import { describe, expect, it } from 'vitest';
import {
  CLOCK_PRESETS,
  flagged,
  pause,
  press,
  remaining,
  resume,
  startClock,
} from './clock';

const cfg32 = { baseMs: 180000, incrementMs: 2000 };
const cfg10 = { baseMs: 600000, incrementMs: 0 };

describe('CLOCK_PRESETS', () => {
  it('offers exactly the presets in the spec', () =>
    expect(CLOCK_PRESETS.map(p => p.label)).toEqual(['None', '1+0', '3+2', '5+0', '10+5', '15+10']));

  it('maps each preset to the spec base and increment, with None as no clock', () =>
    expect(CLOCK_PRESETS.map(p => p.config)).toEqual([
      null,
      { baseMs: 60000, incrementMs: 0 },
      { baseMs: 180000, incrementMs: 2000 },
      { baseMs: 300000, incrementMs: 0 },
      { baseMs: 600000, incrementMs: 5000 },
      { baseMs: 900000, incrementMs: 10000 },
    ]));
});

describe('startClock', () => {
  it('gives both players the base time and starts the side to move', () => {
    const s = startClock(cfg32, 'white', 0);
    expect(s).toEqual({ whiteMs: 180000, blackMs: 180000, running: 'white', since: 0 });
  });
});

describe('press', () => {
  it('adds the increment to the player who just moved', () => {
    const s = press(startClock({ baseMs: 180000, incrementMs: 2000 }, 'white', 0), cfg32, 10000);
    expect(s.whiteMs).toBe(172000);
    expect(s.running).toBe('black');
  });

  it('charges the mover only for time elapsed since their turn began', () => {
    const s1 = press(startClock(cfg10, 'white', 0), cfg10, 4000);
    expect(s1.whiteMs).toBe(596000);
    const s2 = press(s1, cfg10, 9000);
    expect(s2.blackMs).toBe(595000);
    expect(s2.running).toBe('white');
  });

  it('switches running on a null config without touching the clock values', () => {
    const s = press(startClock(null, 'white', 0), null, 5000);
    expect(s.running).toBe('black');
    expect(s.whiteMs).toBe(Number.MAX_SAFE_INTEGER);
    expect(s.blackMs).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('no-clock state persistence', () => {
  it('survives a JSON round trip unchanged', () => {
    const s = press(startClock(null, 'white', 0), null, 5000);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('still reports Infinity remaining and no flag after a JSON round trip', () => {
    const s = JSON.parse(JSON.stringify(startClock(null, 'white', 0)));
    expect(remaining(s, 'white', 999999)).toBe(Infinity);
    expect(remaining(s, 'black', 999999)).toBe(Infinity);
    expect(flagged(s, 999999999)).toBeNull();
  });
});

describe('pause and resume', () => {
  it('does not tick while paused, so the editor and dialogs cost no time', () => {
    const p = pause(startClock(cfg10, 'white', 0), 5000);
    expect(remaining(p, 'white', 999999)).toBe(595000);
  });

  it('pausing an already-paused state is a no-op', () => {
    const p = pause(startClock(cfg10, 'white', 0), 5000);
    expect(pause(p, 7000)).toEqual(p);
  });

  it('resuming a running state is a no-op', () => {
    const s = startClock(cfg10, 'white', 0);
    expect(resume(s, 'black', 3000)).toEqual(s);
  });

  it('resume restarts the clock for the given side from now', () => {
    const p = pause(startClock(cfg10, 'white', 0), 5000);
    const r = resume(p, 'white', 20000);
    expect(remaining(r, 'white', 22000)).toBe(593000);
  });
});

describe('remaining', () => {
  it('counts down only for the running player', () => {
    const s = startClock(cfg10, 'white', 0);
    expect(remaining(s, 'white', 3000)).toBe(597000);
    expect(remaining(s, 'black', 3000)).toBe(600000);
  });

  it('never goes below 0', () => {
    const s = startClock({ baseMs: 1000, incrementMs: 0 }, 'white', 0);
    expect(remaining(s, 'white', 50000)).toBe(0);
  });

  it('is Infinity for every color when there is no clock', () => {
    const s = startClock(null, 'white', 0);
    expect(remaining(s, 'white', 999999)).toBe(Infinity);
    expect(remaining(s, 'black', 999999)).toBe(Infinity);
  });
});

describe('flagged', () => {
  it('flags from elapsed timestamps so a backgrounded tab still loses on time', () =>
    expect(flagged(startClock({ baseMs: 60000, incrementMs: 0 }, 'white', 0), 60001)).toBe('white'));

  it('flags at exactly zero remaining', () =>
    expect(flagged(startClock({ baseMs: 60000, incrementMs: 0 }, 'white', 0), 60000)).toBe('white'));

  it('does not flag one millisecond before zero', () =>
    expect(flagged(startClock({ baseMs: 60000, incrementMs: 0 }, 'white', 0), 59999)).toBeNull());

  it('returns null when nothing has run out', () =>
    expect(flagged(startClock(cfg10, 'white', 0), 1000)).toBeNull());

  it('returns null when there is no clock', () =>
    expect(flagged(startClock(null, 'white', 0), 999999999)).toBeNull());

  it('still reports a flag after the flagged player’s clock is paused', () => {
    const p = pause(startClock({ baseMs: 60000, incrementMs: 0 }, 'white', 0), 70000);
    expect(flagged(p, 80000)).toBe('white');
  });
});
