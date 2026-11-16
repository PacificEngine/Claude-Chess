import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestRules } from '../../rules/test-rules';
import type { Rules } from '../../rules/types';
import { buildBetza, CANNON_LEAPS, LEAPS, SLIDING_LEAPS } from '../../variants/betza';
import { generateVariant } from '../../variants/generator';
import { positionProblems } from '../../variants/legality';
import { PREVIEW_FEN, previewSpec, reachOf } from './designer-preview';

let rules: Rules;
beforeAll(async () => {
  rules = await loadTestRules();
});

/** Loads the preview variant straight into ffish (no engine check: these Betza strings are known good). */
function load(betza: string): string {
  const { name, ini } = generateVariant(previewSpec(betza));
  if (!rules.knows(name)) rules.loadConfig(ini);
  return name;
}
const reach = (betza: string) => reachOf(rules, load(betza));

const sorted = (xs: string[]) => [...xs].sort();

describe('the designer preview', () => {
  it('is chess on 8×8 with the piece on d4, the kings in corners and Black pawns as screens', () => {
    const spec = previewSpec('W');
    expect(spec.base).toBe('chess');
    expect([spec.files, spec.ranks]).toEqual([8, 8]);
    expect(spec.designed).toEqual({ z: { id: 'preview', betza: 'W', art: null } });
    expect(spec.fen).toBe(PREVIEW_FEN);
    expect(PREVIEW_FEN.split(' ')[0]).toBe('k7/8/1p1p1p2/8/3Z1p2/8/8/7K');
  });

  it('shows where a step moves, with no capture-only squares', () => {
    expect(reach('W')).toEqual({ moves: ['c4', 'd3', 'd5', 'e4'], captures: [] });
  });

  it('shows a capture-only piece where it could capture', () => {
    expect(reach('cW')).toEqual({ moves: [], captures: ['c4', 'd3', 'd5', 'e4'] });
  });

  it('stops a slide at a screen, which it can capture', () => {
    const r = reach('WW');
    expect(sorted(r.moves)).toEqual(['a4', 'b4', 'c4', 'd1', 'd2', 'd3', 'd5', 'e4']);
    expect(r.captures).toEqual(['d6', 'f4']);
  });

  it('shows a cannon capturing only over a screen', () => {
    const r = reach('mRcpR');
    expect(sorted(r.moves)).toEqual(['a4', 'b4', 'c4', 'd1', 'd2', 'd3', 'd5', 'e4']);
    expect(r.captures).toEqual(['d7', 'd8', 'g4', 'h4']);
  });

  it('shows a diagonal cannon hopping its screens, with neither king in its way', () => {
    const r = reach('mFFcpFF');
    expect(sorted(r.moves)).toEqual(['a1', 'b2', 'c3', 'c5', 'e3', 'e5', 'f2', 'g1']);
    expect(r.captures).toEqual(['a7', 'g7', 'h8']);
  });

  it('keeps both kings out of reach of every move the designer offers, so the preview is always a legal position', () => {
    const betzas = LEAPS.map((l) => buildBetza([{ atom: l.atom, slide: false, range: null, mode: 'both' }], []));
    for (const atom of SLIDING_LEAPS) betzas.push(buildBetza([{ atom, slide: true, range: null, mode: 'both' }], []));
    for (const atom of CANNON_LEAPS) betzas.push(buildBetza([{ atom, slide: true, range: null, mode: 'cannon' }], []));
    for (const betza of betzas) expect(positionProblems(rules, load(betza), PREVIEW_FEN, 'chess'), betza).toEqual([]);
  });

  it('finds no square for a piece that cannot move', () => {
    expect(reach('pN')).toEqual({ moves: [], captures: [] });
  });
});
