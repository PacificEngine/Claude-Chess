import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestRules } from '../../rules/test-rules';
import type { Rules } from '../../rules/types';
import { curatedActive, customActive } from '../../variants/active';
import { CURATED_VARIANTS } from '../../variants/catalog';
import { generateVariant, needsCustomVariant } from '../../variants/generator';
import { BUILTIN_PIECES } from '../../variants/piece-types';
import { type BaseLookup, EditorModel, editorBases } from './editor-model';

let rules: Rules;
let bases: BaseLookup;
beforeAll(async () => {
  rules = await loadTestRules();
  bases = editorBases(rules);
});

const curated = (id: Parameters<typeof curatedActive>[0]) => curatedActive(id, rules);
const startFen = (engineName: string) => {
  const g = rules.newGame(engineName);
  const fen = g.fen();
  g.dispose();
  return fen;
};
const GRAND_START = 'r8r/1nbqkcabn1/pppppppppp/10/10/10/10/PPPPPPPPPP/1NBQKCABN1/R8R w - - 0 1';

describe('EditorModel', () => {
  it('opens on a curated start position that needs no custom variant, with the same FEN ffish writes', () => {
    for (const v of CURATED_VARIANTS) {
      const m = EditorModel.fromBase(v.id, bases);
      const spec = m.toSpec();
      expect(spec.fen, v.id).toBe(startFen(v.engineName));
      expect(needsCustomVariant(spec, bases(v.id)), v.id).toBe(false);
    }
  });

  it("never lets a pawn promote to 'k', even where k is mapped to a commoner (Spartan, Antichess)", () => {
    for (const id of ['spartan', 'antichess'] as const) {
      const m = EditorModel.fromBase(id, bases);
      expect(m.toSpec().promotion.pieceTypes, id).not.toContain('k');
      expect(needsCustomVariant(m.toSpec(), bases(id)), id).toBe(false);
      m.place('d4', m.letterFor('amazon')!, 'white');
      expect(m.toSpec().promotion.pieceTypes, id).not.toContain('k');
    }
  });

  it('removes pieces that fall off a shrunk board and reports how many', () => {
    const m = EditorModel.fromGame(curated('grand'), GRAND_START, bases);
    expect(m.resize(8, 8).removed).toBeGreaterThan(0);
    expect(m.toSpec().files).toBe(8);
    expect(m.toSpec().fen.split(' ')[0].split('/')).toHaveLength(8);
  });

  it('counts exactly the pieces off the new board', () => {
    const m = EditorModel.fromBase('chess', bases);
    expect(m.resize(6, 8).removed).toBe(8); // the g and h files
    expect(m.resize(6, 8).removed).toBe(0);
    expect(m.toSpec().fen.startsWith('rnbqkb/pppppp/6/6/6/6/PPPPPP/RNBQKB ')).toBe(true);
  });

  it('turns castling off when the board no longer has the base size, as custom setups default to', () => {
    const m = EditorModel.fromBase('chess', bases);
    m.resize(10, 8);
    expect(m.toSpec().castling).toBe(false);
    expect(m.toSpec().fen.split(' ')[2]).toBe('-');
  });

  it('builds a spec whose piece letters map to built-in types', () => {
    const m = EditorModel.fromBase('chess', bases);
    const a = m.letterFor('archbishop');
    expect(a).toBe('a');
    m.place('d4', a!, 'white');
    const spec = m.toSpec();
    expect(spec.pieces.a).toBe('archbishop');
    expect(spec.pieces.q).toBe('queen');
    expect(spec.fen.split(' ')[0]).toContain('3A4');
    expect(spec.promotion.pieceTypes.sort()).toEqual(['a', 'b', 'n', 'q', 'r']);
    expect(needsCustomVariant(spec, bases('chess'))).toBe(true);
    expect(() => generateVariant(spec, bases('chess').types)).not.toThrow();
  });

  it('uses the base letter for a type the base already has, and never re-maps a base letter', () => {
    const m = EditorModel.fromBase('capablanca', bases);
    expect(m.letterFor('rook')).toBe('r');
    expect(m.letterFor('archbishop')).toBe('a');
    const amazon = m.letterFor('amazon');
    expect(amazon).toBe('d'); // 'a' is Capablanca's archbishop: the first free letter instead
    expect(m.letterFor('amazon')).toBe('d');
  });

  it('frees a letter again once no piece uses it', () => {
    const m = EditorModel.fromBase('chess', bases);
    const amazon = m.letterFor('amazon')!;
    m.place('d4', amazon, 'white');
    m.remove('d4');
    expect(m.letterFor('archbishop')).toBe('a');
  });

  it('runs out of letters when a setup has too many different piece types', () => {
    const m = EditorModel.fromBase('chess', bases);
    const extra = BUILTIN_PIECES.filter((p) => !['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'].includes(p.type));
    const squares = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].flatMap((f) => [3, 4, 5].map((r) => `${f}${r}`));
    let placed = 0;
    for (const p of extra) {
      const letter = m.letterFor(p.type);
      if (letter === null) break;
      m.place(squares[placed++]!, letter, 'white');
    }
    expect(placed).toBe(20); // 26 letters less chess's six
    expect(m.letterFor(extra[20]!.type)).toBeNull();
  });

  it('moves and removes pieces freely, with no legality', () => {
    const m = EditorModel.fromBase('chess', bases);
    m.move('e1', 'e5');
    m.move('d8', 'e5'); // captures whatever is there, even a king
    m.remove('a1');
    const board = m.toSpec().fen.split(' ')[0].split('/');
    expect(board[3]).toBe('4q3');
    expect(board[7]).toBe('1NBQ1BNR');
  });

  it('takes the board the view shows after a drag', () => {
    const m = EditorModel.fromBase('chess', bases);
    m.replaceBoard([['e1', { letter: 'k', color: 'white' }], ['e8', { letter: 'k', color: 'black' }]]);
    expect(m.toSpec().fen.split(' ')[0]).toBe('4k3/8/8/8/8/8/8/4K3');
    expect(() => m.replaceBoard([['e1', { letter: 'z', color: 'white' }]])).toThrow();
  });

  it('refuses a letter it has not assigned, and squares off the board', () => {
    const m = EditorModel.fromBase('chess', bases);
    expect(() => m.place('d4', 'z', 'white')).toThrow();
    expect(() => m.place('i1', 'q', 'white')).toThrow();
  });

  it('sets the side to move and castling, keeping only the rights the pieces still have', () => {
    const m = EditorModel.fromBase('chess', bases);
    m.setTurn('black');
    m.remove('h8');
    expect(m.toSpec().fen.split(' ').slice(1, 3)).toEqual(['b', 'KQq']);
    m.setCastling(false);
    expect(m.toSpec().fen.split(' ')[2]).toBe('-');
    expect(m.toSpec().castling).toBe(false);
  });

  /** The FEN ffish writes after `moves` from the variant's start. */
  const fenAfter = (engineName: string, moves: string[]) => {
    const g = rules.newGame(engineName);
    for (const m of moves) g.push(m);
    const fen = g.fen();
    g.dispose();
    return fen;
  };

  it("keeps the game's castling rights when editing it: a king that moved and came back doesn't castle again", () => {
    const fen = fenAfter('chess', ['e2e4', 'e7e5', 'e1e2', 'b8c6', 'e2e1', 'c6b8']);
    expect(fen.split(' ')[2]).toBe('kq');
    const m = EditorModel.fromGame(curated('chess'), fen, bases);
    expect(m.toSpec().fen.split(' ')[2]).toBe('kq');
    // Edits still drop a right the pieces no longer allow, and never add one the game had lost.
    m.remove('h8');
    expect(m.toSpec().fen.split(' ')[2]).toBe('q');
    m.place('h8', 'r', 'black');
    m.setCastling(false);
    m.setCastling(true);
    expect(m.toSpec().fen.split(' ')[2]).toBe('kq');
  });

  it("keeps the game's Seirawan gating rights that the game has used up", () => {
    const fen = fenAfter('seirawan', ['g1f3', 'g8f6', 'f3g1', 'f6g8']);
    const field = fen.split(' ')[2];
    expect(field).not.toContain('G');
    const m = EditorModel.fromGame(curated('seirawan'), fen, bases);
    expect(m.toSpec().fen.split(' ')[2]).toBe(field);
  });

  it("keeps the game's en-passant square while the position is unchanged, and drops it after an edit", () => {
    const fen = fenAfter('chess', ['e2e4', 'a7a6', 'e4e5', 'd7d5']);
    expect(fen.split(' ')[3]).toBe('d6');
    const m = EditorModel.fromGame(curated('chess'), fen, bases);
    expect(m.toSpec().fen.split(' ')[3]).toBe('d6');
    m.remove('a2');
    expect(m.toSpec().fen.split(' ')[3]).toBe('-');
    m.place('a2', 'p', 'white');
    expect(m.toSpec().fen.split(' ')[3]).toBe('d6');
    m.setTurn('black');
    expect(m.toSpec().fen.split(' ')[3]).toBe('-');
  });

  const field = (m: EditorModel) => m.toSpec().fen.split(' ')[2];

  it("lists the base's castling rights one by one, each on for a new setup, and drops the ones unticked", () => {
    const m = EditorModel.fromBase('chess', bases);
    expect(m.rights()).toEqual(['K', 'Q', 'k', 'q'].map((right) => ({ right, on: true, possible: true })));
    m.setRight('Q', false);
    m.setRight('k', false);
    expect(field(m)).toBe('Kq');
    expect(m.rights().filter((r) => r.on).map((r) => r.right)).toEqual(['K', 'q']);
    m.setRight('Q', true);
    expect(field(m)).toBe('KQq');
  });

  it('allows a right only while its king and rook are on their start squares, and keeps it ticked for when they return', () => {
    const m = EditorModel.fromBase('chess', bases);
    m.remove('a1');
    expect(m.rights().find((r) => r.right === 'Q')).toEqual({ right: 'Q', on: false, possible: false });
    expect(field(m)).toBe('Kkq');
    // Ticking a right the pieces don't allow changes nothing.
    m.setRight('Q', true);
    expect(field(m)).toBe('Kkq');
    m.place('a1', 'r', 'white');
    expect(field(m)).toBe('KQkq');
    m.move('e8', 'd8');
    expect(m.rights().filter((r) => r.right === r.right.toLowerCase()).map((r) => r.possible)).toEqual([false, false]);
    expect(field(m)).toBe('KQ');
  });

  it("starts an edited game from its own rights, and lets the player give back a lost one while the pieces allow it", () => {
    const fen = fenAfter('chess', ['e2e4', 'e7e5', 'e1e2', 'b8c6', 'e2e1', 'c6b8']);
    const m = EditorModel.fromGame(curated('chess'), fen, bases);
    expect(m.rights()).toEqual([
      { right: 'K', on: false, possible: true },
      { right: 'Q', on: false, possible: true },
      { right: 'k', on: true, possible: true },
      { right: 'q', on: true, possible: true },
    ]);
    m.setRight('K', true);
    expect(field(m)).toBe('Kkq');
    // Start position starts over from the base's own rights.
    m.setBase('chess');
    expect(field(m)).toBe('KQkq');
  });

  it('keeps the rights ticked while castling is off, and writes none until it is on again', () => {
    const m = EditorModel.fromBase('chess', bases);
    m.setRight('q', false);
    m.setCastling(false);
    expect(field(m)).toBe('-');
    m.setCastling(true);
    expect(field(m)).toBe('KQk');
  });

  it('lists Seirawan\'s gating files with its castling rights, and none for a base without castling', () => {
    const m = EditorModel.fromBase('seirawan', bases);
    expect(m.rights().map((r) => r.right).join('')).toBe(startFen('seirawan').split(' ')[2]);
    m.setRight('G', false);
    expect(field(m)).not.toContain('G');
    expect(rules.validateFen('seirawan', m.toSpec().fen)).toBe(true);
    expect(EditorModel.fromBase('grand', bases).rights()).toEqual([]);
  });

  it('puts pieces in hand for a base with pockets', () => {
    const m = EditorModel.fromBase('seirawan', bases);
    expect(m.base.pocketLetters.sort()).toEqual(['e', 'h']);
    m.setPocket('white', 'h', 2);
    m.setPocket('black', 'e', 0);
    expect(m.toSpec().fen.split(' ')[0]).toMatch(/\[EHHh\]$/);
    expect(rules.validateFen('seirawan', m.toSpec().fen)).toBe(true);
  });

  it('starts over from another base', () => {
    const m = EditorModel.fromBase('chess', bases);
    m.place('d4', m.letterFor('amazon')!, 'white');
    m.setBase('capablanca');
    expect(m.toSpec().fen).toBe(startFen('capablanca'));
    expect(m.toSpec().base).toBe('capablanca');
  });

  it('edits a custom game with the letters its setup added', () => {
    const spec = EditorModel.fromBase('chess', bases);
    spec.resize(10, 8);
    spec.place('i1', spec.letterFor('archbishop')!, 'white');
    const s = spec.toSpec();
    const active = customActive(s, generateVariant(s).name, bases('chess').types);
    const m = EditorModel.fromGame(active, s.fen, bases);
    expect(m.toSpec()).toEqual(s);
  });
});
