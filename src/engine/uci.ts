// Pure UCI text helpers. No DOM or worker access.
import { remaining, type ClockConfig, type ClockState } from '../session/clock';
import { levelById, type AiLevelId } from './levels';

/** Builds the `go` line: the live clock when one runs, otherwise the level's fixed movetime. */
export function goCommand(level: AiLevelId, clock: ClockState | null, now: number, cfg: ClockConfig): string {
  if (clock && cfg) {
    const wtime = remaining(clock, 'white', now);
    const btime = remaining(clock, 'black', now);
    // An untimed side is Infinity; never put that (or the stored sentinel) on the wire.
    if (Number.isFinite(wtime) && Number.isFinite(btime)) {
      return `go wtime ${Math.round(wtime)} btime ${Math.round(btime)} winc ${cfg.incrementMs} binc ${cfg.incrementMs}`;
    }
  }
  return `go movetime ${levelById(level).movetimeMs}`;
}

/**
 * The longest a search may legitimately take: the level's movetime, or with a live clock the searching side's
 * remaining time (the larger of the two while the clock is paused). Mirrors goCommand's choice.
 */
export function searchTimeLimitMs(level: AiLevelId, clock: ClockState | null, now: number, cfg: ClockConfig): number {
  if (clock && cfg) {
    const wtime = remaining(clock, 'white', now);
    const btime = remaining(clock, 'black', now);
    if (Number.isFinite(wtime) && Number.isFinite(btime)) {
      return clock.running === null ? Math.max(wtime, btime) : clock.running === 'white' ? wtime : btime;
    }
  }
  return levelById(level).movetimeMs;
}

/** Returns the move of a `bestmove` line, or null for other lines and for `(none)`. */
export function parseBestMove(line: string): string | null {
  const m = /^bestmove\s+(\S+)/.exec(line);
  if (!m || m[1] === '(none)') return null;
  return m[1];
}
