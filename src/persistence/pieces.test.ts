import { beforeEach, describe, expect, it } from 'vitest';
import { type DesignedPiece, loadPieces, PIECES_VERSION, savePieces } from './pieces';
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

const piece: DesignedPiece = { id: 'p-1', name: 'My <i>knight</i>', letter: 'j', betza: 'NW', art: 'merida/N', savedAt: 1 };
const noArt: DesignedPiece = { id: 'p-2', name: 'Plain', letter: 'z', betza: 'R', art: null, savedAt: 2 };

let mem: MemoryStorage;
let store: Store;
beforeEach(() => {
  mem = new MemoryStorage();
  store = createStore(mem);
});

describe('designed pieces', () => {
  it('starts empty when nothing is stored', () => expect(loadPieces(store)).toEqual({ pieces: [], problem: null }));

  it('round-trips designed pieces under chess.pieces with a version', () => {
    expect(savePieces(store, [piece, noArt])).toBe(true);
    expect(JSON.parse(mem.getItem('chess.pieces')!)).toEqual({ version: PIECES_VERSION, data: [piece, noArt] });
    expect(loadPieces(store)).toEqual({ pieces: [piece, noArt], problem: null });
  });

  it('keeps a malformed piece library from crashing the app', () => {
    mem.setItem('chess.pieces', '{"version":1,"data":[{"id":"x","name":3}]}');
    expect(loadPieces(store)).toEqual({ pieces: [], problem: 'corrupt' });
    expect(mem.getItem('chess.pieces.corrupt')).toContain('"id":"x"');
    mem.setItem('chess.pieces', 'not json');
    expect(loadPieces(store)).toEqual({ pieces: [], problem: 'corrupt' });
  });

  it.each([
    ['empty id', { ...piece, id: '' }],
    ['empty name', { ...piece, name: '' }],
    ['31-char name', { ...piece, name: 'x'.repeat(31) }],
    ['uppercase letter', { ...piece, letter: 'J' }],
    ['two-char letter', { ...piece, letter: 'jj' }],
    ['numeric betza', { ...piece, betza: 5 }],
    ['undefined art', { ...piece, art: undefined }],
    ['non-finite savedAt', { ...piece, savedAt: null }],
  ])('treats a piece with %s as corrupt', (_n, bad) => {
    mem.setItem('chess.pieces', JSON.stringify({ version: PIECES_VERSION, data: [bad] }));
    expect(loadPieces(store).problem).toBe('corrupt');
  });

  it('accepts a 30-char name', () => {
    const p = { ...piece, name: 'x'.repeat(30) };
    savePieces(store, [p]);
    expect(loadPieces(store).pieces).toEqual([p]);
  });
});
