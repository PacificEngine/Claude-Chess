// The editor's state: the board, pieces in hand, side to move, castling and which letter each piece type
// uses. Pure (no DOM): the view and controls draw it and call it, and it builds the SetupSpec the generator
// and the legality checks read. It decides nothing about legality.
import type { Color, Rules } from '../../rules/types';
import { type ActiveVariant, curatedActive } from '../../variants/active';
import { type VariantId } from '../../variants/catalog';
import { buildFen, parseFen } from '../../variants/fen';
import type { ActiveVariantShape } from '../../variants/generator';
import { pieceTypeByName } from '../../variants/piece-types';
import { MAX_FILES, MAX_RANKS, MIN_FILES, MIN_RANKS, type SetupSpec } from '../../variants/setup';

export const TOO_MANY_TYPES = 'Too many different piece types for one setup.';

/** A curated variant as the editor uses it: the base of every setup. */
export interface EditorBase extends ActiveVariantShape {
  id: VariantId;
  engineName: string;
  label: string;
  startFen: string;
  /** Whether the base has pieces in hand (Seirawan), and so a pocket editor. */
  pockets: boolean;
  /** Lowercase letters the base holds in hand at the start: the pocket editor's rows. */
  pocketLetters: string[];
}

export type BaseLookup = (id: VariantId) => EditorBase;

/** Bases by id, built once each: the piece types take about a second per board size the first time. */
export function editorBases(rules: Rules): BaseLookup {
  const cache = new Map<VariantId, EditorBase>();
  return (id) => {
    let base = cache.get(id);
    if (!base) {
      const active = curatedActive(id, rules);
      const game = rules.newGame(active.engineName);
      const startFen = game.fen();
      game.dispose();
      base = {
        id,
        engineName: active.engineName,
        label: active.label,
        files: active.files,
        ranks: active.ranks,
        letters: active.letters,
        castling: active.castling,
        types: active.types,
        startFen,
        pockets: active.pockets,
        pocketLetters: [...new Set(parseFen(startFen).pocket.map((c) => c.toLowerCase()))],
      };
      cache.set(id, base);
    }
    return base;
  };
}

export interface EditorPiece {
  letter: string;
  color: Color;
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const fileOf = (square: string) => square.charCodeAt(0) - 97;
const rankOf = (square: string) => Number(square.slice(1)) - 1;
const squareAt = (file: number, rank: number) => `${String.fromCharCode(97 + file)}${rank + 1}`;
const fenChar = ({ letter, color }: EditorPiece) => (color === 'white' ? letter.toUpperCase() : letter);

export class EditorModel {
  base: EditorBase;
  files: number;
  ranks: number;
  turn: Color = 'white';
  castling: boolean;
  /** Pieces by UCI square ("e1", "j10"). */
  private board = new Map<string, EditorPiece>();
  private hand: Record<Color, Map<string, number>> = { white: new Map(), black: new Map() };
  /** Letters the base doesn't define, to the built-in type the setup gives them. */
  private added = new Map<string, string>();
  /**
   * The castling (and gating) rights the player has ticked: the base's for a setup, the game's own when editing
   * one. The FEN gets those the pieces still allow, while castling is on.
   */
  private ticked = new Set<string>();
  /** The game's en-passant square, and the position it belongs to: it holds only while that position is unchanged. */
  private gameEp: { position: string; square: string } | null = null;

  private constructor(
    private readonly bases: BaseLookup,
    base: EditorBase,
  ) {
    this.base = base;
    this.files = base.files;
    this.ranks = base.ranks;
    this.castling = base.castling;
  }

  /** The base variant's start position. */
  static fromBase(id: VariantId, bases: BaseLookup): EditorModel {
    const m = new EditorModel(bases, bases(id));
    m.setBase(id);
    return m;
  }

  /** The position `fen` of a game in `active`, curated or custom; a custom game keeps its setup's letters. */
  static fromGame(active: ActiveVariant, fen: string, bases: BaseLookup): EditorModel {
    const m = new EditorModel(bases, bases(active.setup?.base ?? active.artBase));
    m.files = active.files;
    m.ranks = active.ranks;
    m.castling = active.castling;
    for (const [letter, type] of Object.entries(active.setup?.pieces ?? {})) {
      if (!m.base.types.has(letter)) m.added.set(letter, type);
    }
    m.load(fen);
    // Rights the game has lost (a king or rook that moved and came back) start unticked, never rebuilt from the pieces.
    const [, , rights = '-', ep = '-'] = fen.split(' ');
    m.ticked = new Set(rights === '-' ? [] : rights);
    if (ep !== '-') m.gameEp = { position: m.position(), square: ep };
    return m;
  }

  /** Starts over from another base variant's start position. */
  setBase(id: VariantId): void {
    this.base = this.bases(id);
    this.files = this.base.files;
    this.ranks = this.base.ranks;
    this.castling = this.base.castling;
    this.added.clear();
    this.ticked = new Set(this.baseRights());
    this.gameEp = null;
    this.load(this.base.startFen);
  }

