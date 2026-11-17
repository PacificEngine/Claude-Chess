// The editor's board and piece palette. Pieces move freely (no legality: the editor's problems list says what
// can't be played). Clicking a palette piece arms it; each click on a square then places it, until the
// piece (or Escape) disarms it. The eraser removes, and so does dragging a piece off the board. "Your pieces"
// lists the piece library, each wearing the art the player chose, with New piece… and Edit… for the designer.
// A built-in piece (or the base's own piece) with a lesson has a ? on its White entry, which opens that lesson.
import { Chessground } from 'chessgroundx';
import type { Api } from 'chessgroundx/api';
import type * as cg from 'chessgroundx/types';
import type { DesignedPiece } from '../../persistence/pieces';
import type { Color } from '../../rules/types';
import { lessonForLetter, lessonForType } from '../../tutorial/links';
import { type ActiveVariant, customActive } from '../../variants/active';
import { BUILTIN_PIECES, INHERITED } from '../../variants/piece-types';
import { fromKey, observePieces } from '../board-view';
import { artUrl, tokenClass } from '../pieces';
import { type EditorModel, TOO_MANY_TYPES } from './editor-model';

/** A palette entry: a built-in type, a base variant's own piece (by its letter), or a library piece. */
type Tool =
  | { kind: 'piece'; color: Color; type: string; letter?: string }
  | { kind: 'designed'; color: Color; piece: DesignedPiece }
  | { kind: 'eraser' };

export interface EditorViewHandlers {
  /** The model changed; `notice` is a one-off message for the player, e.g. TOO_MANY_TYPES. */
  changed(notice?: string): void;
  /** Opens the piece designer on a new piece. */
  newPiece(): void;
  /** Opens the piece designer on a library piece. */
  editPiece(piece: DesignedPiece): void;
  /** Opens the tutorial on the lesson `lessonId` ("Learn this piece"). */
  learn(lessonId: string): void;
}

export interface EditorView {
  /** Draws the model; rebuilds the board when its size changes and the palette when its base does. */
  render(model: EditorModel): void;
  /** Disarms the palette (e.g. when the editor closes). */
  disarm(): void;
  /** The piece library for "Your pieces"; the palette is rebuilt on the next render. */
  setPieces(pieces: readonly DesignedPiece[]): void;
}

const COLORS: Color[] = ['white', 'black'];
const capital = (c: Color) => (c === 'white' ? 'White' : 'Black');

