import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestRules } from '../rules/test-rules';
import type { Rules } from '../rules/types';
import { CURATED_VARIANTS } from '../variants/catalog';
import { artTypeOf, curatedActive, customActive } from '../variants/active';
import { BUILTIN_PIECES, typesOfVariant } from '../variants/piece-types';
import type { SetupSpec } from '../variants/setup';
import { artUrl, hasArt, pieceClass, pieceLettersOf, pocketRoles, tokenClass } from './pieces';

let rules: Rules;
beforeAll(async () => {
  rules = await loadTestRules();
});

const lettersFor = (id: string): string[] => pieceLettersOf(rules.newGame(id).fen());

describe('pieceLettersOf', () => {
  it('reads board and pocket letters, lowercased and unique', () => {
    expect(pieceLettersOf('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR[EHeh] w KQkq - 0 1').sort()).toEqual(
      ['b', 'e', 'h', 'k', 'n', 'p', 'q', 'r'],
    );
  });
  it('finds the fairy pieces of each variant by the letters ffish uses', () => {
    expect(lettersFor('capablanca')).toEqual(expect.arrayContaining(['a', 'c']));
    expect(lettersFor('amazon')).toContain('a');
    expect(lettersFor('shako')).toEqual(expect.arrayContaining(['c', 'e']));
    expect(lettersFor('spartan')).toEqual(expect.arrayContaining(['h', 'l', 'g', 'w', 'c']));
    expect(lettersFor('seirawan')).toEqual(expect.arrayContaining(['h', 'e']));
  });
});

