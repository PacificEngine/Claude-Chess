import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestRules } from './test-rules';
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

describe('knows', () => {
  it('is true for built-in variants and false for names never defined', () => {
    expect(rules.knows('chess')).toBe(true);
    expect(rules.knows('spartan')).toBe(true);
    expect(rules.knows('nosuchvariant')).toBe(false);
  });
});
