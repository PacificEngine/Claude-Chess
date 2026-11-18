import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestRules } from '../../rules/test-rules';
import type { Rules } from '../../rules/types';
import { curatedActive, customActive } from '../../variants/active';
import { CURATED_VARIANTS } from '../../variants/catalog';
import { generateVariant, needsCustomVariant } from '../../variants/generator';
import { positionProblems } from '../../variants/legality';
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

describe('EditorModel with designed pieces', () => {
  const piece = (id: string, letter: string, betza = 'NN', art: string | null = 'alfaerie/ox') => ({ id, letter, betza, art });

  it("copies a designed piece into the setup's designed pieces under its preferred letter", () => {
    const m = EditorModel.fromBase('chess', bases);
    const z = m.letterForDesigned(piece('nightrider', 'z'));
    expect(z).toBe('z');
    m.place('d4', z!, 'white');
    const spec = m.toSpec();
    expect(spec.designed).toEqual({ z: { id: 'nightrider', betza: 'NN', art: 'alfaerie/ox' } });
    expect(spec.pieces.z).toBeUndefined();
    // Designed pieces are never royal, so pawns may promote to them.
    expect(spec.promotion.pieceTypes).toContain('z');
    const { name, ini } = generateVariant(spec, bases('chess').types);
    rules.loadConfig(ini);
    expect(rules.validateFen(name, spec.fen)).toBe(true);
  });

  it('reuses the letter of a piece already in the setup, and gives another the first free letter', () => {
    const m = EditorModel.fromBase('chess', bases);
    m.place('d4', m.letterForDesigned(piece('one', 'z'))!, 'white');
    expect(m.letterForDesigned(piece('one', 'z'))).toBe('z');
    // 'z' is taken and 'n' is the base's knight: never re-mapped.
    m.place('d5', m.letterForDesigned(piece('two', 'z'))!, 'white');
    expect(m.toSpec().designed!.a!.id).toBe('two');
    expect(m.letterForDesigned(piece('three', 'n'))).toBe('c');
    // The same library piece changed since it was placed is another piece: the setup's copy stays as it was.
    expect(m.letterForDesigned(piece('one', 'z', 'WW'))).toBe('c');
    expect(m.toSpec().designed!.z!.betza).toBe('NN');
  });

  it('keeps designed letters away from built-in types it adds later, and frees them once unused', () => {
    const m = EditorModel.fromBase('chess', bases);
    m.place('d4', m.letterForDesigned(piece('arch', 'a'))!, 'white');
    expect(m.letterFor('archbishop')).toBe('c');
    m.remove('d4');
    expect(m.toSpec().designed).toBeUndefined();
    expect(m.letterFor('amazon')).toBe('a');
  });

  it('runs out of letters with the same rule as built-in types', () => {
    const m = EditorModel.fromBase('chess', bases);
    const squares = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].flatMap((f) => [3, 4, 5].map((r) => `${f}${r}`));
    for (let i = 0; i < 20; i++) m.place(squares[i]!, m.letterForDesigned(piece(`p${i}`, 'z'))!, 'black');
    expect(m.letterForDesigned(piece('p20', 'z'))).toBeNull();
    expect(Object.keys(m.toSpec().designed!)).toHaveLength(20);
  });

  it("rewrites its copies of a piece updated everywhere, keeping their letters", () => {
    const m = EditorModel.fromBase('chess', bases);
    m.place('d4', m.letterForDesigned(piece('one', 'z'))!, 'white');
    m.place('d5', m.letterForDesigned(piece('two', 'y', 'W', null))!, 'black');
    expect(m.usesPiece('one')).toBe(true);
    expect(m.usesPiece('three')).toBe(false);
    expect(m.rewritePiece({ id: 'three', betza: 'F', art: null })).toBe(false);
    expect(m.rewritePiece({ id: 'one', betza: 'NNF', art: 'merida/N' })).toBe(true);
    expect(m.toSpec().designed).toEqual({ z: { id: 'one', betza: 'NNF', art: 'merida/N' }, y: { id: 'two', betza: 'W', art: null } });
    // The updated library piece is the same piece as its copy now, so it is placed with the same letter.
    expect(m.letterForDesigned(piece('one', 'q', 'NNF', 'merida/N'))).toBe('z');
  });

  it('edits a custom game with its designed pieces', () => {
    const start = EditorModel.fromBase('chess', bases);
    start.place('d4', start.letterForDesigned(piece('one', 'x'))!, 'white');
    const s = start.toSpec();
    const active = customActive(s, generateVariant(s).name, bases('chess').types);
    const m = EditorModel.fromGame(active, s.fen, bases);
    expect(m.toSpec()).toEqual(s);
    m.setBase('chess');
    expect(m.toSpec().designed).toBeUndefined();
  });
});

