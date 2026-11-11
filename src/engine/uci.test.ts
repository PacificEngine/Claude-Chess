import { describe, expect, it } from 'vitest';
import { levelById } from './levels';
import { goCommand, parseBestMove, searchTimeLimitMs } from './uci';

const cfg32 = { baseMs: 180000, incrementMs: 2000 };

describe('goCommand', () => {
  it('gives the AI its real clock when a timer runs', () =>
    expect(goCommand('expert', { whiteMs: 170000, blackMs: 180000, running: 'black', since: 0 }, 0, cfg32)).toBe(
      'go wtime 170000 btime 180000 winc 2000 binc 2000',
    ));
  it('deducts the running side time elapsed at now', () =>
    expect(goCommand('expert', { whiteMs: 170000, blackMs: 180000, running: 'white', since: 0 }, 5000, cfg32)).toBe(
      'go wtime 165000 btime 180000 winc 2000 binc 2000',
    ));
  it('uses the level movetime when there is no clock', () =>
    expect(goCommand('beginner', null, 0, null)).toMatch(/^go movetime \d+$/));
  it('never sends the no-clock sentinel', () => {
    const sentinel = Number.MAX_SAFE_INTEGER;
    const cmd = goCommand('max', { whiteMs: sentinel, blackMs: sentinel, running: 'white', since: 0 }, 0, null);
    expect(cmd).toMatch(/^go movetime \d+$/);
    expect(cmd).not.toContain(String(sentinel));
  });
});

describe('searchTimeLimitMs', () => {
  it('is the level movetime when there is no clock', () =>
    expect(searchTimeLimitMs('max', null, 0, null)).toBe(levelById('max').movetimeMs));
  it("is the searching side's remaining time when a clock runs", () =>
    expect(searchTimeLimitMs('expert', { whiteMs: 170000, blackMs: 60000, running: 'black', since: 0 }, 5000, cfg32)).toBe(55000));
  it('is the larger remaining time when the clock is paused', () =>
    expect(searchTimeLimitMs('expert', { whiteMs: 170000, blackMs: 60000, running: null, since: null }, 5000, cfg32)).toBe(170000));
  it('falls back to movetime for the no-clock sentinel', () => {
    const sentinel = Number.MAX_SAFE_INTEGER;
    expect(searchTimeLimitMs('beginner', { whiteMs: sentinel, blackMs: sentinel, running: 'white', since: 0 }, 0, null)).toBe(
      levelById('beginner').movetimeMs,
    );
  });
});

describe('parseBestMove', () => {
  it('reads the move from a bestmove line, including promotion and gating suffixes', () =>
    expect(parseBestMove('bestmove a9a10c ponder x')).toBe('a9a10c'));
  it('returns null for other lines and for "(none)"', () => {
    expect(parseBestMove('info depth 3')).toBeNull();
    expect(parseBestMove('bestmove (none)')).toBeNull();
  });
});