export function createEditorView(boardHost: HTMLElement, paletteHost: HTMLElement, handlers: EditorViewHandlers): EditorView {
  boardHost.dataset.testid = 'editor-board';
  boardHost.dataset.orientation = 'white';
  boardHost.classList.add('board-host', 'editor-board');
  const wrap = document.createElement('div');
  wrap.className = 'board-wrap';
  boardHost.append(wrap);

  let model: EditorModel | null = null;
  let drawn: ActiveVariant | null = null;
  observePieces(boardHost, () => drawn);
  let api: Api | null = null;
  let builtFor = '';
  let paletteFor = '';
  let library: readonly DesignedPiece[] = [];
  let armed: Tool | null = null;
  const buttons = new Map<HTMLButtonElement, Tool>();

  const arm = (tool: Tool | null) => {
    armed = tool;
    for (const [b, t] of buttons) b.setAttribute('aria-pressed', String(t === tool));
    boardHost.classList.toggle('armed', tool !== null);
  };

  // While a palette tool is armed, a press on the board is ours: chessground never sees it (no drag, no select).
  const onPress = (e: MouseEvent | TouchEvent) => {
    if (!armed || !api || !model) return;
    e.stopPropagation();
    e.preventDefault();
    const point = 'touches' in e ? e.touches[0] : e;
    if (!point) return;
    const key = api.getKeyAtDomPos([point.clientX, point.clientY]);
    if (!key) return;
    const square = fromKey(key);
    if (armed.kind === 'eraser') {
      model.remove(square);
      return handlers.changed();
    }
    const letter =
      armed.kind === 'designed' ? model.letterForDesigned(armed.piece) : (armed.letter ?? model.letterFor(armed.type));
    if (letter === null) return handlers.changed(TOO_MANY_TYPES);
    model.place(square, letter, armed.color);
    handlers.changed();
  };
  wrap.addEventListener('mousedown', onPress, { capture: true });
  wrap.addEventListener('touchstart', onPress, { capture: true, passive: false });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && armed) arm(null);
  });

  /** After a free drag, chessground's board is the truth: hand it to the model. */
  const onBoardChange = () => {
    if (!api || !model) return;
    const pieces: [string, { letter: string; color: Color }][] = [];
    for (const [key, piece] of api.state.boardState.pieces) {
      pieces.push([fromKey(key), { letter: piece.role.split('-')[0]!, color: piece.color }]);
    }
    model.replaceBoard(pieces);
    handlers.changed();
  };

  function build(m: EditorModel): void {
    api?.destroy();
    wrap.replaceChildren();
    api = Chessground(wrap, {
      fen: placement(m),
      dimensions: { width: m.files, height: m.ranks },
      orientation: 'white',
      coordinates: true,
      autoCastle: false,
      highlight: { lastMove: false, check: false },
      animation: { enabled: false },
      premovable: { enabled: false },
      drawable: { enabled: false },
      movable: { free: true, color: 'both', showDests: false },
      draggable: { deleteOnDropOff: true },
      events: { change: onBoardChange },
    });
    builtFor = `${m.files}x${m.ranks}`;
  }

  function buildPalette(m: EditorModel): void {
    paletteHost.replaceChildren();
    buttons.clear();
    const eraser = document.createElement('button');
    eraser.type = 'button';
    eraser.className = 'palette-eraser secondary';
    eraser.dataset.testid = 'palette-eraser';
    eraser.textContent = 'Eraser';
    eraser.title = 'Remove pieces (or drag a piece off the board)';
    const eraserTool: Tool = { kind: 'eraser' };
    buttons.set(eraser, eraserTool);
    eraser.addEventListener('click', () => arm(armed === eraserTool ? null : eraserTool));
    paletteHost.append(eraser);

    // The base's own pieces that match no built-in type (Spartan's hoplite), then every built-in type.
    const own = [...m.base.types].filter(([, t]) => t === INHERITED).map(([letter]) => letter);
    for (const color of COLORS) {
      const group = document.createElement('div');
      group.className = 'palette-group';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', `${capital(color)} pieces`);
      const entries: { tool: Tool; name: string; letter: string; url: string | null; lesson: string | null }[] = [
        ...own.map((letter) => ({
          tool: { kind: 'piece', color, type: INHERITED, letter } as Tool,
          name: `${m.base.label} piece ${letter.toUpperCase()}`,
          letter,
          url: artUrl(letter, color, m.base.id),
          lesson: lessonForLetter(m.base.id, letter),
        })),
        ...BUILTIN_PIECES.map((p) => {
          const baseLetter = [...m.base.types].find(([, t]) => t === p.type)?.[0];
          return {
            tool: { kind: 'piece', color, type: p.type } as Tool,
            name: p.name,
            letter: baseLetter ?? p.letter,
            // A base letter keeps the base's art (as on the board); any other type looks like what it moves as.
            url: baseLetter ? artUrl(baseLetter, color, m.base.id) : artUrl(p.letter, color, m.base.id, p.type),
            lesson: lessonForType(p.type),
          };
        }),
      ];
      for (const entry of entries) {
        const isOwn = entry.tool.kind === 'piece' && entry.tool.letter !== undefined;
        const type = (entry.tool as { type: string }).type;
        const id = isOwn ? `own-${entry.letter}` : type;
        const button = paletteButton(entry.tool as Tool & { color: Color }, `palette-${color}-${id}`, `${capital(color)} ${entry.name}`, entry.url, entry.letter);
        // One ? per piece, on its White entry. It sits beside the piece button, so it never arms the piece.
        group.append(color === 'white' && entry.lesson ? withLearn(button, entry.lesson, isOwn ? entry.letter : type, entry.name) : button);
      }
      paletteHost.append(group);
    }
    paletteHost.append(yourPieces(m));
    paletteFor = m.base.id;
    arm(null);
  }

  function paletteButton(tool: Tool & { color: Color }, testid: string, label: string, url: string | null, letter: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `palette-piece ${tool.color}`;
    b.dataset.testid = testid;
    b.title = label;
    b.setAttribute('aria-label', label);
    const icon = document.createElement('span');
    icon.className = 'palette-icon';
    if (url) icon.style.backgroundImage = `url("${import.meta.env.BASE_URL}${url}")`;
    else {
      icon.classList.add(...tokenClass(letter).split(' '), tool.color);
      icon.dataset.letter = letter.toUpperCase();
    }
    b.append(icon);
    buttons.set(b, tool);
    b.addEventListener('click', () => arm(armed === tool ? null : tool));
    return b;
  }

  /** A palette cell: the piece button with a small ? in its corner that opens the piece's lesson. */
  function withLearn(button: HTMLButtonElement, lessonId: string, id: string, name: string): HTMLElement {
    const cell = document.createElement('div');
    cell.className = 'palette-cell';
    const learn = document.createElement('button');
    learn.type = 'button';
    learn.className = 'palette-learn';
    learn.dataset.testid = `learn-${id}`;
    learn.textContent = '?';
    learn.title = `Learn the ${name}`;
    learn.setAttribute('aria-label', `Learn the ${name}`);
    learn.addEventListener('click', () => handlers.learn(lessonId));
    cell.append(button, learn);
    return cell;
  }

  /** The piece library: a White and a Black button per piece (its name tells same-art pieces apart), and Edit…. */
  function yourPieces(m: EditorModel): HTMLElement {
    const section = document.createElement('div');
    section.className = 'palette-designed';
    section.setAttribute('role', 'group');
    section.setAttribute('aria-label', 'Your pieces');
    const heading = document.createElement('h3');
    heading.textContent = 'Your pieces';
    section.append(heading);
    for (const piece of library) {
      const row = document.createElement('div');
      row.className = 'palette-designed-row';
      const name = document.createElement('span');
      name.className = 'palette-designed-name';
      name.textContent = piece.name;
      row.append(name);
      for (const color of COLORS) {
        // The art the player chose, or a token, never the base's art for the letter (designedArt in artUrl).
        const url = artUrl(piece.letter, color, m.base.id, undefined, piece.art);
        row.append(paletteButton({ kind: 'designed', color, piece }, `palette-${color}-designed-${piece.id}`, `${capital(color)} ${piece.name}`, url, piece.letter));
      }
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'secondary small';
      edit.textContent = 'Edit…';
      edit.dataset.testid = `palette-edit-${piece.id}`;
      edit.setAttribute('aria-label', `Edit ${piece.name}`);
      edit.addEventListener('click', () => handlers.editPiece(piece));
      row.append(edit);
      section.append(row);
    }
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'secondary small';
    add.textContent = 'New piece…';
    add.dataset.testid = 'palette-new-piece';
    add.addEventListener('click', () => handlers.newPiece());
    section.append(add);
    return section;
  }

  return {
    render(m) {
      model = m;
      const spec = m.toSpec();
      // Drawn as the custom variant it may become, so added letters wear their type's art (or a token).
      drawn = customActive(spec, 'cx_editor', m.base.types);
      boardHost.style.setProperty('--files', String(m.files));
      boardHost.style.setProperty('--ranks', String(m.ranks));
      boardHost.dataset.files = String(m.files);
      boardHost.dataset.ranks = String(m.ranks);
      if (paletteFor !== m.base.id) buildPalette(m);
      if (builtFor !== `${m.files}x${m.ranks}`) build(m);
      else api!.set({ fen: placement(m) });
      boardHost.dataset.fen = spec.fen;
    },
    disarm() {
      arm(null);
    },
    setPieces(pieces) {
      library = pieces;
      paletteFor = ''; // rebuilt on the next render
    },
  };
}

/** The board part of the FEN, which is all the editor board shows (pieces in hand are set in the controls). */
function placement(m: EditorModel): cg.FEN {
  return m.toSpec().fen.split(' ')[0]!.replace(/\[.*\]$/, '') as cg.FEN;
}