describe('EditorModel on a position-only base (Shogi, Xiangqi)', () => {
  // A Shogi position from the middle of a game: a promoted pawn and a dragon on the board, pieces in both hands.
  const SHOGI_MIDGAME = 'lnsgkgsnl/1r5b1/pppp1pppp/9/4+P4/9/PPPP1PPPP/1B5+R1/LNSGKGSNL[Pp] w - - 0 1';

  it('keeps the board size of the game itself', () => {
    for (const id of ['shogi', 'xiangqi'] as const) {
      const m = EditorModel.fromBase(id, bases);
      expect(m.positionOnly, id).toBe(true);
      expect(() => m.resize(8, 8), id).toThrow(`${bases(id).label} keeps its own board size.`);
      expect([m.files, m.ranks], id).toEqual([bases(id).files, bases(id).ranks]);
    }
    expect(EditorModel.fromBase('chess', bases).positionOnly).toBe(false);
  });

  it("offers Shogi's promoted forms, which place the promoted piece, and Xiangqi none", () => {
    const m = EditorModel.fromBase('shogi', bases);
    expect(m.base.promotable).toEqual(['p', 'l', 'n', 's', 'b', 'r']);
    m.clear();
    m.place('e9', 'k', 'black');
    m.place('e1', 'k', 'white');
    m.place('e5', '+p', 'white');
    m.place('b2', '+r', 'black');
    expect(m.pieceAt('e5')).toEqual({ letter: '+p', color: 'white' });
    expect(m.toSpec().fen).toBe('4k4/9/9/9/4+P4/9/9/1+r7/4K4[] w - - 0 1');
    // The gold and the king have no promoted form.
    expect(() => m.place('a1', '+g', 'white')).toThrow();
    expect(() => m.place('a1', '+k', 'white')).toThrow();
    const x = EditorModel.fromBase('xiangqi', bases);
    expect(x.base.promotable).toEqual([]);
    expect(() => x.place('e5', '+p', 'white')).toThrow();
  });

  it("edits every Shogi piece that can be in hand, even from an empty hand, and Xiangqi has no hand", () => {
    const m = EditorModel.fromBase('shogi', bases);
    expect(m.base.pockets).toBe(true);
    expect(m.base.pocketLetters).toEqual(['r', 'b', 'g', 's', 'n', 'l', 'p']);
    m.setPocket('white', 'g', 2);
    m.setPocket('black', 'p', 1);
    expect(m.toSpec().fen.split(' ')[0]).toMatch(/\[GGp\]$/);
    expect(positionProblems(rules, 'shogi', m.toSpec().fen)).toEqual([]);
    const x = EditorModel.fromBase('xiangqi', bases);
    expect(x.base.pockets).toBe(false);
    expect(x.base.pocketLetters).toEqual([]);
  });

  it('never puts a promoted piece or a king in hand', () => {
    const m = EditorModel.fromBase('shogi', bases);
    expect(() => m.setPocket('white', '+p', 1)).toThrow();
    expect(() => m.setPocket('black', 'k', 1)).toThrow();
    expect(m.pocketCount('black', 'k')).toBe(0);
    expect(m.toSpec().fen.split(' ')[0]).toMatch(/\[\]$/);
  });

  it('switches from a Chess setup with pieces added to Shogi, leaving nothing of the Chess setup behind', () => {
    const m = EditorModel.fromBase('chess', bases);
    m.place('d4', m.letterFor('archbishop')!, 'white');
    m.place('e4', m.letterForDesigned({ id: 'ox', letter: 'x', betza: 'NN', art: null })!, 'black');
    m.resize(10, 8);
    m.setBase('shogi');
    expect(m.positionOnly).toBe(true);
    expect([m.files, m.ranks]).toEqual([9, 9]);
    const spec = m.toSpec();
    expect(spec.fen).toBe(startFen('shogi'));
    expect(spec.pieces).toEqual(Object.fromEntries(bases('shogi').types));
    expect(spec.designed).toBeUndefined();
    expect(needsCustomVariant(spec, bases('shogi'))).toBe(false);
    m.setBase('chess');
    expect(m.positionOnly).toBe(false);
    expect(() => m.resize(10, 8)).not.toThrow();
  });

  it('keeps the hands and the promoted pieces when editing a Shogi game, and writes back the same FEN', () => {
    expect(positionProblems(rules, 'shogi', SHOGI_MIDGAME)).toEqual([]);
    const m = EditorModel.fromGame(curated('shogi'), SHOGI_MIDGAME, bases);
    expect(m.pieceAt('e5')).toEqual({ letter: '+p', color: 'white' });
    expect(m.pieceAt('h2')).toEqual({ letter: '+r', color: 'white' });
    expect(m.pocketCount('white', 'p')).toBe(1);
    expect(m.pocketCount('black', 'p')).toBe(1);
    expect(m.toSpec().fen).toBe(SHOGI_MIDGAME);
    m.move('e5', 'e6');
    expect(m.toSpec().fen.split(' ')[0]).toContain('4+P4/9/9/PPPP1PPPP');
  });

  it('never needs a custom variant, so a setup always plays as the curated game from its FEN', () => {
    for (const id of ['shogi', 'xiangqi'] as const) {
      const m = EditorModel.fromBase(id, bases);
      m.remove('a1');
      if (id === 'shogi') {
        m.place('e5', '+s', 'white');
        m.setPocket('black', 'r', 1);
      }
      const spec = m.toSpec();
      expect(needsCustomVariant(spec, bases(id)), id).toBe(false);
      // Whatever the spec says: these bases are never generated (their zones, palaces and river are fixed squares).
      expect(needsCustomVariant({ ...spec, files: 8, castling: true, promotion: { rank: 'last', pieceTypes: ['q'] } }, bases(id)), id).toBe(false);
      expect(positionProblems(rules, bases(id).engineName, spec.fen), id).toEqual([]);
    }
  });
});

