import { beforeEach, describe, expect, it } from 'vitest';
import { createStore, DEFAULT_SETTINGS, isSettings, SETTINGS_VERSION, type Store } from './store';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
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

function isRecord(d: unknown): d is Record<string, unknown> {
  return typeof d === 'object' && d !== null;
}
const isState = (d: unknown): d is { moves: string[] } => isRecord(d) && Array.isArray(d.moves);
const isSettingsV2 = (d: unknown): d is { highlightLegal: boolean } =>
  isRecord(d) && typeof d.highlightLegal === 'boolean';

let mem: MemoryStorage;
let store: Store;
beforeEach(() => {
  mem = new MemoryStorage();
  store = createStore(mem);
});

describe('store', () => {
  it('moves unreadable saved data aside instead of crashing, and reports it', () => {
    mem.setItem('chess.game', '{not json');
    expect(store.load('chess.game', 1, {}, isState)).toEqual({ data: null, problem: 'corrupt' });
    expect(mem.getItem('chess.game.corrupt')).toBe('{not json');
    expect(mem.getItem('chess.game')).toBeNull();
  });

  it('runs migrations from an older version', () => {
    mem.setItem('chess.settings', JSON.stringify({ version: 1, data: { highlight: true } }));
    const migrate = (o: unknown): unknown => ({ highlightLegal: isRecord(o) ? o.highlight : undefined });
    expect(store.load('chess.settings', 2, { 1: migrate }, isSettingsV2).data).toEqual({ highlightLegal: true });
  });

  it('treats a missing migration step as corrupt', () => {
    mem.setItem('chess.settings', JSON.stringify({ version: 1, data: {} }));
    expect(store.load('chess.settings', 2, {}, isSettingsV2).problem).toBe('corrupt');
  });

  it('treats an unknown future version as corrupt rather than guessing', () => {
    mem.setItem('chess.settings', JSON.stringify({ version: 99, data: {} }));
    expect(store.load('chess.settings', 2, {}, isSettingsV2).problem).toBe('corrupt');
    expect(mem.getItem('chess.settings.corrupt')).not.toBeNull();
  });

  it('treats a wrong envelope shape or failed validation as corrupt', () => {
    mem.setItem('chess.game', JSON.stringify({ nope: 1 }));
    expect(store.load('chess.game', 1, {}, isState).problem).toBe('corrupt');
    mem.setItem('chess.game', JSON.stringify({ version: 1, data: { moves: 'x' } }));
    expect(store.load('chess.game', 1, {}, isState).problem).toBe('corrupt');
  });

  it('returns no data and no problem when nothing is saved', () => {
    expect(store.load('chess.game', 1, {}, isState)).toEqual({ data: null, problem: null });
  });

  it('round-trips saved data', () => {
    expect(store.save('chess.game', 1, { moves: ['e4'] })).toBe(true);
    expect(store.load('chess.game', 1, {}, isState)).toEqual({ data: { moves: ['e4'] }, problem: null });
  });

  it('reports unavailable storage so the UI can warn that progress will not save', () => {
    const none = createStore(null);
    expect(none.available).toBe(false);
    expect(none.load('chess.game', 1, {}, isState)).toEqual({ data: null, problem: null });
    expect(none.save('chess.game', 1, {})).toBe(false);
  });

  it('treats storage that throws on access as unavailable', () => {
    const hostile = new MemoryStorage();
    hostile.getItem = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    hostile.setItem = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    const s = createStore(hostile);
    expect(s.available).toBe(false);
    expect(s.save('chess.game', 1, {})).toBe(false);
  });

  it('returns false when the quota is exceeded', () => {
    const full = new MemoryStorage();
    const real = full.setItem.bind(full);
    full.setItem = (k, v) => {
      if (k.startsWith('chess.')) throw new DOMException('full', 'QuotaExceededError');
      real(k, v);
    };
    expect(createStore(full).save('chess.game', 1, { moves: [] })).toBe(false);
  });
});

describe('settings', () => {
  it('has defaults that satisfy the guard', () => {
    expect(SETTINGS_VERSION).toBe(1);
    expect(DEFAULT_SETTINGS).toEqual({ highlightLegal: true, boardTheme: 'brown', pieceSet: 'default', sound: true });
    expect(isSettings(DEFAULT_SETTINGS)).toBe(true);
  });
  it('rejects malformed settings', () => {
    expect(isSettings({ ...DEFAULT_SETTINGS, sound: 'yes' })).toBe(false);
    expect(isSettings(null)).toBe(false);
    expect(isSettings({})).toBe(false);
  });
});
