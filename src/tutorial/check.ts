// The content check: whether a lesson is sound under the real rules, as plain-English problems. Pure logic over
// the rules library: no DOM or UI imports. The unit tests run it on every lesson that ships.
import type { Rules } from '../rules/types';
import { variantTypes } from '../variants/active';
import { type VariantId, variantById } from '../variants/catalog';
import { pieceOn, uciSquares } from '../variants/fen';
import { positionProblems } from '../variants/legality';
import { INHERITED } from '../variants/piece-types';
import { reachFrom } from '../variants/reach';
import type { SetupSpec } from '../variants/setup';
import { goalMet, startOf, trackAfter } from './goals';
import { boardFen, type Lesson, type LessonBoard, type Page, type Puzzle, type Step, type Teaches, type VariantPage } from './lesson';
import { tryMoves } from './runner';
import { forcedWins } from './solver';

/** A lesson board as the rules library plays it. */
interface Board {
  /** The variant name ffish knows: curated, or the one `register` gave a setup. */
  variant: string;
  fen: string;
  base: VariantId;
  setup: SetupSpec | null;
}

interface Context {
  rules: Rules;
  lesson: Lesson;
  register: (spec: SetupSpec) => string;
  problems: string[];
}

const PIECE_SHAPE = 'see,try,read:Strategy,puzzles';
const CONCEPT_SHAPE = 'read:Learn,puzzles';

/**
 * Problems with `lesson`, in plain English, each naming where it is; empty when the lesson is sound.
 * `register` gives the variant name for a setup board, loading its variant into `rules` when needed.
 */
export function checkLesson(rules: Rules, lesson: Lesson, register: (spec: SetupSpec) => string): string[] {
  const cx: Context = { rules, lesson, register, problems: [] };
  checkShape(cx);
  checkText(cx.problems, `${lesson.id} title`, lesson.title);
  lesson.cards.forEach((card, i) => checkText(cx.problems, `${lesson.id} card ${i + 1}`, card.name));
  lesson.steps.forEach((step, i) => checkStep(cx, step, `${lesson.id} step ${i + 1} (${step.kind})`));
  return cx.problems;
}

/** Problems with a variant page's text, each naming where it is; empty when it has none. */
export function checkVariantPage(page: VariantPage): string[] {
  const problems: string[] = [];
  page.differences.forEach((text, i) => checkText(problems, `${page.id} difference ${i + 1}`, text));
  return problems;
}

const PLACEHOLDER = 'the text still has a TODO';

/**
 * Whether a problem is only a TODO left in the text. The puzzle search writes TODO where a person must write
 * the text, so it judges its own puzzles without these; nothing else stops one from shipping.
 */
export const isPlaceholderProblem = (problem: string): boolean => problem.endsWith(`: ${PLACEHOLDER}`);

function checkText(problems: string[], where: string, text: string): void {
  if (text.includes('TODO')) problems.push(`${where}: ${PLACEHOLDER}`);
}

function checkShape({ lesson, problems }: Context): void {
  const shape = lesson.steps.map((s) => (s.kind === 'read' ? `read:${s.title}` : s.kind)).join(',');
  if (lesson.teaches.length > 0 && shape !== PIECE_SHAPE)
    problems.push(`${lesson.id}: a piece lesson's steps must be see, try, read (Strategy), puzzles, not ${shape}`);
  if (lesson.teaches.length === 0 && shape !== CONCEPT_SHAPE)
    problems.push(`${lesson.id}: a concept lesson's steps must be read (Learn), puzzles, not ${shape}`);
}

function checkStep(cx: Context, step: Step, where: string): void {
  if (step.kind === 'see' || step.kind === 'try') checkText(cx.problems, where, step.text);
  switch (step.kind) {
    case 'see': {
      const board = legalBoard(cx, step.board, where);
      if (board) movablePiece(cx, board, step.square, where);
      return;
    }
    case 'try': {
      const board = legalBoard(cx, step.board, where);
      if (step.targets.length === 0) cx.problems.push(`${where}: there are no targets`);
      if (board && movablePiece(cx, board, step.square, where)) reachableTargets(cx, board, step.square, step.targets, where);
      return;
    }
    case 'read':
      step.pages.forEach((page, i) => checkPage(cx, page, `${where} page ${i + 1}`));
      return;
    case 'puzzles':
      if (step.puzzles.length === 0) cx.problems.push(`${where}: there are no puzzles`);
      step.puzzles.forEach((puzzle, i) => checkPuzzle(cx, puzzle, `${where} puzzle ${i + 1}`));
      return;
  }
}

