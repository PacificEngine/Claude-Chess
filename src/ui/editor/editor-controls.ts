// The editor's controls: base variant, board size, side to move, castling and each castling right, pieces in hand, the setup's name,
// the clock times when editing a timed game, the problems list, and Play / Save / Close (Resume / Cancel when editing the game in progress). They render what editor.ts tells them and report what the
// player changed; they hold no setup state. All text, the player's own included, goes through textContent.
import type { Color } from '../../rules/types';
import { CURATED_VARIANTS, type VariantId } from '../../variants/catalog';
import { MAX_FILES, MAX_RANKS, MIN_FILES, MIN_RANKS } from '../../variants/setup';
import type { EditorModel } from './editor-model';

export interface EditorControlsHandlers {
  base(id: VariantId): void;
  resize(files: number, ranks: number): void;
  turn(c: Color): void;
  castling(on: boolean): void;
  /** Ticks or unticks one castling (or gating) right, a letter of the base's castling field. */
  right(right: string, on: boolean): void;
  pocket(color: Color, letter: string, count: number): void;
  /** The text typed in a side's clock time, editing a timed game. */
  clock(color: Color, text: string): void;
  clear(): void;
  reset(): void;
  play(): void;
  resume(): void;
  save(): void;
  close(): void;
}

export interface EditorStatus {
  problems: string[];
  /** The engine is still checking a custom setup. */
  checking: boolean;
  /** A one-off message: pieces removed by a resize, a save. */
  notice: string;
  /** Editing the game in progress: Resume and Cancel replace Play, Save and Close, and the base is fixed. */
  resuming: boolean;
  /** The clock times as typed, editing a timed game; null otherwise (no clock inputs). */
  clocks: Record<Color, string> | null;
}

export interface EditorControls {
  render(model: EditorModel, status: EditorStatus): void;
  name(): string;
  setName(name: string): void;
}

export const CHECKING = 'Checking setup…';
export const READY = 'Ready to play.';
const MAX_NAME = 60;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props);
}

function field(label: string, control: HTMLElement): HTMLLabelElement {
  const l = el('label', { className: 'field' });
  l.append(el('span', { textContent: label }), control);
  return l;
}

function numberSelect(id: string, min: number, max: number): HTMLSelectElement {
  const s = el('select', { id });
  for (let n = min; n <= max; n++) s.append(el('option', { value: String(n), textContent: String(n) }));
  return s;
}

const sideOf = (right: string) => (right === right.toUpperCase() ? 'White' : 'Black');
/** An id that keeps White's and Black's rights apart however ids are compared ("editor-right-w-k"). */
const rightId = (right: string) => `editor-right-${right === right.toUpperCase() ? 'w' : 'b'}-${right.toLowerCase()}`;

/** A right as the player reads it: O-O / O-O-O, and in Seirawan the gating it also carries, or a gating file. */
function rightLabel(base: VariantId, right: string): string {
  const letter = right.toLowerCase();
  const gating = base === 'seirawan';
  if (letter === 'k' || letter === 'q') return `${sideOf(right)} ${letter === 'k' ? 'O-O' : 'O-O-O'}${gating ? ' and gating' : ''}`;
  return `${sideOf(right)} gating on the ${letter}-file`;
}

