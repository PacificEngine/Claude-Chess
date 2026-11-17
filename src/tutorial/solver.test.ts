import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestRules } from '../rules/test-rules';
import type { Rules } from '../rules/types';
import { forcedWins, forcesGoal } from './solver';

let rules: Rules;
beforeAll(async () => {
  rules = await loadTestRules();
});

describe('forcedWins', () => {
  it('finds the one back-rank mate in 1', () =>
    expect(forcedWins(rules, 'chess', '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', { kind: 'mate' }, 1)).toEqual(['a1a8']));

  it('finds a mate in 2 against every defence', () => {
    // No mate in 1 (Ra8+ Kh7, Rh7+ Kxh7). Kg6 leaves only Kg8, and then Ra8 mates.
    expect(forcedWins(rules, 'chess', '7k/R7/5K2/8/8/8/8/8 w - - 0 1', { kind: 'mate' }, 2)).toEqual(['f6g6']);
  });

  it('leaves out a move that does not force the goal', () => {
    // Ra8+ lets the king out to h7.
    expect(forcedWins(rules, 'chess', '7k/R7/5K2/8/8/8/8/8 w - - 0 1', { kind: 'mate' }, 2)).not.toContain('a7a8');
  });

  it('rejects a key that a defence refutes', () => {
    // As above, but Black's rook answers Kg6 with Rg1+, and Ra8+ with Rb8.
    expect(forcedWins(rules, 'chess', '7k/R7/5K2/8/8/8/8/1r6 w - - 0 1', { kind: 'mate' }, 2)).toEqual([]);
  });

  it('returns several keys when several win', () => {
    const keys = forcedWins(rules, 'chess', '6k1/5ppp/8/8/8/8/8/R2R2K1 w - - 0 1', { kind: 'mate' }, 1);
    expect([...keys].sort()).toEqual(['a1a8', 'd1d8']);
  });

  it('judges only the first moves from the given squares', () => {
    const keys = forcedWins(rules, 'chess', '6k1/5ppp/8/8/8/8/8/R2R2K1 w - - 0 1', { kind: 'mate' }, 1, ['d1']);
    expect(keys).toEqual(['d1d8']);
  });

  it('does not count a first move that leaves no reply without meeting the goal', () => {
    // Rg7 stalemates: the rook can't then reach h7, and stalemate is not the goal.
    const keys = forcedWins(rules, 'chess', '7k/R7/5K2/8/8/8/8/8 w - - 0 1', { kind: 'reach', from: 'a7', to: 'h8' }, 2);
    expect(keys).not.toContain('a7g7');
  });

  it('follows the target through the reply', () => {
    // Black can only move the knight on h8, to g6 or f7. After Rg7 the rook takes it on either square.
    const keys = forcedWins(rules, 'chess', 'k6n/p1K5/P7/8/8/8/8/6R1 w - - 0 1', { kind: 'capture', square: 'h8' }, 2);
    expect(keys).toContain('g1g7');
  });

  it('does not play on after a first move that ends the game', () => {
    // Nxa3 leaves king and knight against king: a draw, so the knight never gets to c4. Nd2 gets there.
    const keys = forcedWins(rules, 'chess', 'k7/8/8/8/8/p7/8/1N5K w - - 0 1', { kind: 'reach', from: 'b1', to: 'c4' }, 2);
    expect(keys).toContain('b1d2');
    expect(keys).not.toContain('b1a3');
  });

  it('counts a reply that ends the game as a defence', () => {
    // Whatever White plays, Kxa7 leaves king and knight against king, a draw.
    expect(forcedWins(rules, 'chess', 'k7/P7/8/8/8/8/8/1N5K w - - 0 1', { kind: 'reach', from: 'b1', to: 'c4' }, 2)).toEqual([]);
  });
});

/** f8=Q mates (it covers g7); a rook, bishop or knight lets the king out. */
const PROMOTION = '7k/5P1p/8/8/8/8/8/6K1 w - - 0 1';
const PROMOTIONS = ['f7f8q', 'f7f8r', 'f7f8b', 'f7f8n'];

describe('a promotion first move', () => {
  it('is found with its suffix', () => {
    expect(forcedWins(rules, 'chess', PROMOTION, { kind: 'mate' }, 1)).toEqual(['f7f8q']);
  });
});

describe('forcesGoal', () => {
  it('rejects the promotions that do not mate, and accepts every promotion for a promote goal', () => {
    expect(forcesGoal(rules, 'chess', PROMOTION, { kind: 'mate' }, 1, 'f7f8q')).toBe(true);
    expect(forcesGoal(rules, 'chess', PROMOTION, { kind: 'mate' }, 1, 'f7f8n')).toBe(false);
    for (const uci of PROMOTIONS) expect(forcesGoal(rules, 'chess', PROMOTION, { kind: 'promote' }, 1, uci), uci).toBe(true);
  });

  it('judges a two-move first move as forcedWins does', () => {
    const fen = '7k/R7/5K2/8/8/8/8/8 w - - 0 1';
    expect(forcesGoal(rules, 'chess', fen, { kind: 'mate' }, 2, 'f6g6')).toBe(true);
    expect(forcesGoal(rules, 'chess', fen, { kind: 'mate' }, 2, 'a7a8')).toBe(false);
  });
});
