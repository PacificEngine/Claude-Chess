import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestRules } from '../rules/test-rules';
import type { Rules } from '../rules/types';
import { curatedActive, customActive } from './active';
import { CURATED_VARIANTS } from './catalog';
import { generateVariant, needsCustomVariant } from './generator';
import type { SetupSpec } from './setup';

let rules: Rules;
beforeAll(async () => {
  rules = await loadTestRules();
});

const spec = (over: Partial<SetupSpec> = {}): SetupSpec => ({
  base: 'chess',
  files: 8,
  ranks: 8,
  pieces: { k: 'king', a: 'archbishop', p: 'pawn' },
  fen: '4k3/pppppppp/8/8/8/8/PPPPPPPP/A3K3 w - - 0 1',
  castling: false,
  promotion: { rank: 'last', pieceTypes: ['a'] },
  ...over,
});

describe('curatedActive', () => {
  it('describes a curated variant from the catalog and its start position', () => {
    const v = curatedActive('capablanca', rules);
    expect(v).toMatchObject({ engineName: 'capablanca', label: 'Capablanca', files: 10, ranks: 8, pockets: false });
    expect(v).toMatchObject({ artBase: 'capablanca', castling: true, setup: null });
    expect([...v.letters].sort()).toEqual(['a', 'b', 'c', 'k', 'n', 'p', 'q', 'r']);
  });

  it('counts pieces in hand as letters and as pockets', () => {
    const v = curatedActive('seirawan', rules);
    expect(v.pockets).toBe(true);
    expect(v.letters).toEqual(expect.arrayContaining(['e', 'h']));
  });

  it('reads castling from the start position', () => {
    expect(curatedActive('chess', rules).castling).toBe(true);
    expect(curatedActive('grand', rules).castling).toBe(false);
    expect(curatedActive('antichess', rules).castling).toBe(false);
  });

  it('knows each letter’s built-in type, so the editor can tell whether a setup needs a custom variant', () => {
    const chess = curatedActive('chess', rules);
    expect(chess.types.get('q')).toBe('queen');
    expect(chess.types).toBe(curatedActive('chess', rules).types); // computed once per variant
    const unchanged = spec({ pieces: { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' } });
    unchanged.castling = true;
    unchanged.promotion.pieceTypes = ['q', 'r', 'b', 'n'];
    expect(needsCustomVariant(unchanged, chess)).toBe(false);
    expect(needsCustomVariant(spec(), chess)).toBe(true);
  });

  it('describes every curated variant', () => {
    for (const c of CURATED_VARIANTS) expect(curatedActive(c.id, rules).letters.length, c.id).toBeGreaterThan(0);
  });
});

describe('customActive', () => {
  it('describes a custom variant from its setup, drawn with its base variant’s art', () => {
    const s = spec();
    const { name } = generateVariant(s);
    const v = customActive(s, name, curatedActive('chess', rules).types);
    expect(v).toMatchObject({ engineName: name, label: 'Custom (based on Chess)', files: 8, ranks: 8, pockets: false });
    expect(v).toMatchObject({ artBase: 'chess', castling: false, setup: s });
    expect(v.baseTypes?.get('q')).toBe('queen');
    expect([...v.letters].sort()).toEqual(['a', 'k', 'p']);
    expect(v.types.get('a')).toBe('archbishop');
  });

  it('has pockets when the setup puts pieces in hand', () => {
    const s = spec({ base: 'seirawan', fen: '4k3/pppppppp/8/8/8/8/PPPPPPPP/4K3[Aa] w - - 0 1' });
    const v = customActive(s, 'cx_test', curatedActive('seirawan', rules).types);
    expect(v.pockets).toBe(true);
    expect(v.label).toBe('Custom (based on Seirawan)');
  });
});
