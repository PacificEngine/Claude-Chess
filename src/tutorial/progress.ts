// What the player has done in the tutorial: finished lessons, and the solved puzzles of each lesson. Pure
// logic: no DOM or UI imports. src/persistence/tutorial.ts keeps this record under chess.tutorial.

export interface TutorialProgress {
  isFinished(lessonId: string): boolean;
  /** The indexes of the lesson's solved puzzles, sorted. */
  solved(lessonId: string): number[];
  /** Records a solved puzzle; the lesson is finished once every index in 0..puzzleCount-1 is solved. */
  markSolved(lessonId: string, index: number, puzzleCount: number): void;
  markFinished(lessonId: string): void;
}

/** The record as it is stored: finished lesson and variant-page ids, and each lesson's solved puzzle indexes. */
export interface ProgressData {
  finished: string[];
  solved: Record<string, number[]>;
}

/** A progress record starting from `initial`; `changed` gets the whole record after every change. */
export function createMemoryProgress(
  initial: ProgressData = { finished: [], solved: {} },
  changed: (data: ProgressData) => void = () => {},
): TutorialProgress {
  const finished = new Set<string>(initial.finished);
  const solved = new Map<string, Set<number>>(Object.entries(initial.solved).map(([id, list]) => [id, new Set(list)]));
  const sortedSolved = (id: string) => [...(solved.get(id) ?? [])].sort((a, b) => a - b);
  const report = () =>
    changed({ finished: [...finished], solved: Object.fromEntries([...solved.keys()].map((id) => [id, sortedSolved(id)])) });
  return {
    isFinished: (id) => finished.has(id),
    solved: sortedSolved,
    markSolved(id, index, puzzleCount) {
      const set = solved.get(id) ?? new Set<number>();
      set.add(index);
      solved.set(id, set);
      if (Array.from({ length: puzzleCount }, (_, i) => i).every((i) => set.has(i))) finished.add(id);
      report();
    },
    markFinished(id) {
      finished.add(id);
      report();
    },
  };
}
