// "Learn this piece": which lesson a piece letter, or a built-in type, links to.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestRules } from '../rules/test-rules';
import type { Rules } from '../rules/types';
import { type ActiveVariant, curatedActive, customActive, variantTypes } from '../variants/active';
import { INHERITED } from '../variants/piece-types';
import type { SetupSpec } from '../variants/setup';
import type { Lesson, Teaches } from './lesson';
import { lessonFor, lessonForType } from './links';

let rules: Rules;
beforeAll(async () => {
  rules = await loadTestRules();
});

/** A lesson that only says what it teaches: the lookup reads nothing else. */
const lesson = (id: string, ...teaches: Teaches[]): Lesson => ({ id, track: 'fairy', order: 1, title: id, cards: [], teaches, steps: [] });

const curated = (id: Parameters<typeof curatedActive>[0]): [ActiveVariant, Map<string, string>] => {
  const v = curatedActive(id, rules);
  return [v, variantTypes(rules, v.engineName)];
};

const SPEC: SetupSpec = {
  base: 'chess',
  files: 8,
  ranks: 8,
  pieces: { k: 'king', p: 'pawn', w: 'wazir' },
  designed: { x: { id: 'd1', betza: 'WD', art: null } },
  fen: '4k3/8/8/8/3WX3/8/8/4K3 w - - 0 1',
  castling: false,
  promotion: { rank: 'last', pieceTypes: ['w'] },
};
const custom = (spec: SetupSpec): [ActiveVariant, Map<string, string>] => {
  const v = customActive(spec, 'cx_links_test', variantTypes(rules, 'chess'));
  return [v, v.types];
};

/** The arguments for `letter` in a variant: the variant, the letter, and its letter-to-type map. */
const at = ([v, types]: [ActiveVariant, Map<string, string>], letter: string): [ActiveVariant, string, Map<string, string>] => [v, letter, types];

describe('lessonFor', () => {
  it("gives Seirawan's hawk the archbishop lesson, by the type it moves as", () => {
    const lessons = [lesson('wazir', { type: 'wazir' }), lesson('archbishop', { type: 'archbishop' })];
    expect(lessonFor(...at(curated('seirawan'), 'h'), lessons)).toBe('archbishop');
  });

  it('matches the type before a lesson on the letter', () => {
    const lessons = [lesson('hawk', { variant: 'seirawan', letter: 'h' }), lesson('archbishop', { type: 'archbishop' })];
    expect(lessonFor(...at(curated('seirawan'), 'h'), lessons)).toBe('archbishop');
  });

  it("gives an inherited letter its variant's lesson for that letter, and no other variant's", () => {
    const [v, types] = curated('spartan');
    const inherited = [...types].find(([, t]) => t === INHERITED)?.[0];
    expect(inherited).toBeDefined();
    expect(lessonFor(v, inherited!, types, [lesson('other', { variant: 'chess', letter: inherited! })])).toBeNull();
    expect(lessonFor(v, inherited!, types, [lesson('spartan', { variant: 'spartan', letter: inherited! })])).toBe('spartan');
  });

  it("gives a custom variant's letter the lesson for the type the setup gives it", () => {
    expect(lessonFor(...at(custom(SPEC), 'w'), [lesson('wazir', { type: 'wazir' })])).toBe('wazir');
  });

  it('gives a designed letter null, even where its letter or a type it is mapped to has a lesson', () => {
    const lessons = [lesson('x', { variant: 'chess', letter: 'x' }), lesson('wazir', { type: 'wazir' })];
    const [v] = custom(SPEC);
    expect(lessonFor(v, 'x', new Map([['x', 'wazir']]), lessons)).toBeNull();
    expect(lessonFor(v, 'x', new Map([['x', INHERITED]]), lessons)).toBeNull();
  });

  it('gives null when no lesson teaches the piece, and reads an uppercase letter as its piece', () => {
    expect(lessonFor(...at(curated('chess'), 'n'), [lesson('wazir', { type: 'wazir' })])).toBeNull();
    expect(lessonFor(...at(curated('chess'), 'R'), [lesson('rook', { type: 'rook' })])).toBe('rook');
  });

  it("uses the shipped lessons by default: the rook links, and the promotion concept lesson doesn't", () => {
    expect(lessonFor(...at(curated('chess'), 'r'))).toBe('rook');
    expect(lessonForType('wazir')).toBe('wazir');
    expect(lessonForType('pawn', [lesson('promotion')])).toBeNull();
  });

  it('gives the commoner type the king lesson, which cards it as Commoner', () => {
    expect(lessonForType('commoner')).toBe('king');
    expect(lessonFor(...at(curated('chess'), 'k'))).toBe('king');
  });
});
