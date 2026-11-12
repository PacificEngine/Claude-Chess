import { describe, expect, it } from 'vitest';
import { clockProblem, formatClockInput, parseClockInput } from './clock-time';

describe('editor clock times', () => {
  it('formats a paused time as m:ss, or h:mm:ss from an hour, rounding part of a second up as the clocks do', () => {
    expect(formatClockInput(200000)).toBe('3:20');
    expect(formatClockInput(199001)).toBe('3:20');
    expect(formatClockInput(400)).toBe('0:01');
    expect(formatClockInput(0)).toBe('0:00');
    expect(formatClockInput(3600000)).toBe('1:00:00');
    expect(formatClockInput(5025000)).toBe('1:23:45');
  });

  it('reads m:ss and h:mm:ss, ignoring spaces around them', () => {
    expect(parseClockInput('3:20')).toBe(200000);
    expect(parseClockInput(' 0:05 ')).toBe(5000);
    expect(parseClockInput('75:00')).toBe(4500000);
    expect(parseClockInput('1:23:45')).toBe(5025000);
    expect(parseClockInput('9:59:59')).toBe(35999000);
    expect(parseClockInput('0:00')).toBe(0);
  });

  it('refuses anything else: empty, no seconds, seconds or minutes past 59, signs, decimals, past 9:59:59', () => {
    for (const text of ['', '  ', '5', '3:2', '3:60', '1:60:00', '-1:00', '1.5:00', '3:20.5', '10:00:00', '600:00', 'a:bc', '1:00:00:00']) {
      expect(parseClockInput(text), text).toBeNull();
    }
  });

  it('names the side whose clock is unreadable, or out of time', () => {
    expect(clockProblem('white', '3:20')).toBeNull();
    expect(clockProblem('white', '0:01')).toBeNull();
    expect(clockProblem('white', '0:00')).toBe('White has no time left — set its clock above 0:00.');
    expect(clockProblem('black', '0:00')).toBe('Black has no time left — set its clock above 0:00.');
    expect(clockProblem('black', '')).toBe("Black's clock must be a time from 0:01 to 9:59:59, such as 4:30.");
    expect(clockProblem('white', '10:00:00')).toBe("White's clock must be a time from 0:01 to 9:59:59, such as 4:30.");
  });
});
