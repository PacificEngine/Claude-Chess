import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadTestRules } from '../rules/test-rules';
import type { Rules } from '../rules/types';
import type { Puzzle } from './lesson';
import { createPuzzleRun, createTryRun, type PuzzleRun } from './runner';

let rules: Rules;
beforeAll(async () => {
  rules = await loadTestRules();
});

/** Puzzle runs hold an ffish game; every run a test opens is disposed after it. */
const open: PuzzleRun[] = [];
afterEach(() => {
  for (const run of open.splice(0)) run.dispose();
});
const puzzleRun = (puzzle: Puzzle): PuzzleRun => {
  const run = createPuzzleRun(rules, 'chess', puzzle);
  open.push(run);
  return run;
};

const fenAfter = (fen: string, moves: string[]): string => {
  const game = rules.newGame('chess', fen);
  try {
    for (const uci of moves) game.push(uci);
    return game.fen();
  } finally {
    game.dispose();
  }
};

/**
 * Ra7 shuts the king on the back rank, so it must go to g8, and then Rb8 and Rc8 both mate. (Rb7 and Rc7 would
 * win too: the runner judges moves, and leaves uniqueness to the content check.)
 */
const START = '7k/8/8/8/8/8/8/RRR1K3 w - - 0 1';
const MATE_IN_2: Puzzle = {
  prompt: 'Mate in two.',
  board: { variant: 'chess', fen: START },
  goal: { kind: 'mate' },
  moves: 2,
  line: ['a1a7', 'h8g8', 'b1b8'],
  hint: '',
};
const SECOND_MATE = 'c1c8';
const NOT_MATE = 'b1b2';

