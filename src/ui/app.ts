// The app: owns the GameSession, the Engine and the Store, and wires the views to them.
// Views never touch the session directly; every change goes through changed() so it is saved and redrawn.
import { createEngine, type EngineTestHooks } from '../engine/engine';
import { levelById } from '../engine/levels';
import { loadSetups } from '../persistence/setups';
import { createStore, DEFAULT_SETTINGS, isSettings, SETTINGS_VERSION, type Settings } from '../persistence/store';
import { loadRules, type Rules } from '../rules/rules';
import type { Color, GameResult } from '../rules/types';
import { remaining } from '../session/clock';
import { checkWithoutEngine, type PendingRestore, type Restored, restoreInBackground } from '../session/restore';
import { GameSession, isSessionState, type Opponent, type SessionState } from '../session/session';
import { type ActiveVariant, curatedActive, customActive, variantTypes } from '../variants/active';
import { CURATED_VARIANTS, type VariantInfo, variantById } from '../variants/catalog';
import type { SetupSpec } from '../variants/setup';
import { createBoardView, parseUci } from './board-view';
import { createChoiceDialog } from './choice-dialog';
import { type ClockTimes, createEditor, type StartVerdict } from './editor/editor';
import { createSetupChecker, guardChecker, type SetupVerdict } from './editor/editor-check';
import { editorBases } from './editor/editor-model';
import { createPanel } from './panel';
import { createPlayDialog, EDITOR_SETUP_ID, type PlayChoice } from './play-dialog';
import { createSettingsDialog } from './settings-dialog';
import { createSetupsController } from './setups-controller';
import { createSourceLink } from './source-link';
import { createTopBar } from './top-bar';

/** What `--mode test` builds expose on window for e2e. */
export interface ChessTestHooks {
  loadFen(variant: string, fen: string): void;
  engine: EngineTestHooks;
}

declare global {
  interface Window {
    __chessTest?: ChessTestHooks;
  }
}

const GAME_VERSION = 1;

const MSG_NO_STORAGE = "This browser is blocking storage, so progress won't be saved.";
const MSG_SAVE_FAILED = "Progress won't be saved: the browser refused to store it (storage may be full).";
const MSG_CORRUPT_GAME =
  "Your saved game couldn't be read, so a new game was started. The damaged data was kept under chess.game.corrupt.";
const MSG_CUSTOM_NEEDS_ENGINE =
  'This saved custom game needs the AI engine to load, so a new game was started. The saved game is kept until you play a move or start a new game.';
const MSG_RESTORING = 'Restoring your saved custom game…';
const MSG_CORRUPT_SETTINGS = "Your saved settings couldn't be read, so the defaults are in use.";
const MSG_CORRUPT_SETUPS =
  "Your saved setups couldn't be read, so the list starts empty. The damaged data was kept under chess.setups.corrupt.";

const other = (c: Color): Color => (c === 'white' ? 'black' : 'white');
const capital = (c: Color) => (c === 'white' ? 'White' : 'Black');

const REASONS: Record<GameResult['reason'], string> = {
  checkmate: 'by checkmate',
  stalemate: 'by stalemate',
  repetition: 'by threefold repetition',
  'fifty-move': 'by the fifty-move rule',
  insufficient: 'by insufficient material',
  variant: "by the variant's rules",
  timeout: 'on time',
  'timeout-insufficient': 'on time, but the opponent cannot mate',
};

function resultText(r: GameResult): string {
  return r.winner ? `${capital(r.winner)} wins ${REASONS[r.reason]}` : `Draw ${REASONS[r.reason]}`;
}

