import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestRules } from '../rules/test-rules';
import type { Rules } from '../rules/types';
import { CURATED_VARIANTS } from '../variants/catalog';
import { artUrl, hasArt, pieceClass, pieceLettersOf, tokenClass } from './pieces';

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
  const EXPECTED_TOKENS: Record<string, string[]> = { amazon: ['a'] };

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
    expect(hasArt('a', 'amazon')).toBe(false); // no suitable art for the Amazon: lettered token
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
});
