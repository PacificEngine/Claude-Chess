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

describe('positionProblems: Xiangqi and Shogi placement', () => {
  // Each FEN below is one ffish accepts (validateFen) though the game forbids it: these rules are ours.
  const XQ = (rank2: string, rank1 = 'RNBAKABNR', rest = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1') => `${rest}/${rank2}/${rank1} w - - 0 1`;
  const xq = (fen: string) => {
    expect(rules.validateFen('xiangqi', fen), fen).toBe(true);
    return positionProblems(rules, 'xiangqi', fen);
  };
  const sh = (fen: string) => {
    expect(rules.validateFen('shogi', fen), fen).toBe(true);
    return positionProblems(rules, 'shogi', fen);
  };

  it("keeps each Xiangqi general in its own palace", () => {
    expect(xq(XQ('K8', 'RNBA1ABNR'))).toEqual(["White's general must stay inside its palace."]);
    expect(xq('rnba1abnr/9/1c5c1/p1p1p1p1p/k8/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1')).toEqual(["Black's general must stay inside its palace."]);
    expect(xq(XQ('3K5', 'RNBA1ABNR'))).toEqual([]); // d2 is in the palace
  });

  it("keeps Xiangqi advisors on the palace's diagonal points", () => {
    expect(xq(XQ('A8', 'RNB1KABNR'))).toEqual(["White's advisors must stay on the diagonal points of its palace."]);
    expect(xq(XQ('3A5', 'RNB1KABNR'))).toEqual(["White's advisors must stay on the diagonal points of its palace."]); // d2: in the palace, off the diagonals
    expect(xq(XQ('4A4', 'RNB1KABNR'))).toEqual([]); // e2, the palace's centre
    expect(xq('rnb1kabnr/4a4/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1')).toEqual([]); // e9
    expect(xq('rnb1kabnr/9/1c1a3c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1')).toEqual([]); // d8
  });

  it('keeps Xiangqi elephants on their own side of the river, on the elephant points', () => {
    const across = 'rnbakabnr/9/1c5c1/p1p1p1p1p/4B4/9/P1P1P1P1P/1C5C1/9/RN1AKABNR w - - 0 1'; // e6
    expect(xq(across)).toEqual(["White's elephants must stay on their own side of the river, on the elephant points."]);
    expect(xq(XQ('4B4', 'RN1AKABNR'))).toEqual(["White's elephants must stay on their own side of the river, on the elephant points."]); // e2
    expect(xq('rnbakabnr/9/1c5c1/p1p1p1p1p/9/2B6/P1P1P1P1P/1C5C1/9/RN1AKABNR w - - 0 1')).toEqual([]); // c5
    expect(xq('rn1akabnr/9/1c5c1/p1p1p1p1p/9/2b6/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1')).toEqual(["Black's elephants must stay on their own side of the river, on the elephant points."]); // c5
    expect(xq('rn1akabnr/9/1c2b2c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1')).toEqual([]); // e8
  });

  it('keeps Xiangqi soldiers from standing behind their start rank', () => {
    expect(xq(XQ('P8'))).toEqual(["White's soldiers can't stand behind their starting rank."]);
    expect(xq('rnbakabnr/p8/1c5c1/2p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1')).toEqual(["Black's soldiers can't stand behind their starting rank."]);
    expect(xq('rnbakabnr/9/1c5c1/p1p1p1p1p/9/P8/2P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1')).toEqual([]); // a5
    expect(xq('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNp w - - 0 1')).toEqual([]); // a Black soldier deep in White's camp
  });

  it('keeps the Xiangqi generals from facing each other on an open file (the flying general rule)', () => {
    const facing = 'The generals face each other on an open file.';
    expect(xq('3k5/9/9/9/9/9/9/9/9/3K5 w - - 0 1')).toEqual([facing]);
    expect(xq('4k4/9/9/9/9/9/9/9/4K4/9 w - - 0 1')).toEqual([facing]);
    expect(xq('3k5/9/9/9/3p5/9/9/9/9/3K5 w - - 0 1')).toEqual([]); // a piece between them
    expect(xq('3k5/9/9/9/9/9/9/9/9/4K4 w - - 0 1')).toEqual([]); // on different files
  });

  it('keeps Shogi pawns and lances off their last rank, and knights off their last two', () => {
    const last = "White has a pawn or lance on its last rank, where it could never move.";
    expect(sh('P3k4/9/9/9/9/9/9/9/4K4[] w - - 0 1')).toEqual([last]);
    expect(sh('L3k4/9/9/9/9/9/9/9/4K4[] w - - 0 1')).toEqual([last]);
    expect(sh('4k4/9/9/9/9/9/9/9/p3K4[] w - - 0 1')).toEqual(["Black has a pawn or lance on its last rank, where it could never move."]);
    expect(sh('4k4/N8/9/9/9/9/9/9/4K4[] w - - 0 1')).toEqual(["White has a knight on its last two ranks, where it could never move."]);
    expect(sh('4k4/9/9/9/9/9/9/n8/4K4[] w - - 0 1')).toEqual(["Black has a knight on its last two ranks, where it could never move."]);
    // Promoted, they move as golds; and each side's own back ranks are free.
    expect(sh('+P+L2k4/+N8/9/9/9/9/9/9/4K4[] w - - 0 1')).toEqual([]);
    expect(sh('4k4/9/9/9/9/9/9/N8/PL2K4[] w - - 0 1')).toEqual([]);
  });

  it('allows one unpromoted Shogi pawn per side on a file (no nifu)', () => {
    expect(sh('4k4/9/9/9/P8/9/P8/9/4K4[] w - - 0 1')).toEqual(['White has two unpromoted pawns on one file.']);
    expect(sh('4k4/9/p8/9/p8/9/9/9/4K4[] w - - 0 1')).toEqual(['Black has two unpromoted pawns on one file.']);
    expect(sh('4k4/9/9/9/+P8/9/P8/9/4K4[] w - - 0 1')).toEqual([]);
    expect(sh('4k4/9/p8/9/9/9/P8/9/4K4[] w - - 0 1')).toEqual([]);
  });

  it('passes every start position, and leaves other variants alone', () => {
    for (const v of CURATED_VARIANTS) {
      const g = rules.newGame(v.engineName);
      expect(positionProblems(rules, v.engineName, g.fen()), v.id).toEqual([]);
      g.dispose();
    }
    // A chess pawn on the first rank is the engine's business, not these rules'.
    expect(positionProblems(rules, 'chess', '4k3/8/8/8/8/8/8/P3K3 w - - 0 1')).not.toContain('White has a pawn or lance on its last rank, where it could never move.');
  });
});