export function createEditorControls(host: HTMLElement, handlers: EditorControlsHandlers): EditorControls {
  const base = el('select', { id: 'editor-base' });
  for (const v of CURATED_VARIANTS) base.append(el('option', { value: v.id, textContent: v.label }));
  base.addEventListener('change', () => handlers.base(base.value as VariantId));

  const files = numberSelect('editor-files', MIN_FILES, MAX_FILES);
  const ranks = numberSelect('editor-ranks', MIN_RANKS, MAX_RANKS);
  const resize = () => handlers.resize(Number(files.value), Number(ranks.value));
  files.addEventListener('change', resize);
  ranks.addEventListener('change', resize);
  const size = el('div', { className: 'editor-size' });
  size.append(field('Files', files), field('Ranks', ranks));

  const turn = el('select', { id: 'editor-turn' });
  turn.append(el('option', { value: 'white', textContent: 'White' }), el('option', { value: 'black', textContent: 'Black' }));
  turn.addEventListener('change', () => handlers.turn(turn.value as Color));

  const castling = el('input', { id: 'editor-castling', type: 'checkbox' });
  castling.addEventListener('change', () => handlers.castling(castling.checked));
  const castlingText = el('span', { textContent: 'Castling' });
  const castlingLabel = el('label', { className: 'check' });
  castlingLabel.append(castling, castlingText);

  const rights = el('fieldset', { className: 'editor-rights' });
  let rightsFor = '';

  const pockets = el('fieldset', { className: 'editor-pockets' });
  let pocketsFor = '';

  const clocks = el('fieldset', { className: 'editor-clocks' });
  clocks.append(el('legend', { textContent: 'Clock times' }));
  const clockInputs = {} as Record<Color, HTMLInputElement>;
  for (const color of ['white', 'black'] as const) {
    const input = el('input', { id: `editor-clock-${color}`, type: 'text', placeholder: 'm:ss', autocomplete: 'off' });
    input.addEventListener('input', () => handlers.clock(color, input.value));
    clockInputs[color] = input;
    clocks.append(field(color === 'white' ? 'White' : 'Black', input));
  }

  const clear = el('button', { type: 'button', className: 'secondary', textContent: 'Clear board' });
  clear.addEventListener('click', () => handlers.clear());
  const reset = el('button', { type: 'button', className: 'secondary', textContent: 'Start position' });
  reset.addEventListener('click', () => handlers.reset());
  const boardButtons = el('div', { className: 'editor-board-buttons' });
  boardButtons.append(clear, reset);

  const name = el('input', { id: 'editor-name', type: 'text', maxLength: String(MAX_NAME), placeholder: 'Untitled setup' } as Record<string, string>);

  const status = el('p', { className: 'editor-status' });
  status.dataset.testid = 'editor-status';
  const problems = el('ul', { className: 'editor-problems' });
  problems.dataset.testid = 'editor-problems';
  problems.setAttribute('aria-live', 'polite');
  const notice = el('p', { className: 'editor-notice' });
  notice.dataset.testid = 'editor-notice';
  notice.setAttribute('role', 'status');

  const button = (testid: string, text: string, onClick: () => void, secondary = false) => {
    const b = el('button', { type: 'button', textContent: text, className: secondary ? 'secondary' : '' });
    b.dataset.testid = testid;
    b.addEventListener('click', onClick);
    return b;
  };
  const close = button('editor-close', 'Close', () => handlers.close(), true);
  const save = button('editor-save', 'Save', () => handlers.save(), true);
  const play = button('editor-play', 'Play', () => handlers.play());
  const resume = button('editor-resume', 'Resume', () => handlers.resume());
  const actions = el('div', { className: 'actions' });
  actions.append(close, save, play, resume);

  const heading = el('h2', { textContent: 'Board editor' });
  const nameField = field('Name', name);
  host.append(
    heading,
    field('Base variant', base),
    size,
    field('Side to move', turn),
    castlingLabel,
    rights,
    pockets,
    clocks,
    boardButtons,
    nameField,
    status,
    problems,
    notice,
    actions,
  );

  /** One box per right of the base, rebuilt when the base changes; shown only while castling is on. */
  function renderRights(m: EditorModel): void {
    const list = m.rights();
    rights.hidden = !m.castling || castling.disabled || list.length === 0;
    if (rightsFor !== m.base.id) {
      rights.replaceChildren(el('legend', { textContent: m.base.id === 'seirawan' ? 'Castling and gating rights' : 'Castling rights' }));
      for (const { right } of list) {
        const input = el('input', { id: rightId(right), type: 'checkbox' });
        input.addEventListener('change', () => handlers.right(right, input.checked));
        const label = el('label', { className: 'check' });
        label.append(input, el('span', { textContent: rightLabel(m.base.id, right) }));
        rights.append(label);
      }
      rightsFor = m.base.id;
    }
    for (const { right, on, possible } of list) {
      const input = rights.querySelector<HTMLInputElement>(`#${rightId(right)}`);
      if (!input) continue;
      input.checked = on;
      input.disabled = !possible;
      // Disabled boxes say why, so a right that can't be ticked isn't a mystery.
      input.title = possible ? '' : 'Needs the king and that rook (or gating piece) on their start squares.';
    }
  }

  function renderPockets(m: EditorModel): void {
    pockets.hidden = !m.base.pockets;
    const key = `${m.base.id}:${m.base.pocketLetters.join('')}`;
    if (pocketsFor !== key) {
      pockets.replaceChildren(el('legend', { textContent: 'Pieces in hand' }));
      for (const color of ['white', 'black'] as const) {
        for (const letter of m.base.pocketLetters) {
          const input = el('input', { id: `editor-pocket-${color}-${letter}`, type: 'number', min: '0', max: '9' });
          input.addEventListener('change', () => handlers.pocket(color, letter, Math.min(9, Math.max(0, Number(input.value) || 0))));
          const type = m.typeOf(letter) ?? letter;
          pockets.append(field(`${color === 'white' ? 'White' : 'Black'} ${type === 'inherited' ? letter.toUpperCase() : type}`, input));
        }
      }
      pocketsFor = key;
    }
    for (const color of ['white', 'black'] as const) {
      for (const letter of m.base.pocketLetters) {
        const input = pockets.querySelector<HTMLInputElement>(`#editor-pocket-${color}-${letter}`);
        if (input && document.activeElement !== input) input.value = String(m.pocketCount(color, letter));
      }
    }
  }

  return {
    render(m, s) {
      base.value = m.base.id;
      files.value = String(m.files);
      ranks.value = String(m.ranks);
      turn.value = m.turn;
      castling.checked = m.castling;
      // Seirawan keeps its gating rights in the same FEN field, so turning castling off ends gating too.
      castlingText.textContent = m.base.id === 'seirawan' ? 'Castling and gating' : 'Castling';
      // Rights only exist on the base's own board size; elsewhere the box would do nothing.
      castling.disabled = m.files !== m.base.files || m.ranks !== m.base.ranks;
      castling.title = castling.disabled ? 'Castling needs the base variant’s board size.' : '';
      renderRights(m);
      renderPockets(m);
      clocks.hidden = s.clocks === null;
      for (const color of ['white', 'black'] as const) {
        // The player's own text stays as typed while they type it.
        if (s.clocks && document.activeElement !== clockInputs[color]) clockInputs[color].value = s.clocks[color];
      }
      status.textContent = s.checking ? CHECKING : s.problems.length ? '' : READY;
      problems.replaceChildren(...s.problems.map((p) => el('li', { textContent: p })));
      notice.textContent = s.notice;
      const blocked = s.checking || s.problems.length > 0;
      play.disabled = blocked;
      save.disabled = blocked;
      resume.disabled = blocked;
      // An edited game keeps its own variant as the base: another base would be another game.
      base.disabled = s.resuming;
      heading.textContent = s.resuming ? 'Edit current game' : 'Board editor';
      close.textContent = s.resuming ? 'Cancel' : 'Close';
      play.hidden = s.resuming;
      save.hidden = s.resuming;
      nameField.hidden = s.resuming;
      resume.hidden = !s.resuming;
    },
    name: () => name.value.trim(),
    setName(n) {
      name.value = n;
    },
  };
}
