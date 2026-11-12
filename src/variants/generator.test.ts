import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestRules } from '../rules/test-rules';
import type { Rules } from '../rules/types';
import { type ActiveVariantShape, fnv1a, generateVariant, needsCustomVariant } from './generator';
import { typesOfVariant } from './piece-types';
import { isSetupSpec, MAX_FILES, MAX_RANKS, MIN_FILES, MIN_RANKS, type SetupSpec } from './setup';

let rules: Rules;
beforeAll(async () => {
  rules = await loadTestRules();
});

/** An 8x8 chess-based setup with a king, queen and rook per side, using the custom-setup defaults. */
const spec = (): SetupSpec => ({
  base: 'chess',
  files: 8,
  ranks: 8,
  pieces: { k: 'king', q: 'queen', r: 'rook' },
  fen: 'r2qk3/8/8/8/8/8/8/R2QK3 w - - 0 1',
  castling: false,
  promotion: { rank: 'last', pieceTypes: ['q', 'r'] },
});

const noPromotion = (): SetupSpec => ({ ...spec(), promotion: { rank: 'last', pieceTypes: [] } });

const CHESS_SHAPE: ActiveVariantShape = {
  files: 8,
  ranks: 8,
  letters: ['p', 'n', 'b', 'r', 'q', 'k'],
  castling: true,
  types: new Map([
    ['p', 'pawn'],
    ['n', 'knight'],
    ['b', 'bishop'],
    ['r', 'rook'],
    ['q', 'queen'],
    ['k', 'king'],
  ]),
};

