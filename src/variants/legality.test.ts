import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestRules } from '../rules/test-rules';
import type { Rules } from '../rules/types';
import { CURATED_VARIANTS } from './catalog';
import { generateVariant } from './generator';
import { positionProblems } from './legality';

let rules: Rules;
beforeAll(async () => {
  rules = await loadTestRules();
});

describe('positionProblems', () => {
  it('blocks a chess position with no black king', () =>
    expect(positionProblems(rules, 'chess', '8/8/8/8/8/8/8/K7 w - - 0 1')).toContain('Black needs a king.'));
  it('reports a missing white king too', () =>
    expect(positionProblems(rules, 'chess', '7k/8/8/8/8/8/8/8 w - - 0 1')).toEqual(['White needs a king.']));
  it('allows Antichess positions without kings, because the king is an ordinary piece there', () =>
    expect(positionProblems(rules, 'antichess', '8/8/8/8/8/8/p7/R7 w - - 0 1')).toEqual([]));
  it('blocks a position where the side not to move is in check', () =>
    expect(positionProblems(rules, 'chess', '4k3/8/8/8/8/8/4R3/4K3 w - - 0 1')).toContain(
      'The side not to move is in check.',
    ));
  it('allows the side to move to be in check', () =>
    expect(positionProblems(rules, 'chess', '4k3/8/8/8/8/8/4r3/4K3 w - - 0 1')).toEqual([]));
  it('returns only the FEN problem for an invalid FEN', () =>
    expect(positionProblems(rules, 'chess', 'nonsense')).toEqual([
      'The position is not a valid FEN for this variant.',
    ]));
  it('treats an unknown variant as an invalid FEN without crashing', () =>
    expect(positionProblems(rules, 'no-such-variant', '8/8/8/8/8/8/8/K7 w - - 0 1')).toEqual([
      'The position is not a valid FEN for this variant.',
    ]));
  it('does not flag no-legal-moves once the game is already over by checkmate', () =>
    expect(positionProblems(rules, 'chess', '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).toEqual([]));
  it('does not flag no-legal-moves once the game is already over by stalemate', () =>
    expect(positionProblems(rules, 'chess', '7k/5Q2/8/6K1/8/8/8/8 b - - 0 1')).toEqual([]));
  it('keeps pockets intact when flipping the side to move', () =>
    expect(positionProblems(rules, 'seirawan', rules.newGame('seirawan').fen())).toEqual([]));
  it('reports an invalid FEN, not a missing king, when a king-less FEN has another defect', () =>
    expect(positionProblems(rules, 'chess', '7k/8/8/8/8/8/8 w - - 0 1')).toEqual([
      'The position is not a valid FEN for this variant.',
    ]));
  it('requires a black king in Spartan', () =>
    expect(positionProblems(rules, 'spartan', '8/8/8/8/8/8/8/4K3 w - - 0 1')).toEqual(['Black needs a king.']));
  it('flips a FEN that has an en passant square and still finds the check', () =>
    expect(positionProblems(rules, 'chess', '4k3/8/8/8/4Pp2/8/4r3/4K3 b - e3 0 1')).toContain(
      'The side not to move is in check.',
    ));
  it('finds a check in a pocket position, with the placement intact', () =>
    expect(positionProblems(rules, 'seirawan', '4k3/8/8/8/8/8/4R3/4K3[HEhe] w - - 0 1')).toContain(
      'The side not to move is in check.',
    ));
  it('accepts a Spartan position with one black king', () =>
    expect(positionProblems(rules, 'spartan', '4k3/8/8/8/8/8/8/4K3 w - - 0 1')).toEqual([]));
  it('accepts the curated start positions', () => {
    for (const v of CURATED_VARIANTS) {
      expect(positionProblems(rules, v.engineName, rules.newGame(v.engineName).fen()), v.id).toEqual([]);
    }
  });

  it("asks for the base variant's kings in a custom variant whose own start position lacks one", () => {
    // A generated variant's start position is the setup itself, so it can't tell which kings are required.
    const fen = '8/8/8/8/8/8/8/K6A w - - 0 1';
    const { name, ini } = generateVariant({
      base: 'chess', files: 8, ranks: 8, pieces: { k: 'king', a: 'archbishop' }, fen, castling: false,
      promotion: { rank: 'last', pieceTypes: ['a'] },
    });
    rules.loadConfig(ini);
    expect(positionProblems(rules, name, fen, 'chess')).toEqual(['Black needs a king.']);
  });
});
