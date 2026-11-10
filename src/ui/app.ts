// The app: owns the GameSession, the Engine and the Store, and wires the views to them.
// Views never touch the session directly; every change goes through changed() so it is saved and redrawn.
import { createEngine, type EngineTestHooks } from '../engine/engine';
import { levelById } from '../engine/levels';
import { createStore, DEFAULT_SETTINGS, isSettings, SETTINGS_VERSION, type Settings } from '../persistence/store';
import { loadRules, type Rules } from '../rules/rules';
import type { Color, GameResult } from '../rules/types';
import { remaining } from '../session/clock';
import { GameSession, isSessionState, type Opponent, type SessionState } from '../session/session';
import { CURATED_VARIANTS, type VariantInfo } from '../variants/catalog';
import { createBoardView, parseUci } from './board-view';
import { createChoiceDialog } from './choice-dialog';
import { createPanel } from './panel';
import { createPlayDialog, type PlayChoice } from './play-dialog';
import { createSettingsDialog } from './settings-dialog';
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
const MSG_CORRUPT_SETTINGS = "Your saved settings couldn't be read, so the defaults are in use.";

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

/**
 * A saved game is only usable if its variant is curated and its moves and snapshots replay; anything else counts as
 * corrupt. Curated games never carry an ini, and only generator-validated text may reach the engine's variants.ini,
 * so a stored ini is refused rather than trusted.
 */
function restorable(rules: Rules, d: unknown): d is SessionState {
  if (!isSessionState(d) || d.ini !== undefined || !CURATED_VARIANTS.some((v) => v.engineName === d.variant)) return false;
  try {
    GameSession.restore(rules, d).dispose();
    return true;
  } catch {
    return false;
  }
}