  private load(fen: string): void {
    const { files, squares, pocket } = parseFen(fen);
    this.board.clear();
    this.hand = { white: new Map(), black: new Map() };
    for (const [index, c] of squares) {
      this.board.set(squareAt(index % files, Math.floor(index / files)), { letter: c.toLowerCase(), color: c === c.toLowerCase() ? 'black' : 'white' });
    }
    for (const c of pocket) {
      const color: Color = c === c.toLowerCase() ? 'black' : 'white';
      this.hand[color].set(c.toLowerCase(), (this.hand[color].get(c.toLowerCase()) ?? 0) + 1);
    }
    this.turn = fen.split(' ')[1] === 'b' ? 'black' : 'white';
  }

  /** The built-in type a letter moves as, or 'inherited' for a base piece that matches none. */
  typeOf(letter: string): string | undefined {
    return this.base.types.get(letter) ?? this.added.get(letter);
  }

  /**
   * The letter to place a built-in type with, assigning one if needed: the base's own letter for that type,
   * else the type's usual letter if the base and setup leave it free, else the first free letter. A base
   * letter is never given to another type. Null when every letter is taken (TOO_MANY_TYPES).
   */
  letterFor(type: string): string | null {
    for (const [letter, t] of this.base.types) if (t === type) return letter;
    const used = this.usedLetters();
    for (const [letter, t] of [...this.added]) {
      if (!used.has(letter)) this.added.delete(letter);
      else if (t === type) return letter;
    }
    const free = (l: string) => !this.base.types.has(l) && !this.added.has(l);
    const letter = [pieceTypeByName(type).letter, ...LETTERS].find(free);
    if (letter === undefined) return null;
    this.added.set(letter, type);
    return letter;
  }

  place(square: string, letter: string, color: Color): void {
    if (this.typeOf(letter) === undefined) throw new Error(`No piece type for the letter ${letter}`);
    this.checkSquare(square);
    this.board.set(square, { letter, color });
  }

  remove(square: string): void {
    this.board.delete(square);
  }

  /** Moves a piece anywhere, replacing what is there. */
  move(from: string, to: string): void {
    const piece = this.board.get(from);
    if (!piece || from === to) return;
    this.checkSquare(to);
    this.board.delete(from);
    this.board.set(to, piece);
  }

  /** Takes the board as the view shows it after a free drag (a move, a capture, or a piece dropped off the board). */
  replaceBoard(pieces: Iterable<[string, EditorPiece]>): void {
    const next = new Map<string, EditorPiece>();
    for (const [square, piece] of pieces) {
      if (this.typeOf(piece.letter) === undefined) throw new Error(`No piece type for the letter ${piece.letter}`);
      this.checkSquare(square);
      next.set(square, { ...piece });
    }
    this.board = next;
  }

  clear(): void {
    this.board.clear();
    this.hand = { white: new Map(), black: new Map() };
  }

  /** Keeps the pieces from a1 up and to the right; the rest fall off. A size other than the base's turns castling off. */
  resize(files: number, ranks: number): { removed: number } {
    if (!Number.isInteger(files) || files < MIN_FILES || files > MAX_FILES) throw new Error(`Files must be ${MIN_FILES} to ${MAX_FILES}`);
    if (!Number.isInteger(ranks) || ranks < MIN_RANKS || ranks > MAX_RANKS) throw new Error(`Ranks must be ${MIN_RANKS} to ${MAX_RANKS}`);
    let removed = 0;
    for (const square of [...this.board.keys()]) {
      if (fileOf(square) >= files || rankOf(square) >= ranks) {
        this.board.delete(square);
        removed++;
      }
    }
    if (files !== this.files || ranks !== this.ranks) {
      this.files = files;
      this.ranks = ranks;
      if (files !== this.base.files || ranks !== this.base.ranks) this.castling = false;
    }
    return { removed };
  }

  setTurn(c: Color): void {
    this.turn = c;
  }

  setCastling(b: boolean): void {
    this.castling = b;
  }

  /**
   * The base's castling (and Seirawan gating) rights, in its FEN order: whether each is ticked (and so in the
   * FEN), and whether the pieces allow it at all. A right the pieces don't allow shows as off.
   */
  rights(): { right: string; on: boolean; possible: boolean }[] {
    return this.baseRights().map((right) => {
      const possible = this.allows(right);
      return { right, on: possible && this.ticked.has(right), possible };
    });
  }

  setRight(right: string, on: boolean): void {
    if (!this.baseRights().includes(right)) throw new Error(`The base has no castling right ${right}`);
    if (on) this.ticked.add(right);
    else this.ticked.delete(right);
  }

  setPocket(color: Color, letter: string, count: number): void {
    if (!this.base.pockets) throw new Error('This base variant has no pieces in hand');
    if (this.typeOf(letter) === undefined) throw new Error(`No piece type for the letter ${letter}`);
    const n = Math.max(0, Math.floor(count));
    if (n) this.hand[color].set(letter, n);
    else this.hand[color].delete(letter);
  }

  pocketCount(color: Color, letter: string): number {
    return this.hand[color].get(letter) ?? 0;
  }

