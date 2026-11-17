// The puzzle search behind `yarn tutorial:search`: what it finds must pass the content check's puzzle rules.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestRules } from '../rules/test-rules';
import type { Rules } from '../rules/types';
import { generateVariant } from '../variants/generator';
import type { SetupSpec } from '../variants/setup';
import { checkLesson, isPlaceholderProblem } from './check';
import { boardFen, type Lesson, type Puzzle, type Teaches } from './lesson';
import { searchPuzzles } from './search';

let rules: Rules;
beforeAll(async () => {
  rules = await loadTestRules();
});

const register = (spec: SetupSpec): string => {
  const { name, ini } = generateVariant(spec);
  if (!rules.knows(name)) rules.loadConfig(ini);
  return name;
};

/** The content check's problems for one puzzle in a lesson teaching `type`, leaving out the lesson-shape and placeholder ones. */
const puzzleProblems = (puzzle: Puzzle, type: string | Teaches = 'rook'): string[] => {
  const lesson: Lesson = {
    id: 't',
    track: 'basics',
    order: 1,
    title: 'T',
    cards: [],
    teaches: [typeof type === 'string' ? { type } : type],
    steps: [{ kind: 'puzzles', title: 'Puzzles', puzzles: [puzzle] }],
  };
  // The search leaves the hint as a TODO for the author to write.
  return checkLesson(rules, lesson, register).filter((p) => p.startsWith('t step') && !isPlaceholderProblem(p));
};

describe('searchPuzzles', () => {
  it('finds rook mates in one that pass the puzzle rules', () => {
    const found = searchPuzzles(rules, { piece: 'rook', goal: 'mate1', count: 2, seed: 1 });
    expect(found).toHaveLength(2);
    for (const puzzle of found) {
      expect(puzzle.moves).toBe(1);
      expect(puzzle.goal).toEqual({ kind: 'mate' });
      expect(puzzleProblems(puzzle)).toEqual([]);
    }
  });

  it('finds a wazir mate in two, whose first move does not already mate', () => {
    // Bounded by tries, not time, so a loaded machine can't change the result: seed 1 finds one within 1000 tries.
    const found = searchPuzzles(rules, { piece: 'wazir', goal: 'mate2', count: 1, seed: 1, maxTries: 1000 });
    expect(found).toHaveLength(1);
    const [puzzle] = found;
    expect(puzzle!.line).toHaveLength(3);
    expect(puzzleProblems(puzzle!, 'wazir')).toEqual([]);
  }, 30_000);

  it('gives the same puzzles for the same seed', () => {
    const a = searchPuzzles(rules, { piece: 'rook', goal: 'mate1', count: 1, seed: 7 });
    const b = searchPuzzles(rules, { piece: 'rook', goal: 'mate1', count: 1, seed: 7 });
    expect(a).toEqual(b);
  });

  // Xiangqi confines its general, advisors, elephants and soldiers, which Fairy-Stockfish's FEN check doesn't
  // know, so the search must place them where the game allows or every position fails the content check.
  for (const [letter, goal] of [['p', 'capture1'], ['a', 'capture1'], ['k', 'capture1']] as const)
    it(`finds a Xiangqi ${letter} ${goal} on a board the game allows`, () => {
      const found = searchPuzzles(rules, { piece: `xiangqi:${letter}`, goal, count: 1, seed: 1, maxTries: 3000 });
      expect(found).toHaveLength(1);
      expect(puzzleProblems(found[0]!, { variant: 'xiangqi', letter })).toEqual([]);
    }, 30_000);

  it('uses only the extra letters it is given', () => {
    const found = searchPuzzles(rules, { piece: 'xiangqi:p', goal: 'capture1', count: 3, seed: 2, maxTries: 3000, extras: ['r'] });
    expect(found.length).toBeGreaterThan(0);
    for (const puzzle of found) expect(boardFen(puzzle.board).split(' ')[0].replace(/[\d/kKpPrR]/g, '')).toBe('');
  }, 30_000);
});
