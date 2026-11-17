import { describe, expect, it } from 'vitest';
import { createMemoryProgress } from './progress';

describe('createMemoryProgress', () => {
  it('starts with nothing solved or finished', () => {
    const progress = createMemoryProgress();
    expect(progress.isFinished('rook')).toBe(false);
    expect(progress.solved('rook')).toEqual([]);
  });

  it('records solved puzzles once each, sorted, per lesson', () => {
    const progress = createMemoryProgress();
    progress.markSolved('rook', 2, 4);
    progress.markSolved('rook', 0, 4);
    progress.markSolved('rook', 2, 4);
    expect(progress.solved('rook')).toEqual([0, 2]);
    expect(progress.solved('bishop')).toEqual([]);
    expect(progress.isFinished('rook')).toBe(false);
  });

  it('finishes a lesson once every puzzle is solved', () => {
    const progress = createMemoryProgress();
    progress.markSolved('rook', 1, 2);
    progress.markSolved('rook', 0, 2);
    expect(progress.isFinished('rook')).toBe(true);
  });

  it('finishes a lesson when told to', () => {
    const progress = createMemoryProgress();
    progress.markFinished('chess');
    expect(progress.isFinished('chess')).toBe(true);
  });

  it('hands out copies, so a caller cannot change the record', () => {
    const progress = createMemoryProgress();
    progress.markSolved('rook', 0, 2);
    progress.solved('rook').push(1);
    expect(progress.solved('rook')).toEqual([0]);
  });
});
