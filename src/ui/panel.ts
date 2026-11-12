// The right panel (layout A): Black clock, move list, White clock, Undo / Edit / Settings, the status line
// and the variant-and-opponent line. It renders what app.ts tells it; it holds no game state.
import type { Color } from '../rules/types';
import type { ActiveVariant } from '../variants/active';

export interface PanelState {
  /** The game's variant; its label starts the game line, e.g. "Grand Chess · AI: Expert". */
  variant: ActiveVariant;
  /** The rest of the game line, e.g. "AI: Expert" or "Hot-seat". */
  opponent: string;
  /** SAN of every ply, in order. */
  sans: string[];
  clocksVisible: boolean;
  canUndo: boolean;
  /** Edit is off only while a saved custom game is still being restored: the board isn't that game yet. */
  canEdit: boolean;
  /** "White to move", "AI is thinking…", or the result. */
  status: string;
  /** Show the Retry button: the AI's last attempt failed but the engine still runs. */
  retry: boolean;
  over: boolean;
}

export interface PanelHandlers {
  undo(): void;
  edit(): void;
  settings(): void;
  retry(): void;
}

export interface Panel {
  render(s: PanelState): void;
  /** Redraws only the clocks; called every animation frame. */
  renderClocks(whiteMs: number, blackMs: number, running: Color | null): void;
}

const TENTHS_BELOW_MS = 10000;

/** "4:59" while at least ten seconds are left, then "0:09.8". Rounds up so 0:00 means the flag fell. */
export function formatClock(ms: number): string {
  if (!Number.isFinite(ms)) return '–';
  if (ms < TENTHS_BELOW_MS) {
    const tenths = Math.ceil(ms / 100);
    return `0:0${Math.floor(tenths / 10)}.${tenths % 10}`;
  }
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function createPanel(host: HTMLElement, handlers: PanelHandlers): Panel {
  const panel = document.createElement('aside');
  panel.className = 'panel';

  const clock = (color: Color) => {
    const c = document.createElement('div');
    c.className = `clock clock-${color}`;
    c.dataset.testid = `clock-${color}`;
    return c;
  };
  const blackClock = clock('black');
  const whiteClock = clock('white');

  const moveList = document.createElement('ol');
  moveList.className = 'move-list';
  moveList.dataset.testid = 'move-list';

  const status = document.createElement('div');
  status.className = 'status';
  status.dataset.testid = 'status';
  status.setAttribute('role', 'status');
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'retry';
  retry.dataset.testid = 'ai-retry';
  retry.textContent = 'Retry';
  retry.hidden = true;
  retry.addEventListener('click', handlers.retry);

  const buttons = document.createElement('div');
  buttons.className = 'panel-buttons';
  const button = (id: string, text: string, onClick?: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.testid = id;
    b.textContent = text;
    if (onClick) b.addEventListener('click', onClick);
    buttons.append(b);
    return b;
  };
  const undo = button('undo', 'Undo', handlers.undo);
  const edit = button('edit', 'Edit', handlers.edit);
  button('settings', 'Settings', handlers.settings);

  const gameLine = document.createElement('div');
  gameLine.className = 'game-line';
  gameLine.dataset.testid = 'game-line';

  panel.append(blackClock, moveList, whiteClock, status, retry, buttons, gameLine);
  host.append(panel);

  let renderedSans: string[] = [];
  let shown: [string, string, Color | null] = ['', '', null];

  return {
    render(s) {
      gameLine.textContent = `${s.variant.label} · ${s.opponent}`;
      status.textContent = s.status;
      retry.hidden = !s.retry;
      status.classList.toggle('over', s.over);
      undo.disabled = !s.canUndo;
      edit.disabled = !s.canEdit;
      blackClock.hidden = !s.clocksVisible;
      whiteClock.hidden = !s.clocksVisible;
      // Rebuild the list only when it changed, so scrolling isn't reset every render.
      if (s.sans.length !== renderedSans.length || s.sans.some((san, i) => san !== renderedSans[i])) {
        renderedSans = [...s.sans];
        const rows: HTMLLIElement[] = [];
        for (let i = 0; i < s.sans.length; i += 2) {
          const row = document.createElement('li');
          const num = document.createElement('span');
          num.className = 'num';
          num.textContent = `${i / 2 + 1}.`;
          row.append(num);
          for (const san of s.sans.slice(i, i + 2)) {
            const ply = document.createElement('span');
            ply.className = 'ply';
            ply.textContent = san;
            row.append(ply);
          }
          rows.push(row);
        }
        moveList.replaceChildren(...rows);
        moveList.scrollTop = moveList.scrollHeight;
      }
    },
    renderClocks(whiteMs, blackMs, running) {
      const w = formatClock(whiteMs);
      const b = formatClock(blackMs);
      if (shown[0] === w && shown[1] === b && shown[2] === running) return;
      shown = [w, b, running];
      whiteClock.textContent = w;
      blackClock.textContent = b;
      whiteClock.classList.toggle('running', running === 'white');
      blackClock.classList.toggle('running', running === 'black');
    },
  };
}
