import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PIECE_SETS, pieceSetOf } from './piece-sets';

describe('piece sets', () => {
  it('offers Merida first, then the fourteen Lichess sets', () => {
    expect(PIECE_SETS.map((s) => s.id)).toEqual([
      'merida', 'cburnett', 'chessnut', 'fantasy', 'spatial', 'celtic', 'mpchess', 'kiwen-suwi', 'firi', 'totoy',
      'papercut', 'rhosgfx', 'shapes', 'pixel', 'letter',
    ]);
    expect(new Set(PIECE_SETS.map((s) => s.label)).size).toBe(PIECE_SETS.length);
  });

  it('ships all twelve pieces of every set', () => {
    for (const s of PIECE_SETS) {
      for (const c of 'wb') for (const p of 'KQRBNP') expect(existsSync(resolve('public/pieces', s.id, `${c}${p}.svg`)), `${s.id} ${c}${p}`).toBe(true);
    }
  });

  it('reads a saved set, and falls back to Merida for the old default or an unknown set', () => {
    expect(pieceSetOf('cburnett')).toBe('cburnett');
    expect(pieceSetOf('default')).toBe('merida');
    expect(pieceSetOf('gone')).toBe('merida');
  });
});