/** Standard chess after 1.e4: every letter is chess's own, and castling and promotion are chess's. */
const chessSpecWithDifferentFen = (): SetupSpec => ({
  base: 'chess',
  files: 8,
  ranks: 8,
  pieces: { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' },
  fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
  castling: true,
  promotion: { rank: 'last', pieceTypes: ['n', 'b', 'r', 'q'] },
});

// ffish refuses to redefine a variant name, so each generated variant is loaded once per run.
const loaded = new Set<string>();
function register(s: SetupSpec): string {
  const { name, ini } = generateVariant(s);
  if (!loaded.has(name)) {
    rules.loadConfig(ini);
    loaded.add(name);
  }
  return name;
}

function movesFrom(s: SetupSpec, square: string): string[] {
  const game = rules.newGame(register(s), s.fen);
  try {
    return game.legalMovesFrom(square).sort();
  } finally {
    game.dispose();
  }
}

describe('variant generator', () => {
  it('names a setup by a hash of its definition so the same setup never needs redefining', () => {
    expect(generateVariant(spec()).name).toBe(generateVariant(spec()).name);
    expect(generateVariant(spec()).name).toMatch(/^cx_[0-9a-f]{8}$/);
    expect(generateVariant({ ...spec(), files: 9, fen: 'r2qk4/9/9/9/9/9/9/R2QK4 w - - 0 1' }).name).not.toBe(
      generateVariant(spec()).name,
    );
  });

  it('hashes with 32-bit FNV-1a', () => {
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('a')).toBe('e40c292c');
    expect(fnv1a('foobar')).toBe('bf9cf968');
  });

  it('hashes the parent and the section body, so the name is fixed by what the engine is told', () => {
    const { name, ini } = generateVariant(spec());
    const body = ini.slice(ini.indexOf('\n') + 1);
    expect(name).toBe(`cx_${fnv1a(`chess\n${body}`)}`);
  });

  it('names identical bodies on different bases differently, since ffish keeps the first definition', () => {
    const chess = generateVariant(spec());
    const anti = generateVariant({ ...spec(), base: 'antichess' });
    expect(anti.ini.slice(anti.ini.indexOf('\n'))).toBe(chess.ini.slice(chess.ini.indexOf('\n')));
    expect(anti.name).not.toBe(chess.name);
    expect(generateVariant({ ...spec(), base: 'antichess' }).name).toBe(anti.name);
  });

  it('refuses promotion to a pawn, since only non-king pieces other than pawns are promotion targets', () => {
    const withPawn = { ...spec(), pieces: { k: 'king', q: 'queen', r: 'rook', p: 'pawn' } };
    expect(() => generateVariant({ ...withPawn, promotion: { rank: 'last', pieceTypes: ['q', 'p'] } })).toThrow(
      /pawn/,
    );
    expect(() => generateVariant({ ...withPawn, promotion: { rank: 'last', pieceTypes: ['q'] } })).not.toThrow();
  });

  it('inherits from the base variant and overrides only what the setup changes', () => {
    const { name, ini } = generateVariant({
      ...spec(),
      base: 'grand',
      files: 12,
      ranks: 10,
      fen: 'r2qk7/12/12/12/12/12/12/12/12/R2QK7 w - - 0 1',
    });
    expect(ini.split('\n')[0]).toBe(`[${name}:grand]`);
    expect(ini).toContain('maxFile = l');
    expect(ini).toContain('maxRank = 10');
  });

  it('writes one line per built-in piece type and none for letters the base defines itself', () => {
    const { ini } = generateVariant({ ...spec(), pieces: { k: 'king', q: 'queen', r: 'rook', w: 'inherited' } });
    expect(ini).toContain('king = k');
    expect(ini).toContain('queen = q');
    expect(ini).toContain('rook = r');
    expect(ini).not.toMatch(/= w$/m);
    expect(ini).not.toContain('inherited');
  });

  it('defaults to no castling and last-rank promotion to every non-king piece in the setup', () => {
    const { ini } = generateVariant(spec());
    expect(ini).toContain('castling = false');
    expect(ini).toContain('promotionRegionWhite = *8');
    expect(ini).toContain('promotionRegionBlack = *1');
    expect(ini).toContain('promotionPieceTypes = qr');
  });

  it('lists every setup letter in pieceToCharTable so the engine check reports no missing piece type', () => {
    const { ini } = generateVariant({ ...spec(), pieces: { k: 'king', q: 'queen', r: 'rook', a: 'amazon' } });
    expect(ini).toContain('pieceToCharTable = AKQRakqr');
  });

  it('writes the body lines in a fixed order so the same setup always hashes the same', () => {
    const a = generateVariant({ ...spec(), pieces: { k: 'king', q: 'queen', r: 'rook' } });
    const b = generateVariant({ ...spec(), pieces: { r: 'rook', q: 'queen', k: 'king' } });
    const c = generateVariant({ ...spec(), promotion: { rank: 'last', pieceTypes: ['r', 'q'] } });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('refuses values that could inject extra variants.ini lines', () => {
    expect(() => generateVariant({ ...spec(), fen: 'k7/8/8/8/8/8/8/K7 w - - 0 1\nstartFen = x' })).toThrow();
    expect(() => generateVariant({ ...spec(), fen: 'k7/8/8/8/8/8/8/K7 w - - 0 1 ; x' })).toThrow();
    expect(() => generateVariant({ ...spec(), fen: '[x]k7/8/8/8/8/8/8/K7 w - - 0 1' })).toThrow();
    expect(() => generateVariant({ ...spec(), pieces: { k: 'king', 'q\n[x]': 'queen' } })).toThrow();
    expect(() => generateVariant({ ...spec(), pieces: { k: 'king', q: 'queen\ncastling = true' } })).toThrow();
    expect(() => generateVariant({ ...spec(), promotion: { rank: 'last', pieceTypes: ['q=x'] } })).toThrow();
  });

  it('refuses piece types and promotion letters the engine would silently drop', () => {
    expect(() => generateVariant({ ...spec(), pieces: { k: 'king', q: 'dragon' } })).toThrow();
    expect(() => generateVariant({ ...spec(), promotion: { rank: 'last', pieceTypes: ['n'] } })).toThrow();
    expect(() => generateVariant({ ...spec(), promotion: { rank: 'last', pieceTypes: ['k'] } })).toThrow();
  });

  it('refuses board sizes outside 5x5..12x10', () => {
    expect([MIN_FILES, MIN_RANKS, MAX_FILES, MAX_RANKS]).toEqual([5, 5, 12, 10]);
    expect(() => generateVariant({ ...spec(), files: 4 })).toThrow();
    expect(() => generateVariant({ ...spec(), ranks: 4 })).toThrow();
    expect(() => generateVariant({ ...spec(), files: 13 })).toThrow();
    expect(() => generateVariant({ ...spec(), ranks: 11 })).toThrow();
    expect(() => generateVariant({ ...spec(), files: 7.5 })).toThrow();
  });

  it('loads in ffish and plays from the setup position', () => {
    const s = spec();
    const name = register(s);
    const game = rules.newGame(name);
    try {
      expect(game.fen()).toBe(s.fen);
      expect(game.legalMoves().length).toBeGreaterThan(0);
    } finally {
      game.dispose();
    }
  });

  it('really sizes the board: a 12x10 setup has file l and rank 10', () => {
    const s: SetupSpec = {
      ...spec(),
      // Chess is 8x8, so both maxFile and maxRank have to take effect.
      files: 12,
      ranks: 10,
      fen: '11k/12/12/12/12/12/12/12/12/R3K7 w - - 0 1',
    };
    const name = register(s);
    const game = rules.newGame(name);
    try {
      expect(game.fen()).toBe(s.fen);
    } finally {
      game.dispose();
    }
    const rook = movesFrom(s, 'a1');
    expect(rook).toContain('a1a10');
    expect(rook).not.toContain('a1a11');
    expect(movesFrom(s, 'e1')).toContain('e1f1');
  });

  it('really turns castling off: no castling moves from a castling-ready position', () => {
    const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    const on = movesFrom({ ...spec(), castling: true, fen }, 'e1');
    expect(on).toEqual(expect.arrayContaining(['e1g1', 'e1c1']));
    // Same FEN, castling rights included: with castling off the engine drops them, so a dropped option shows.
    const off = movesFrom({ ...spec(), castling: false, fen }, 'e1');
    expect(off).not.toContain('e1g1');
    expect(off).not.toContain('e1c1');
  });

  it('really adds the setup pieces: a chess-based amazon moves as a queen and a knight', () => {
    const s: SetupSpec = {
      ...spec(),
      pieces: { k: 'king', a: 'amazon' },
      fen: '7k/8/8/8/3A4/8/8/K7 w - - 0 1',
      promotion: { rank: 'last', pieceTypes: ['a'] },
    };
    expect(movesFrom(s, 'd4')).toEqual(expect.arrayContaining(['d4e6', 'd4d8', 'd4h8']));
  });

  it('really promotes on the last rank only, to exactly the chosen pieces', () => {
    // Grand Chess itself promotes on ranks 8 to 10; the setup promotes on rank 10 only.
    const s: SetupSpec = {
      base: 'grand',
      files: 10,
      ranks: 10,
      pieces: { k: 'king', p: 'pawn', n: 'knight', r: 'rook', c: 'chancellor' },
      fen: '9k/1P8/P9/10/10/10/10/10/10/K9 w - - 0 1',
      castling: false,
      promotion: { rank: 'last', pieceTypes: ['n', 'c'] },
    };
    expect(movesFrom(s, 'a8')).toEqual(['a8a9']);
    expect(movesFrom(s, 'b9')).toEqual(['b9b10c', 'b9b10n']);
  });

  it('needs no custom variant when only the position changed', () =>
    expect(needsCustomVariant(chessSpecWithDifferentFen(), CHESS_SHAPE)).toBe(false));

  it('needs a custom variant when the size, letters, castling or promotion change', () => {
    const base = chessSpecWithDifferentFen();
    expect(needsCustomVariant({ ...base, files: 9 }, CHESS_SHAPE)).toBe(true);
    expect(needsCustomVariant({ ...base, ranks: 7 }, CHESS_SHAPE)).toBe(true);
    expect(needsCustomVariant({ ...base, pieces: { ...base.pieces, a: 'amazon' } }, CHESS_SHAPE)).toBe(true);
    expect(needsCustomVariant({ ...base, castling: false }, CHESS_SHAPE)).toBe(true);
    expect(needsCustomVariant({ ...base, promotion: { rank: 'last', pieceTypes: ['q'] } }, CHESS_SHAPE)).toBe(true);
    expect(needsCustomVariant(spec(), CHESS_SHAPE)).toBe(true);
  });

  it('needs a custom variant when a base letter gets a different type, or amazons would play as knights', () => {
    const base = chessSpecWithDifferentFen();
    expect(needsCustomVariant({ ...base, pieces: { ...base.pieces, n: 'amazon' } }, CHESS_SHAPE)).toBe(true);
    // 'inherited' means "whatever the base has", so it matches.
    expect(needsCustomVariant({ ...base, pieces: { ...base.pieces, n: 'inherited' } }, CHESS_SHAPE)).toBe(false);
  });
});

describe('pockets and letter clashes', () => {
  it('generates and loads a Seirawan setup with its pieces in hand intact', () => {
    const start = rules.newGame('seirawan');
    const fen = start.fen();
    start.dispose();
    expect(fen).toMatch(/\[[A-Za-z]+\] w /);
    const baseTypes = typesOfVariant(rules, 'seirawan');
    const s: SetupSpec = {
      base: 'seirawan',
      files: 8,
      ranks: 8,
      pieces: Object.fromEntries(baseTypes),
      fen,
      castling: true,
      promotion: { rank: 'last', pieceTypes: ['n', 'b', 'r', 'q', 'e', 'h'] },
    };
    const { name, ini } = generateVariant(s, baseTypes);
    expect(ini).toContain(`startFen = ${fen}`);
    rules.loadConfig(ini);
    const game = rules.newGame(name);
    try {
      expect(game.fen()).toBe(fen);
      expect(game.legalMoves().length).toBeGreaterThan(0);
    } finally {
      game.dispose();
    }
  });

  it('allows an empty pocket', () =>
    expect(() => generateVariant({ ...spec(), fen: 'r2qk3/8/8/8/8/8/8/R2QK3[] w - - 0 1' })).not.toThrow());

  it('refuses a pocket that could inject lines or appears anywhere but after the placement', () => {
    const bad = [
      'r2qk3/8/8/8/8/8/8/R2QK3[]\nstartFen = x w - - 0 1',
      'r2qk3/8/8/8/8/8/8/R2QK3[Q]\nstartFen = x',
      'r2qk3/8/8/8/8/8/8/R2QK3[Q][q] w - - 0 1',
      'r2qk3/8/8/8/8/8/8/R2QK3 w [Q] - 0 1',
      'r2qk3/8/8/8/8/8/8/R2QK3[Q] w - - 0 1 [q]',
      'r2qk3/8/8/8/8/8/8/R2QK3[Q=] w - - 0 1',
      'r2qk3/8/8/8/8/8/8/R2QK3[Q;] w - - 0 1',
      'r2qk3/8/8/8/8/8/8/R2QK3]Q[ w - - 0 1',
      'r2qk3/8/8/8/8/8/8/R2QK3[Q w - - 0 1',
      'r2qk3/8/8/8/8/8/8/R2QK3 w - - 0 1 = x',
      'r2qk3/8/8/8/8/8/8/R2QK3 w - - 0 1\n',
    ];
    for (const fen of bad) expect(() => generateVariant({ ...spec(), fen }), JSON.stringify(fen)).toThrow();
  });

  it('refuses two letters for one piece type, since the engine would keep only one of them', () =>
    expect(() => generateVariant({ ...noPromotion(), pieces: { k: 'king', a: 'amazon', m: 'amazon' } })).toThrow(
      /letters a, m .*amazon/,
    ));

  it('refuses giving a base letter a different type, since the engine would evict the base piece', () => {
    const chess = new Map([
      ['p', 'pawn'],
      ['n', 'knight'],
      ['b', 'bishop'],
      ['r', 'rook'],
      ['q', 'queen'],
      ['k', 'king'],
    ]);
    expect(() => generateVariant({ ...noPromotion(), pieces: { k: 'king', n: 'amazon' } }, chess)).toThrow(
      /n is the base variant's knight/,
    );
    expect(() => generateVariant({ ...spec(), pieces: { k: 'king', q: 'queen', r: 'rook' } }, chess)).not.toThrow();
    expect(() =>
      generateVariant({ ...spec(), pieces: { k: 'king', q: 'queen', r: 'rook', w: 'inherited' } }, chess),
    ).toThrow(/w is not a letter the base variant defines/);
    const inherited = new Map([...chess, ['w', 'inherited']]);
    expect(() => generateVariant({ ...noPromotion(), pieces: { k: 'king', w: 'wazir' } }, inherited)).toThrow(
      /w is the base variant's own piece/,
    );
  });
});

describe('isSetupSpec', () => {
  it('accepts a well-formed setup', () => expect(isSetupSpec(spec())).toBe(true));

  it('rejects anything a stored setup could be corrupted into', () => {
    expect(isSetupSpec(null)).toBe(false);
    expect(isSetupSpec('chess')).toBe(false);
    expect(isSetupSpec({ ...spec(), base: 'nope' })).toBe(false);
    expect(isSetupSpec({ ...spec(), files: '8' })).toBe(false);
    expect(isSetupSpec({ ...spec(), ranks: 8.5 })).toBe(false);
    expect(isSetupSpec({ ...spec(), pieces: null })).toBe(false);
    expect(isSetupSpec({ ...spec(), pieces: { k: 1 } })).toBe(false);
    expect(isSetupSpec({ ...spec(), fen: 1 })).toBe(false);
    expect(isSetupSpec({ ...spec(), castling: 'no' })).toBe(false);
    expect(isSetupSpec({ ...spec(), promotion: { rank: 'first', pieceTypes: [] } })).toBe(false);
    expect(isSetupSpec({ ...spec(), promotion: { rank: 'last', pieceTypes: [1] } })).toBe(false);
  });
});
