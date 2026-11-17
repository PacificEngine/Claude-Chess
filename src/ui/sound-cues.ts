// Which sound a moment of play makes. Pure: no DOM or audio, so tests run in Node. sound.ts plays them.
import type { GameResult } from '../rules/types';
import type { Opponent } from '../session/session';

export type Cue = 'move' | 'capture' | 'check' | 'win' | 'lose' | 'draw' | 'lowTime';

/** A clock under this many milliseconds gets the low-time warning, once. */
export const LOW_TIME_MS = 10_000;

/** The sound for a move, from its SAN: a check wins over a capture, a capture over a plain move. */
export function moveCue(san: string): Cue {
  if (/[+#]/.test(san)) return 'check';
  if (san.includes('x')) return 'capture';
  return 'move';
}

/**
 * The sound for the end of a game. Against the AI it is the human's win or loss; in hot-seat any decisive
 * result plays the win tune, since one of the people at the screen won.
 */
export function endCue(result: GameResult, opponent: Opponent): Cue {
  if (result.winner === null) return 'draw';
  if (opponent.kind === 'hotseat') return 'win';
  return result.winner === opponent.aiColor ? 'lose' : 'win';
}

/** Whether a clock has just dropped under LOW_TIME_MS. */
export function lowTimeCrossed(beforeMs: number, nowMs: number): boolean {
  return beforeMs >= LOW_TIME_MS && nowMs < LOW_TIME_MS;
}