describe('piece art and lettered tokens', () => {
  // Pieces drawn as lettered tokens, by variant. Every other piece of every curated variant must have art.
  const EXPECTED_TOKENS: Record<string, string[]> = {};

  /** Each piece in the start position (board and pockets) with its side: uppercase is White. */
  const piecesOf = (id: string): { letter: string; color: 'white' | 'black' }[] => {
    const placement = rules.newGame(id).fen().split(' ')[0] ?? '';
    const seen = new Map<string, { letter: string; color: 'white' | 'black' }>();
    for (const ch of placement) {
      if (!/[a-z]/i.test(ch)) continue;
      const color = ch === ch.toUpperCase() ? 'white' : 'black';
      seen.set(`${ch.toLowerCase()}${color}`, { letter: ch.toLowerCase(), color });
    }
    return [...seen.values()];
  };

  it('draws exactly the expected pieces as lettered tokens, and gives every other piece art', () => {
    for (const v of CURATED_VARIANTS) {
      const tokens = [...new Set(piecesOf(v.id).filter((p) => artUrl(p.letter, p.color, v.id) === null).map((p) => p.letter))];
      expect(tokens.sort(), v.id).toEqual(EXPECTED_TOKENS[v.id] ?? []);
    }
  });

  it('has art for the standard pieces everywhere', () => {
    for (const v of CURATED_VARIANTS) for (const l of 'pnbrqk') expect(hasArt(l, v.id)).toBe(true);
  });

  it('draws the same letter as different pieces in different variants', () => {
    expect(hasArt('a', 'capablanca')).toBe(true);
    expect(artUrl('a', 'white', 'amazon')).toBe('pieces/alfaerie/wamazon.svg');
    expect(artUrl('c', 'white', 'shako')).not.toBe(artUrl('c', 'white', 'capablanca'));
  });

  it('points every piece that has art at a real file', () => {
    for (const v of CURATED_VARIANTS) {
      for (const { letter, color } of piecesOf(v.id)) {
        if ((EXPECTED_TOKENS[v.id] ?? []).includes(letter)) continue;
        const url = artUrl(letter, color, v.id);
        expect(url, `${v.id} ${letter} ${color}`).not.toBeNull();
        expect(existsSync(resolve('public', url!)), `${v.id} ${letter} ${color}: ${url}`).toBe(true);
      }
    }
  });

  it('names a token class that the stylesheet draws from data-letter', () => {
    const css = readFileSync(resolve('src/ui/pieces.css'), 'utf8');
    expect(tokenClass('a').split(' ')).toContain('token');
    expect(css).toContain('.token::after');
    expect(css).toContain('content: attr(data-letter)');
  });

  it('gives each piece its own class by letter and colour', () => {
    expect(pieceClass('n', 'white')).not.toBe(pieceClass('n', 'black'));
    expect(pieceClass('n', 'white')).not.toBe(pieceClass('b', 'white'));
  });

  it("draws a custom variant's own letter with the art of the piece type it moves as", () => {
    expect(artUrl('a', 'white', 'chess', 'archbishop')).toBe('pieces/merida/wA.svg');
    expect(artUrl('z', 'black', 'chess', 'cannon')).toBe('pieces/merida/shako/bC.svg');
    expect(artUrl('z', 'white', 'chess', 'amazon')).toBe('pieces/alfaerie/wamazon.svg');
    expect(artUrl('z', 'white', 'chess')).toBeNull();
  });

  it('draws a letter by the type it moves as before the base variant\'s art for that letter', () => {
    expect(artUrl('q', 'white', 'chess', 'archbishop')).toBe('pieces/merida/wA.svg');
    expect(artUrl('c', 'white', 'shako', 'cannon')).toBe(artUrl('c', 'white', 'shako'));
    expect(artUrl('q', 'white', 'chess', 'queen')).toBe('pieces/merida/wQ.svg');
  });

  it("falls back to the base variant's art when the type has none", () =>
    expect(artUrl('h', 'black', 'spartan', 'inherited')).toBe('pieces/spartan/bP.svg'));

  it('gives every built-in piece type art for both sides, from a real file, so the palette has no lettered tokens', () => {
    for (const p of BUILTIN_PIECES) {
      const white = artUrl('z', 'white', 'chess', p.type);
      const black = artUrl('z', 'black', 'chess', p.type);
      expect(white, p.type).not.toBeNull();
      expect(black, p.type).not.toBeNull();
      expect(white, p.type).not.toBe(black);
      for (const url of [white!, black!]) expect(existsSync(resolve('public', url)), `${p.type}: ${url}`).toBe(true);
    }
  });

  it('gives a type the art a curated variant gives a letter of that type, so a palette piece matches the game', () => {
    const curated = CURATED_VARIANTS.flatMap((v) =>
      [...typesOfVariant(rules, v.engineName)].map(([letter, type]) => ({ type, url: artUrl(letter, 'white', v.id) })),
    );
    // Antichess's and Spartan's king moves as a commoner but keeps the king's art there; in the palette the
    // commoner is its own piece beside the king, so it needs its own look.
    const OWN_LOOK = ['commoner'];
    for (const p of BUILTIN_PIECES.filter((p) => !OWN_LOOK.includes(p.type))) {
      // Spartan's own pieces have art for Black only, so White's side of them has nothing to match.
      const uses = curated.filter((c) => c.type === p.type && c.url !== null);
      if (uses.length === 0) continue;
      expect(uses.map((c) => c.url), p.type).toContain(artUrl('z', 'white', 'chess', p.type));
    }
  });

  it("draws Black's Alfaerie and shogi pieces in Merida's dark colour, not pychess-variants' blue", () => {
    for (const p of BUILTIN_PIECES) {
      const url = artUrl('z', 'black', 'chess', p.type)!;
      if (!/alfaerie|shogi-tile/.test(url)) continue;
      const svg = readFileSync(resolve('public', url), 'utf8');
      expect(svg, url).not.toMatch(/#5984bd/i);
      expect(svg, url).toContain('#1f1a17');
    }
  });

  it('gives the three elephants different art, so they can be told apart in the palette', () => {
    const urls = ['alfil', 'elephant', 'janggiElephant'].map((t) => artUrl('z', 'white', 'chess', t));
    expect(new Set(urls).size).toBe(3);
  });

  it('draws the shogi pieces on a shogi tile, each a self-contained SVG with nothing loaded from elsewhere', () => {
    for (const type of ['shogiPawn', 'shogiKnight', 'lance', 'silver', 'gold', 'dragonHorse']) {
      for (const color of ['white', 'black'] as const) {
        const url = artUrl('z', color, 'chess', type)!;
        expect(url, type).toMatch(/^pieces\/shogi-tile\//);
        const svg = readFileSync(resolve('public', url), 'utf8');
        expect(svg, url).not.toMatch(/<image|<script|href="(?!#)|xlink:href="(?!#)| on[a-z]+=/i);
      }
    }
  });

  describe('in a custom variant', () => {
    const custom = (spec: Omit<SetupSpec, 'files' | 'ranks' | 'castling' | 'promotion'>) => {
      const setup: SetupSpec = { files: 8, ranks: 8, castling: false, promotion: { rank: 'last', pieceTypes: [] }, ...spec };
      return customActive(setup, 'cx_test', curatedActive(setup.base, rules).types);
    };
    const drawn = (v: ReturnType<typeof custom>, letter: string, color: 'white' | 'black' = 'white') =>
      artUrl(letter, color, v.artBase, artTypeOf(v, letter));

    it("keeps the base's own art for base letters that keep the base's type", () => {
      const v = custom({ base: 'seirawan', pieces: { k: 'king', h: 'archbishop', e: 'chancellor' }, fen: '4k3/8/8/8/8/8/8/4K3[HEhe] w - - 0 1' });
      expect(drawn(v, 'h')).toBe('pieces/merida/wH.svg'); // the hawk, not the archbishop art
      expect(drawn(v, 'e')).toBe('pieces/merida/wE.svg');
      const spartan = custom({ base: 'spartan', pieces: { k: 'commoner', w: 'archbishop', h: 'inherited' }, fen: 'w3k3/hhhh4/8/8/8/8/8/4K3 w - - 0 1' });
      expect(drawn(spartan, 'w', 'black')).toBe('pieces/spartan/bWarlord.svg');
      expect(drawn(spartan, 'h', 'black')).toBe('pieces/spartan/bP.svg');
    });

    it('draws a re-typed letter as its new type, not as the base piece', () => {
      const v = custom({ base: 'chess', pieces: { k: 'king', q: 'amazon' }, fen: '4k3/8/8/8/8/8/8/Q3K3 w - - 0 1' });
      expect(drawn(v, 'q')).toBe('pieces/alfaerie/wamazon.svg'); // an amazon, not the queen art
      expect(drawn(v, 'k')).toBe('pieces/merida/wK.svg');
    });

    it('draws a letter the base does not define, or gives another type, as the type it moves as', () => {
      const v = custom({ base: 'chess', pieces: { k: 'king', q: 'archbishop', z: 'cannon' }, fen: '4k3/8/8/8/8/8/8/Q3K2Z w - - 0 1' });
      expect(drawn(v, 'q')).toBe('pieces/merida/wA.svg');
      expect(drawn(v, 'z')).toBe('pieces/merida/shako/wC.svg');
      expect(drawn(v, 'k')).toBe('pieces/merida/wK.svg');
    });
  });
});

describe('pocketRoles', () => {
  it('gives a curated drop variant its pocket pieces', () =>
    expect(pocketRoles(curatedActive('seirawan', rules))).toEqual(['h-piece', 'e-piece']));

  it('has no pockets for a variant without pieces in hand', () => expect(pocketRoles(curatedActive('chess', rules))).toBeUndefined());

  it("gives a custom setup the letters it puts in hand, and no pocket rows when the hand is empty", () => {
    const setup = (fen: string): SetupSpec => ({
      base: 'seirawan', files: 8, ranks: 8, pieces: { k: 'king', h: 'archbishop' }, fen, castling: false,
      promotion: { rank: 'last', pieceTypes: ['h'] },
    });
    const types = curatedActive('seirawan', rules).types;
    expect(pocketRoles(customActive(setup('4k3/8/8/8/8/8/8/4K3[Hh] w - - 0 1'), 'cx_a', types))).toEqual(['h-piece']);
    expect(pocketRoles(customActive(setup('4k3/8/8/8/8/8/8/4K3[] w - - 0 1'), 'cx_b', types))).toBeUndefined();
  });
});
