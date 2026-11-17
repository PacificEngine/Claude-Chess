import { describe, expect, it } from 'vitest';
import { endCue, lowTimeCrossed, moveCue } from './sound-cues';

describe('sound cues', () => {
  it('gives a move, a capture or a check its own sound, check first', () => {
    expect(moveCue('e4')).toBe('move');
    expect(moveCue('O-O')).toBe('move');
    expect(moveCue('Nxe5')).toBe('capture');
    expect(moveCue('Qh5+')).toBe('check');
    expect(moveCue('Bxf7+')).toBe('check');
    expect(moveCue('e8=Q')).toBe('move');
  });

  it("plays win or lose from the human's side against the AI, and a draw either way", () => {
    const ai = { kind: 'ai', level: 'beginner', aiColor: 'black' } as const;
    expect(endCue({ winner: 'white', reason: 'checkmate' }, ai)).toBe('win');
    expect(endCue({ winner: 'black', reason: 'timeout' }, ai)).toBe('lose');
    expect(endCue({ winner: null, reason: 'stalemate' }, ai)).toBe('draw');
  });

  it('plays the win tune for any decisive hot-seat result', () => {
    expect(endCue({ winner: 'black', reason: 'checkmate' }, { kind: 'hotseat' })).toBe('win');
    expect(endCue({ winner: 'white', reason: 'timeout' }, { kind: 'hotseat' })).toBe('win');
    expect(endCue({ winner: null, reason: 'repetition' }, { kind: 'hotseat' })).toBe('draw');
  });

  it('warns once a clock drops under ten seconds, not while it stays there', () => {
    expect(lowTimeCrossed(10_001, 9_999)).toBe(true);
    expect(lowTimeCrossed(10_000, 9_000)).toBe(true);
    expect(lowTimeCrossed(9_000, 8_000)).toBe(false);
    expect(lowTimeCrossed(20_000, 15_000)).toBe(false);
  });
});