/** The board as the rules play it, or null (with the problems reported) when it can't be played. */
function legalBoard(cx: Context, lessonBoard: LessonBoard, where: string): Board | null {
  let board: Board;
  try {
    board =
      'setup' in lessonBoard
        ? { variant: cx.register(lessonBoard.setup), fen: boardFen(lessonBoard), base: lessonBoard.setup.base, setup: lessonBoard.setup }
        : { variant: variantById(lessonBoard.variant).engineName, fen: lessonBoard.fen, base: lessonBoard.variant, setup: null };
  } catch (e) {
    cx.problems.push(`${where}: the setup can't be made into a variant: ${(e as Error).message}`);
    return null;
  }
  const problems = positionProblems(cx.rules, board.variant, board.fen, variantById(board.base).engineName);
  cx.problems.push(...problems.map((p) => `${where}: ${p}`));
  return problems.length ? null : board;
}

/** Whether `square` holds a White piece, with White to move, that has at least one move. */
function movablePiece(cx: Context, board: Board, square: string, where: string): boolean {
  const piece = pieceOn(board.fen, square);
  if (piece === undefined || piece !== piece.toUpperCase() || board.fen.split(' ')[1] !== 'w') {
    cx.problems.push(`${where}: there is no White piece on ${square} with White to move`);
    return false;
  }
  const { moves, captures } = reachFrom(cx.rules, board.variant, board.fen, square);
  if (moves.length + captures.length === 0) {
    cx.problems.push(`${where}: the piece on ${square} has no move`);
    return false;
  }
  return true;
}

