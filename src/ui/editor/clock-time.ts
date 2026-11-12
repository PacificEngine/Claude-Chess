// The clock times the editor shows and reads when it edits a timed game: m:ss, or h:mm:ss from an hour on.
import type { Color } from '../../rules/types';

/** The longest time a clock can be set to in the editor: 9:59:59. */
export const MAX_CLOCK_MS = 35999000;

/** A paused time as the editor's input shows it. Part of a second rounds up, as the game's clocks show it. */
export function formatClockInput(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** The time typed in an editor clock input, in ms, or null when it is not m:ss or h:mm:ss up to 9:59:59. */
export function parseClockInput(text: string): number | null {
  const t = text.trim();
  const short = /^(\d{1,3}):([0-5]\d)$/.exec(t);
  const long = /^(\d):([0-5]\d):([0-5]\d)$/.exec(t);
  let seconds: number;
  if (short) seconds = Number(short[1]) * 60 + Number(short[2]);
  else if (long) seconds = Number(long[1]) * 3600 + Number(long[2]) * 60 + Number(long[3]);
  else return null;
  const ms = seconds * 1000;
  return ms <= MAX_CLOCK_MS ? ms : null;
}

const capital = (c: Color) => (c === 'white' ? 'White' : 'Black');

/** Why the editor can't resume with `text` on `color`'s clock, or null when it can. */
export function clockProblem(color: Color, text: string): string | null {
  const ms = parseClockInput(text);
  if (ms === null) return `${capital(color)}'s clock must be a time from 0:01 to 9:59:59, such as 4:30.`;
  // A side at 0:00 would lose on time the moment the game resumed.
  if (ms === 0) return `${capital(color)} has no time left — set its clock above 0:00.`;
  return null;
}
