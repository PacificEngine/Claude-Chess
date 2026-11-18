import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestRules } from './test-rules';
import { parseUci, pieceOn } from '../variants/fen';
import type { Rules } from './types';

// Hand-built positions. Each one is checked with validateFen below so a typo can't make a test pass vacuously.
const FEN_ANTI_FORCED_CAPTURE = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w - - 0 2';
// Black's only piece is a pawn blocked by White's pawn, so Black to move has no moves.
const FEN_ANTI_STALEMATE = '8/8/8/8/8/p7/P7/7K b - - 0 1';
// Every White piece but the king has been captured, so Grand lets the a9 pawn promote to any of them.
const FEN_GRAND_PAWN_ON_9TH = '9k/P9/10/10/10/10/10/10/10/K9 w - - 0 1';
// Black (Spartan) has lost one of its two kings (the one on e8).
const FEN_SPARTAN_ONE_KING_CAPTURED = 'lg2ckwl/hhhhhhhh/8/8/8/8/PPPPPPPP/RNBQKBNR w KQ - 0 1';
const FEN_FOOLS_MATE = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
const FEN_STALEMATE = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1';
const FEN_KN_V_K = '8/8/8/8/8/2k5/8/KN6 w - - 0 1';
const FEN_KR_V_K = '8/8/8/8/8/2k5/8/K6R w - - 0 1';
const FEN_FIFTY_MOVES = '8/8/8/8/8/2k5/8/K6R w - - 100 80';
// White king on a10 and rook on a1, so moves from both squares start with "a1".
const FEN_GRAND_A1_AND_A10 = 'K8k/10/10/10/10/10/10/10/10/R9 w - - 0 1';
// White's rook on a5 can take Black's bishop on e5.
const FEN_SHOGI_ROOK_TAKES_BISHOP = '4k4/9/9/9/R3b4/9/9/9/4K4[] w - - 0 1';
// White has a bishop in hand and an otherwise bare board.
const FEN_SHOGI_BISHOP_IN_HAND = '4k4/9/9/9/9/9/9/9/4K4[B] w - - 0 1';
// White has a pawn on e3 and another in hand, so a second pawn can't go on the e-file.
const FEN_SHOGI_PAWN_IN_HAND = '4k4/9/9/9/9/9/4P4/9/4K4[P] w - - 0 1';
// White's pawns on e7 (one step from the 8th rank) and c8 (one step from the last rank).
const FEN_SHOGI_PAWNS_NEAR_THE_END = 'k8/2P6/4P4/9/9/9/9/9/4K4[] w - - 0 1';
// Black's general on d10 and White's on e1: the d-file is open between d1 and d10.
const FEN_XIANGQI_GENERALS = '3k5/9/9/9/9/9/9/9/9/4K4 w - - 0 1';
// White's cannon on a1 looks up an open a-file at Black's chariot on a5; in the second, a soldier on its start
// square a4 screens it (a soldier can never stand behind its start rank).
const FEN_XIANGQI_CANNON_NO_SCREEN = '5k3/9/9/9/9/r8/9/9/9/C2K5 w - - 0 1';
const FEN_XIANGQI_CANNON_SCREENED = '5k3/9/9/9/9/r8/P8/9/9/C2K5 w - - 0 1';
// Duck Chess: White's rook on e2 looks up an open e-file at Black's king on e8; the duck stands on a1.
const FEN_DUCK_ROOK_TAKES_KING = '4k3/8/8/8/8/8/4R3/*3K3 w - - 0 1';

const FENS: [string, string][] = [
  ['antichess', FEN_ANTI_FORCED_CAPTURE],
  ['antichess', FEN_ANTI_STALEMATE],
  ['grand', FEN_GRAND_PAWN_ON_9TH],
  ['spartan', FEN_SPARTAN_ONE_KING_CAPTURED],
  ['chess', FEN_FOOLS_MATE],
  ['chess', FEN_STALEMATE],
  ['chess', FEN_KN_V_K],
  ['chess', FEN_KR_V_K],
  ['chess', FEN_FIFTY_MOVES],
  ['grand', FEN_GRAND_A1_AND_A10],
  ['shogi', FEN_SHOGI_ROOK_TAKES_BISHOP],
  ['shogi', FEN_SHOGI_BISHOP_IN_HAND],
  ['shogi', FEN_SHOGI_PAWN_IN_HAND],
  ['shogi', FEN_SHOGI_PAWNS_NEAR_THE_END],
  ['xiangqi', FEN_XIANGQI_GENERALS],
  ['xiangqi', FEN_XIANGQI_CANNON_NO_SCREEN],
  ['xiangqi', FEN_XIANGQI_CANNON_SCREENED],
  ['duck', FEN_DUCK_ROOK_TAKES_KING],
];