describe('createPuzzleRun', () => {
  it('plays the written reply after the right first move', () => {
    const run = puzzleRun(MATE_IN_2);
    expect(run.play(MATE_IN_2.line[0])).toEqual({ result: 'reply', reply: MATE_IN_2.line[1] });
    expect(run.lastMove()).toBe(MATE_IN_2.line[1]);
    expect(run.turn()).toBe('white');
  });

  it('undoes a wrong first move', () => {
    const run = puzzleRun(MATE_IN_2);
    const start = run.fen();
    const wrong = run.legalFrom(MATE_IN_2.line[0].slice(0, 2)).find((uci) => uci !== MATE_IN_2.line[0]);
    expect(wrong).toBeDefined();
    expect(run.play(wrong!)).toEqual({ result: 'wrong' });
    expect(run.fen()).toBe(start);
    expect(run.lastMove()).toBeNull();
  });

  it('accepts any mating last move', () => {
    const run = puzzleRun(MATE_IN_2);
    run.play(MATE_IN_2.line[0]);
    expect(run.play(SECOND_MATE)).toEqual({ result: 'solved' });
  });

  it('undoes a wrong last move back to after the reply', () => {
    const run = puzzleRun(MATE_IN_2);
    run.play(MATE_IN_2.line[0]);
    const afterReply = fenAfter(START, MATE_IN_2.line.slice(0, 2));
    expect(run.fen()).toBe(afterReply);
    expect(run.play(NOT_MATE)).toEqual({ result: 'wrong' });
    expect(run.fen()).toBe(afterReply);
    expect(run.lastMove()).toBe(MATE_IN_2.line[1]);
  });

  it('stays solved after the last move', () => {
    const run = puzzleRun(MATE_IN_2);
    run.play(MATE_IN_2.line[0]);
    run.play(MATE_IN_2.line[2]);
    const solved = run.fen();
    expect(run.play('e1e2')).toEqual({ result: 'solved' });
    expect(run.fen()).toBe(solved);
  });

  it('refuses every call after dispose, and disposes once', () => {
    const run = createPuzzleRun(rules, 'chess', MATE_IN_2);
    run.dispose();
    expect(() => run.dispose()).not.toThrow();
    for (const call of [() => run.fen(), () => run.turn(), () => run.legalFrom('a1'), () => run.lastMove(), () => run.play('a1a7'), () => run.restart()])
      expect(call).toThrow(/disposed/);
  });

  it('restarts from the puzzle position', () => {
    const run = puzzleRun(MATE_IN_2);
    run.play(MATE_IN_2.line[0]);
    run.restart();
    expect(run.fen()).toBe(fenAfter(START, []));
    expect(run.lastMove()).toBeNull();
  });

  it('solves a one-move puzzle with its first move', () => {
    const puzzle: Puzzle = { ...MATE_IN_2, board: { variant: 'chess', fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1' }, moves: 1, line: ['a1a8'] };
    expect(puzzleRun(puzzle).play('a1a8')).toEqual({ result: 'solved' });
  });

  it('accepts every promotion suffix that forces the goal, and only those', () => {
    // f8=Q mates, and any other promotion lets the king out; but every promotion meets a promote goal.
    const board = { variant: 'chess', fen: '7k/5P1p/8/8/8/8/8/6K1 w - - 0 1' } as const;
    const mate: Puzzle = { ...MATE_IN_2, board, moves: 1, line: ['f7f8q'] };
    expect(puzzleRun(mate).play('f7f8n')).toEqual({ result: 'wrong' });
    expect(puzzleRun(mate).play('f7f8q')).toEqual({ result: 'solved' });
    const promote: Puzzle = { ...mate, goal: { kind: 'promote' } };
    for (const uci of ['f7f8q', 'f7f8r', 'f7f8b', 'f7f8n'])
      expect(puzzleRun(promote).play(uci), uci).toEqual({ result: 'solved' });
  });
});

describe('a puzzle whose reply is illegal after a sibling key', () => {
  // f8=Q has the key's squares and mates at once, so it is a right first move, but Kg7 can't follow it.
  const puzzle: Puzzle = {
    ...MATE_IN_2,
    board: { variant: 'chess', fen: '7k/5P1p/8/8/8/8/8/6K1 w - - 0 1' },
    line: ['f7f8r', 'h8g7', 'f8f7'],
  };

  it("throws a clear error and takes the player's move back", () => {
    const run = puzzleRun(puzzle);
    const start = run.fen();
    expect(() => run.play('f7f8q')).toThrow(/reply h8g7 is not legal after f7f8q/);
    expect(run.fen()).toBe(start);
    expect(run.lastMove()).toBeNull();
  });
});

describe('createTryRun', () => {
  // The rook on d4 with both kings out of its way. b6 and g2 each take two moves.
  const FEN = '7k/8/8/8/3R4/8/8/K7 w - - 0 1';

  it('a try run hands the turn back and reports each target', () => {
    const run = createTryRun(rules, 'chess', FEN, 'd4', ['b6', 'g2']);
    expect(run.play('d4d6')).toBe('moved');
    expect(run.fen().split(' ')[1]).toBe('w');
    expect(run.play('d6b6')).toBe('target');
    expect(run.play('b6b2')).toBe('moved');
    expect(run.play('b2g2')).toBe('done');
  });

  it('moves only the taught piece', () => {
    const run = createTryRun(rules, 'chess', FEN, 'd4', ['b6']);
    expect(run.legalFrom('a1')).toEqual([]);
    expect(run.play('a1a2')).toBe('illegal');
    expect(run.legalFrom('d4')).toContain('d4d7');
    run.play('d4d6');
    expect(run.legalFrom('d4')).toEqual([]);
    expect(run.legalFrom('d6')).toContain('d6b6');
  });

  it('never lets the piece give check, so it can never take the king', () => {
    const run = createTryRun(rules, 'chess', FEN, 'd4', ['b6']);
    expect(run.legalFrom('d4')).not.toContain('d4h4');
    expect(run.legalFrom('d4')).not.toContain('d4d8');
  });

  it('names the first target not reached yet, and null once all are', () => {
    const run = createTryRun(rules, 'chess', FEN, 'd4', ['b6', 'g2']);
    expect(run.nextTarget()).toBe('b6');
    // Reaching a later target first leaves the earlier one next.
    run.play('d4g4');
    expect(run.play('g4g2')).toBe('target');
    expect(run.nextTarget()).toBe('b6');
    run.play('g2b2');
    expect(run.play('b2b6')).toBe('done');
    expect(run.nextTarget()).toBeNull();
    run.restart();
    expect(run.nextTarget()).toBe('b6');
  });

  it('restarts from the board', () => {
    const run = createTryRun(rules, 'chess', FEN, 'd4', ['b6']);
    run.play('d4d6');
    run.restart();
    expect(run.fen()).toBe(FEN);
    expect(run.play('d4d6')).toBe('moved');
    expect(run.play('d6b6')).toBe('done');
  });
});