export async function startApp(root: HTMLElement): Promise<void> {
  root.replaceChildren();
  root.classList.add('app');
  // Start the engine first: it loads in the background and never delays the board.
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
  const savedGame = store.load('chess.game', GAME_VERSION, {}, (d): d is SessionState => restorable(rules, d));
  if (savedGame.problem) warn(MSG_CORRUPT_GAME);

  // ---- Layout ------------------------------------------------------------------------------------
  const main = document.createElement('main');
  main.className = 'layout';
  const boardHost = document.createElement('div');
  main.append(boardHost);
  createTopBar(root, { play: () => openPlay(), settings: () => openSettings() });
  root.append(banner, main);
  createSourceLink(root);
  const board = createBoardView(boardHost);
  const panel = createPanel(main, { undo: () => undo(), settings: () => openSettings(), retry: () => retryAi() });
  const playDialog = createPlayDialog(root);
  const settingsDialog = createSettingsDialog(root);
  const choiceDialog = createChoiceDialog(root);

  // ---- Game state --------------------------------------------------------------------------------
  let session: GameSession;
  if (savedGame.data) {
    session = GameSession.restore(rules, savedGame.data);
    // A closed tab never costs time: the clock stays paused until the next move (or the AI's search).
    session.pauseClock(Date.now());
  } else {
    session = GameSession.create(rules, { variant: 'chess', opponent: { kind: 'hotseat' }, clockConfig: null }, Date.now());
  }
  let st: SessionState = session.state();
  /** Request id of the AI search in flight, or null. */
  let pending: number | null = null;
  let engineVariant: string | null = null;
  let engineReason: string | undefined;
  /** The last AI request failed with the engine still alive (no move, or a move the rules refuse): offer Retry. */
  let aiFailed = false;
  let pausedForDialog = false;
  let lastChoice: PlayChoice = {
    variant: 'chess',
    opponent: { kind: 'ai', level: 'expert' },
    color: 'white',
    clockConfig: null,
  };
  if (savedGame.data && st.opponent.kind === 'ai') {
    lastChoice = {
      variant: variantOf(st.variant).id,
      opponent: { kind: 'ai', level: st.opponent.level },
      color: other(st.opponent.aiColor),
      clockConfig: st.clockConfig,
    };
  }

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
    if (!store.save('chess.game', GAME_VERSION, st) && store.available) warn(MSG_SAVE_FAILED);
  }

  function statusText(): string {
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
    const variant = variantOf(st.variant);
    const sans = st.moves.map((_, i) => sanOf(i));
    const last = st.moves.length ? parseUci(st.moves[st.moves.length - 1]) : null;
    const lastSan = sans[sans.length - 1] ?? '';
    board.show({
      variant,
      fen: session.fen(),
      turn: session.turn(),
      orientation: humanColor(),
      movable: !st.result && session.isHumanTurn() ? session.turn() : null,
      legalFrom: (sq) => session.legalMovesFrom(sq),
      lastMove: last ? [last.from, last.to] : null,
      check: /[+#]/.test(lastSan),
      showDests: settings.highlightLegal,
    });
    const opponent = st.opponent.kind === 'ai' ? `AI: ${levelById(st.opponent.level).label}` : 'Hot-seat';
    panel.render({
      gameLine: `${variant.label} · ${opponent}`,
      sans,
      clocksVisible: st.clockConfig !== null,
      canUndo: session.canUndo(),
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
      const variant = variantOf(st.variant);
      if (engineVariant !== variant.engineName) {
        engineVariant = variant.engineName;
        await engine.setVariant(variant.engineName, st.ini);
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
    if (st.result || !s.isHumanTurn()) return render();
    const candidates = s.legalMovesFrom(from).filter((u) => {
      const m = parseUci(u);
      return m !== null && m.to === to;
    });
    if (candidates.length === 0) return render();
    let uci = candidates[0];
    if (candidates.length > 1) {
      // Several legal moves share these squares (promotion or gating): the player must choose.
      const variant = variantOf(st.variant);
      const choices = candidates.map((u) => ({ uci: u, suffix: parseUci(u)!.suffix }));
      const gating = variant.id === 'seirawan';
      pauseForDialog();
      const picked = await choiceDialog.ask(variant.id, gating ? 'Bring in a piece from hand?' : 'Promote to', choices);
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

  function startGame(variant: VariantInfo, opponent: Opponent, clockConfig: SessionState['clockConfig'], fen?: string): void {
    const next = GameSession.create(rules, { variant: variant.engineName, fen, opponent, clockConfig }, Date.now());
    cancelAi();
    session.dispose();
    session = next;
    pausedForDialog = false;
    changed();
  }

  // ---- Dialogs (clocks pause while one is open) ---------------------------------------------------
  function pauseForDialog(): void {
    if (st.result || st.clock.running === null) return;
    session.pauseClock(Date.now());
    pausedForDialog = true;
    changed();
  }
  function resumeAfterDialog(): void {
    if (!pausedForDialog) return;
    pausedForDialog = false;
    session.resumeClock(Date.now());
    changed();
  }

  function openPlay(): void {
    pauseForDialog();
    playDialog.open(lastChoice);
  }
  playDialog.onClose(resumeAfterDialog);
  playDialog.onStart((choice) => {
    lastChoice = choice;
    const variant = variantOf(choice.variant);
    let opponent: Opponent = { kind: 'hotseat' };
    if (choice.opponent.kind === 'ai') {
      const human: Color = choice.color === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : choice.color;
      opponent = { kind: 'ai', level: choice.opponent.level, aiColor: other(human) };
    }
    startGame(variant, opponent, choice.clockConfig);
  });

  function openSettings(): void {
    pauseForDialog();
    settingsDialog.open(settings);
  }
  settingsDialog.onClose(resumeAfterDialog);
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
  /** After a restore (reload or back/forward cache), the AI picks up its turn straight away. */
  const resumeAiTurn = () => {
    if (st.opponent.kind === 'ai' && !st.result && !session.isHumanTurn()) {
      session.resumeClock(Date.now());
      pending = null;
    }
    changed();
  };
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) resumeAiTurn();
  });

  if (import.meta.env.MODE === 'test') {
    window.__chessTest = {
      loadFen: (variant, fen) => startGame(variantOf(variant), { kind: 'hotseat' }, null, fen),
      engine: engine.test!,
    };
  }

  resumeAiTurn();
}