/** Every target is reached by some series of Try it moves, as the runner plays them. */
function reachableTargets(cx: Context, board: Board, square: string, targets: string[], where: string): void {
  const reached = new Set<string>();
  const seen = new Set<string>();
  const queue: [string, string][] = [[board.fen, square]];
  while (queue.length) {
    const [fen, at] = queue.shift()!;
    const key = `${fen.split(' ')[0]} ${at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const move of tryMoves(cx.rules, board.variant, fen, at)) {
      const to = uciSquares(move.uci).to;
      reached.add(to);
      queue.push([move.fen, to]);
    }
  }
  for (const target of targets) if (!reached.has(target)) cx.problems.push(`${where}: the target ${target} can't be reached`);
}

function checkPage(cx: Context, page: Page, where: string): void {
  checkText(cx.problems, where, page.text);
  if (!page.board) {
    if (page.square || page.arrows) cx.problems.push(`${where}: a square or arrows need a board`);
    return;
  }
  const board = legalBoard(cx, page.board, where);
  if (!board) return;
  if (page.square) movablePiece(cx, board, page.square, where);
  const game = cx.rules.newGame(board.variant, board.fen);
  try {
    for (const [from, to] of page.arrows ?? []) {
      if (!game.legalMovesFrom(from).some((uci) => uciSquares(uci).to === to))
        cx.problems.push(`${where}: the arrow ${from}-${to} is not a legal move`);
    }
  } finally {
    game.dispose();
  }
}

function checkPuzzle(cx: Context, puzzle: Puzzle, where: string): void {
  checkText(cx.problems, `${where} prompt`, puzzle.prompt);
  checkText(cx.problems, `${where} hint`, puzzle.hint);
  const board = legalBoard(cx, puzzle.board, where);
  if (!board) return;
  const { goal, moves, line } = puzzle;
  const problem = (text: string): void => void cx.problems.push(`${where}: ${text}`);
  // Lesson puzzles are always played as White.
  if (board.fen.split(' ')[1] !== 'w') return problem('White must be the side to move');
  if (line.length !== 2 * moves - 1) return problem(`the line has ${line.length} moves, not ${2 * moves - 1}`);
  // The goals find a promotion by its SAN and en passant by the chess pawn, which only a chess base guarantees.
  if ((goal.kind === 'promote' || goal.kind === 'enPassant') && board.base !== 'chess')
    return problem(`a${goal.kind === 'enPassant' ? 'n' : ''} ${goal.kind} goal needs a board based on chess`);
  if (!lineIsSound(cx, board, puzzle, problem)) return;

  const wins = forcedWins(cx.rules, board.variant, board.fen, goal, moves);
  if (!wins.includes(line[0])) problem(`the first move ${line[0]} does not force the goal`);
  const key = uciSquares(line[0]);
  const others = wins.filter((uci) => uciSquares(uci).from !== key.from || uciSquares(uci).to !== key.to);
  if (others.length) problem(`another first move also forces the goal: ${others.join(', ')}`);
  // The runner accepts any of these as the first move, and then plays the written reply.
  if (moves === 2)
    for (const sibling of wins.filter((uci) => uci !== line[0] && !others.includes(uci)))
      if (!replyIsLegal(cx, board, sibling, line[1])) problem(`the reply ${line[1]} is not legal after ${sibling}`);

  if (cx.lesson.teaches.length > 0 && !isTaught(cx, board, key.from))
    problem(`the first move ${line[0]} is not made by the taught piece`);
  goalPiece(cx, board, puzzle, problem);
}

/**
 * Every move of the line is legal and, in a two-move puzzle, the first doesn't already meet the goal and the
 * last one does. (A one-move line is judged by the forced-win search.) Reports what is wrong and says whether the rest of the puzzle can be judged.
 */
function lineIsSound(cx: Context, board: Board, { goal, moves, line }: Puzzle, problem: (text: string) => void): boolean {
  const game = cx.rules.newGame(board.variant, board.fen);
  try {
    let tracked = startOf(goal);
    for (const [i, uci] of line.entries()) {
      if (!game.legalMoves().includes(uci)) {
        problem(`the line's move ${uci} is not legal`);
        return false;
      }
      game.push(uci);
      const met = goalMet(game, goal, tracked, uci);
      tracked = trackAfter(goal, tracked, uci);
      if (i === 0 && moves === 2 && met) {
        problem(`the first move ${uci} already meets the goal`);
        return false;
      }
      if (i === 2 && !met) problem(`the last move ${uci} does not meet the goal`);
    }
    return true;
  } finally {
    game.dispose();
  }
}

function replyIsLegal(cx: Context, board: Board, first: string, reply: string): boolean {
  const game = cx.rules.newGame(board.variant, board.fen);
  try {
    game.push(first);
    return game.legalMoves().includes(reply);
  } finally {
    game.dispose();
  }
}

/** The built-in type a board's letter moves as, or undefined for a designed piece. */
function typeOf(cx: Context, board: Board, letter: string): string | undefined {
  const own = board.setup?.pieces[letter];
  if (own !== undefined && own !== INHERITED) return own;
  if (board.setup?.designed?.[letter]) return undefined;
  return variantTypes(cx.rules, variantById(board.base).engineName).get(letter);
}

function teachesLetter(cx: Context, board: Board, letter: string, teaches: Teaches): boolean {
  if ('type' in teaches) return typeOf(cx, board, letter) === teaches.type;
  const own = board.setup?.pieces[letter];
  return board.base === teaches.variant && letter === teaches.letter && (own === undefined || own === INHERITED);
}

function isTaught(cx: Context, board: Board, square: string): boolean {
  const letter = pieceOn(board.fen, square)?.toLowerCase();
  return letter !== undefined && cx.lesson.teaches.some((t) => teachesLetter(cx, board, letter, t));
}

/**
 * The piece a capture or reach goal follows: there is one, a capture's is Black, and it is not a rook whose
 * side may still castle (the goals don't follow a castling rook, so a second answer could go unseen).
 */
function goalPiece(cx: Context, board: Board, { goal }: Puzzle, problem: (text: string) => void): void {
  const square = startOf(goal);
  if (square === null) return;
  const piece = pieceOn(board.fen, square);
  if (piece === undefined) return problem(`there is no piece on the goal's square ${square}`);
  if (goal.kind === 'capture' && piece === piece.toUpperCase()) problem(`the capture goal's piece on ${square} is White; it must be Black`);
  if (typeOf(cx, board, piece.toLowerCase()) !== 'rook') return;
  const rights = board.fen.split(' ')[2] ?? '-';
  const white = piece === piece.toUpperCase();
  if ([...rights].some((c) => /[a-z]/i.test(c) && (c === c.toUpperCase()) === white))
    problem(`the goal's rook on ${square} belongs to a side with castling rights; remove them from the FEN`);
}