describe('EditorModel on Duck Chess (position-only)', () => {
  // A Duck Chess game after 1. e4 (duck to e5) Nc6 (duck to d4): the duck is the FEN's `*`.
  const DUCK_MIDGAME = 'r1bqkbnr/pppppppp/2n5/8/3*P3/8/PPPP1PPP/RNBQKBNR w KQkq - 2 2';

  it('keeps the 8x8 board and the castling rights, and offers the duck', () => {
    const m = EditorModel.fromBase('duck', bases);
    expect(m.positionOnly).toBe(true);
    expect(() => m.resize(10, 8)).toThrow('Duck Chess keeps its own board size.');
    expect(m.castling).toBe(true);
    expect(m.rights().map((r) => [r.right, r.on])).toEqual([['K', true], ['Q', true], ['k', true], ['q', true]]);
    expect(m.base.duck).toBe(true);
    expect(EditorModel.fromBase('chess', bases).base.duck).toBe(false);
  });

  it('places the duck as the colourless `*`, which only Duck Chess has', () => {
    const m = EditorModel.fromBase('duck', bases);
    m.place('e4', '*', 'white');
    expect(m.pieceAt('e4')).toEqual({ letter: '*', color: 'black' });
    const spec = m.toSpec();
    expect(spec.fen).toBe('rnbqkbnr/pppppppp/8/8/4*3/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(spec.pieces).toEqual(Object.fromEntries(bases('duck').types));
    expect(needsCustomVariant(spec, bases('duck'))).toBe(false);
    expect(positionProblems(rules, 'duck', spec.fen)).toEqual([]);
    m.place('d3', '*', 'black');
    expect(positionProblems(rules, 'duck', m.toSpec().fen)).toEqual(['There can be only one duck.']);
    expect(() => EditorModel.fromBase('chess', bases).place('e4', '*', 'black')).toThrow();
  });

  it('keeps the duck where it is when editing a game, and takes it back from the board after a drag', () => {
    expect(positionProblems(rules, 'duck', DUCK_MIDGAME)).toEqual([]);
    const m = EditorModel.fromGame(curated('duck'), DUCK_MIDGAME, bases);
    expect(m.pieceAt('d4')).toEqual({ letter: '*', color: 'black' });
    expect(m.toSpec().fen).toBe(DUCK_MIDGAME.replace(' 2 2', ' 0 1'));
    m.replaceBoard([['e1', { letter: 'k', color: 'white' }], ['e8', { letter: 'k', color: 'black' }], ['h5', { letter: '*', color: 'white' }]]);
    expect(m.pieceAt('h5')).toEqual({ letter: '*', color: 'black' });
    expect(m.toSpec().fen).toBe('4k3/8/8/7*/8/8/8/4K3 w - - 0 1');
    expect(needsCustomVariant(m.toSpec(), bases('duck'))).toBe(false);
  });
});
