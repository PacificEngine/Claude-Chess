// Tutorial progress under chess.tutorial: finished lessons and variant pages, and each lesson's solved
// puzzles. No DOM or UI imports.
import { createMemoryProgress, type ProgressData, type TutorialProgress } from '../tutorial/progress';
import type { Store } from './store';

export const TUTORIAL_VERSION = 1;

const isRecord = (d: unknown): d is Record<string, unknown> => typeof d === 'object' && d !== null && !Array.isArray(d);
const isIndexList = (d: unknown): d is number[] => Array.isArray(d) && d.every((i) => Number.isInteger(i) && i >= 0);

function isProgressData(d: unknown): d is ProgressData {
  return (
    isRecord(d) &&
    Array.isArray(d.finished) &&
    d.finished.every((id) => typeof id === 'string') &&
    isRecord(d.solved) &&
    Object.values(d.solved).every(isIndexList)
  );
}

/**
 * The stored progress, saved again after every change. A value that fails validation is moved aside to
 * chess.tutorial.corrupt by the store, so the tutorial starts with nothing done. `saveFailed` is called when the
 * browser refuses a save; the change still holds for this visit.
 */
export function loadTutorialProgress(
  store: Store,
  saveFailed: () => void = () => {},
): { progress: TutorialProgress; problem: 'corrupt' | null } {
  const loaded = store.load('chess.tutorial', TUTORIAL_VERSION, {}, isProgressData);
  const progress = createMemoryProgress(loaded.data ?? undefined, (data) => {
    if (!store.save('chess.tutorial', TUTORIAL_VERSION, data)) saveFailed();
  });
  return { progress, problem: loaded.problem };
}
