import { beforeEach, describe, expect, it } from 'vitest';
import type { SetupSpec } from '../variants/setup';
import type { DesignedPiece } from './pieces';
import { loadSetups, rewritePieceCopies, type SavedSetup, saveSetups, SETUPS_VERSION, setupsUsingPiece, usesPiece } from './setups';
import { createStore, type Store } from './store';

class MemoryStorage implements Storage {
  map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

const spec: SetupSpec = {
  base: 'chess',
  files: 10,
  ranks: 8,
  pieces: { k: 'king', a: 'archbishop' },
  fen: '4k5/10/10/10/10/10/10/A3K5 w - - 0 1',
  castling: false,
  promotion: { rank: 'last', pieceTypes: ['a'] },
};
const saved: SavedSetup = { id: 'id-1', name: 'My <b>setup</b>', spec, savedAt: 1 };

let mem: MemoryStorage;
let store: Store;
beforeEach(() => {
  mem = new MemoryStorage();
  store = createStore(mem);
});

describe('saved setups', () => {
  it('starts empty when nothing is stored', () => expect(loadSetups(store)).toEqual({ setups: [], problem: null }));

  it('saves and loads setups under chess.setups with a version', () => {
    expect(saveSetups(store, [saved])).toBe(true);
    expect(JSON.parse(mem.getItem('chess.setups')!)).toEqual({ version: SETUPS_VERSION, data: [saved] });
    expect(loadSetups(store)).toEqual({ setups: [saved], problem: null });
  });

  it('keeps a malformed saved-setups list from crashing the app', () => {
    mem.setItem('chess.setups', '{"version":1,"data":[{"id":"x","name":3}]}');
    expect(loadSetups(store)).toEqual({ setups: [], problem: 'corrupt' });
    expect(mem.getItem('chess.setups.corrupt')).toContain('"id":"x"');
    mem.setItem('chess.setups', 'not json');
    expect(loadSetups(store)).toEqual({ setups: [], problem: 'corrupt' });
  });

  it('treats a setup whose spec has the wrong shape as corrupt', () => {
    mem.setItem('chess.setups', JSON.stringify({ version: 1, data: [{ ...saved, spec: { ...spec, base: 'nope' } }] }));
    expect(loadSetups(store).problem).toBe('corrupt');
  });

  it('reports a refused save', () => {
    mem.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(saveSetups(store, [saved])).toBe(false);
  });
});

describe('designed-piece copies in setups', () => {
  const twoPieces: SetupSpec = {
    ...spec,
    designed: { z: { id: 'rider', betza: 'NN', art: 'alfaerie/horse' }, y: { id: 'wazir', betza: 'W', art: null } },
    fen: '4k5/10/10/10/10/10/10/AZY1K5 w - - 0 1',
  };
  const changed: DesignedPiece = { id: 'rider', name: 'Rider', letter: 'q', betza: 'NNF', art: 'merida/n', savedAt: 2 };

  it('rewrites only the copies of the changed piece, keeping letters', () => {
    const next = rewritePieceCopies(twoPieces, changed);
    expect(next.designed).toEqual({ z: { id: 'rider', betza: 'NNF', art: 'merida/n' }, y: { id: 'wazir', betza: 'W', art: null } });
    expect({ ...next, designed: undefined }).toEqual({ ...twoPieces, designed: undefined });
    // The original is left as it was.
    expect(twoPieces.designed!.z).toEqual({ id: 'rider', betza: 'NN', art: 'alfaerie/horse' });
    // And shares no copy with the result, so changing one never changes the other.
    expect(next.designed!.y).not.toBe(twoPieces.designed!.y);
  });

  it('leaves a setup without the piece as it was', () => {
    expect(rewritePieceCopies(spec, changed)).toEqual(spec);
    expect(rewritePieceCopies(twoPieces, { ...changed, id: 'other' })).toEqual(twoPieces);
  });

  it('finds the saved setups that hold a copy of a piece', () => {
    const other: SavedSetup = { id: 'id-2', name: 'Two', spec: twoPieces, savedAt: 2 };
    expect(usesPiece(twoPieces, 'wazir')).toBe(true);
    expect(usesPiece(spec, 'wazir')).toBe(false);
    expect(setupsUsingPiece([saved, other], 'rider')).toEqual([other]);
    expect(setupsUsingPiece([saved, other], 'nope')).toEqual([]);
  });
});