  pieceAt(square: string): EditorPiece | undefined {
    return this.board.get(square);
  }

  pieceCount(): number {
    return this.board.size;
  }

  toSpec(): SetupSpec {
    const used = this.usedLetters();
    const pieces: Record<string, string> = Object.fromEntries(this.base.types);
    for (const [letter, type] of this.added) if (used.has(letter)) pieces[letter] = type;
    // Custom setup default: promote to any non-king piece of the setup (never a royal type, nor a pawn). The
    // base's letters are always offered, so an unchanged piece set promotes as the base does.
    const promotion = Object.keys(pieces).filter((l) => {
      const type = pieces[l]!;
      // 'k' is excluded even when it maps to a commoner: Spartan's kings must never be promoted to.
      if (l === 'k' || type === 'king' || type === 'pawn') return false;
      return this.base.types.has(l) || !pieceTypeByName(type).royal;
    });
    return {
      base: this.base.id,
      files: this.files,
      ranks: this.ranks,
      pieces,
      fen: this.fen(),
      castling: this.castling,
      promotion: { rank: 'last', pieceTypes: promotion.sort() },
    };
  }

  private fen(): string {
    const position = this.position();
    return `${position} ${this.gameEp?.position === position ? this.gameEp.square : '-'} 0 1`;
  }

  /** The FEN up to its castling field: placement, pieces in hand, side to move and castling. */
  private position(): string {
    const squares = new Map<number, string>();
    for (const [square, piece] of this.board) squares.set(fileOf(square) + rankOf(square) * this.files, fenChar(piece));
    const pocket = (['white', 'black'] as const).flatMap((color) =>
      [...this.hand[color]].flatMap(([letter, n]) => new Array<string>(n).fill(fenChar({ letter, color }))),
    );
    const placement = buildFen({ files: this.files, ranks: this.ranks, squares, pocket: pocket.sort() }, '').trimEnd();
    // A base with pockets always writes them, empty or not, as ffish does.
    const hand = this.base.pockets && pocket.length === 0 ? '[]' : '';
    return `${placement}${hand} ${this.turn === 'white' ? 'w' : 'b'} ${this.castlingField()}`;
  }

  /** The base's castling field as letters: none for a base without castling. */
  private baseRights(): string[] {
    const field = this.base.startFen.split(' ')[2] ?? '-';
    return field === '-' ? [] : [...field];
  }

  /** The ticked rights the pieces allow, in the base's order. None when castling is off or the board is not the base's size. */
  private castlingField(): string {
    const base = parseFen(this.base.startFen);
    if (!this.castling || this.files !== base.files || this.ranks !== base.ranks) return '-';
    const kept = this.baseRights().filter((right) => this.ticked.has(right) && this.allows(right));
    return kept.length ? kept.join('') : '-';
  }

  /**
   * Whether the pieces allow a right: a king and its rook on their start squares for K/Q, and for a gating
   * file, the king and the start piece on that file of its rank.
   */
  private allows(right: string): boolean {
    const base = parseFen(this.base.startFen);
    if (this.files !== base.files || this.ranks !== base.ranks) return false;
    const startAt = new Map([...base.squares].map(([i, c]) => [squareAt(i % base.files, Math.floor(i / base.files)), c]));
    const has = (square: string | undefined, c: string): boolean => {
      const piece = square === undefined ? undefined : this.board.get(square);
      return piece !== undefined && fenChar(piece) === c;
    };
    const white = right === right.toUpperCase();
    const king = white ? 'K' : 'k';
    const kings = [...startAt].filter(([, c]) => c === king).map(([sq]) => sq);
    if (kings.length !== 1) return false;
    const kingSquare = kings[0]!;
    if (!has(kingSquare, king)) return false;
    const rank = rankOf(kingSquare);
    if (right.toLowerCase() === 'k' || right.toLowerCase() === 'q') {
      const rook = white ? 'R' : 'r';
      const rooks = [...startAt]
        .filter(([sq, c]) => c === rook && rankOf(sq) === rank)
        .map(([sq]) => sq)
        .sort((a, b) => fileOf(a) - fileOf(b));
      const kingSide = right.toLowerCase() === 'k';
      const corner = kingSide ? rooks.filter((sq) => fileOf(sq) > fileOf(kingSquare)).pop() : rooks.find((sq) => fileOf(sq) < fileOf(kingSquare));
      return has(corner, rook);
    }
    // A gating file: the start piece on that file of the king's rank must still be there.
    const square = squareAt(right.toLowerCase().charCodeAt(0) - 97, rank);
    const start = startAt.get(square);
    return start !== undefined && has(square, start);
  }

  private usedLetters(): Set<string> {
    const used = new Set<string>();
    for (const p of this.board.values()) used.add(p.letter);
    for (const c of ['white', 'black'] as const) for (const l of this.hand[c].keys()) used.add(l);
    return used;
  }

  private checkSquare(square: string): void {
    const f = fileOf(square);
    const r = rankOf(square);
    if (!/^[a-l]\d+$/.test(square) || f >= this.files || r < 0 || r >= this.ranks) throw new Error(`Off the board: ${square}`);
  }
}
