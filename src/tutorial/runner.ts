// The state of a Try it step and of one puzzle as the player moves. Pure logic over the rules library: no DOM
// or UI imports, so the content check can use the same rules the lesson view plays by.
import type { Color, Rules } from '../rules/types';
import { uciSquares } from '../variants/fen';
import { goalMet, startOf, trackAfter } from './goals';
import { boardFen, type Puzzle } from './lesson';
import { forcesGoal } from './solver';

/** A position with White to move again. En passant and the move counters are reset. */
function handBack(fen: string): string {
  const fields = fen.split(' ');
  fields[1] = 'w';
  if (fields.length > 3) fields[3] = '-';
  if (fields.length > 5) fields.splice(4, 2, '0', '1');
  return fields.join(' ');
}

/**
 * The taught piece's moves in a Try it position, each with the position after it, White to move again. A move
 * that gives check is left out: with the turn handed back, the piece could next take the king.
 */
export function tryMoves(rules: Rules, variant: string, fen: string, square: string): { uci: string; fen: string }[] {
  const game = rules.newGame(variant, fen);
  try {
    return game.legalMovesFrom(square).flatMap((uci) => {
      game.push(uci);
      try {
        return game.inCheck() ? [] : [{ uci, fen: handBack(game.fen()) }];
      } finally {
        game.pop();
      }
    });
  } finally {
    game.dispose();
  }
}

export type TryResult = 'moved' | 'target' | 'done' | 'illegal';

export interface TryRun {
  fen(): string;
  /** The taught piece's moves, as UCI; empty for any other square. */
  legalFrom(square: string): string[];
  /** 'target' when the move reaches a target not reached before, 'done' when it was the last one. */
  play(uci: string): TryResult;
  /** The first target, in the step's order, not reached yet; null once every one is. */
  nextTarget(): string | null;
  restart(): void;
}

/** Only the piece on `square` moves, and White moves again after every move. */
export function createTryRun(rules: Rules, variant: string, fen: string, square: string, targets: string[]): TryRun {
  let position = fen;
  let at = square;
  let reached = new Set<string>();
  const moves = () => tryMoves(rules, variant, position, at);
  return {
    fen: () => position,
    legalFrom: (sq) => (sq === at ? moves().map((m) => m.uci) : []),
    play(uci) {
      const move = moves().find((m) => m.uci === uci);
      if (!move) return 'illegal';
      position = move.fen;
      at = uciSquares(uci).to;
      if (!targets.includes(at) || reached.has(at)) return 'moved';
      reached.add(at);
      return reached.size === new Set(targets).size ? 'done' : 'target';
    },
    nextTarget: () => targets.find((t) => !reached.has(t)) ?? null,
    restart() {
      position = fen;
      at = square;
      reached = new Set();
    },
  };
}

export type PuzzleResult = { result: 'wrong' } | { result: 'reply'; reply: string } | { result: 'solved' };

export interface PuzzleRun {
  fen(): string;
  turn(): Color;
  legalFrom(square: string): string[];
  /** The last move on the board (the written reply, after a right first move), or null at the start. */
  lastMove(): string | null;
  /** A wrong move is taken back, so the position is the one before it. Once solved, play only says 'solved'. */
  play(uci: string): PuzzleResult;
  restart(): void;
  /** Frees the game. A second call does nothing; any other call afterwards throws. */
  dispose(): void;
}

/**
 * A puzzle as the player solves it. The first move is right when it has `line[0]`'s squares and is `line[0]`
 * or also forces the goal (another promotion or gating suffix); the written reply is then played. The last
 * move is right when it meets the goal.
 */
export function createPuzzleRun(rules: Rules, variant: string, puzzle: Puzzle): PuzzleRun {
  const { goal, moves, line } = puzzle;
  const start = boardFen(puzzle.board);
  const key = uciSquares(line[0]);
  let game = rules.newGame(variant, start);
  let played: string[] = [];
  let tracked = startOf(goal);
  let solved = false;

  const push = (uci: string) => {
    game.push(uci);
    played.push(uci);
    tracked = trackAfter(goal, tracked, uci);
  };
  const isKey = (uci: string): boolean => {
    const { from, to } = uciSquares(uci);
    return from === key.from && to === key.to && (uci === line[0] || forcesGoal(rules, variant, start, goal, moves, uci));
  };
  /** Whether `uci`, pushed as the last move, meets the goal; a miss (or a failed judgement) is popped again. */
  const meetsGoal = (uci: string): boolean => {
    game.push(uci);
    let met = false;
    try {
      met = goalMet(game, goal, tracked, uci);
    } finally {
      if (met) played.push(uci);
      else game.pop();
    }
    return met;
  };
  let disposed = false;
  /** The live game; throws once the run is disposed, rather than touching a freed ffish board. */
  const live = () => {
    if (disposed) throw new Error('This puzzle run was disposed');
    return game;
  };

  return {
    fen: () => live().fen(),
    turn: () => live().turn(),
    legalFrom(square) {
      const board = live();
      return solved ? [] : board.legalMovesFrom(square);
    },
    lastMove() {
      live();
      return played.at(-1) ?? null;
    },
    play(uci) {
      live();
      if (solved) return { result: 'solved' };
      if (!game.legalMoves().includes(uci)) return { result: 'wrong' };
      if (played.length === 0) {
        if (!isKey(uci)) return { result: 'wrong' };
        if (moves === 1) {
          push(uci);
          solved = true;
          return { result: 'solved' };
        }
        push(uci);
        if (!game.legalMoves().includes(line[1])) {
          // The content check rules this out; never leave the run half-way through a move pair.
          game.pop();
          played = [];
          tracked = startOf(goal);
          throw new Error(`The puzzle's reply ${line[1]} is not legal after ${uci}`);
        }
        push(line[1]);
        return { result: 'reply', reply: line[1] };
      }
      if (!meetsGoal(uci)) return { result: 'wrong' };
      solved = true;
      return { result: 'solved' };
    },
    restart() {
      // The new game first: if newGame throws, the run still holds its old, live game rather than a freed one.
      // (live() comes before it, so a disposed run makes no game to leak.)
      const old = live();
      const fresh = rules.newGame(variant, start);
      old.dispose();
      game = fresh;
      played = [];
      tracked = startOf(goal);
      solved = false;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      game.dispose();
    },
  };
}
