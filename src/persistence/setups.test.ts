import { beforeEach, describe, expect, it } from 'vitest';
import type { SetupSpec } from '../variants/setup';
import { loadSetups, type SavedSetup, saveSetups, SETUPS_VERSION } from './setups';
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
