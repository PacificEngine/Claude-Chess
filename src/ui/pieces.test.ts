import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestRules } from '../rules/test-rules';
import type { Rules } from '../rules/types';
import { CURATED_VARIANTS } from '../variants/catalog';
import { artTypeOf, curatedActive, customActive, designedArt } from '../variants/active';
import { BUILTIN_PIECES, typesOfVariant } from '../variants/piece-types';
import type { SetupSpec } from '../variants/setup';
import { artUrl, facingUrl, hasArt, parsePieceClass, pieceClass, pieceLettersOf, pocketRoles, promotedArtUrl, promotedMark, tokenClass } from './pieces';

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

const WITH_ART = CURATED_VARIANTS;

const STANDARD = 'pnbrqk';

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
    for (const v of WITH_ART) {
      const tokens = [...new Set(piecesOf(v.id).filter((p) => artUrl(p.letter, p.color, v.id) === null).map((p) => p.letter))];
      expect(tokens.sort(), v.id).toEqual(EXPECTED_TOKENS[v.id] ?? []);
    }
  });

  // A standard letter is drawn as the standard piece only where the game's piece is that piece, so a Shogi
  // pawn or a Xiangqi horse never wears the chess pawn's or knight's art just because it shares the letter.
  it('draws a standard letter as the standard piece only where the piece is the standard one', () => {
    const STANDARD_TYPE: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
    // Pieces that move differently but are drawn as the standard piece on purpose (owner decisions).
    const DRAWN_AS_STANDARD = [
      'antichess k white', 'antichess k black', // moves as a commoner, still the king
      'spartan k white', // a commoner there too; Black's king has Spartan art
      'xiangqi k white', 'xiangqi k black', // the general, drawn as the king in the chosen set (spec, 2026-11-17)
    ];
    for (const v of CURATED_VARIANTS) {
      const types = typesOfVariant(rules, v.engineName);
      for (const { letter, color } of piecesOf(v.id)) {
        if (!STANDARD.includes(letter)) continue;
        const url = artUrl(letter, color, v.id, undefined, undefined, 'cburnett');
        const asStandard = url === `pieces/cburnett/${color[0]}${letter.toUpperCase()}.svg`;
        const expected = types.get(letter) === STANDARD_TYPE[letter] || DRAWN_AS_STANDARD.includes(`${v.id} ${letter} ${color}`);
        expect(asStandard, `${v.id} ${letter} ${color}: ${url} (moves as ${types.get(letter)})`).toBe(expected);
      }
    }
  });

  it("draws Shogi's pieces with their own art, and its king, rook and bishop in the chosen set", () => {
    const set = 'cburnett';
    for (const [color, side] of [['white', 'w'], ['black', 'b']] as const) {
      const at = (letter: string) => artUrl(letter, color, 'shogi', undefined, undefined, set);
      expect(at('p')).toBe(`pieces/shogi-tile/${side}shogiPawn.svg`);
      expect(at('l')).toBe(`pieces/shogi-tile/${side}lance.svg`);
      expect(at('n')).toBe(`pieces/shogi-tile/${side}shogiKnight.svg`);
      expect(at('s')).toBe(`pieces/shogi-tile/${side}silver.svg`);
      expect(at('g')).toBe(`pieces/shogi-tile/${side}gold.svg`);
      expect(at('k')).toBe(`pieces/${set}/${side}K.svg`);
      expect(at('r')).toBe(`pieces/${set}/${side}R.svg`);
      expect(at('b')).toBe(`pieces/${set}/${side}B.svg`);
    }
  });

  it("draws Xiangqi's pieces with their own art, and its chariot and general in the chosen set", () => {
    const set = 'cburnett';
    for (const [color, side] of [['white', 'w'], ['black', 'b']] as const) {
      const at = (letter: string) => artUrl(letter, color, 'xiangqi', undefined, undefined, set);
      expect(at('r')).toBe(`pieces/${set}/${side}R.svg`); // chariot
      expect(at('k')).toBe(`pieces/${set}/${side}K.svg`); // general
      expect(at('a')).toBe(`pieces/alfaerie/${side}ferz.svg`); // advisor
      expect(at('b')).toBe(`pieces/alfaerie/${side}elephantwazir.svg`); // elephant
      expect(at('n')).toBe(`pieces/alfaerie/${side}horse.svg`);
      expect(at('c')).toBe(`pieces/merida/shako/${side}C.svg`); // cannon
      expect(at('p')).toBe(`pieces/alfaerie/${side}chinesepawn.svg`); // soldier
    }
  });

  it('draws the same letter as different pieces in different variants', () => {
    expect(hasArt('a', 'capablanca')).toBe(true);
    expect(artUrl('a', 'white', 'amazon')).toBe('pieces/alfaerie/wamazon.svg');
    expect(artUrl('c', 'white', 'shako')).not.toBe(artUrl('c', 'white', 'capablanca'));
  });

  it('points every piece that has art at a real file', () => {
    for (const v of WITH_ART) {
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

  it('draws a designed piece with the art the player chose, for each side', () =>
    expect(artUrl('z', 'black', 'chess', undefined, 'alfaerie/amazon')).toBe('pieces/alfaerie/bamazon.svg'));

  it('draws a designed piece with no art, or with art that no longer exists, as a lettered token', () => {
    expect(artUrl('z', 'white', 'chess', undefined, null)).toBeNull();
    expect(artUrl('z', 'white', 'chess', undefined, 'gone/x')).toBeNull();
  });

  it('never gives a designed letter the base or type art', () => {
    expect(artUrl('q', 'white', 'chess', 'queen', null)).toBeNull();
    expect(artUrl('q', 'white', 'chess', undefined, 'gone/x')).toBeNull();
  });

  it("reports a custom variant's designed art by letter, undefined for any other letter", () => {
    const setup: SetupSpec = {
      base: 'chess', files: 8, ranks: 8, pieces: { k: 'king' },
      designed: { z: { id: 'p', betza: 'N', art: 'alfaerie/ox' }, y: { id: 'q', betza: 'N', art: null } },
      fen: '7k/8/8/8/8/8/8/Z6K w - - 0 1', castling: false, promotion: { rank: 'last', pieceTypes: [] },
    };
    const v = customActive(setup, 'cx_t', new Map());
    expect(designedArt(v, 'z')).toBe('alfaerie/ox');
    expect(designedArt(v, 'y')).toBeNull();
    expect(designedArt(v, 'k')).toBeUndefined();
    expect(designedArt(curatedActive('chess', rules), 'z')).toBeUndefined();
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
    const curated = WITH_ART.flatMap((v) =>
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

  it('has each shogi tile turned the other way too: White pointing down, Black up, the piece still upright', () => {
    const turn = 'transform="rotate(180 25 25)"';
    const tile = (url: string) => /<path[^>]*>/.exec(readFileSync(resolve('public', url), 'utf8'))![0];
    for (const type of ['shogiPawn', 'shogiKnight', 'lance', 'silver', 'gold', 'dragonHorse']) {
      for (const color of ['white', 'black'] as const) {
        const own = artUrl('z', color, 'chess', type)!;
        const turned = own.replace('shogi-tile/', 'shogi-tile/turned/');
        // Black's own tile points down (turned), White's up; the turned files are the other way round.
        expect(tile(own).includes(turn), own).toBe(color === 'black');
        expect(tile(turned).includes(turn), turned).toBe(color === 'white');
        // Only the tile turns: the piece on it is not rotated.
        expect(readFileSync(resolve('public', turned), 'utf8').split('rotate(').length, turned).toBe(color === 'white' ? 2 : 1);
      }
    }
  });

  it('points each shogi tile toward the opponent: the side at the bottom up, the side at the top down', () => {
    const w = 'pieces/shogi-tile/wshogiPawn.svg';
    const b = 'pieces/shogi-tile/bgold.svg';
    expect(facingUrl(w, 'white', 'ally')).toBe(w);
    expect(facingUrl(b, 'black', 'enemy')).toBe(b);
    expect(facingUrl(w, 'white', 'enemy')).toBe('pieces/shogi-tile/turned/wshogiPawn.svg');
    expect(facingUrl(b, 'black', 'ally')).toBe('pieces/shogi-tile/turned/bgold.svg');
    // Off a board (no side), a tile keeps its own direction; art that is not a tile never turns.
    expect(facingUrl(b, 'black', null)).toBe(b);
    expect(facingUrl('pieces/merida/wK.svg', 'white', 'enemy')).toBe('pieces/merida/wK.svg');
    expect(facingUrl('pieces/alfaerie/bkingrook.svg', 'black', 'ally')).toBe('pieces/alfaerie/bkingrook.svg');
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

describe('promoted pieces', () => {
  // Shogi's promotable pieces; the gold and the king never promote.
  const SHOGI_PROMOTABLE = 'plnsbr';

  it('reads a promoted role from the class chessgroundx gives it', () => {
    expect(parsePieceClass('white ally promoted pp-piece')).toEqual({ letter: 'p', color: 'white', promoted: true });
    expect(parsePieceClass('black enemy  promoted pr-piece')).toEqual({ letter: 'r', color: 'black', promoted: true });
    expect(parsePieceClass('white ally  p-piece')).toEqual({ letter: 'p', color: 'white', promoted: false });
    expect(parsePieceClass('n-piece black')).toEqual({ letter: 'n', color: 'black', promoted: false });
    expect(parsePieceClass('white ally')).toBeNull();
  });

  it('gives every promoted Shogi piece art for both sides, from a real file', () => {
    for (const letter of SHOGI_PROMOTABLE) {
      for (const color of ['white', 'black'] as const) {
        const url = promotedArtUrl(letter, color, 'shogi');
        expect(url, `+${letter} ${color}`).not.toBeNull();
        expect(existsSync(resolve('public', url!)), `+${letter} ${color}: ${url}`).toBe(true);
      }
    }
  });

  it('draws the promoted forms as the spec says', () => {
    for (const [color, side] of [['white', 'w'], ['black', 'b']] as const) {
      for (const letter of 'plns') expect(promotedArtUrl(letter, color, 'shogi')).toBe(`pieces/shogi-tile/${side}gold.svg`);
      expect(promotedArtUrl('b', color, 'shogi')).toBe(`pieces/shogi-tile/${side}dragonHorse.svg`);
      expect(promotedArtUrl('r', color, 'shogi')).toBe(`pieces/alfaerie/${side}kingrook.svg`);
    }
  });

  it('never draws a promoted piece with the image of its unpromoted form, whatever the set', () => {
    for (const set of ['merida', 'cburnett']) {
      for (const letter of SHOGI_PROMOTABLE) {
        for (const color of ['white', 'black'] as const) {
          expect(promotedArtUrl(letter, color, 'shogi'), `+${letter}`).not.toBe(artUrl(letter, color, 'shogi', undefined, undefined, set));
        }
      }
    }
  });

  it('marks exactly the promoted pieces that share an unpromoted piece\'s image, so +P never passes for a gold', () => {
    const unpromoted = new Set([...'plnsgbrk'].map((l) => artUrl(l, 'white', 'shogi')));
    for (const letter of SHOGI_PROMOTABLE) {
      expect(promotedMark(letter, 'shogi'), `+${letter}`).toBe(unpromoted.has(promotedArtUrl(letter, 'white', 'shogi')));
    }
    expect([...SHOGI_PROMOTABLE].filter((l) => promotedMark(l, 'shogi'))).toEqual(['p', 'l', 'n', 's']);
  });

  it('has no promoted art outside Shogi, so an unknown promoted piece is a token', () => {
    expect(promotedArtUrl('p', 'white', 'chess')).toBeNull();
    expect(promotedMark('p', 'chess')).toBe(false);
  });

  it('draws the promoted marker from the stylesheet, without taking clicks', () => {
    const css = readFileSync(resolve('src/ui/pieces.css'), 'utf8');
    expect(css).toMatch(/\.promoted-mark::before\s*\{[^}]*pointer-events:\s*none/);
  });
});

describe('pocketRoles', () => {
  it('gives a curated drop variant its pocket pieces', () =>
    expect(pocketRoles(curatedActive('seirawan', rules))).toEqual(['h-piece', 'e-piece']));

  it("gives Shogi a slot for every piece that can be captured, from the start, while the hands are empty", () =>
    expect(pocketRoles(curatedActive('shogi', rules))).toEqual(['r-piece', 'b-piece', 'g-piece', 's-piece', 'n-piece', 'l-piece', 'p-piece']));

  it('has no pockets for Xiangqi', () => expect(pocketRoles(curatedActive('xiangqi', rules))).toBeUndefined());

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

describe('piece sets', () => {
  it('draws the six standard pieces from the chosen set', () => {
    expect(artUrl('n', 'white', 'chess', undefined, undefined, 'cburnett')).toBe('pieces/cburnett/wN.svg');
    expect(artUrl('k', 'black', 'grand', undefined, undefined, 'pixel')).toBe('pieces/pixel/bK.svg');
    // A custom variant's letter that moves as a standard type uses the set too.
    expect(artUrl('x', 'black', 'chess', 'queen', undefined, 'fantasy')).toBe('pieces/fantasy/bQ.svg');
  });

  it('draws Merida without a set, and for the saved default', () => {
    expect(artUrl('n', 'white', 'chess')).toBe('pieces/merida/wN.svg');
    expect(artUrl('n', 'white', 'chess', undefined, undefined, 'merida')).toBe('pieces/merida/wN.svg');
  });

  it("keeps every other piece's own art whatever the set", () => {
    expect(artUrl('a', 'white', 'capablanca', undefined, undefined, 'cburnett')).toBe('pieces/merida/wA.svg');
    expect(artUrl('c', 'black', 'shako', undefined, undefined, 'cburnett')).toBe('pieces/merida/shako/bC.svg');
    expect(artUrl('a', 'white', 'amazon', undefined, undefined, 'cburnett')).toBe('pieces/alfaerie/wamazon.svg');
    expect(artUrl('x', 'white', 'chess', 'wazir', undefined, 'cburnett')).toBe('pieces/alfaerie/wwazir.svg');
    expect(artUrl('k', 'black', 'spartan', undefined, undefined, 'cburnett')).toBe('pieces/spartan/bK.svg');
    // A designed piece keeps the art the player chose, even standard Merida art.
    expect(artUrl('z', 'white', 'chess', undefined, 'merida/Q', 'cburnett')).toBe('pieces/merida/wQ.svg');
  });

  it("gives White's king in Spartan the chosen set", () => {
    expect(artUrl('k', 'white', 'spartan', undefined, undefined, 'cburnett')).toBe('pieces/cburnett/wK.svg');
  });
});
