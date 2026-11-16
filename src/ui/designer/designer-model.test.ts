import { describe, expect, it } from 'vitest';
import type { DesignedPiece } from '../../persistence/pieces';
import { J_UNSUPPORTED, MAX_PARTS, TOO_MANY_PARTS, UNSAFE_BETZA } from '../../variants/betza';
import {
  canCannon,
  canSlide,
  COMBINABLE,
  DesignerModel,
  LETTER_INVALID,
  NAME_REQUIRED,
  NAME_TOO_LONG,
  NO_MOVES,
  uniqueById,
  upsertPiece,
} from './designer-model';

const named = (name = 'Wazir rider') => {
  const m = DesignerModel.create();
  m.name = name;
  return m;
};

describe('DesignerModel', () => {
  it('turns its components into Betza, with any combined built-in pieces', () => {
    const m = named();
    m.updateComponent(0, { atom: 'W', slide: true, range: null, mode: 'both' });
    expect(m.betza()).toEqual({ betza: 'WW', problem: null });
    m.addComponent();
    m.updateComponent(1, { atom: 'N', mode: 'move' });
    m.setCombine('bishop', true);
    expect(m.betza()).toEqual({ betza: 'WWmNB', problem: null });
    m.setCombine('bishop', false);
    m.removeComponent(0);
    expect(m.betza().betza).toBe('mN');
  });

  it('starts as a one-square orthogonal step, with a token for art and no Betza override', () => {
    const m = DesignerModel.create();
    expect(m.components).toEqual([{ atom: 'W', slide: false, range: null, mode: 'both' }]);
    expect(m.art).toBeNull();
    expect(m.advanced).toBeNull();
    expect(m.id).toBeNull();
  });

  it('lets the advanced box override the components, and go back to them', () => {
    const m = named();
    m.setAdvanced('fRbW');
    expect(m.betza()).toEqual({ betza: 'fRbW', problem: null });
    m.updateComponent(0, { atom: 'F' });
    expect(m.betza().betza).toBe('fRbW');
    m.setAdvanced(null);
    expect(m.betza().betza).toBe('F');
  });

  it('refuses hand-typed Betza with j or characters the engine does not accept', () => {
    const m = named();
    m.setAdvanced('jR');
    expect(m.betza()).toEqual({ betza: null, problem: J_UNSUPPORTED });
    m.setAdvanced('R=1');
    expect(m.betza()).toEqual({ betza: null, problem: UNSAFE_BETZA });
    m.setAdvanced(' R');
    expect(m.problems()).toEqual([UNSAFE_BETZA]);
  });

  it('asks for a Betza when the advanced box is emptied, rather than blaming its characters', () => {
    const m = named();
    m.setAdvanced('');
    expect(m.problems()).toEqual(['Type a Betza move description.']);
  });

  it('needs at least one move', () => {
    const m = named();
    m.removeComponent(0);
    expect(m.problems()).toEqual([NO_MOVES]);
    m.setCombine('knight', true);
    expect(m.problems()).toEqual([]);
  });

  it('requires a name of 1 to 30 characters after trimming', () => {
    expect(named('').problems()).toEqual([NAME_REQUIRED]);
    expect(named('   ').problems()).toEqual([NAME_REQUIRED]);
    expect(named('x'.repeat(30)).problems()).toEqual([]);
    expect(named(` ${'x'.repeat(30)} `).problems()).toEqual([]);
    expect(named('x'.repeat(31)).problems()).toEqual([NAME_TOO_LONG]);
  });

  it('requires a letter from a to z', () => {
    const m = named();
    for (const bad of ['', 'A', 'ab', '1', 'é']) {
      m.letter = bad;
      expect(m.problems(), bad).toEqual([LETTER_INVALID]);
    }
    m.letter = 'q';
    expect(m.problems()).toEqual([]);
  });

  it('only slides the leaps the engine can slide, and only hops a cannon along W and F slides', () => {
    expect(['W', 'F', 'N'].every((a) => canSlide(a as never))).toBe(true);
    expect(canSlide('D')).toBe(false);
    const m = named();
    m.updateComponent(0, { atom: 'D', slide: true });
    expect(m.components[0]!.slide).toBe(false);
    m.updateComponent(0, { atom: 'N', slide: true, range: 3, mode: 'cannon' });
    expect(m.components[0]).toEqual({ atom: 'N', slide: true, range: 3, mode: 'both' });
    expect(canCannon(m.components[0]!)).toBe(false);
    m.updateComponent(0, { atom: 'F', mode: 'cannon' });
    expect(m.betza().betza).toBe('mF3cpF3');
    // A slide turned off can no longer be a cannon, and has no range.
    m.updateComponent(0, { slide: false });
    expect(m.components[0]).toEqual({ atom: 'F', slide: false, range: null, mode: 'both' });
    // Changing to a leap that can't slide stops the slide.
    m.updateComponent(0, { slide: true, range: null, mode: 'cannon' });
    m.updateComponent(0, { atom: 'C' });
    expect(m.components[0]).toEqual({ atom: 'C', slide: false, range: null, mode: 'both' });
  });

  it(`caps the moves at ${MAX_PARTS}`, () => {
    const m = named();
    for (let i = 1; i < MAX_PARTS; i++) expect(m.addComponent()).toBe(true);
    expect(m.components).toHaveLength(MAX_PARTS);
    expect(m.addComponent()).toBe(false);
    expect(m.components).toHaveLength(MAX_PARTS);
  });

  it(`caps the moves and the pieces it also moves like at ${MAX_PARTS} together`, () => {
    const m = named();
    const types = ['archbishop', 'chancellor', 'amazon', 'horse', 'shogiKnight', 'centaur', 'knight'];
    for (const t of types) expect(m.setCombine(t, true)).toBe(true);
    expect(m.addComponent()).toBe(false);
    expect(m.setCombine('rook', true)).toBe(false);
    expect(m.combineWith).not.toContain('rook');
    expect(m.atCap()).toBe(true);
    // Unticking one makes room again.
    expect(m.setCombine('knight', false)).toBe(true);
    expect(m.atCap()).toBe(false);
    // A model pushed past the cap some other way says why, rather than searching.
    m.combineWith.push('knight', 'rook');
    expect(m.betza()).toEqual({ betza: null, problem: TOO_MANY_PARTS });
  });

  it('checks the Betza it is given rather than building it again', () => {
    const m = named();
    expect(m.problems({ betza: null, problem: 'given' })).toEqual(['given']);
    expect(m.problems({ betza: 'W', problem: null })).toEqual([]);
  });

  it('only combines built-in pieces that Betza can describe and that are not royal', () => {
    expect(COMBINABLE.map((p) => p.type)).not.toContain('pawn');
    expect(COMBINABLE.map((p) => p.type)).not.toContain('king');
    expect(COMBINABLE.map((p) => p.type)).toContain('rook');
    expect(() => named().setCombine('king', true)).toThrow();
    expect(() => named().setCombine('pawn', true)).toThrow();
  });

  it('builds a library piece with a trimmed name, and reopens it with its Betza in the advanced box', () => {
    const m = named('  Wazir rider ');
    m.letter = 'w';
    m.art = 'alfaerie/wazir';
    m.updateComponent(0, { slide: true });
    const piece = m.toPiece('id-1', 5);
    expect(piece).toEqual({ id: 'id-1', name: 'Wazir rider', letter: 'w', betza: 'WW', art: 'alfaerie/wazir', savedAt: 5 });
    const again = DesignerModel.fromPiece(piece);
    expect(again.id).toBe('id-1');
    expect(again.advanced).toBe('WW');
    expect(again.components).toEqual([]);
    expect(again.toPiece('id-1', 6)).toEqual({ ...piece, savedAt: 6 });
  });

  it('refuses to build a piece with problems', () => {
    expect(() => named('').toPiece('id', 1)).toThrow(NAME_REQUIRED);
  });
});

describe('upsertPiece', () => {
  const p = (id: string, name: string): DesignedPiece => ({ id, name, letter: 'z', betza: 'W', art: null, savedAt: 1 });

  it('adds a new piece and replaces one with the same id', () => {
    expect(upsertPiece([p('a', 'A')], p('b', 'B')).map((x) => x.name)).toEqual(['A', 'B']);
    expect(upsertPiece([p('a', 'A'), p('b', 'B')], p('a', 'A2')).map((x) => x.name)).toEqual(['A2', 'B']);
  });

  it('keeps one entry per id even when the list already held duplicates', () => {
    expect(upsertPiece([p('a', 'A'), p('b', 'B'), p('a', 'A again')], p('a', 'New')).map((x) => x.name)).toEqual(['New', 'B']);
  });
});

describe('uniqueById', () => {
  it('drops later entries that repeat an id', () => {
    const p = (id: string, name: string): DesignedPiece => ({ id, name, letter: 'z', betza: 'W', art: null, savedAt: 1 });
    expect(uniqueById([p('a', 'A'), p('b', 'B'), p('a', 'A again')]).map((x) => x.name)).toEqual(['A', 'B']);
  });
});
