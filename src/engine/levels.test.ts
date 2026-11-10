import { describe, expect, it } from 'vitest';
import { AI_LEVELS, levelOptions } from './levels';

describe('levels', () => {
  it('lists the six levels in strength order with increasing movetimes', () => {
    expect(AI_LEVELS.map((l) => [l.id, l.label, l.elo])).toEqual([
      ['beginner', 'Beginner', 800],
      ['novice', 'Novice', 1100],
      ['intermediate', 'Intermediate', 1400],
      ['advanced', 'Advanced', 1700],
      ['expert', 'Expert', 2000],
      ['max', 'Max', null],
    ]);
    const times = AI_LEVELS.map((l) => l.movetimeMs);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(new Set(times).size).toBe(times.length);
  });
  it('limits strength for every named level and lifts it for Max', () => {
    expect(levelOptions('expert')).toEqual(['setoption name UCI_LimitStrength value true', 'setoption name UCI_Elo value 2000']);
    expect(levelOptions('max')).toEqual(['setoption name UCI_LimitStrength value false']);
  });
});