function variantOf(engineName: string): VariantInfo {
  const v = CURATED_VARIANTS.find((c) => c.engineName === engineName || c.id === engineName);
  if (!v) throw new Error(`Unknown variant: ${engineName}`);
  return v;
}

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export async function startApp(root: HTMLElement): Promise<void> {
  root.replaceChildren();
  root.classList.add('app');
  // Start the engine first: it loads in the background. The board never waits for it; a saved custom game,
  // which needs it, is restored in the background once it is ready.
  const engine = createEngine();
  const store = createStore(browserStorage());

  const banner = document.createElement('div');
  banner.className = 'banner';
  banner.dataset.testid = 'storage-banner';
  banner.setAttribute('role', 'alert');
  banner.hidden = true;
  const problems = new Set<string>();
  const warn = (msg: string) => {
    problems.add(msg);
    banner.textContent = [...problems].join(' ');
    banner.hidden = false;
  };

  let rules: Rules;
  try {
    rules = await loadRules();
  } catch (e) {
    console.error('Rules failed to load:', e);
    const fatal = document.createElement('p');
    fatal.className = 'fatal';
    fatal.textContent = 'The chess rules library failed to load in this browser. Reload the page to retry.';
    root.append(fatal);
    return;
  }

  // ---- Persistence -------------------------------------------------------------------------------
  if (!store.available) warn(MSG_NO_STORAGE);
  const savedSettings = store.load('chess.settings', SETTINGS_VERSION, {}, isSettings);
  if (savedSettings.problem) warn(MSG_CORRUPT_SETTINGS);
  let settings: Settings = savedSettings.data ?? { ...DEFAULT_SETTINGS };
  const loadedSetups = loadSetups(store);
  if (loadedSetups.problem) warn(MSG_CORRUPT_SETUPS);
  const loaded = store.load('chess.game', GAME_VERSION, {}, isSessionState);
  if (loaded.problem) warn(MSG_CORRUPT_GAME);
  let saved: SessionState | null = null;
  /** A saved custom game still to be checked by the engine; restored in the background below. */
  let savedCustom: SessionState | null = null;
  /** Generated ini text by custom variant name, for the engine's setVariant. */
  const inis = new Map<string, string>();
  /** True while a saved custom game is pending or waits for an engine: the fresh game must not overwrite it. */
  let keepSavedGame = false;
  if (loaded.data) {
    const r = checkWithoutEngine(rules, loaded.data);
    if (r === null) {
      savedCustom = loaded.data;
      keepSavedGame = true;
    } else if (r.ok) {
      saved = loaded.data;
    } else {
      store.quarantine('chess.game');
      warn(MSG_CORRUPT_GAME);
    }
  }

  // ---- Layout ------------------------------------------------------------------------------------
  const main = document.createElement('main');
  main.className = 'layout';
  main.dataset.testid = 'game';
  const boardHost = document.createElement('div');
  main.append(boardHost);
  createTopBar(root, { play: () => openPlay(), editor: () => openEditor(), settings: () => openSettings() });
  root.append(banner, main);
  const bases = editorBases(rules);
  // Guarded: the Play dialog's setup check and Start must never wait on a check that throws.
  const checker = guardChecker(createSetupChecker(rules, engine, bases));
  const editor = createEditor(root, bases, checker, {
    play: () => openPlay({ kind: 'setup', id: EDITOR_SETUP_ID }),
    resume: (verdict, clocks) => resumeEditedGame(verdict, clocks),
    save: (spec, name, id) => setupsCtl.save(spec, name, id),
    close: () => closeEditor(),
  });
  createSourceLink(root);
  const board = createBoardView(boardHost);
  const panel = createPanel(main, {
    undo: () => undo(),
    edit: () => openEditorForCurrentGame(),
    settings: () => openSettings(),
    retry: () => retryAi(),
  });
  const playDialog = createPlayDialog(root);
  const settingsDialog = createSettingsDialog(root);
  const choiceDialog = createChoiceDialog(root);
  const setupsCtl = createSetupsController({
    store,
    initial: loadedSetups.setups,
    editor: () => editor,
    checker,
    playDialog,
    saveFailed: () => warn(MSG_SAVE_FAILED),
  });

  // ---- Game state --------------------------------------------------------------------------------
  let session: GameSession;
  if (saved) {
    session = GameSession.restore(rules, saved);
    // A closed tab never costs time: the clock stays paused until the next move (or the AI's search).
    session.pauseClock(Date.now());
  } else {
    session = GameSession.create(rules, { variant: 'chess', opponent: { kind: 'hotseat' }, clockConfig: null }, Date.now());
  }
  let st: SessionState = session.state();
  let active: ActiveVariant | null = null;
  /** The variant of the game on the board, rebuilt only when a new game changes it. */
  const activeVariant = (): ActiveVariant => {
    if (active?.engineName !== st.variant) {
      active = st.setup
        ? customActive(st.setup, st.variant, variantTypes(rules, variantById(st.setup.base).engineName))
        : curatedActive(variantOf(st.variant).id, rules);
    }
    return active;
  };

  /** Request id of the AI search in flight, or null. */
  let pending: number | null = null;
  let engineVariant: string | null = null;
  let engineReason: string | undefined;
  /** The last AI request failed with the engine still alive (no move, or a move the rules refuse): offer Retry. */
  let aiFailed = false;
  let pausedForDialog = false;
  let lastChoice: PlayChoice = {
    variant: { kind: 'curated', id: 'chess' },
    opponent: { kind: 'ai', level: 'expert' },
    color: 'white',
    clockConfig: null,
  };
  /** The Play dialog starts from a restored AI game's settings. */
  const rememberChoice = (): void => {
    if (st.opponent.kind !== 'ai') return;
    lastChoice = {
      variant: { kind: 'curated', id: activeVariant().artBase },
      opponent: { kind: 'ai', level: st.opponent.level },
      color: other(st.opponent.aiColor),
      clockConfig: st.clockConfig,
    };
  };
  if (saved) rememberChoice();
  /** The background restore of a saved custom game, while it runs; the board stays disabled meanwhile. */
  let restoring: PendingRestore | null = null;

  // SAN needs the position before each ply; it is computed once per (position, move) and cached.
  const sanCache = new Map<string, string>();
  const sanOf = (i: number): string => {
    const key = `${st.snapshots[i].fen}|${st.moves[i]}`;
    let san = sanCache.get(key);
    if (san === undefined) {
      const g = rules.newGame(st.variant, st.snapshots[i].fen);
      try {
        san = g.san(st.moves[i]);
      } finally {
        g.dispose();
      }
      sanCache.set(key, san);
    }
    return san;
  };

  const humanColor = (): Color => (st.opponent.kind === 'ai' ? other(st.opponent.aiColor) : 'white');

  function save(): void {
    if (keepSavedGame) return;
    if (!store.save('chess.game', GAME_VERSION, st) && store.available) warn(MSG_SAVE_FAILED);
  }

  function statusText(): string {
    if (restoring) return MSG_RESTORING;
    if (st.result) return resultText(st.result);
    const turn = session.turn();
    if (!session.isHumanTurn()) {
      if (engine.status() === 'unavailable') return `The AI can't move: the engine is unavailable${engineReason ? ` (${engineReason})` : ''}.`;
      if (aiFailed) return "The AI couldn't move.";
      return engine.status() === 'loading' ? 'AI is thinking… (engine loading)' : 'AI is thinking…';
    }
    const paused = st.clockConfig !== null && st.clock.running === null ? ' · clocks paused until the next move' : '';
    return `${capital(turn)} to move${paused}`;
  }

  function render(): void {
    const variant = activeVariant();
    const sans = st.moves.map((_, i) => sanOf(i));
    const last = st.moves.length ? parseUci(st.moves[st.moves.length - 1]) : null;
    const lastSan = sans[sans.length - 1] ?? '';
    board.show({
      variant,
      fen: session.fen(),
      turn: session.turn(),
      orientation: humanColor(),
      movable: !restoring && !st.result && session.isHumanTurn() ? session.turn() : null,
      legalFrom: (sq) => session.legalMovesFrom(sq),
      lastMove: last ? [last.from, last.to] : null,
      check: /[+#]/.test(lastSan),
      showDests: settings.highlightLegal,
    });
    const opponent = st.opponent.kind === 'ai' ? `AI: ${levelById(st.opponent.level).label}` : 'Hot-seat';
    // A saved custom game still restoring isn't on the board yet, so there is nothing to edit.
    const canEdit = !restoring;
    settingsDialog.setCanEditGame(canEdit);
    panel.render({
      variant,
      opponent,
      sans,
      clocksVisible: st.clockConfig !== null,
      canUndo: session.canUndo(),
      canEdit,
      status: statusText(),
      retry: aiFailed && !st.result && !session.isHumanTurn() && engine.status() !== 'unavailable',
      over: st.result !== null,
    });
    drawClocks(Date.now());
    root.dataset.theme = settings.boardTheme;
  }

  /** Every state change ends here: save, redraw, and let the AI move if it is its turn. */
  function changed(): void {
    st = session.state();
    save();
    render();
    // The AI waits while the editor covers the game; closing the editor calls changed() again.
    if (editor.isOpen()) return;
    if (st.opponent.kind === 'ai' && !st.result && !session.isHumanTurn() && pending === null && !aiFailed) void runAi();
  }

  async function runAi(): Promise<void> {
    const s = session;
    if (st.opponent.kind !== 'ai' || engine.status() === 'unavailable') return;
    const level = st.opponent.level;
    const id = s.beginEngineRequest();
    pending = id;
    st = s.state();
    save();
    render();
    const current = () => s === session && pending === id;
    try {
      const variant = activeVariant();
      if (engineVariant !== variant.engineName) {
        engineVariant = variant.engineName;
        await engine.setVariant(variant.engineName, inis.get(variant.engineName));
        if (!current()) return;
      }
      const snap = s.state();
      const timed = snap.clockConfig !== null;
      const uci = await engine.search({
        fen: snap.startFen,
        moves: snap.moves,
        level,
        clock: timed ? snap.clock : null,
        now: Date.now(),
        ...(timed && { clockConfig: snap.clockConfig }),
      });
      if (!current()) return; // undo or a new game made this search stale
      // Throws if the rules refuse the engine's move; the request stays current until the move is in.
      // false means stale or flagged; either way the session already knows what to do.
      s.acceptEngineMove(id, uci, Date.now());
      pending = null;
      changed();
    } catch (e) {
      console.error('AI move failed:', e);
      if (current()) {
        pending = null;
        engineVariant = null; // set the variant again on retry, in case the engine lost it
        aiFailed = engine.status() !== 'unavailable';
        render();
      }
    }
  }

  function retryAi(): void {
    if (!aiFailed) return;
    aiFailed = false;
    changed();
  }

  /** Stops a search in flight; its bestmove will be ignored because the session moves on. */
  function cancelAi(): void {
    aiFailed = false;
    if (pending === null) return;
    engine.stop();
    pending = null;
  }

  async function onBoardMove(from: string, to: string): Promise<void> {
    const s = session;
    if (restoring || st.result || !s.isHumanTurn()) return render();
    const candidates = s.legalMovesFrom(from).filter((u) => {
      const m = parseUci(u);
      return m !== null && m.to === to;
    });
    if (candidates.length === 0) return render();
    let uci = candidates[0];
    if (candidates.length > 1) {
      // Several legal moves share these squares (promotion or gating): the player must choose.
      const variant = activeVariant();
      const choices = candidates.map((u) => ({ uci: u, suffix: parseUci(u)!.suffix }));
      const gating = variant.artBase === 'seirawan';
      pauseForDialog();
      const picked = await choiceDialog.ask(variant.artBase, gating ? 'Bring in a piece from hand?' : 'Promote to', choices);
      if (s !== session) return render();
      if (picked === null) {
        resumeAfterDialog();
        return render(); // put the dragged piece back even when no clock was paused
      }
      // The move below restarts the clock itself (resumeClock), so only the dialog's pause is cleared here.
      pausedForDialog = false;
      uci = picked;
    }
    const now = Date.now();
    if (s.checkFlag(now)) return changed();
    // A restored game's clock is paused; it starts again with this move.
    s.resumeClock(now);
    supersedeSavedGame(); // the player has moved on from the saved custom game
    try {
      s.play(uci, now);
    } catch (e) {
      console.error('Move rejected:', e);
    }
    changed();
  }
  board.onMove((from, to) => void onBoardMove(from, to));

  function undo(): void {
    if (!session.canUndo()) return;
    cancelAi();
    session.undo(Date.now());
    changed();
  }

  /** A new game or a move replaces the saved custom game: drop a restore still running, and save again. */
  function supersedeSavedGame(): void {
    restoring?.cancel();
    restoring = null;
    keepSavedGame = false;
  }

  /** Swaps in the saved custom game once the engine has checked it, or says why it can't be. */
  function onRestored(saved: SessionState, r: Restored): void {
    restoring = null;
    if (r.ok) {
      if (r.ini !== undefined) inis.set(saved.variant, r.ini);
      const next = GameSession.restore(rules, saved);
      // Paused until the next move, as any restored game; on the AI's turn its clock runs while it thinks.
      next.pauseClock(Date.now());
      const aiTurn = saved.opponent.kind === 'ai' && !saved.result && !next.isHumanTurn();
      replaceSession(next, { resumeClock: aiTurn });
      st = session.state();
      rememberChoice();
      changed();
      return;
    }
    if (r.reason === 'engine') {
      warn(MSG_CUSTOM_NEEDS_ENGINE); // keepSavedGame stays on: the save may load once the engine works
    } else {
      store.quarantine('chess.game');
      keepSavedGame = false;
      warn(MSG_CORRUPT_GAME);
    }
    render();
  }

  /** `variant` is an engine name: curated (maybe from a `fen`), or a registered custom variant with its `setup`. */
  function startGame(
    game: { variant: string; fen?: string; setup?: SetupSpec },
    opponent: Opponent,
    clockConfig: SessionState['clockConfig'],
  ): void {
    replaceSession(GameSession.create(rules, { ...game, opponent, clockConfig }, Date.now()), { resumeClock: false });
    changed();
  }

  /**
   * Puts `next` in place of the game on the board: the old one's search is stopped and it is freed, and a saved
   * custom game still pending is superseded. `resumeClock` starts next's clock, or, while the editor or a dialog
   * covers the board, when that closes. A dialog's pause belonged to the old game, so it never resumes next.
   */
  function replaceSession(next: GameSession, { resumeClock }: { resumeClock: boolean }): void {
    cancelAi();
    session.dispose();
    session = next;
    supersedeSavedGame();
    pausedForDialog = false;
    if (resumeClock) resumeClockWhenUncovered();
  }

  // ---- Dialogs (clocks pause while one is open) ---------------------------------------------------
  /** The editor or a dialog covers the board: the game's clock waits for it to close. */
  const covered = (): boolean => editor.isOpen() || root.querySelector('dialog[open]') !== null;
  /** Starts the game's clock now, or as the editor or dialog covering the board closes. */
  function resumeClockWhenUncovered(): void {
    if (covered()) pausedForDialog = true;
    else session.resumeClock(Date.now());
  }
  function pauseForDialog(): void {
    if (st.result || st.clock.running === null) return;
    session.pauseClock(Date.now());
    pausedForDialog = true;
    changed();
  }
  function resumeAfterDialog(): void {
    // The editor keeps the game paused until it closes, even when a dialog opened over it closes first.
    if (!pausedForDialog || editor.isOpen()) return;
    pausedForDialog = false;
    session.resumeClock(Date.now());
    changed();
  }

  function openPlay(variant?: PlayChoice['variant']): void {
    pauseForDialog();
    playDialog.setSetups(setupsCtl.options());
    playDialog.open(variant ? { ...lastChoice, variant } : lastChoice);
  }
  playDialog.onClose(resumeAfterDialog);
  playDialog.onStart((choice) => void startChoice(choice));

  async function startChoice(choice: PlayChoice): Promise<void> {
    let game: { variant: string; fen?: string; setup?: SetupSpec };
    if (choice.variant.kind === 'curated') {
      game = { variant: variantById(choice.variant.id).engineName };
    } else {
      const spec = setupsCtl.spec(choice.variant.id);
      // Already checked by the dialog, so this only looks up the registered variant.
      const verdict: SetupVerdict | null = spec ? await checker.check(spec) : null;
      if (!verdict?.ok) {
        // The dialog checked it a moment ago; say why it no longer starts rather than doing nothing.
        warn(`This setup can't be played: ${verdict ? verdict.problems.join(' ') : 'it is no longer available.'}`);
        return;
      }
      if (verdict.setup) {
        inis.set(verdict.variant, verdict.ini);
        game = { variant: verdict.variant, setup: verdict.setup };
      } else {
        game = { variant: verdict.variant, fen: verdict.fen };
      }
    }
    lastChoice = choice;
    let opponent: Opponent = { kind: 'hotseat' };
    if (choice.opponent.kind === 'ai') {
      const human: Color = choice.color === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : choice.color;
      opponent = { kind: 'ai', level: choice.opponent.level, aiColor: other(human) };
    }
    startGame(game, opponent, choice.clockConfig);
    if (editor.isOpen()) closeEditor();
  }

  // ---- The editor ------------------------------------------------------------------------------
  /** The editor is its own screen: the game stays as it was, its clock paused until the editor closes. */
  function openEditor(): void {
    if (editor.isOpen()) return;
    // A search left running would answer behind the editor and press the clock; it restarts on close.
    cancelAi();
    main.hidden = true;
    editor.open();
    pauseForDialog(); // after open, so its changed() doesn't start a new search
  }
  /** Edit current game: the same editor, on the game's position and variant, with Resume and Cancel. A finished game can be edited too. */
  function openEditorForCurrentGame(): void {
    if (editor.isOpen() || restoring) return;
    cancelAi();
    main.hidden = true;
    const now = Date.now();
    // A timed game's clocks are editable, from the times they show now.
    const { clockConfig, clock } = session.state();
    const clocks = clockConfig ? { white: remaining(clock, 'white', now), black: remaining(clock, 'black', now) } : null;
    editor.openGame(activeVariant(), session.fen(), clocks);
    pauseForDialog();
  }

  /**
   * Resume replaces the game with a new one from the edited position: a fresh move history and no result, the
   * same opponent and clock settings, and the clock times entered in the editor (as paused, unless changed). The checker said what to start: the
   * curated variant from the FEN, or the registered custom variant. The clock runs again only if it ran when the
   * editor opened, or for the AI, which thinks on its own time; a game paused until the next move stays paused.
   */
  function resumeEditedGame(verdict: StartVerdict, times: ClockTimes | null): void {
    const now = Date.now();
    const clockRan = pausedForDialog; // the editor (or the Settings dialog it came from) paused a running clock
    session.pauseClock(now); // already paused unless the game had no running clock; read the times before disposing
    const { opponent, clockConfig, clock: paused } = session.state();
    const clock = times ? { ...paused, whiteMs: times.white, blackMs: times.black } : paused;
    if (verdict.setup) inis.set(verdict.variant, verdict.ini);
    const game = verdict.setup ? { variant: verdict.variant, setup: verdict.setup } : { variant: verdict.variant, fen: verdict.fen };
    const next = GameSession.create(rules, { ...game, opponent, clockConfig, clock }, now);
    const aiTurn = opponent.kind === 'ai' && !next.state().result && !next.isHumanTurn();
    // The editor still covers the board, so the new game's clock starts as it closes.
    replaceSession(next, { resumeClock: clockRan || aiTurn });
    closeEditor(); // starts the clock, saves, and starts the AI's search if it is the AI's turn
  }

  function closeEditor(): void {
    if (!editor.isOpen()) return;
    editor.hide();
    main.hidden = false;
    resumeAfterDialog();
    changed(); // restarts the AI's search if it is the AI's turn (also when no clock was paused)
  }

  function openSettings(): void {
    pauseForDialog();
    settingsDialog.open(settings);
  }
  settingsDialog.onClose(resumeAfterDialog);
  settingsDialog.onEditGame(() => openEditorForCurrentGame());
  settingsDialog.onSave((next) => {
    settings = next;
    if (!store.save('chess.settings', SETTINGS_VERSION, settings) && store.available) warn(MSG_SAVE_FAILED);
    render();
  });

  // ---- Engine status -----------------------------------------------------------------------------
  // Follows the engine for the whole page life: it can become unavailable long after startup (a crash or a hung search).
  let engineStatusSeen = false;
  engine.onStatus((status, reason) => {
    engineReason = reason;
    playDialog.setEngineStatus(status, reason);
    if (status === 'unavailable') {
      pending = null;
      aiFailed = false;
    }
    // The first call reports the status at subscription time, before the game state below exists.
    if (engineStatusSeen) render();
    engineStatusSeen = true;
  });

  // ---- Clock loop --------------------------------------------------------------------------------
  function drawClocks(now: number): void {
    if (st.clockConfig === null) return;
    panel.renderClocks(remaining(st.clock, 'white', now), remaining(st.clock, 'black', now), st.clock.running);
  }
  const frame = () => {
    const now = Date.now();
    drawClocks(now);
    if (!st.result && st.clock.running !== null && session.checkFlag(now)) {
      cancelAi();
      changed();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // ---- Page lifecycle ----------------------------------------------------------------------------
  // Pause and save as the page goes away, so time spent with the tab closed is never charged.
  window.addEventListener('pagehide', () => {
    session.pauseClock(Date.now());
    st = session.state();
    save();
  });
  /** After a restore (reload or back/forward cache), the AI picks up its turn straight away, or once the editor or a dialog closes. */
  const resumeAiTurn = () => {
    if (st.opponent.kind === 'ai' && !st.result && !session.isHumanTurn()) {
      resumeClockWhenUncovered();
      pending = null;
    }
    changed();
  };
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) resumeAiTurn();
  });

  if (import.meta.env.MODE === 'test') {
    window.__chessTest = {
      loadFen: (variant, fen) => startGame({ variant: variantOf(variant).engineName, fen }, { kind: 'hotseat' }, null),
      engine: engine.test!,
    };
  }

  resumeAiTurn();
  if (savedCustom) {
    const pendingSave = savedCustom;
    restoring = restoreInBackground(rules, engine, pendingSave, (r) => onRestored(pendingSave, r));
    restoring.done.catch((e: unknown) => console.error('Restoring the saved custom game failed:', e));
    render();
  }
}
