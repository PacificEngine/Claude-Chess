import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestRules } from '../rules/test-rules';
import type { Rules } from '../rules/types';
import { betzaProblem, buildBetza, LEAPS, MAX_PARTS, type MoveComponent, SLIDING_LEAPS, TOO_MANY_PARTS } from './betza';
import { fnv1a } from './generator';
import { BUILTIN_PIECES, pieceTypeByName } from './piece-types';

let rules: Rules;
beforeAll(async () => {
  rules = await loadTestRules();
});

// The probed piece stands on d4. The kings sit on h1 and a8, off every line and leap through d4, so no probe
// starts in check. The screen is a 5x5 box of Black pawns around d4: it shows captures, hurdles (a cannon
// captures on d6, over d5) and lame legs.
const SCREEN = ['b', 'c', 'd', 'e', 'f'].flatMap((f) => [2, 3, 4, 5, 6].map((r) => `${f}${r}`)).filter((s) => s !== 'd4');

function fen(letter: string, screened: boolean): string {
  const board: string[][] = Array.from({ length: 8 }, () => Array<string>(8).fill(''));
  const put = (square: string, piece: string) => (board[8 - Number(square[1])][square.charCodeAt(0) - 97] = piece);
  put('h1', 'K');
  put('a8', 'k');
  if (screened) for (const s of SCREEN) put(s, 'p');
  put('d4', letter.toUpperCase());
  const rows = board.map((row) => row.map((c) => c || '1').join('').replace(/1+/g, (m) => String(m.length)));
  return `${rows.join('/')} w - - 0 1`;
}

function movesFromD4(variant: string, letter: string, screened: boolean): string[] {
  const game = rules.newGame(variant, fen(letter, screened));
  try {
    return [...new Set(game.legalMovesFrom('d4'))].sort();
  } finally {
    game.dispose();
  }
}

// A variant name can't be redefined in ffish, so each Betza gets its own hashed name and is loaded once.
function betzaVariant(betza: string): string {
  const name = `probe_${fnv1a(betza)}`;
  if (!rules.knows(name)) rules.loadConfig(`[${name}:chess]\ncustomPiece1 = z:${betza}\n`);
  return name;
}

function builtinVariant(type: string): string {
  const name = `probe_builtin_${type}`;
  // The pawn keeps chess's own 'p'; every other type goes on 'z', which chess doesn't use.
  if (!rules.knows(name)) rules.loadConfig(`[${name}:chess]\n${type === 'pawn' ? '' : `${type} = z\n`}`);
  return name;
}

const builtinLetter = (type: string) => (type === 'pawn' ? 'p' : 'z');
const movesOf = (betza: string) => movesFromD4(betzaVariant(betza), 'z', false);
const capturesOver = (betza: string) => movesFromD4(betzaVariant(betza), 'z', true);
const builtinMoves = (type: string) => movesFromD4(builtinVariant(type), builtinLetter(type), false);
const builtinCapturesOver = (type: string) => movesFromD4(builtinVariant(type), builtinLetter(type), true);

// Built-ins whose Betza can't describe how the engine plays them carry betza ''. pawn: its double step,
// en passant and promotion are pawn rules in Fairy-Stockfish's code, not part of its Betza "fmWfceF".
const DESCRIBABLE = BUILTIN_PIECES.filter((p) => !p.royal && p.betza !== '');

