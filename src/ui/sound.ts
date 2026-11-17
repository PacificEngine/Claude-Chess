// Plays the sound cues as short tones made in the browser (Web Audio): no sound files, so no licence to
// track (owner choice, 2026-11-17). Silent while the Sound setting is off, and silent, never failing, where
// the browser has no Web Audio.
import type { Cue } from './sound-cues';

interface Tone {
  /** Frequencies in Hz, played one after another. */
  freqs: number[];
  /** How long each note rings, in seconds. */
  dur: number;
  type: OscillatorType;
  /** Seconds from one note's start to the next. */
  gap: number;
  volume: number;
}

const TONES: Record<Cue, Tone> = {
  move: { freqs: [520], dur: 0.06, type: 'triangle', gap: 0.09, volume: 0.25 },
  capture: { freqs: [300, 220], dur: 0.08, type: 'square', gap: 0.05, volume: 0.15 },
  check: { freqs: [880, 880], dur: 0.08, type: 'sine', gap: 0.12, volume: 0.25 },
  win: { freqs: [523, 659, 784, 1047], dur: 0.18, type: 'triangle', gap: 0.12, volume: 0.25 },
  lose: { freqs: [392, 330, 262], dur: 0.25, type: 'sine', gap: 0.18, volume: 0.25 },
  draw: { freqs: [440, 440], dur: 0.2, type: 'sine', gap: 0.22, volume: 0.25 },
  lowTime: { freqs: [1000, 1000, 1000], dur: 0.05, type: 'square', gap: 0.15, volume: 0.1 },
};

export interface SoundPlayer {
  play(cue: Cue): void;
}

/**
 * `enabled` is read on every cue, so turning Sound on or off in Settings takes effect at once. `heard` is
 * told each cue that plays (the e2e tests record them, since a test can't listen).
 */
export function createSoundPlayer(enabled: () => boolean, heard?: (cue: Cue) => void): SoundPlayer {
  let ctx: AudioContext | null = null;
  return {
    play(cue) {
      if (!enabled()) return;
      heard?.(cue);
      try {
        // Made on first use: browsers only let a page start audio after the player has interacted with it.
        ctx ??= new AudioContext();
        if (ctx.state === 'suspended') void ctx.resume();
        const { freqs, dur, type, gap, volume } = TONES[cue];
        freqs.forEach((freq, i) => {
          const start = ctx!.currentTime + i * gap;
          const osc = ctx!.createOscillator();
          const gain = ctx!.createGain();
          osc.type = type;
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(volume, start);
          gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
          osc.connect(gain).connect(ctx!.destination);
          osc.start(start);
          osc.stop(start + dur);
        });
      } catch (e) {
        console.warn('Sound could not play:', e);
      }
    },
  };
}
