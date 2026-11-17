import { beforeEach, describe, expect, it } from 'vitest';
import { createStore, type Store } from './store';
import { loadTutorialProgress, TUTORIAL_VERSION } from './tutorial';

class MemoryStorage implements Storage {
  map = new Map<string, string>();
  failWrites = false;
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
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.map.set(key, value);
  }
}

let mem: MemoryStorage;
let store: Store;
beforeEach(() => {
  mem = new MemoryStorage();
  store = createStore(mem);
});

const stored = () => JSON.parse(mem.getItem('chess.tutorial')!);

describe('tutorial progress', () => {
  it('starts empty when nothing is stored', () => {
    const { progress, problem } = loadTutorialProgress(store);
    expect(problem).toBeNull();
    expect(progress.isFinished('rook')).toBe(false);
    expect(progress.solved('rook')).toEqual([]);
  });

  it('round-trips solved puzzles and finished lessons through chess.tutorial', () => {
    const first = loadTutorialProgress(store).progress;
    first.markSolved('rook', 2, 4);
    first.markSolved('rook', 0, 4);
    first.markFinished('variant-chess');
    expect(stored()).toEqual({ version: TUTORIAL_VERSION, data: { finished: ['variant-chess'], solved: { rook: [0, 2] } } });
    const again = loadTutorialProgress(store);
    expect(again.problem).toBeNull();
    expect(again.progress.solved('rook')).toEqual([0, 2]);
    expect(again.progress.isFinished('rook')).toBe(false);
    expect(again.progress.isFinished('variant-chess')).toBe(true);
  });

  it('finishes a lesson when its last puzzle is solved, and keeps that over a reload', () => {
    const progress = loadTutorialProgress(store).progress;
    progress.markSolved('promotion', 0, 1);
    expect(progress.isFinished('promotion')).toBe(true);
    expect(loadTutorialProgress(store).progress.isFinished('promotion')).toBe(true);
  });

  it.each([
    ['unparseable JSON', '{not json'],
    ['a missing field', JSON.stringify({ version: 1, data: { finished: [] } })],
    ['a non-string finished id', JSON.stringify({ version: 1, data: { finished: [3], solved: {} } })],
    ['a puzzle index that is not a whole number', JSON.stringify({ version: 1, data: { finished: [], solved: { rook: [0.5] } } })],
    ['a negative puzzle index', JSON.stringify({ version: 1, data: { finished: [], solved: { rook: [-1] } } })],
    ['solved as a list', JSON.stringify({ version: 1, data: { finished: [], solved: [[0]] } })],
    ['a newer version', JSON.stringify({ version: 2, data: { finished: [], solved: {} } })],
  ])('treats %s as corrupt: moved aside, and the progress starts empty', (_, raw) => {
    mem.setItem('chess.tutorial', raw);
    const { progress, problem } = loadTutorialProgress(store);
    expect(problem).toBe('corrupt');
    expect(progress.isFinished('rook')).toBe(false);
    expect(progress.solved('rook')).toEqual([]);
    expect(mem.getItem('chess.tutorial.corrupt')).toBe(raw);
    expect(mem.getItem('chess.tutorial')).toBeNull();
  });

  it('says when the browser refuses to store a change, and keeps it for this visit', () => {
    let failures = 0;
    const { progress } = loadTutorialProgress(store, () => failures++);
    mem.failWrites = true;
    progress.markSolved('rook', 0, 4);
    expect(failures).toBe(1);
    expect(progress.solved('rook')).toEqual([0]);
  });
});