let rules: Rules;
beforeAll(async () => {
  rules = await loadTestRules();
});

it('accepts every hand-built test position as a legal FEN', () => {
  for (const [variant, fen] of FENS) expect(rules.validateFen(variant, fen), `${variant} ${fen}`).toBe(true);
});

it('rejects a malformed FEN', () => expect(rules.validateFen('chess', 'not a fen')).toBe(false));

it('refuses an unknown variant with an error instead of crashing the wasm module', () => {
  expect(() => rules.newGame('no-such-variant')).toThrow(/unknown variant/i);
  expect(rules.validateFen('no-such-variant', FEN_FOOLS_MATE)).toBe(false);
  // The module must still work afterwards.
  expect(rules.newGame('chess').legalMoves()).toHaveLength(20);
});

it('refuses an invalid starting FEN', () => expect(() => rules.newGame('chess', 'not a fen')).toThrow(/fen/i));

describe('antichess', () => {
  it('forces a capture when one is available', () => {
    const g = rules.newGame('antichess', FEN_ANTI_FORCED_CAPTURE);
    expect(g.legalMoves()).toEqual(['e4d5']);
  });
  it('awards the win to the side that is stalemated', () => {
    const g = rules.newGame('antichess', FEN_ANTI_STALEMATE);
    expect(g.result()).toEqual({ winner: 'black', reason: 'variant' });
  });
});

it('offers Seirawan gating moves after a back-rank piece first moves', () =>
  expect(rules.newGame('seirawan').legalMoves()).toContain('g1f3h'));

it('offers every Grand promotion piece, not only the queen', () =>
  expect(
    rules.newGame('grand', FEN_GRAND_PAWN_ON_9TH).legalMoves().filter((m) => m.startsWith('a9a10')).length,
  ).toBeGreaterThan(1));

it('does not call a Spartan game over while one of two kings survives', () =>
  expect(rules.newGame('spartan', FEN_SPARTAN_ONE_KING_CAPTURED).result()).toBeNull());

it('reports checkmate with the winner', () =>
  expect(rules.newGame('chess', FEN_FOOLS_MATE).result()).toEqual({ winner: 'black', reason: 'checkmate' }));

it('reports stalemate as a draw in standard chess', () =>
  expect(rules.newGame('chess', FEN_STALEMATE).result()).toEqual({ winner: null, reason: 'stalemate' }));

it('reports a draw when neither side can mate', () =>
  expect(rules.newGame('chess', FEN_KN_V_K).result()).toEqual({ winner: null, reason: 'insufficient' }));

it('ends the game at the fifty-move rule without waiting for a claim', () =>
  expect(rules.newGame('chess', FEN_FIFTY_MOVES).result()).toEqual({ winner: null, reason: 'fifty-move' }));

it('ends the game on threefold repetition without waiting for a claim', () => {
  const g = rules.newGame('chess');
  for (let i = 0; i < 2; i++) for (const m of ['g1f3', 'g8f6', 'f3g1', 'f6g8']) g.push(m);
  expect(g.result()).toEqual({ winner: null, reason: 'repetition' });
});

it('returns null while the game is still going', () => expect(rules.newGame('chess').result()).toBeNull());

it('tells which side lacks mating material, for timeout draws', () => {
  const g = rules.newGame('chess', FEN_KR_V_K);
  expect(g.hasInsufficientMaterial('white')).toBe(false);
  expect(g.hasInsufficientMaterial('black')).toBe(true);
});

describe('a game', () => {
  it('plays and takes back moves, tracking the side to move and the FEN', () => {
    const g = rules.newGame('chess');
    const start = g.fen();
    expect(g.turn()).toBe('white');
    expect(g.san('g1f3')).toBe('Nf3');
    g.push('g1f3');
    expect(g.turn()).toBe('black');
    expect(g.fen()).not.toBe(start);
    g.pop();
    expect(g.fen()).toBe(start);
    g.dispose();
  });

  it('lists legal moves from one square only', () =>
    expect(rules.newGame('chess').legalMovesFrom('g1').sort()).toEqual(['g1f3', 'g1h3']));

  it('does not mix up a1 and a10 on a ten-rank board', () => {
    const g = rules.newGame('grand', FEN_GRAND_A1_AND_A10);
    expect(g.legalMovesFrom('a1').length).toBeGreaterThan(0);
    expect(g.legalMovesFrom('a1').every((m) => /^a1[a-j]/.test(m))).toBe(true);
    expect(g.legalMovesFrom('a10').every((m) => m.startsWith('a10'))).toBe(true);
  });

  it('rejects an illegal move instead of silently ignoring it', () => {
    const g = rules.newGame('chess');
    const start = g.fen();
    expect(() => g.push('e2e5')).toThrow(/illegal/i);
    expect(g.fen()).toBe(start);
  });
});

