// The content check, run on every lesson that ships, plus the loader and the check's own failure reports.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestRules } from '../rules/test-rules';
import type { Rules } from '../rules/types';
import { curatedActive, variantTypes } from '../variants/active';
import { CURATED_VARIANTS } from '../variants/catalog';
import { generateVariant } from '../variants/generator';
import { BUILTIN_PIECES, INHERITED } from '../variants/piece-types';
import type { SetupSpec } from '../variants/setup';
import { checkLesson, checkVariantPage, isPlaceholderProblem } from './check';
import { cardsByTrack, cardsOf, LESSONS, lessonById, loadContent, nextLessonOf, VARIANT_PAGES } from './content';
import type { Lesson, Puzzle, Step, Teaches, VariantPage } from './lesson';
import { lessonFor, lessonForType } from './links';

let rules: Rules;
beforeAll(async () => {
  rules = await loadTestRules();
});

const register = (spec: SetupSpec): string => {
  const { name, ini } = generateVariant(spec);
  if (!rules.knows(name)) rules.loadConfig(ini);
  return name;
};

describe('the content check', () => {
  for (const lesson of LESSONS) it(`${lesson.id} is sound`, () => expect(checkLesson(rules, lesson, register)).toEqual([]));

  it('has the rook lesson', () => expect(lessonById('rook')?.title).toBeDefined());

  for (const page of VARIANT_PAGES) it(`${page.id} has no placeholder text`, () => expect(checkVariantPage(page)).toEqual([]));

  for (const page of VARIANT_PAGES) it(`${page.id} is the only page for ${page.variant}`, () => {
    expect(VARIANT_PAGES.filter((p) => p.variant === page.variant)).toHaveLength(1);
  });

  it('has a page for every curated variant, in the catalog order, each saying how it differs in 2 to 4 sentences', () => {
    expect(cardsByTrack('variants').map((c) => c.lessonId)).toEqual(CURATED_VARIANTS.map((v) => `variant-${v.id}`));
    for (const page of VARIANT_PAGES) expect(page.differences.length, page.id).toBeGreaterThanOrEqual(2);
    for (const page of VARIANT_PAGES) expect(page.differences.length, page.id).toBeLessThanOrEqual(4);
  });

  it('points beginners from the chess page to the Chess basics lessons', () =>
    expect(VARIANT_PAGES.find((p) => p.variant === 'chess')?.differences.join(' ')).toMatch(/Chess basics/));
});

// Every piece the player can meet opens a lesson, and no piece is taught twice.
describe('coverage', () => {
  const key = (t: Teaches): string => ('type' in t ? `type ${t.type}` : `${t.variant} ${t.letter}`);
  const teachers = (t: Teaches): string[] => LESSONS.filter((l) => l.teaches.some((x) => key(x) === key(t))).map((l) => l.id);

  it('teaches each type, and each variant letter, in one lesson only', () => {
    const keys = LESSONS.flatMap((l) => l.teaches.map(key));
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });

  it('gives every built-in piece type exactly one lesson', () => {
    for (const { type } of BUILTIN_PIECES) {
      expect(teachers({ type }), type).toHaveLength(1);
      expect(lessonForType(type), type).toBe(teachers({ type })[0]);
    }
  });

  // variantTypes is shared with the content check above, so each board size is probed once in this file.
  for (const { id } of CURATED_VARIANTS)
    it(`gives every ${id} start-position letter, on the board and in hand, exactly one lesson`, () => {
      const v = curatedActive(id, rules);
      const types = variantTypes(rules, v.engineName);
      expect(v.letters.length, id).toBeGreaterThan(0);
      for (const letter of v.letters) {
        const type = types.get(letter);
        const teaches: Teaches = type === INHERITED ? { variant: id, letter } : { type: type! };
        expect(teachers(teaches), `${id} ${letter} (${type})`).toHaveLength(1);
        expect(lessonFor(v, letter, types), `${id} ${letter}`).toBe(teachers(teaches)[0]);
      }
    });
});

