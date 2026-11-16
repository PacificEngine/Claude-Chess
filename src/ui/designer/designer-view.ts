// The piece designer's screen: the preview board, name and letter, the move components, the built-in pieces to
// combine with, the advanced Betza box, the art picker, the problems list, Save / Delete / Close, and the
// choice between updating a used piece everywhere and saving it as a new one. It draws
// what designer.ts tells it and reports what the player changed; it holds no design state. All text, the
// player's own included, goes through textContent.
import { Chessground } from 'chessgroundx';
import type { Api } from 'chessgroundx/api';
import type * as cg from 'chessgroundx/types';
import { LEAPS, type Leap, type Mode, type MoveComponent, TOO_MANY_PARTS } from '../../variants/betza';
import { ART_CHOICES } from '../art-catalog';
import { artUrl, parsePieceClass, tokenClass } from '../pieces';
import { canCannon, canSlide, COMBINABLE, type DesignerModel } from './designer-model';
import { PREVIEW_FEN, type Reach } from './designer-preview';

export interface DesignerViewHandlers {
  name(text: string): void;
  letter(letter: string): void;
  addMove(): void;
  removeMove(i: number): void;
  updateMove(i: number, patch: Partial<MoveComponent>): void;
  combine(type: string, on: boolean): void;
  /** Betza typed in the advanced box, or null to go back to the components. */
  advanced(betza: string | null): void;
  art(id: string | null): void;
  save(): void;
  /** The answer to "Update everywhere" or "Save as new piece"; null cancels the save. */
  change(choice: 'everywhere' | 'new' | null): void;
  delete(): void;
  close(): void;
}

export interface DesignerViewState {
  model: DesignerModel;
  /** The Betza the components (or the advanced box) make, or '' when they make none. */
  betza: string;
  problems: string[];
  /** What the preview says: "Checking…", or where the piece goes; '' when the problems say it all. */
  status: string;
  /** The squares to highlight; null while there are none to show. */
  reach: Reach | null;
  /** The preview can't run (no engine): the board is dimmed. */
  disabled: boolean;
  canSave: boolean;
  notice: string;
  /** Saving an edit that saved setups or the game use: ask how to save it. */
  choosing: boolean;
}

export interface DesignerView {
  /** Fills the inputs from a model being opened: they are not rewritten while the player types. */
  load(model: DesignerModel): void;
  render(state: DesignerViewState): void;
}

const MODES: { mode: Mode; label: string }[] = [
  { mode: 'both', label: 'Move and capture' },
  { mode: 'move', label: 'Move only' },
  { mode: 'capture', label: 'Capture only' },
  { mode: 'cannon', label: 'Cannon: capture over a screen' },
];
const NO_SLIDE = "The engine can't slide this leap.";
const NO_CANNON = 'A cannon needs a slide one square orthogonally or diagonally.';
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props);
}

function field(label: string, control: HTMLElement): HTMLLabelElement {
  const l = el('label', { className: 'field' });
  l.append(el('span', { textContent: label }), control);
  return l;
}

const squareName = (file: number, rank: number) => `${String.fromCharCode(97 + file)}${rank}`;

