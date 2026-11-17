// The tutorial's lesson and variant-page shapes, and structural guards for them. Pure data: no DOM or UI imports.
import { CURATED_VARIANTS, type VariantId } from '../variants/catalog';
import { isSetupSpec, type SetupSpec } from '../variants/setup';

export type Track = 'basics' | 'fairy';
export type LessonBoard = { variant: VariantId; fen: string } | { setup: SetupSpec };
export type Goal =
  | { kind: 'mate' } | { kind: 'stalemate' } | { kind: 'castle' } | { kind: 'enPassant' } | { kind: 'promote' }
  | { kind: 'capture'; square: string } | { kind: 'reach'; from: string; to: string };
export interface Page { text: string; board?: LessonBoard; square?: string; arrows?: [string, string][] }
export interface Puzzle { prompt: string; board: LessonBoard; goal: Goal; moves: 1 | 2; line: string[]; hint: string }
export type Step =
  | { kind: 'see'; title: 'See it'; text: string; board: LessonBoard; square: string }
  | { kind: 'try'; title: 'Try it'; text: string; board: LessonBoard; square: string; targets: string[] }
  | { kind: 'read'; title: 'Strategy' | 'Learn'; pages: Page[] }
  | { kind: 'puzzles'; title: 'Puzzles'; puzzles: Puzzle[] };
/**
 * One per name in the lesson list; a look-alike's card opens the shared lesson. `order` places this card
 * instead of its lesson's order, and may fall between two lessons' orders (the Commoner after the Wazir).
 */
export interface Card { track: Track; name: string; order?: number }
/** What a lesson teaches, for the "Learn this piece" links: a built-in type, or a curated variant's own letter. */
export type Teaches = { type: string } | { variant: VariantId; letter: string };
export interface Lesson { id: string; track: Track; order: number; title: string; cards: Card[]; teaches: Teaches[]; steps: Step[] }
export interface VariantPage { id: string; variant: VariantId; order: number; differences: string[] }

/** The position a board starts from: a setup's own FEN, or the curated variant's. */
export const boardFen = (board: LessonBoard): string => ('setup' in board ? board.setup.fen : board.fen);

type Data = Record<string, unknown>;
const isRecord = (d: unknown): d is Data => typeof d === 'object' && d !== null && !Array.isArray(d);
const isString = (d: unknown): d is string => typeof d === 'string';
const isStrings = (d: unknown): d is string[] => Array.isArray(d) && d.every(isString);
const isListOf = <T>(d: unknown, guard: (x: unknown) => x is T): d is T[] => Array.isArray(d) && d.every(guard);
const isVariantId = (d: unknown): d is VariantId => CURATED_VARIANTS.some((v) => v.id === d);
const isTrack = (d: unknown): d is Track => d === 'basics' || d === 'fairy';

const isBoard = (d: unknown): d is LessonBoard =>
  isRecord(d) && (d.setup !== undefined ? isSetupSpec(d.setup) : isVariantId(d.variant) && isString(d.fen));

const PLAIN_GOALS = ['mate', 'stalemate', 'castle', 'enPassant', 'promote'];
const isGoal = (d: unknown): d is Goal =>
  isRecord(d) &&
  ((isString(d.kind) && PLAIN_GOALS.includes(d.kind)) ||
    (d.kind === 'capture' && isString(d.square)) ||
    (d.kind === 'reach' && isString(d.from) && isString(d.to)));

const isArrow = (d: unknown): d is [string, string] => isStrings(d) && d.length === 2;
const isPage = (d: unknown): d is Page =>
  isRecord(d) &&
  isString(d.text) &&
  (d.board === undefined || isBoard(d.board)) &&
  (d.square === undefined || isString(d.square)) &&
  (d.arrows === undefined || isListOf(d.arrows, isArrow));

const isPuzzle = (d: unknown): d is Puzzle =>
  isRecord(d) &&
  isString(d.prompt) &&
  isBoard(d.board) &&
  isGoal(d.goal) &&
  (d.moves === 1 || d.moves === 2) &&
  isStrings(d.line) &&
  isString(d.hint);

function isStep(d: unknown): d is Step {
  if (!isRecord(d)) return false;
  switch (d.kind) {
    case 'see':
      return d.title === 'See it' && isString(d.text) && isBoard(d.board) && isString(d.square);
    case 'try':
      return d.title === 'Try it' && isString(d.text) && isBoard(d.board) && isString(d.square) && isStrings(d.targets);
    case 'read':
      return (d.title === 'Strategy' || d.title === 'Learn') && isListOf(d.pages, isPage);
    case 'puzzles':
      return d.title === 'Puzzles' && isListOf(d.puzzles, isPuzzle);
    default:
      return false;
  }
}

const isCard = (d: unknown): d is Card =>
  isRecord(d) && isTrack(d.track) && isString(d.name) && (d.order === undefined || Number.isFinite(d.order));
const isTeaches = (d: unknown): d is Teaches =>
  isRecord(d) && (isString(d.type) || (isVariantId(d.variant) && isString(d.letter)));

/** Checks the shape only. The content checks judge the values (squares, moves, forced wins). */
export function isLesson(d: unknown): d is Lesson {
  return (
    isRecord(d) &&
    isString(d.id) &&
    isTrack(d.track) &&
    Number.isInteger(d.order) &&
    isString(d.title) &&
    isListOf(d.cards, isCard) &&
    isListOf(d.teaches, isTeaches) &&
    isListOf(d.steps, isStep)
  );
}

/** Checks the shape only. */
export function isVariantPage(d: unknown): d is VariantPage {
  return isRecord(d) && isString(d.id) && isVariantId(d.variant) && Number.isInteger(d.order) && isStrings(d.differences);
}
