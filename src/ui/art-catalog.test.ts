import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ART_CHOICES, artChoice } from './art-catalog';

describe('art catalog', () => {
  it('offers every piece image the site ships with both colours, and never Spartan', () => {
    for (const c of ART_CHOICES) for (const p of [c.white, c.black]) expect(existsSync(resolve('public', p)), p).toBe(true);
    expect(ART_CHOICES.some((c) => c.id.startsWith('spartan'))).toBe(false);
    expect(ART_CHOICES.map((c) => c.id)).toEqual(
      expect.arrayContaining(['merida/Q', 'merida/shako/C', 'alfaerie/amazon', 'shogi-tile/gold']),
    );
  });

  it('lists every two-colour image on disk, so new art cannot be forgotten', () => {
    const ids = new Set(ART_CHOICES.map((c) => c.id));
    const walk = (dir: string): string[] =>
      readdirSync(resolve('public/pieces', dir), { withFileTypes: true }).flatMap((e) => {
        if (e.isDirectory()) return e.name === 'spartan' ? [] : walk(`${dir}/${e.name}`);
        const m = /^w(.+)\.svg$/.exec(e.name);
        return m && existsSync(resolve('public/pieces', dir, `b${m[1]}.svg`)) ? [`${dir}/${m[1]}`] : [];
      });
    const onDisk = readdirSync(resolve('public/pieces'), { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'spartan')
      .flatMap((e) => walk(e.name));
    expect(onDisk.length).toBeGreaterThan(40);
    for (const id of onDisk) expect(ids.has(id), id).toBe(true);
  });

  it('has unique ids and labels', () => {
    expect(new Set(ART_CHOICES.map((c) => c.id)).size).toBe(ART_CHOICES.length);
    expect(new Set(ART_CHOICES.map((c) => c.label)).size).toBe(ART_CHOICES.length);
  });

  it('labels art in plain English with its set', () => {
    expect(artChoice('merida/Q')?.label).toBe('Queen (Merida)');
    expect(artChoice('alfaerie/amazon')?.label).toBe('Amazon (Alfaerie)');
    expect(artChoice('merida/shako/E')?.label).toBe('Elephant (Shako)');
    expect(artChoice('shogi-tile/gold')?.label).toBe('Gold General (Shogi tile)');
    expect(artChoice('alfaerie/amazon')?.white).toBe('pieces/alfaerie/wamazon.svg');
  });

  it('gives an unknown or missing art id no art instead of throwing', () => {
    expect(artChoice('gone/x')).toBeNull();
    expect(artChoice(null)).toBeNull();
  });
});
