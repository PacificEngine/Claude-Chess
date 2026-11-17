import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestRules } from '../rules/test-rules';
import type { Rules } from '../rules/types';
import { goalMet, trackAfter } from './goals';
import type { Goal } from './lesson';

let rules: Rules;
beforeAll(async () => {
  rules = await loadTestRules();
});

/** Plays `uci` in a chess position and judges `goal` the way a lesson does: after the move is pushed. */
function judge(fen: string, uci: string, goal: Goal, tracked: string | null = null): boolean {
  const game = rules.newGame('chess', fen);
  try {
    game.push(uci);
    return goalMet(game, goal, tracked, uci);
  } finally {
    game.dispose();
  }
}

const SIMPLE: Goal[] = [{ kind: 'mate' }, { kind: 'stalemate' }, { kind: 'castle' }, { kind: 'enPassant' }, { kind: 'promote' }];
/** The goals of SIMPLE a move meets. */
const met = (fen: string, uci: string) => SIMPLE.filter((g) => judge(fen, uci, g)).map((g) => g.kind);

describe('goalMet', () => {
  it('sees mate, stalemate, castling, en passant and promotion', () => {
    expect(met('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'a1a8')).toEqual(['mate']);
    expect(met('7k/8/5Q2/8/8/8/8/K7 w - - 0 1', 'f6f7')).toEqual(['stalemate']);
    expect(met('4k3/8/8/8/8/8/8/4K2R w K - 0 1', 'e1g1')).toEqual(['castle']);
    expect(met('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'e5d6')).toEqual(['enPassant']);
    expect(met('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1', 'e4d5')).toEqual([]);
    expect(met('2k5/P7/8/8/8/8/8/4K3 w - - 0 1', 'a7a8q')).toEqual(['promote']);
    expect(met('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', 'e2e4')).toEqual([]);
  });

  it('counts a capture of the tracked piece only', () => {
    const fen = '4k3/8/8/2p1p3/3P4/8/8/4K3 w - - 0 1';
    expect(judge(fen, 'd4e5', { kind: 'capture', square: 'e5' }, 'e5')).toBe(true);
    expect(judge(fen, 'd4c5', { kind: 'capture', square: 'e5' }, 'e5')).toBe(false);
  });

  it('counts nothing when the tracked piece has left its square unseen', () => {
    // Black castles with the tracked rook, so h8 is empty when White's rook lands there.
    const game = rules.newGame('chess', '4k2r/8/8/8/8/8/7R/4K3 b k - 0 1');
    const goal: Goal = { kind: 'capture', square: 'h8' };
    try {
      game.push('e8g8');
      game.push('h2h8');
      expect(goalMet(game, goal, 'h8', 'h2h8')).toBe(false);
    } finally {
      game.dispose();
    }
  });

  it('counts an en passant capture of the tracked pawn', () => {
    const fen = '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1';
    expect(judge(fen, 'e5d6', { kind: 'capture', square: 'd5' }, 'd5')).toBe(true);
  });

  it('counts a reach by the tracked piece onto the target only', () => {
    const fen = '4k3/8/8/8/8/8/8/R3K2R w - - 0 1';
    const goal: Goal = { kind: 'reach', from: 'a1', to: 'a8' };
    expect(judge(fen, 'a1a8', goal, 'a1')).toBe(true);
    expect(judge(fen, 'a1a7', goal, 'a1')).toBe(false);
    expect(judge(fen, 'h1h8', { kind: 'reach', from: 'a1', to: 'h8' }, 'a1')).toBe(false);
  });

  it('leaves the game as the move left it', () => {
    const game = rules.newGame('chess', '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
    try {
      game.push('e5d6');
      const fen = game.fen();
      goalMet(game, { kind: 'enPassant' }, null, 'e5d6');
      goalMet(game, { kind: 'castle' }, null, 'e5d6');
      expect(game.fen()).toBe(fen);
    } finally {
      game.dispose();
    }
  });
});

describe('trackAfter', () => {
  const goal: Goal = { kind: 'capture', square: 'e5' };

  it('follows a captured target that moved first', () => {
    expect(trackAfter(goal, 'e5', 'e5e4')).toBe('e4');
  });

  it('keeps the square when another piece moves', () => {
    expect(trackAfter(goal, 'e5', 'd7d6')).toBe('e5');
  });

  it('loses the piece when it is captured', () => {
    expect(trackAfter({ kind: 'reach', from: 'a1', to: 'a8' }, 'a1', 'h8a1')).toBeNull();
  });

  it('tracks nothing for goals with no piece', () => {
    expect(trackAfter({ kind: 'mate' }, null, 'e2e4')).toBeNull();
  });
});