describe('buildBetza', () => {
  it('builds a rook from orthogonal slides and the engine moves it like the built-in rook', () =>
    expect(movesOf(buildBetza([{ atom: 'W', slide: true, range: null, mode: 'both' }], []))).toEqual(movesOf(pieceTypeByName('rook').betza)));
  it('limits a slide to its range', () => expect(movesOf(buildBetza([{ atom: 'F', slide: true, range: 2, mode: 'both' }], [])).length).toBe(8));
  it('builds a cannon that captures only over a screen, like the built-in cannon', () =>
    expect(capturesOver(buildBetza([{ atom: 'W', slide: true, range: null, mode: 'cannon' }], []))).toEqual(capturesOver(pieceTypeByName('cannon').betza)));
  it('builds a cannon that moves without capturing like the built-in cannon', () =>
    expect(movesOf(buildBetza([{ atom: 'W', slide: true, range: null, mode: 'cannon' }], []))).toEqual(movesOf(pieceTypeByName('cannon').betza)));
  it('combines components with built-in pieces (rook + knight moves like the chancellor)', () =>
    expect(movesOf(buildBetza([{ atom: 'N', slide: false, range: null, mode: 'both' }], ['rook']))).toEqual(movesOf(pieceTypeByName('chancellor').betza)));
  it('gives every built-in piece the Betza the engine plays it with', () => {
    for (const p of DESCRIBABLE) expect(movesOf(p.betza), p.type).toEqual(builtinMoves(p.type));
  });
  it('gives every built-in piece the Betza it captures, hops and is blocked with', () => {
    for (const p of DESCRIBABLE) expect(capturesOver(p.betza), p.type).toEqual(builtinCapturesOver(p.type));
  });

  it('marks the pawn indescribable, because a Betza pawn has no double step', () => {
    expect(pieceTypeByName('pawn').betza).toBe('');
    const fromD2 = (variant: string, letter: string) => {
      const game = rules.newGame(variant, `k7/8/8/8/8/8/3${letter.toUpperCase()}4/7K w - - 0 1`);
      try {
        return game.legalMovesFrom('d2').sort();
      } finally {
        game.dispose();
      }
    };
    expect(fromD2(builtinVariant('pawn'), 'p')).toEqual(['d2d3', 'd2d4']);
    expect(fromD2(betzaVariant('fmWfceF'), 'z')).toEqual(['d2d3']);
  });

  // A doubled atom means a slide, so joining "N" with the knight's "N" must not make "NN", a nightrider.
  describe('joins parts without doubling an atom', () => {
    const step = (atom: 'N' | 'W' | 'F') => ({ atom, slide: false, range: null, mode: 'both' as const });
    const sameAs = (betza: string, type: string) => {
      expect(movesOf(betza), betza).toEqual(builtinMoves(type));
      expect(capturesOver(betza), betza).toEqual(builtinCapturesOver(type));
    };
    it('a knight step plus the knight moves like the knight, not a nightrider', () => {
      sameAs(buildBetza([step('N')], ['knight']), 'knight');
      expect(movesOf(buildBetza([step('N')], ['knight']))).not.toEqual(movesOf('NN'));
    });
    it('a wazir step plus the gold moves like the gold', () => sameAs(buildBetza([step('W')], ['gold']), 'gold'));
    it('a fers step plus the fers moves like the fers', () => sameAs(buildBetza([step('F')], ['fers']), 'fers'));
    it('a fers step plus the fers-alfil moves like the fers-alfil', () => sameAs(buildBetza([step('F')], ['fersAlfil']), 'fersAlfil'));
    it('the rook twice moves like the rook', () => sameAs(buildBetza([], ['rook', 'rook']), 'rook'));
    it('the knight twice moves like the knight', () => sameAs(buildBetza([], ['knight', 'knight']), 'knight'));
    it('two identical components move like one', () => sameAs(buildBetza([step('N'), step('N')], []), 'knight'));
    it('the commoner plus the centaur moves like the centaur', () => sameAs(buildBetza([], ['commoner', 'centaur']), 'centaur'));
    it('refuses parts that double an atom in every order', () =>
      expect(() => buildBetza([step('N'), { atom: 'N', slide: true, range: null, mode: 'both' }], [])).toThrow(
        new Error("These moves can't be written in any order without one changing another: N, NN."),
      ));
  });

  // Ordering the parts is a search over their orders: the cap keeps it to milliseconds even when no order exists.
  describe(`caps the moves and pieces combined at ${MAX_PARTS}`, () => {
    const knight = (mode: MoveComponent['mode'], slide = false): MoveComponent => ({ atom: 'N', slide, range: null, mode });
    const endInN = ['archbishop', 'chancellor', 'amazon', 'horse', 'shogiKnight', 'centaur', 'knight'];
    const timed = (f: () => unknown) => {
      const start = performance.now();
      try {
        f();
      } catch {
        // only the time matters here
      }
      return performance.now() - start;
    };
    it('settles the worst case at the cap quickly: two parts that may never meet an N, and six that end in one', () => {
      // "N" and "NN" both start with N and every other part ends with one, so no order exists: the search
      // has to rule them all out.
      const components = [knight('both'), knight('both', true)];
      const combined = endInN.slice(0, MAX_PARTS - components.length);
      expect(() => buildBetza(components, combined)).toThrow(
        new Error("These moves can't be written in any order without one changing another: N, NN, BN, RN, QN, nN, fN, KN."),
      );
      expect(timed(() => buildBetza(components, combined))).toBeLessThan(250);
    });
    it('refuses more, at once, rather than searching', () => {
      const components = [knight('both'), knight('both', true), knight('move'), knight('capture'), knight('move', true), knight('capture', true)];
      expect(() => buildBetza(components, endInN)).toThrow(TOO_MANY_PARTS);
      expect(timed(() => buildBetza(components, endInN))).toBeLessThan(50);
    });
  });

  it('refuses to combine with a built-in whose moves Betza cannot describe', () =>
    expect(() => buildBetza([], ['pawn'])).toThrow(/Pawn/));

  it('refuses an unknown built-in name', () => expect(() => buildBetza([], ['dabbaba'])).toThrow(/Unknown piece type/));

  it('moves only, or captures only, when the mode says so', () => {
    const knight = (mode: 'move' | 'capture') => buildBetza([{ atom: 'N', slide: false, range: null, mode }], []);
    expect(movesOf(knight('move'))).toEqual(movesOf('N'));
    expect(capturesOver(knight('move'))).toEqual(movesOf('N').filter((m) => !SCREEN.includes(m.slice(2))));
    expect(movesOf(knight('capture'))).toEqual([]);
    expect(capturesOver(knight('capture'))).toEqual(capturesOver('N').filter((m) => SCREEN.includes(m.slice(2))));
  });

  it('ignores the range of a step, which is not a slide', () =>
    expect(movesOf(buildBetza([{ atom: 'N', slide: false, range: 3, mode: 'both' }], []))).toEqual(movesOf('N')));

  it('refuses a range the engine cannot read (one digit, 1 to 9)', () => {
    for (const range of [0, 10, 2.5]) {
      expect(() => buildBetza([{ atom: 'W', slide: true, range, mode: 'both' }], []), String(range)).toThrow(/range/);
    }
  });

  it('refuses a cannon that does not slide, since it has no line to hop along', () =>
    expect(() => buildBetza([{ atom: 'N', slide: false, range: null, mode: 'cannon' }], [])).toThrow(/cannon/i));

  it('makes every leap a step the engine can move, and W, F and N slides too', () => {
    for (const { atom } of LEAPS) {
      const slides = SLIDING_LEAPS.includes(atom) ? [false, true] : [false];
      for (const slide of slides) {
        const betza = buildBetza([{ atom, slide, range: null, mode: 'both' }], []);
        expect(betzaProblem(betza), betza).toBeNull();
        expect(movesOf(betza).length, betza).toBeGreaterThan(0);
      }
    }
  });

  it('refuses slides the engine would load but never move', () => {
    // Proof that these really don't move: a doubled D leap loads but has no moves at all.
    expect(movesOf('DD')).toEqual([]);
    for (const { atom } of LEAPS.filter((l) => !SLIDING_LEAPS.includes(l.atom))) {
      expect(() => buildBetza([{ atom, slide: true, range: null, mode: 'both' }], []), atom).toThrow(/can't slide/);
    }
  });

  it('slides a nightrider only as far as its range', () => {
    const big = 'probe_nightrider_10x10';
    if (!rules.knows(big)) rules.loadConfig(`[${big}:chess]\nmaxFile = j\nmaxRank = 10\ncustomPiece1 = z:${buildBetza([{ atom: 'N', slide: true, range: 2, mode: 'both' }], [])}\n`);
    const game = rules.newGame(big, 'k9/10/10/10/10/10/10/10/10/Z8K w - - 0 1');
    try {
      expect(game.legalMovesFrom('a1').sort()).toEqual(['a1b3', 'a1c2', 'a1c5', 'a1e3']);
    } finally {
      game.dispose();
    }
  });

  it('builds a diagonal cannon, and a ranged one that hops within its range', () => {
    const cannon = (atom: 'W' | 'F', range: number | null) => buildBetza([{ atom, slide: true, range, mode: 'cannon' }], []);
    expect(capturesOver(cannon('F', null))).toEqual(capturesOver('mBcpB'));
    // The screen is on d5 and the capture on d6, two squares away, so a range-2 cannon still reaches it.
    expect(capturesOver(cannon('W', 2))).toContain('d4d6');
    expect(capturesOver(cannon('W', 2))).not.toContain('d4d5');
  });

  it('refuses a cannon along a nightrider, which the engine never lets capture', () =>
    expect(() => buildBetza([{ atom: 'N', slide: true, range: null, mode: 'cannon' }], [])).toThrow(/cannon/));

  it('labels every leap, starting with the wazir and including the knight', () => {
    expect(LEAPS.map((l) => l.atom)).toEqual(['W', 'F', 'D', 'N', 'A', 'H', 'C', 'Z', 'G']);
    expect(LEAPS[0]).toEqual({ atom: 'W', label: '1 square orthogonally' });
    expect(LEAPS).toContainEqual({ atom: 'N', label: 'Knight jump (1,2)' });
  });
});

describe('betzaProblem', () => {
  it('refuses j, unsafe characters and empty strings', () => {
    expect(betzaProblem('jR')).toBe('The "j" modifier is not supported by the engine.');
    expect(betzaProblem('j\n')).toBe('The "j" modifier is not supported by the engine.');
    expect(betzaProblem('R\n[x]')).toBe('This move description uses characters the engine does not accept.');
    expect(betzaProblem('')).toBe('Type a Betza move description.');
    expect(betzaProblem('mRcpR')).toBeNull();
  });

  it('refuses a description longer than 40 characters', () => {
    expect(betzaProblem('W'.repeat(40))).toBeNull();
    expect(betzaProblem('W'.repeat(41))).toBe('This move description is too long (at most 40 characters).');
    // Odd characters are the bigger problem.
    expect(betzaProblem('W'.repeat(41) + '=')).toBe('This move description uses characters the engine does not accept.');
  });

  it('accepts every Betza the built-in pieces carry', () => {
    for (const p of BUILTIN_PIECES.filter((p) => p.betza !== '')) expect(betzaProblem(p.betza), p.type).toBeNull();
  });
});