// A small sound piece lesson of its own, so these tests don't depend on how rook.json is written.
const KINGS = { variant: 'chess', fen: '7k/8/8/8/3R4/8/8/K7 w - - 0 1' } as const;
const MATE_IN_1: Puzzle = {
  prompt: 'Mate.',
  board: { variant: 'chess', fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1' },
  goal: { kind: 'mate' },
  moves: 1,
  line: ['a1a8'],
  hint: 'The back rank.',
};
const LESSON: Lesson = {
  id: 'test-rook',
  track: 'basics',
  order: 1,
  title: 'The rook',
  cards: [{ track: 'basics', name: 'Rook' }],
  teaches: [{ type: 'rook' }],
  steps: [
    { kind: 'see', title: 'See it', text: '', board: KINGS, square: 'd4' },
    { kind: 'try', title: 'Try it', text: '', board: KINGS, square: 'd4', targets: ['b6', 'g2'] },
    { kind: 'read', title: 'Strategy', pages: [{ text: '', board: KINGS, square: 'd4', arrows: [['d4', 'd7']] }] },
    { kind: 'puzzles', title: 'Puzzles', puzzles: [MATE_IN_1] },
  ],
};

const withStep = (index: number, step: Step): Lesson => ({ ...LESSON, steps: LESSON.steps.map((s, i) => (i === index ? step : s)) });
const withPuzzle = (puzzle: Puzzle): Lesson => withStep(3, { kind: 'puzzles', title: 'Puzzles', puzzles: [puzzle] });
const problems = (lesson: Lesson) => checkLesson(rules, lesson, register);

describe('checkLesson', () => {
  it('passes a sound lesson', () => expect(problems(LESSON)).toEqual([]));

  it('reports a puzzle with a second solution', () => {
    const twoRooks = { ...MATE_IN_1, board: { variant: 'chess', fen: '6k1/5ppp/8/8/8/8/8/R2R2K1 w - - 0 1' } } as const;
    expect(problems(withPuzzle(twoRooks))).toEqual([expect.stringMatching(/another first move.*d1d8/)]);
  });

  it('reports a first move that does not force the goal', () => {
    expect(problems(withPuzzle({ ...MATE_IN_1, line: ['a1a7'] }))).toEqual([
      expect.stringMatching(/a1a7 does not force the goal/),
      expect.stringMatching(/another first move.*a1a8/),
    ]);
  });

  it('reports an illegal board and an unreachable target', () => {
    const noBlackKing = { variant: 'chess', fen: '8/8/8/8/3R4/8/8/K7 w - - 0 1' } as const;
    const lesson = withStep(1, { kind: 'try', title: 'Try it', text: '', board: KINGS, square: 'd4', targets: ['d8'] });
    expect(problems(withStep(0, { kind: 'see', title: 'See it', text: '', board: noBlackKing, square: 'd4' }))).toEqual([
      expect.stringMatching(/step 1 .*Black needs a king/),
    ]);
    expect(problems(lesson)).toEqual([expect.stringMatching(/step 2 .*d8 can't be reached/)]);
  });

  it('reports a puzzle with Black to move, and a try step with no targets', () => {
    const blackToMove = { ...MATE_IN_1, board: { variant: 'chess', fen: '6k1/5ppp/8/8/8/8/8/R5K1 b - - 0 1' } } as const;
    expect(problems(withPuzzle(blackToMove))).toContainEqual(expect.stringMatching(/puzzle 1: White must be the side to move/));
    expect(problems(withStep(1, { kind: 'try', title: 'Try it', text: '', board: KINGS, square: 'd4', targets: [] }))).toEqual([
      expect.stringMatching(/step 2 .*no targets/),
    ]);
  });

  it('reports a see square without a White piece that can move', () => {
    const boxedIn = { variant: 'chess', fen: '7k/8/8/8/8/8/PPP5/KB6 w - - 0 1' } as const;
    const see = (board: typeof KINGS | typeof boxedIn, square: string): Step => ({ kind: 'see', title: 'See it', text: '', board, square });
    expect(problems(withStep(0, see(KINGS, 'h8')))).toEqual([expect.stringMatching(/no White piece on h8/)]);
    expect(problems(withStep(0, see(boxedIn, 'b1')))).toEqual([expect.stringMatching(/piece on b1 has no move/)]);
  });

  it('reports an arrow that is not a legal move', () => {
    const page = { text: '', board: KINGS, arrows: [['d4', 'e5']] as [string, string][] };
    expect(problems(withStep(2, { kind: 'read', title: 'Strategy', pages: [page] }))).toEqual([
      expect.stringMatching(/arrow d4-e5 is not a legal move/),
    ]);
  });

  it('reports a wrong line length, an illegal reply and a last move that misses the goal', () => {
    // Kg6 is the only mate in two: then Kg8 is forced, and Ra8 mates.
    const mateIn2: Puzzle = { ...MATE_IN_1, board: { variant: 'chess', fen: '7k/R7/5K2/8/8/8/8/8 w - - 0 1' }, moves: 2, line: ['f6g6', 'h8g8', 'a7a8'] };
    const lesson = (puzzle: Puzzle) => ({ ...withPuzzle(puzzle), teaches: [] as Lesson['teaches'], steps: [CONCEPT_READ, puzzleStep(puzzle)] });
    expect(problems(lesson(mateIn2))).toEqual([]);
    expect(problems(lesson({ ...mateIn2, line: ['f6g6', 'h8g8'] }))).toEqual([expect.stringMatching(/line has 2 moves, not 3/)]);
    expect(problems(lesson({ ...mateIn2, line: ['f6g6', 'h8h7', 'a7a8'] }))).toEqual([expect.stringMatching(/h8h7 is not legal/)]);
    expect(problems(lesson({ ...mateIn2, line: ['f6g6', 'h8g8', 'a7b7'] }))).toEqual([expect.stringMatching(/a7b7 does not meet the goal/)]);
  });

  it('reports a two-move puzzle whose first move already meets the goal', () => {
    const early: Puzzle = { ...MATE_IN_1, moves: 2, line: ['a1a8', 'g8g8', 'a8a7'] };
    expect(problems(withPuzzle(early))).toContainEqual(expect.stringMatching(/a1a8 already meets the goal/));
  });

  it('reports a key move not made by the taught piece', () => {
    const kingMove: Puzzle = { ...MATE_IN_1, board: { variant: 'chess', fen: '7k/R7/5K2/8/8/8/8/8 w - - 0 1' }, moves: 2, line: ['f6g6', 'h8g8', 'a7a8'] };
    expect(problems(withPuzzle(kingMove))).toEqual([expect.stringMatching(/f6g6 is not made by the taught piece/)]);
  });

  it('reports a written reply that is illegal after a sibling key', () => {
    // f8=Q mates at once, so it forces the goal and has the key's squares, but Kg7 can't follow it.
    const promotion: Puzzle = {
      ...MATE_IN_1,
      board: { variant: 'chess', fen: SIBLING_FEN },
      moves: 2,
      line: ['f7f8r', 'h8g7', 'f8f7'],
    };
    expect(problems({ ...LESSON, teaches: [], steps: [CONCEPT_READ, puzzleStep(promotion)] })).toContainEqual(
      expect.stringMatching(/reply h8g7 is not legal after f7f8q/),
    );
  });

  it('reports a capture puzzle on a rook that may castle', () => {
    // Black's rook on h8 can castle, and a castling rook isn't followed, so the goal could be dropped unseen.
    const capture: Puzzle = {
      ...MATE_IN_1,
      board: { variant: 'chess', fen: '4k2r/8/8/8/8/8/8/R3K3 w k - 0 1' },
      goal: { kind: 'capture', square: 'h8' },
      line: ['a1a8'],
    };
    expect(problems(withPuzzle(capture))).toContainEqual(expect.stringMatching(/castling rights/));
  });

  it('reports a capture goal whose square holds no Black piece', () => {
    const capture: Puzzle = { ...MATE_IN_1, goal: { kind: 'capture', square: 'g1' }, line: ['a1a8'] };
    expect(problems(withPuzzle(capture))).toContainEqual(expect.stringMatching(/capture goal's piece on g1 is White/));
  });

  it('reports a promote or en passant goal on a board not based on chess', () => {
    // The goals find a promotion by its SAN and en passant by the chess pawn, so other bases can't be judged.
    const promote: Puzzle = { ...MATE_IN_1, board: { variant: 'capablanca', fen: '4k5/P9/10/10/10/10/10/4K5 w - - 0 1' }, goal: { kind: 'promote' }, line: ['a7a8q'] };
    const enPassant: Puzzle = { ...MATE_IN_1, board: { variant: 'capablanca', fen: '4k5/10/10/1Pp7/10/10/10/4K5 w - c6 0 1' }, goal: { kind: 'enPassant' }, line: ['b5c6'] };
    const concept = (puzzle: Puzzle): Lesson => ({ ...LESSON, teaches: [], steps: [CONCEPT_READ, puzzleStep(puzzle)] });
    expect(problems(concept(promote))).toContainEqual(expect.stringMatching(/a promote goal needs a board based on chess/));
    expect(problems(concept(enPassant))).toContainEqual(expect.stringMatching(/an enPassant goal needs a board based on chess/));
    // The same goals on a chess board are fine.
    const chessPromote: Puzzle = { ...promote, board: { variant: 'chess', fen: '4k3/P7/8/8/8/8/8/4K3 w - - 0 1' } };
    expect(problems(concept(chessPromote)).filter((p) => /based on chess/.test(p))).toEqual([]);
  });

  it('checks a setup board through register', () => {
    const setup: SetupSpec = {
      base: 'chess',
      files: 6,
      ranks: 6,
      pieces: { k: 'king', r: 'rook', p: 'pawn', n: 'knight' },
      fen: '5k/6/6/2R3/6/K5 w - - 0 1',
      castling: false,
      promotion: { rank: 'last', pieceTypes: ['r'] },
    };
    const see: Step = { kind: 'see', title: 'See it', text: '', board: { setup }, square: 'c3' };
    expect(problems(withStep(0, see))).toEqual([]);
    expect(problems(withStep(0, { ...see, square: 'a1' }))).toEqual([]);
    expect(problems(withStep(0, { ...see, board: { setup: { ...setup, files: 99 } } }))).toEqual([
      expect.stringMatching(/step 1 .*Files must be/),
    ]);
  });
});

/** A promotion square where f8=Q mates and the other promotions give check. */
const SIBLING_FEN = '7k/5P1p/8/8/8/8/8/6K1 w - - 0 1';
const CONCEPT_READ: Step = { kind: 'read', title: 'Learn', pages: [{ text: 'Checkmate wins.' }] };
const puzzleStep = (puzzle: Puzzle): Step => ({ kind: 'puzzles', title: 'Puzzles', puzzles: [puzzle] });

describe('the lesson shape check', () => {
  it('reports a piece lesson without its four steps in order', () => {
    expect(problems({ ...LESSON, steps: [LESSON.steps[0], LESSON.steps[2], LESSON.steps[1], LESSON.steps[3]] })).toEqual([
      expect.stringMatching(/piece lesson's steps must be see, try, read \(Strategy\), puzzles/),
    ]);
  });

  it('reports a piece lesson whose read step is not titled Strategy', () => {
    expect(problems(withStep(2, { kind: 'read', title: 'Learn', pages: [{ text: '' }] }))).toEqual([
      expect.stringMatching(/piece lesson's steps/),
    ]);
  });

  it('passes a concept lesson, and reports one shaped like a piece lesson', () => {
    const concept: Lesson = { ...LESSON, teaches: [], steps: [CONCEPT_READ, puzzleStep(MATE_IN_1)] };
    expect(problems(concept)).toEqual([]);
    expect(problems({ ...concept, steps: [{ ...CONCEPT_READ, title: 'Strategy' }, puzzleStep(MATE_IN_1)] })).toEqual([
      expect.stringMatching(/concept lesson's steps must be read \(Learn\), puzzles/),
    ]);
  });

  it('reports an empty puzzles step', () => {
    expect(problems(withStep(3, { kind: 'puzzles', title: 'Puzzles', puzzles: [] }))).toEqual([
      expect.stringMatching(/no puzzles/),
    ]);
  });
});

// The puzzle search writes TODO where a person must write the text, and nothing else would stop one shipping.
describe('the placeholder check', () => {
  const puzzles = LESSON.steps[3] as Extract<Step, { kind: 'puzzles' }>;

  it('reports TODO in the title, a card name, a step text, a page text, a prompt and a hint, naming where', () => {
    const lesson: Lesson = {
      ...LESSON,
      title: 'TODO title',
      cards: [{ track: 'basics', name: 'Rook TODO' }],
      steps: [
        { ...LESSON.steps[0], text: 'TODO' } as Step,
        LESSON.steps[1],
        { kind: 'read', title: 'Strategy', pages: [{ text: 'Write this. TODO' }] },
        { ...puzzles, puzzles: [{ ...MATE_IN_1, prompt: 'TODO: prompt', hint: 'TODO: hint' }] },
      ],
    };
    expect(problems(lesson)).toEqual([
      'test-rook title: the text still has a TODO',
      'test-rook card 1: the text still has a TODO',
      'test-rook step 1 (see): the text still has a TODO',
      'test-rook step 3 (read) page 1: the text still has a TODO',
      'test-rook step 4 (puzzles) puzzle 1 prompt: the text still has a TODO',
      'test-rook step 4 (puzzles) puzzle 1 hint: the text still has a TODO',
    ]);
  });

  it('tells a placeholder problem from the rest, so the puzzle search can leave its TODO hint for the author', () => {
    const lesson = withPuzzle({ ...MATE_IN_1, line: ['a1a7'], hint: 'TODO: write a hint.' });
    const found = problems(lesson);
    expect(found.filter(isPlaceholderProblem)).toEqual(['test-rook step 4 (puzzles) puzzle 1 hint: the text still has a TODO']);
    expect(found.filter((p) => !isPlaceholderProblem(p))).toHaveLength(2);
  });

  it('reports TODO in a variant page difference', () => {
    const page: VariantPage = { id: 'variant-chess', variant: 'chess', order: 1, differences: ['Plain.', 'TODO'] };
    expect(checkVariantPage(page)).toEqual(['variant-chess difference 2: the text still has a TODO']);
    expect(checkVariantPage({ ...page, differences: ['Plain.'] })).toEqual([]);
  });
});

describe('loadContent', () => {
  const page = { id: 'chess', variant: 'chess', order: 1, differences: [] };

  it('splits variant pages from lessons', () => {
    const { lessons, pages } = loadContent({ './content/basics/rook.json': LESSON, './content/variants/chess.json': page });
    expect(lessons.map((l) => l.id)).toEqual(['test-rook']);
    expect(pages.map((p) => p.id)).toEqual(['chess']);
  });

  it('throws on a file that fails its guard, naming the file', () => {
    expect(() => loadContent({ './content/basics/bad.json': { id: 'bad' } })).toThrow('./content/basics/bad.json');
    expect(() => loadContent({ './content/variants/bad.json': LESSON })).toThrow('./content/variants/bad.json');
  });

  it('throws on two lessons with one id', () => {
    expect(() => loadContent({ './content/basics/a.json': LESSON, './content/fairy/b.json': LESSON })).toThrow(
      'test-rook',
    );
  });
});

describe('cards', () => {
  const lesson = (id: string, order: number, ...cards: Lesson['cards']): Lesson => ({ ...LESSON, id, order, cards });

  it('lists every card of a track, by order and then by name', () => {
    const lessons = [
      lesson('king', 2, { track: 'basics', name: 'King' }, { track: 'fairy', name: 'Commoner' }),
      lesson('rook', 1, { track: 'basics', name: 'Rook' }),
      lesson('wazir', 2, { track: 'fairy', name: 'Wazir' }),
      lesson('bishop', 2, { track: 'basics', name: 'Bishop' }),
    ];
    expect(cardsOf(lessons, [], 'basics')).toEqual([
      { name: 'Rook', lessonId: 'rook' },
      { name: 'Bishop', lessonId: 'bishop' },
      { name: 'King', lessonId: 'king' },
    ]);
    expect(cardsOf(lessons, [], 'fairy')).toEqual([
      { name: 'Commoner', lessonId: 'king' },
      { name: 'Wazir', lessonId: 'wazir' },
    ]);
  });

  it("sorts a card by its own order where it has one, and by its lesson's order otherwise", () => {
    const lessons = [
      lesson('king', 8, { track: 'basics', name: 'King' }, { track: 'fairy', name: 'Commoner', order: 2.5 }),
      lesson('fers', 1, { track: 'fairy', name: 'Fers' }),
      lesson('wazir', 2, { track: 'fairy', name: 'Wazir' }),
      lesson('alfil', 3, { track: 'fairy', name: 'Alfil' }),
    ];
    expect(cardsOf(lessons, [], 'fairy').map((c) => c.name)).toEqual(['Fers', 'Wazir', 'Commoner', 'Alfil']);
    expect(cardsOf(lessons, [], 'basics')).toEqual([{ name: 'King', lessonId: 'king' }]);
  });

  it("gives the lesson after a lesson in its own track's order, or null after the last", () => {
    // A lesson's track is its first card's.
    const lessons = [
      lesson('king', 8, { track: 'basics', name: 'King' }, { track: 'fairy', name: 'Commoner', order: 2.5 }),
      lesson('rook', 6, { track: 'basics', name: 'Rook' }),
      lesson('archbishop', 3, { track: 'fairy', name: 'Archbishop' }, { track: 'fairy', name: 'Hawk' }),
      lesson('wazir', 2, { track: 'fairy', name: 'Wazir' }),
      lesson('alfil', 4, { track: 'fairy', name: 'Alfil' }),
    ].map((l) => ({ ...l, track: l.cards[0].track }));
    expect(nextLessonOf(lessons, 'rook')).toBe('king');
    expect(nextLessonOf(lessons, 'king')).toBeNull();
    // A lesson with two cards in its track is passed over once, not visited again.
    expect(nextLessonOf(lessons, 'archbishop')).toBe('alfil');
    expect(nextLessonOf(lessons, 'wazir')).toBe('archbishop');
    expect(nextLessonOf(lessons, 'alfil')).toBeNull();
    expect(nextLessonOf(lessons, 'missing')).toBeNull();
  });

  it('chains every shipped lesson of a track from its first card to its last', () => {
    for (const track of ['basics', 'fairy'] as const) {
      const ids = [...new Set(cardsByTrack(track).map((c) => c.lessonId))].filter((id) => lessonById(id)!.track === track);
      for (let i = 0; i < ids.length; i++) expect(nextLessonOf(LESSONS, ids[i])).toBe(ids[i + 1] ?? null);
    }
  });

  it('names a variant page by its variant', () => {
    const pages: VariantPage[] = [
      { id: 'grand', variant: 'grand', order: 2, differences: [] },
      { id: 'chess', variant: 'chess', order: 1, differences: [] },
    ];
    expect(cardsOf([], pages, 'variants')).toEqual([
      { name: 'Chess', lessonId: 'chess' },
      { name: 'Grand Chess', lessonId: 'grand' },
    ]);
  });

  it('lists the Commoner card right after the Wazir, since a commoner moves as a fers and a wazir together', () => {
    const fairy = cardsByTrack('fairy').map((c) => c.name);
    expect(fairy.slice(fairy.indexOf('Wazir'), fairy.indexOf('Wazir') + 3)).toEqual(['Wazir', 'Commoner', 'Alfil']);
  });

  it('includes the rook card in the basics track', () => {
    expect(cardsByTrack('basics')).toContainEqual({ name: 'Rook', lessonId: 'rook' });
  });
});
