// The editor screen: wires the model to the board and palette, the controls and the setup checker. Problems are
// worked out on every change; a setup that needs a custom variant is checked by the engine after a short pause,
// so dragging pieces about doesn't send the engine a definition per square.
import type { Color } from '../../rules/types';
import type { ActiveVariant } from '../../variants/active';
import type { VariantId } from '../../variants/catalog';
import type { SetupSpec } from '../../variants/setup';
import { clockProblem, formatClockInput, parseClockInput } from './clock-time';
import { guardChecker, type SetupChecker, type SetupVerdict } from './editor-check';
import { createEditorControls } from './editor-controls';
import { type BaseLookup, EditorModel } from './editor-model';
import { createEditorView } from './editor-view';

export const CHECK_DELAY_MS = 300;

/** A verdict that says how to start: what Resume hands back. */
export type StartVerdict = Extract<SetupVerdict, { ok: true }>;

export interface EditorHandlers {
  play(): void;
  /** Resume an edited game from the checked setup, with the clock times entered (null for an untimed game). */
  resume(verdict: StartVerdict, clocks: ClockTimes | null): void;
  /** Saves the setup; `id` is the saved setup this editor session saved before, or null. Returns the saved id, or null on failure. */
  save(spec: SetupSpec, name: string, id: string | null): string | null;
  close(): void;
}

/** Both sides' clock times, in ms. */
export type ClockTimes = Record<Color, number>;

export interface Editor {
  /** Shows the editor, on the setup it had when last closed (the chess start position the first time). */
  open(): void;
  /**
   * Shows the editor on the game in progress (`fen` in `active`), with Resume and Cancel, and for a timed game
   * its paused `clocks` to edit. The setup being built for Play is kept aside and comes back on the next open().
   */
  openGame(active: ActiveVariant, fen: string, clocks: ClockTimes | null): void;
  hide(): void;
  isOpen(): boolean;
  /** The setup being edited and its name, for the Play dialog. */
  spec(): SetupSpec;
  name(): string;
}

const COLORS = ['white', 'black'] as const;

const removedNotice = (n: number) =>
  n === 1 ? 'Removed 1 piece that no longer fits on the board.' : `Removed ${n} pieces that no longer fit on the board.`;

export function createEditor(host: HTMLElement, bases: BaseLookup, unguarded: SetupChecker, handlers: EditorHandlers): Editor {
  // A check that throws or rejects shows as a problem, rather than leaving the editor on "Checking setup…".
  const checker = guardChecker(unguarded);
  const section = document.createElement('section');
  section.className = 'editor layout';
  section.dataset.testid = 'editor';
  section.hidden = true;
  const boardHost = document.createElement('div');
  const side = document.createElement('div');
  side.className = 'editor-side';
  const controlsHost = document.createElement('div');
  controlsHost.className = 'editor-controls';
  const palette = document.createElement('div');
  palette.className = 'palette';
  side.append(palette, controlsHost);
  section.append(boardHost, side);
  host.append(section);

  let model: EditorModel | null = null;
  /** The game in progress while it is being edited; null when the editor builds a setup. */
  let gameModel: EditorModel | null = null;
  /** Editing a timed game: the clock times as typed, and as first shown with the exact paused times behind them. */
  let clocks: { typed: Record<Color, string>; shown: Record<Color, string>; paused: ClockTimes } | null = null;
  let savedId: string | null = null;
  let notice = '';
  /** A refusal from the last action (too many piece types), shown with the problems until the next change. */
  let refusal: string | null = null;
  let verdict: SetupVerdict | null = null;
  let checking = false;
  let token = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const view = createEditorView(boardHost, palette, {
    changed(message) {
      if (message) {
        refusal = message;
        draw();
      } else changed();
    },
  });

  const current = (): EditorModel => gameModel ?? (model ??= EditorModel.fromBase('chess', bases));

  function draw(): void {
    const m = current();
    view.render(m);
    const problems = [...(refusal ? [refusal] : []), ...(verdict && !verdict.ok ? verdict.problems : []), ...clockProblems()];
    controls.render(m, { problems, checking, notice, resuming: gameModel !== null, clocks: gameModel && clocks ? clocks.typed : null });
  }

  function clockProblems(): string[] {
    if (!gameModel || !clocks) return [];
    return COLORS.flatMap((c) => clockProblem(c, clocks!.typed[c]) ?? []);
  }

  /** The times to resume with: a time left as shown keeps the exact paused time, part of a second included. */
  function clockTimes(): ClockTimes | null {
    if (!clocks) return null;
    const c = clocks;
    const ms = (color: Color) => (c.typed[color] === c.shown[color] ? c.paused[color] : parseClockInput(c.typed[color])!);
    return { white: ms('white'), black: ms('black') };
  }

  /** Every edit ends here: new problems, and the notice from the edit before is gone. */
  function changed(nextNotice = ''): void {
    notice = nextNotice;
    refusal = null;
    recheck();
  }

  function recheck(): void {
    const t = ++token;
    clearTimeout(timer);
    const spec = current().toSpec();
    const quick = checker.quick(spec);
    verdict = quick;
    checking = quick === null;
    draw();
    if (quick) return;
    timer = setTimeout(() => {
      void checker.check(spec).then((v) => {
        if (t !== token) return; // an edit since made this stale
        verdict = v;
        checking = false;
        draw();
      });
    }, CHECK_DELAY_MS);
  }

  const controls = createEditorControls(controlsHost, {
    base(id: VariantId) {
      current().setBase(id);
      changed();
    },
    resize(files, ranks) {
      const { removed } = current().resize(files, ranks);
      changed(removed ? removedNotice(removed) : '');
    },
    turn(c: Color) {
      current().setTurn(c);
      changed();
    },
    castling(on) {
      current().setCastling(on);
      changed();
    },
    right(right, on) {
      current().setRight(right, on);
      changed();
    },
    pocket(color, letter, count) {
      current().setPocket(color, letter, count);
      changed();
    },
    clock(color, text) {
      if (!clocks) return;
      clocks.typed[color] = text;
      draw(); // the board's own check is unaffected
    },
    clear() {
      current().clear();
      changed();
    },
    reset() {
      current().setBase(current().base.id);
      changed();
    },
    play: () => handlers.play(),
    resume() {
      // The button is disabled otherwise; the verdict is for the model as it is now (stale ones are dropped).
      if (!gameModel || checking || refusal || !verdict?.ok || clockProblems().length) return;
      handlers.resume(verdict, clockTimes());
    },
    save() {
      const name = controls.name() || 'Untitled setup';
      const id = handlers.save(current().toSpec(), name, savedId);
      if (id === null) {
        notice = "The setup couldn't be saved: the browser refused to store it.";
      } else {
        savedId = id;
        notice = `Saved “${name}”.`;
      }
      draw();
    },
    close: () => handlers.close(),
  });

  function show(): void {
    notice = '';
    refusal = null;
    section.hidden = false;
    // Drawn once visible, so the board measures its real size.
    recheck();
  }

  return {
    open() {
      gameModel = null;
      clocks = null;
      show();
    },
    openGame(active, fen, paused) {
      gameModel = EditorModel.fromGame(active, fen, bases);
      if (paused) {
        const shown = { white: formatClockInput(paused.white), black: formatClockInput(paused.black) };
        clocks = { typed: { ...shown }, shown, paused: { ...paused } };
      } else clocks = null;
      show();
    },
    hide() {
      section.hidden = true;
      view.disarm();
    },
    isOpen: () => !section.hidden,
    spec: () => current().toSpec(),
    name: () => controls.name() || 'Untitled setup',
  };
}