// The rules come from ffish; these check the app reads them as the spec describes.
describe('shogi', () => {
  it('puts a captured piece in the capturer\'s hand', () => {
    const g = rules.newGame('shogi', FEN_SHOGI_ROOK_TAKES_BISHOP);
    g.push('a5e5');
    expect(g.fen().split(' ')[0]).toMatch(/\[B\]$/);
    g.dispose();
  });

  it('lets a piece in hand be dropped on an empty square', () => {
    const g = rules.newGame('shogi', FEN_SHOGI_BISHOP_IN_HAND);
    expect(g.legalMoves()).toContain('B@e5');
    expect(g.san('B@e5')).toBe('B@e5');
    g.push('B@e5');
    expect(g.fen().split(' ')[0]).toBe('4k4/9/9/9/4B4/9/9/9/4K4[]');
    g.dispose();
  });

  it('refuses a second pawn on a file that already has one', () => {
    const g = rules.newGame('shogi', FEN_SHOGI_PAWN_IN_HAND);
    expect(g.legalMoves()).toContain('P@d5');
    expect(g.legalMoves()).not.toContain('P@e5');
    g.dispose();
  });

  it('offers a choice when promotion is optional, and only the promotion when it is forced', () => {
    const g = rules.newGame('shogi', FEN_SHOGI_PAWNS_NEAR_THE_END);
    expect(g.legalMovesFrom('e7').sort()).toEqual(['e7e8', 'e7e8+']);
    expect(g.legalMovesFrom('c8')).toEqual(['c8c9+']);
    g.dispose();
  });
});

describe('xiangqi', () => {
  it('never lets the generals face each other on an open file', () => {
    const g = rules.newGame('xiangqi', FEN_XIANGQI_GENERALS);
    expect(g.legalMovesFrom('e1')).toContain('e1f1');
    expect(g.legalMovesFrom('e1')).not.toContain('e1d1');
    g.dispose();
  });

  it('lets a cannon capture only over a screen', () => {
    const open = rules.newGame('xiangqi', FEN_XIANGQI_CANNON_NO_SCREEN);
    expect(open.legalMovesFrom('a1')).toContain('a1a4');
    expect(open.legalMovesFrom('a1')).not.toContain('a1a5');
    open.dispose();
    const screened = rules.newGame('xiangqi', FEN_XIANGQI_CANNON_SCREENED);
    expect(screened.legalMovesFrom('a1')).toContain('a1a5');
    screened.dispose();
  });
});

describe('duck', () => {
  it('starts with no duck, and pairs every first move with a duck square', () => {
    const g = rules.newGame('duck');
    expect(g.fen().split(' ')[0]).not.toContain('*');
    const moves = g.legalMoves();
    expect(moves.length).toBeGreaterThan(0);
    for (const uci of moves) expect(parseUci(uci)?.duck, uci).toMatch(/^[a-h][1-8]$/);
    g.dispose();
  });

  it('puts the duck on its square after the move, and writes the SAN as the move then the duck', () => {
    const g = rules.newGame('duck');
    expect(g.san('g1f3,f3e5')).toBe('Nf3,e5');
    g.push('g1f3,f3e5');
    expect(pieceOn(g.fen(), 'e5')).toBe('*');
    expect(pieceOn(g.fen(), 'f3')).toBe('N');
    // The duck must move: no reply leaves it where it is.
    expect(g.legalMoves().some((uci) => parseUci(uci)?.duck === 'e5')).toBe(false);
    g.dispose();
  });

  it('ends the game when a king is captured, as a variant win', () => {
    const g = rules.newGame('duck', FEN_DUCK_ROOK_TAKES_KING);
    expect(g.result()).toBeNull();
    const capture = g.legalMovesFrom('e2').find((uci) => parseUci(uci)?.to === 'e8');
    expect(capture).toBeDefined();
    g.push(capture!);
    expect(g.result()).toEqual({ winner: 'white', reason: 'variant' });
    g.dispose();
  });

  it('gives the win to a side with no legal move, so stalemate wins rather than draws', () => {
    // Black's king on a8 is walled in by the ducks on b8, a7 and b7.
    const g = rules.newGame('duck', 'k*6/**6/8/8/8/8/8/7K b - - 0 1');
    expect(g.legalMoves()).toEqual([]);
    expect(g.result()).toEqual({ winner: 'black', reason: 'variant' });
    g.dispose();
  });
});

describe('knows', () => {
  it('is true for built-in variants and false for names never defined', () => {
    expect(rules.knows('chess')).toBe(true);
    expect(rules.knows('spartan')).toBe(true);
    expect(rules.knows('nosuchvariant')).toBe(false);
  });
});
