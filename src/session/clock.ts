import type { Color } from '../rules/types';

// Pure chess-clock arithmetic. Every function takes `now` (ms) so the clock never reads the wall clock itself;
// callers decide when time passes. No DOM access here.

export type ClockConfig = { baseMs: number; incrementMs: number } | null;

export const CLOCK_PRESETS: { label: string; config: ClockConfig }[] = [
  { label: 'None', config: null },
  { label: '1+0', config: { baseMs: 60000, incrementMs: 0 } },
  { label: '3+2', config: { baseMs: 180000, incrementMs: 2000 } },
  { label: '5+0', config: { baseMs: 300000, incrementMs: 0 } },
  { label: '10+5', config: { baseMs: 600000, incrementMs: 5000 } },
  { label: '15+10', config: { baseMs: 900000, incrementMs: 10000 } },
];

// A null config is stored as the NO_CLOCK sentinel (Number.MAX_SAFE_INTEGER) on both sides, so remaining() needs no
// config and never flags.
export interface ClockState {
  whiteMs: number;
  blackMs: number;
  running: Color | null;
  since: number | null;
}

// Finite sentinel for "no clock" so the state survives JSON.parse(JSON.stringify(...)) unchanged.
const NO_CLOCK = Number.MAX_SAFE_INTEGER;

// Time the running player has used since `since`. Clamped so a clock that goes backwards cannot add time.
function elapsed(state: ClockState, now: number): number {
  if (state.running === null || state.since === null) return 0;
  return Math.max(0, now - state.since);
}

function msOf(state: ClockState, color: Color): number {
  return color === 'white' ? state.whiteMs : state.blackMs;
}

// Returns a copy with the running player's elapsed time deducted. Never stores a negative time.
// A no-clock side keeps the sentinel untouched.
function settle(state: ClockState, now: number): ClockState {
  if (state.running === null) return state;
  if (msOf(state, state.running) >= NO_CLOCK) return state;
  const left = Math.max(0, msOf(state, state.running) - elapsed(state, now));
  return state.running === 'white'
    ? { ...state, whiteMs: left }
    : { ...state, blackMs: left };
}

export function startClock(cfg: ClockConfig, toMove: Color, now: number): ClockState {
  const ms = cfg ? cfg.baseMs : NO_CLOCK;
  return { whiteMs: ms, blackMs: ms, running: toMove, since: now };
}

// Called when the side to move finishes a move: charges the mover for their time, adds their increment, hands the move over.
// Callers must check flagged() first: press after a flag adds the increment back onto a zero clock.
export function press(state: ClockState, cfg: ClockConfig, now: number): ClockState {
  if (state.running === null) return state;
  const mover = state.running;
  const next = settle(state, now);
  const incremented = cfg && msOf(next, mover) < NO_CLOCK
    ? mover === 'white'
      ? { ...next, whiteMs: next.whiteMs + cfg.incrementMs }
      : { ...next, blackMs: next.blackMs + cfg.incrementMs }
    : next;
  return { ...incremented, running: mover === 'white' ? 'black' : 'white', since: now };
}

export function pause(state: ClockState, now: number): ClockState {
  if (state.running === null) return state;
  return { ...settle(state, now), running: null, since: null };
}

export function resume(state: ClockState, toMove: Color, now: number): ClockState {
  if (state.running !== null) return state;
  return { ...state, running: toMove, since: now };
}

export function remaining(state: ClockState, color: Color, now: number): number {
  const ms = msOf(state, color);
  if (ms >= NO_CLOCK) return Infinity;
  const used = state.running === color ? elapsed(state, now) : 0;
  return Math.max(0, ms - used);
}

// The running player is checked first. The other side is checked too, so a flag still shows after pause()
// has settled the running clock to zero.
export function flagged(state: ClockState, now: number): Color | null {
  const order: Color[] = state.running === 'black' ? ['black', 'white'] : ['white', 'black'];
  for (const color of order) {
    if (remaining(state, color, now) <= 0) return color;
  }
  return null;
}