export function createDesignerView(host: HTMLElement, handlers: DesignerViewHandlers): DesignerView {
  // ---- Preview board -----------------------------------------------------------------------------
  const boardHost = el('div', { className: 'board-host designer-board' });
  boardHost.dataset.testid = 'designer-preview';
  boardHost.dataset.files = '8';
  boardHost.dataset.ranks = '8';
  const wrap = el('div', { className: 'board-wrap' });
  const layer = el('div', { className: 'reach-layer' });
  layer.setAttribute('aria-hidden', 'true');
  const cells = new Map<string, HTMLDivElement>();
  for (let rank = 8; rank >= 1; rank--) {
    for (let file = 0; file < 8; file++) {
      const cell = el('div', { className: 'reach-square' });
      cell.dataset.square = squareName(file, rank);
      cells.set(cell.dataset.square, cell);
      layer.append(cell);
    }
  }
  boardHost.append(wrap);
  let api: Api | null = null;
  const status = el('p', { className: 'designer-status' });
  status.dataset.testid = 'designer-status';
  status.setAttribute('role', 'status');
  const legend = el('p', { className: 'designer-legend' });
  legend.append(
    el('span', { className: 'swatch move' }),
    el('span', { textContent: 'Moves (and captures)' }),
    el('span', { className: 'swatch capture' }),
    el('span', { textContent: 'Captures only' }),
  );
  const previewColumn = el('div', { className: 'designer-preview-column' });
  previewColumn.append(boardHost, status, legend);

  // ---- Controls ----------------------------------------------------------------------------------
  const side = el('div', { className: 'designer-controls' });
  const heading = el('h2', { textContent: 'Piece designer' });

  const name = el('input', { id: 'designer-name', type: 'text', placeholder: 'My piece', autocomplete: 'off' });
  name.addEventListener('input', () => handlers.name(name.value));
  const letter = el('select', { id: 'designer-letter' });
  for (const l of LETTERS) letter.append(el('option', { value: l, textContent: l.toUpperCase() }));
  letter.addEventListener('change', () => handlers.letter(letter.value));
  const identity = el('div', { className: 'designer-identity' });
  identity.append(field('Name', name), field('Letter', letter));

  const moves = el('fieldset', { className: 'designer-moves' });
  moves.append(el('legend', { textContent: 'Moves' }));
  const overrideNote = el('p', { className: 'designer-note', textContent: 'The Betza typed below is used instead of these moves.' });
  const rows = el('div', { className: 'designer-rows' });
  const addMove = el('button', { type: 'button', className: 'secondary small', textContent: 'Add move' });
  addMove.dataset.testid = 'designer-add-move';
  addMove.addEventListener('click', () => handlers.addMove());
  moves.append(overrideNote, rows, addMove);

  const combine = el('fieldset', { className: 'designer-combine' });
  combine.append(el('legend', { textContent: 'Also moves like' }));
  const combineBoxes = new Map<string, HTMLInputElement>();
  for (const p of COMBINABLE) {
    const box = el('input', { id: `designer-combine-${p.type}`, type: 'checkbox' });
    box.addEventListener('change', () => handlers.combine(p.type, box.checked));
    combineBoxes.set(p.type, box);
    const label = el('label', { className: 'check' });
    label.append(box, el('span', { textContent: p.name }));
    combine.append(label);
  }

  const betza = el('input', { id: 'designer-betza', type: 'text', autocomplete: 'off', spellcheck: 'false' } as Record<string, string>);
  betza.addEventListener('input', () => handlers.advanced(betza.value));
  const useMoves = el('button', { type: 'button', className: 'secondary small', textContent: 'Use the moves above' });
  useMoves.dataset.testid = 'designer-use-moves';
  useMoves.addEventListener('click', () => handlers.advanced(null));
  const advanced = el('div', { className: 'designer-advanced' });
  advanced.append(field('Betza (advanced)', betza), useMoves);

  const art = el('div', { className: 'designer-art' });
  art.dataset.testid = 'designer-art';
  art.setAttribute('role', 'group');
  art.setAttribute('aria-label', 'Art');
  const artButtons = new Map<string | null, HTMLButtonElement>();
  const artButton = (id: string | null, label: string, url: string | null) => {
    const b = el('button', { type: 'button', className: 'art-choice', title: label });
    b.dataset.testid = id === null ? 'art-token' : `art-${id}`;
    b.setAttribute('aria-label', label);
    const icon = el('span', { className: 'palette-icon' });
    if (url) icon.style.backgroundImage = `url("${import.meta.env.BASE_URL}${url}")`;
    else {
      icon.classList.add('token', 'white');
      icon.dataset.letter = '?';
    }
    b.append(icon);
    b.addEventListener('click', () => handlers.art(id));
    artButtons.set(id, b);
    art.append(b);
  };
  artButton(null, 'Lettered token', null);
  for (const choice of ART_CHOICES) artButton(choice.id, choice.label, choice.white);
  const artField = el('fieldset', { className: 'designer-art-field' });
  artField.append(el('legend', { textContent: 'Art' }), art);

  const problems = el('ul', { className: 'editor-problems' });
  problems.dataset.testid = 'designer-problems';
  problems.setAttribute('aria-live', 'polite');
  const notice = el('p', { className: 'editor-notice' });
  notice.dataset.testid = 'designer-notice';
  notice.setAttribute('role', 'status');

  const button = (testid: string, text: string, onClick: () => void, className = '') => {
    const b = el('button', { type: 'button', textContent: text, className });
    b.dataset.testid = testid;
    b.addEventListener('click', onClick);
    return b;
  };
  const confirm = el('div', { className: 'delete-confirm' });
  confirm.dataset.testid = 'designer-delete-confirm';
  confirm.hidden = true;
  const yes = button('designer-delete-yes', 'Yes', () => handlers.delete(), 'small');
  const no = button('designer-delete-no', 'No', () => {
    confirm.hidden = true;
    del.hidden = false;
  }, 'secondary small');
  confirm.append(el('span', { textContent: 'Delete?' }), yes, no);
  const change = el('div', { className: 'change-choice' });
  change.dataset.testid = 'designer-change-choice';
  change.setAttribute('role', 'group');
  change.setAttribute('aria-label', 'How to save the changed piece');
  change.hidden = true;
  const changeButtons = el('div', { className: 'actions' });
  const changeCancel = button('designer-change-cancel', 'Cancel', () => handlers.change(null), 'secondary small');
  changeButtons.append(
    changeCancel,
    button('designer-save-as-new', 'Save as new piece', () => handlers.change('new'), 'secondary small'),
    button('designer-update-everywhere', 'Update everywhere', () => handlers.change('everywhere'), 'small'),
  );
  change.append(
    el('p', {
      textContent:
        'Saved setups or the game in progress use this piece. Update them to play it the new way, or save it as a new piece and leave them as they are.',
    }),
    changeButtons,
  );
  const close = button('designer-close', 'Close', () => handlers.close(), 'secondary');
  const del = button('designer-delete', 'Delete', () => {
    confirm.hidden = false;
    del.hidden = true;
  }, 'secondary');
  const save = button('designer-save', 'Save', () => handlers.save());
  const actions = el('div', { className: 'actions' });
  actions.append(close, del, save);

  side.append(heading, identity, moves, combine, advanced, artField, problems, notice, confirm, change, actions);
  host.append(previewColumn, side);

  // ---- Move rows ---------------------------------------------------------------------------------
  interface Row {
    root: HTMLDivElement;
    atom: HTMLSelectElement;
    slide: HTMLInputElement;
    range: HTMLSelectElement;
    mode: HTMLSelectElement;
  }
  const rowEls: Row[] = [];

  function buildRow(i: number): Row {
    const root = el('div', { className: 'designer-move' });
    root.dataset.testid = 'designer-move';
    const atom = el('select', { className: 'designer-atom' });
    for (const l of LEAPS) atom.append(el('option', { value: l.atom, textContent: l.label }));
    atom.setAttribute('aria-label', `Move ${i + 1}: direction`);
    atom.addEventListener('change', () => handlers.updateMove(i, { atom: atom.value as Leap }));
    const slide = el('input', { className: 'designer-slide', type: 'checkbox' });
    slide.addEventListener('change', () => handlers.updateMove(i, { slide: slide.checked }));
    const slideLabel = el('label', { className: 'check' });
    slideLabel.append(slide, el('span', { textContent: 'Slide' }));
    const range = el('select', { className: 'designer-range' });
    range.append(el('option', { value: '', textContent: 'Any distance' }));
    for (let n = 1; n <= 9; n++) range.append(el('option', { value: String(n), textContent: `Up to ${n}` }));
    range.setAttribute('aria-label', `Move ${i + 1}: range`);
    range.addEventListener('change', () => handlers.updateMove(i, { range: range.value === '' ? null : Number(range.value) }));
    const mode = el('select', { className: 'designer-mode' });
    for (const m of MODES) mode.append(el('option', { value: m.mode, textContent: m.label }));
    mode.setAttribute('aria-label', `Move ${i + 1}: mode`);
    mode.addEventListener('change', () => handlers.updateMove(i, { mode: mode.value as Mode }));
    const remove = el('button', { type: 'button', className: 'secondary small', textContent: 'Remove' });
    remove.setAttribute('aria-label', `Remove move ${i + 1}`);
    remove.addEventListener('click', () => handlers.removeMove(i));
    root.append(atom, slideLabel, range, mode, remove);
    return { root, atom, slide, range, mode };
  }

  function renderRows(components: MoveComponent[], full: boolean): void {
    while (rowEls.length > components.length) rowEls.pop()!.root.remove();
    while (rowEls.length < components.length) {
      const row = buildRow(rowEls.length);
      rowEls.push(row);
      rows.append(row.root);
    }
    components.forEach((c, i) => {
      const row = rowEls[i]!;
      row.atom.value = c.atom;
      row.slide.checked = c.slide;
      row.slide.disabled = !canSlide(c.atom);
      row.slide.title = canSlide(c.atom) ? '' : NO_SLIDE;
      row.range.value = c.range === null ? '' : String(c.range);
      row.range.disabled = !c.slide;
      row.mode.value = c.mode;
      const cannon = row.mode.querySelector<HTMLOptionElement>('option[value=cannon]')!;
      cannon.disabled = !canCannon(c);
      cannon.title = canCannon(c) ? '' : NO_CANNON;
    });
    addMove.disabled = full;
    addMove.title = full ? TOO_MANY_PARTS : '';
  }

  function renderBoard(state: DesignerViewState): void {
    if (!api) {
      api = Chessground(wrap, {
        fen: PREVIEW_FEN.split(' ')[0] as cg.FEN,
        dimensions: { width: 8, height: 8 },
        orientation: 'white',
        coordinates: true,
        viewOnly: true,
        highlight: { lastMove: false, check: false },
        animation: { enabled: false },
        drawable: { enabled: false },
      });
      wrap.append(layer);
    }
    // The position never changes, so chessground keeps its piece elements: each is given its art here. The
    // designed piece ('z' on the preview) wears the art the player picked, or a token with their letter.
    for (const el of wrap.querySelectorAll<HTMLElement>('piece')) {
      const parsed = parsePieceClass(el.className);
      if (!parsed) continue;
      const designed = parsed.letter === 'z';
      const url = artUrl(parsed.letter, parsed.color, 'chess', undefined, designed ? state.model.art : undefined);
      el.style.backgroundImage = url ? `url("${import.meta.env.BASE_URL}${url}")` : '';
      el.classList.toggle('token', !url);
      el.classList.toggle(tokenClass(parsed.letter).split(' ')[1]!, !url);
      if (url) el.removeAttribute('data-letter');
      else el.dataset.letter = (designed ? state.model.letter : parsed.letter).toUpperCase();
    }
    const moveSet = new Set(state.reach?.moves ?? []);
    const captureSet = new Set(state.reach?.captures ?? []);
    for (const [square, cell] of cells) {
      cell.classList.toggle('move', moveSet.has(square));
      cell.classList.toggle('capture', captureSet.has(square));
    }
    boardHost.dataset.moves = [...moveSet].join(' ');
    boardHost.dataset.captures = [...captureSet].join(' ');
    boardHost.dataset.disabled = String(state.disabled);
  }

  return {
    load(model) {
      name.value = model.name;
      letter.value = model.letter;
      betza.value = model.advanced ?? '';
      confirm.hidden = true;
    },
    render(state) {
      const m = state.model;
      renderBoard(state);
      status.textContent = state.status;
      const full = m.atCap();
      renderRows(m.components, full);
      moves.classList.toggle('overridden', m.advanced !== null);
      overrideNote.hidden = m.advanced === null;
      for (const [type, box] of combineBoxes) {
        box.checked = m.combineWith.includes(type);
        // At the cap only unticking is left.
        box.disabled = full && !box.checked;
        box.parentElement!.title = box.disabled ? TOO_MANY_PARTS : '';
      }
      // Never rewrite the box while the player is typing in it.
      if (document.activeElement !== betza) betza.value = m.advanced ?? state.betza;
      useMoves.disabled = m.advanced === null;
      for (const [id, b] of artButtons) b.setAttribute('aria-pressed', String(id === m.art));
      problems.replaceChildren(...state.problems.map((p) => el('li', { textContent: p })));
      notice.textContent = state.notice;
      del.hidden = m.id === null || !confirm.hidden;
      if (m.id === null) confirm.hidden = true;
      // Save, which had the focus, is disabled while the choice is open: the focus moves to the choice.
      const asking = state.choosing && change.hidden;
      change.hidden = !state.choosing;
      if (asking) changeCancel.focus();
      save.disabled = !state.canSave || state.choosing;
    },
  };
}
