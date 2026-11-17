import { describe, expect, it } from 'vitest';
import { isLesson, isVariantPage, type Lesson, type VariantPage } from './lesson';

const board = { variant: 'chess', fen: '4k3/8/8/8/3R4/8/8/4K3 w - - 0 1' } as const;
const lesson: Lesson = {
  id: 'rook',
  track: 'basics',
  order: 1,
  title: 'The rook',
  cards: [{ track: 'basics', name: 'Rook' }],
  teaches: [{ type: 'rook' }, { variant: 'shako', letter: 'r' }],
  steps: [
    { kind: 'see', title: 'See it', text: 'It slides.', board, square: 'd4' },
    { kind: 'try', title: 'Try it', text: 'Move it.', board, square: 'd4', targets: ['d8'] },
    { kind: 'read', title: 'Strategy', pages: [{ text: 'Open files.', board, square: 'd4', arrows: [['d4', 'd8']] }] },
    {
      kind: 'puzzles',
      title: 'Puzzles',
      puzzles: [
        {
          prompt: 'Mate.',
          board: { setup: { base: 'chess', files: 8, ranks: 8, pieces: {}, fen: '8/8/8/8/8/8/8/8 w - - 0 1', castling: false, promotion: { rank: 'last', pieceTypes: [] } } },
          goal: { kind: 'reach', from: 'd4', to: 'd8' },
          moves: 1,
          line: ['d4d8'],
          hint: 'Up.',
        },
      ],
    },
  ],
};

describe('isLesson', () => {
  it('accepts a lesson of every step kind', () => {
    expect(isLesson(lesson)).toBe(true);
  });

  it("accepts a card's own order, which may sit between two lessons' orders, and rejects one that isn't a number", () => {
    expect(isLesson({ ...lesson, cards: [{ track: 'fairy', name: 'Commoner', order: 2.5 }] })).toBe(true);
    expect(isLesson({ ...lesson, cards: [{ track: 'fairy', name: 'Commoner', order: '3' }] })).toBe(false);
    expect(isLesson({ ...lesson, cards: [{ track: 'fairy', name: 'Commoner', order: Number.NaN }] })).toBe(false);
  });

  it('rejects broken shapes', () => {
    expect(isLesson(null)).toBe(false);
    expect(isLesson({ ...lesson, track: 'other' })).toBe(false);
    expect(isLesson({ ...lesson, cards: [{ track: 'basics' }] })).toBe(false);
    expect(isLesson({ ...lesson, teaches: [{ letter: 'r' }] })).toBe(false);
    expect(isLesson({ ...lesson, steps: [{ kind: 'see', title: 'Try it', text: '', board, square: 'd4' }] })).toBe(false);
    expect(isLesson({ ...lesson, steps: [{ kind: 'try', title: 'Try it', text: '', board, square: 'd4' }] })).toBe(false);
    expect(isLesson({ ...lesson, steps: [{ kind: 'see', title: 'See it', text: '', board: { fen: '' }, square: 'd4' }] })).toBe(false);
    const puzzles = lesson.steps[3];
    if (puzzles.kind !== 'puzzles') throw new Error('expected puzzles');
    const withPuzzle = (p: object) => ({ ...lesson, steps: [{ ...puzzles, puzzles: [{ ...puzzles.puzzles[0], ...p }] }] });
    expect(isLesson(withPuzzle({ moves: 3 }))).toBe(false);
    expect(isLesson(withPuzzle({ goal: { kind: 'capture' } }))).toBe(false);
    expect(isLesson(withPuzzle({ goal: { kind: 'fly' } }))).toBe(false);
    expect(isLesson(withPuzzle({ line: 'd4d8' }))).toBe(false);
  });
});

describe('isVariantPage', () => {
  const page: VariantPage = { id: 'shako', variant: 'shako', order: 2, differences: ['Cannons.'] };

  it('accepts a variant page', () => {
    expect(isVariantPage(page)).toBe(true);
  });

  it('rejects broken shapes', () => {
    expect(isVariantPage({ ...page, variant: 'nope' })).toBe(false);
    expect(isVariantPage({ ...page, differences: [1] })).toBe(false);
    expect(isVariantPage({ ...page, order: '2' })).toBe(false);
  });
});
