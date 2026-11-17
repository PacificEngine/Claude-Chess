// A seeded search for lesson puzzles with exactly one solution, for `yarn tutorial:search`. Dev-time tooling
// over the rules library: no DOM or UI imports. Every puzzle it returns passes the content check.
import type { Rules } from '../rules/types';
import { variantTypes } from '../variants/active';
import { CURATED_VARIANTS, variantById } from '../variants/catalog';
import { buildFen, pieceOn, squareName, uciSquares } from '../variants/fen';
import { generateVariant } from '../variants/generator';
import { placementProblems } from '../variants/legality';
import { BUILTIN_PIECES } from '../variants/piece-types';
import type { SetupSpec } from '../variants/setup';
import { checkLesson, isPlaceholderProblem } from './check';
import { goalMet, startOf, trackAfter } from './goals';
import type { Goal, Lesson, LessonBoard, Puzzle, Teaches } from './lesson';
import { forcedWins } from './solver';

export type SearchGoal = 'mate1' | 'mate2' | 'capture1' | 'capture2';
export const SEARCH_GOALS: readonly SearchGoal[] = ['mate1', 'mate2', 'capture1', 'capture2'];

export interface SearchOptions {
  /** A built-in piece type (`wazir`), or a curated variant's own letter (`shako:c`). */
  piece: string;
  goal: SearchGoal;
  /** How many puzzles to find; default 5. */
  count?: number;
  /** The PRNG seed; the same seed gives the same puzzles (unless the time limit cuts the search short). */
  seed?: number;
  /** Stop after this many milliseconds with whatever was found; default no limit. */
  timeLimitMs?: number;
  /** Stop after this many random positions; default 200000. */
  maxTries?: number;
  /** The letters the other pieces may use; default the variant's pawn and knight. */
  extras?: string[];
}

/** At most this many pieces besides both kings and the taught piece, so the content check stays fast. */
export const MAX_EXTRAS = 4;

/** Mulberry32: small, fast and seeded, so a search can be repeated. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where the search puts pieces, and how it writes the board and the lesson that checks it. */
interface Target {
  files: number;
  ranks: number;
  /** The taught piece's lowercase letter. */
  letter: string;
  /** The other non-king letters the extras may use. */
  extras: string[];
  /** Whether the taught piece is the king (a Xiangqi general), so it is not placed twice. */
  royal: boolean;
  /** The pocket suffix the variant's FEN needs ('' or '[]'). */
  hand: string;
  teaches: Teaches;
  /** The board for a FEN. */
  board: (fen: string) => LessonBoard;
  /**
   * The variant name the search plays positions in. For a setup it is one probe of the same setup: a
   * generated name also hashes the start FEN, and only the kept puzzles need their own (the check registers them).
   */
  variant: string;
}

/** Chess's own letters: a setup may not give one of them another type (the app passes the base's types). */
const CHESS_LETTERS = ['k', 'q', 'r', 'b', 'n', 'p'];

/**
 * The taught type's letter on a chess-based setup: its usual letter unless chess uses that letter for another
 * type, then the first free letter of its type name, then of the alphabet.
 */
function setupLetter(type: string, usual: string): string {
  const chessType: Record<string, string> = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
  if (!CHESS_LETTERS.includes(usual) || chessType[usual] === type) return usual;
  const free = [...type.toLowerCase(), ...'abcdefghijklmnopqrstuvwxyz'].find((c) => /[a-z]/.test(c) && !CHESS_LETTERS.includes(c));
  return free!;
}

function targetOf(rules: Rules, piece: string): Target {
  const [variantId, curatedLetter] = piece.split(':');
  if (curatedLetter !== undefined) {
    const info = CURATED_VARIANTS.find((v) => v.id === variantId);
    if (!info) throw new Error(`Unknown curated variant: ${variantId}`);
    const types = variantTypes(rules, info.engineName);
    if (!types.has(curatedLetter)) throw new Error(`${info.id} has no piece letter ${curatedLetter}`);
    // A chess king has its own lesson; a curated variant's own king (the Xiangqi general) is taught here.
    if (types.get(curatedLetter) === 'king') throw new Error('The search teaches a non-king piece');
    const start = rules.newGame(info.engineName);
    const hand = /\[/.test(start.fen().split(' ')[0]) ? '[]' : '';
    start.dispose();
    const id = info.id;
    return {
      files: info.files,
      ranks: info.ranks,
      letter: curatedLetter,
      royal: curatedLetter === 'k',
      extras: ['p', 'n'].filter((c) => types.has(c) && c !== curatedLetter),
      hand,
      teaches: { variant: id, letter: curatedLetter },
      board: (fen) => ({ variant: id, fen }),
      variant: info.engineName,
    };
  }
  const builtin = BUILTIN_PIECES.find((p) => p.type === piece);
  if (!builtin) throw new Error(`Unknown piece: ${piece} (use a built-in type or <variant>:<letter>)`);
  if (builtin.royal) throw new Error('The search teaches a non-king piece');
  const letter = setupLetter(builtin.type, builtin.letter);
  const pieces: Record<string, string> = { k: 'king', p: 'pawn', n: 'knight', [letter]: builtin.type };
  const spec = (fen: string): SetupSpec => ({
    base: 'chess',
    files: 8,
    ranks: 8,
    pieces,
    fen,
    castling: false,
    promotion: { rank: 'last', pieceTypes: ['n'] },
  });
  return {
    files: 8,
    ranks: 8,
    letter,
    royal: false,
    extras: ['p', 'n'].filter((c) => c !== letter),
    hand: '',
    teaches: { type: builtin.type },
    board: (fen) => ({ setup: spec(fen) }),
    variant: register(rules)(spec('4k3/8/8/8/8/8/8/4K3 w - - 0 1')),
  };
}

/** The variant name for a setup, loading it into the rules as the app does (with the base's types). */
const register =
  (rules: Rules) =>
  (spec: SetupSpec): string => {
    const { name, ini } = generateVariant(spec, variantTypes(rules, variantById(spec.base).engineName));
    if (!rules.knows(name)) rules.loadConfig(ini);
    return name;
  };

/** One random position: both kings, the taught piece and up to `MAX_EXTRAS` more; null when it is unplayable. */
function randomPosition(rules: Rules, t: Target, rand: () => number, wantsBlackPiece: boolean): string | null {
  const { files, ranks } = t;
  const count = files * ranks;
  const pick = (ok: (i: number) => boolean): number | null => {
    for (let n = 0; n < 50; n++) {
      const i = Math.floor(rand() * count);
      if (ok(i)) return i;
    }
    return null;
  };
  const squares = new Map<number, string>();
  const free = (i: number) => !squares.has(i);
  const fileOf = (i: number) => i % files;
  const rankOf = (i: number) => Math.floor(i / files);
  const onEdge = (i: number) => fileOf(i) === 0 || fileOf(i) === files - 1 || rankOf(i) === 0 || rankOf(i) === ranks - 1;
  const inCorner = (i: number) => (fileOf(i) === 0 || fileOf(i) === files - 1) && (rankOf(i) === 0 || rankOf(i) === ranks - 1);
  // Mates mostly happen on the edge, so the black king goes there more often than not.
  const spot = rand();
  // Squares the game lets the piece stand on (Xiangqi's palace, river and soldiers), which the FEN check allows.
  const fits = (i: number, c: string) => placementProblems(t.variant, buildFen({ files, ranks, squares: new Map([[i, c]]), pocket: [] })).length === 0;
  const bk = pick((i) => fits(i, 'k') && (spot < 0.3 ? inCorner(i) : spot < 0.8 ? onEdge(i) : true)) ?? pick((i) => fits(i, 'k'));
  if (bk === null) return null;
  squares.set(bk, 'k');
  // Most pieces go near the black king, where they can take part: the White king and the taught piece close
  // enough to cover its squares, Black's own pieces next to it, where they can block its way out.
  const distance = (i: number) => Math.max(Math.abs(fileOf(i) - fileOf(bk)), Math.abs(rankOf(i) - rankOf(bk)));
  const pawnOk = (i: number) => rankOf(i) > 0 && rankOf(i) < ranks - 1;
  const place = (c: string, radius: number): boolean => {
    const close = rand() < 0.8;
    const ok = (j: number, near: boolean) =>
      free(j) && distance(j) > (c === 'K' ? 1 : 0) && (!near || distance(j) <= radius) && (c.toLowerCase() !== 'p' || pawnOk(j)) && fits(j, c);
    // A piece the game keeps far from the black king (a Xiangqi general or elephant) goes anywhere it may stand.
    const i = pick((j) => ok(j, close)) ?? (close ? pick((j) => ok(j, false)) : null);
    if (i === null) return false;
    squares.set(i, c);
    return true;
  };
  if (!place('K', 2) || (!t.royal && !place(t.letter.toUpperCase(), 2))) return null;
  const letters = t.royal ? t.extras : [...t.extras, t.letter];
  const extras = Math.floor(rand() * (MAX_EXTRAS + 1));
  for (let n = 0; n < extras; n++) {
    const letter = letters[Math.floor(rand() * letters.length)];
    const black = (wantsBlackPiece && n === 0) || rand() < 0.6;
    if (!place(black ? letter : letter.toUpperCase(), black ? 1 : 3)) return null;
  }
  const fen = buildFen({ files, ranks, squares, pocket: [] });
  const [placement, ...rest] = fen.split(' ');
  const full = [placement + t.hand, ...rest].join(' ');
  return quicklyPlayable(rules, t.variant, full) ? full : null;
}

/**
 * A fast stand-in for `positionProblems`, which is too slow to run on every random position: a valid FEN
 * whose side not to move (Black) is not in check. The content check runs the full test on what is kept.
 */
function quicklyPlayable(rules: Rules, variant: string, fen: string): boolean {
  const flipped = fen.replace(' w ', ' b ');
  if (!rules.validateFen(variant, fen) || !rules.validateFen(variant, flipped)) return false;
  const game = rules.newGame(variant, flipped);
  try {
    return !game.inCheck();
  } finally {
    game.dispose();
  }
}

/** The squares of White's copies of the taught piece in `fen`. */
function taughtSquares(t: Target, fen: string): string[] {
  const letter = t.letter.toUpperCase();
  return Array.from({ length: t.files * t.ranks }, (_, i) => squareName(i, t.files)).filter((sq) => pieceOn(fen, sq) === letter);
}

/** The goal for a position: mate, or taking a random Black non-king piece; null when there is none to take. */
function goalFor(kind: SearchGoal, t: Target, fen: string, rand: () => number): Goal | null {
  if (kind.startsWith('mate')) return { kind: 'mate' };
  const targets: string[] = [];
  for (let i = 0; i < t.files * t.ranks; i++) {
    const sq = squareName(i, t.files);
    const p = pieceOn(fen, sq);
    if (p !== undefined && p !== 'k' && p === p.toLowerCase()) targets.push(sq);
  }
  return targets.length ? { kind: 'capture', square: targets[Math.floor(rand() * targets.length)] } : null;
}

/** The player moves after `first` and `reply` that meet the goal. */
function finishers(rules: Rules, variant: string, fen: string, goal: Goal, first: string, reply: string): string[] {
  const game = rules.newGame(variant, fen);
  try {
    game.push(first);
    game.push(reply);
    const tracked = trackAfter(goal, trackAfter(goal, startOf(goal), first), reply);
    return game.legalMoves().filter((uci) => {
      game.push(uci);
      try {
        return goalMet(game, goal, tracked, uci);
      } finally {
        game.pop();
      }
    });
  } finally {
    game.dispose();
  }
}

/** Legal replies after `first` that are also legal after every sibling (the same squares, another suffix). */
function sharedReplies(rules: Rules, variant: string, fen: string, wins: string[]): string[] {
  const lists = wins.map((uci) => {
    const game = rules.newGame(variant, fen);
    try {
      game.push(uci);
      return game.legalMoves();
    } finally {
      game.dispose();
    }
  });
  return lists[0].filter((r) => lists.every((l) => l.includes(r)));
}

const PROMPTS: Record<SearchGoal, (goal: Goal) => string> = {
  mate1: () => 'Checkmate in one move.',
  mate2: () => 'Checkmate in two moves.',
  capture1: (g) => `Take the piece on ${g.kind === 'capture' ? g.square : ''}.`,
  capture2: (g) => `Win the piece on ${g.kind === 'capture' ? g.square : ''} in two moves.`,
};

/** The puzzle for a position, or null when it has no single solution by the taught piece. */
function puzzleFor(rules: Rules, t: Target, kind: SearchGoal, fen: string, goal: Goal): Puzzle | null {
  const moves = kind.endsWith('2') ? 2 : 1;
  // Cheap looks first, as most random positions fail them: a goal met at once spoils a two-move puzzle (it
  // already meets the goal, or is a second answer), and the key must be the taught piece's.
  if (moves === 2 && forcedWins(rules, t.variant, fen, goal, 1).length) return null;
  if (!forcedWins(rules, t.variant, fen, goal, moves, taughtSquares(t, fen)).length) return null;
  const wins = forcedWins(rules, t.variant, fen, goal, moves);
  const key = uciSquares(wins[0]);
  if (wins.some((uci) => uciSquares(uci).from !== key.from || uciSquares(uci).to !== key.to)) return null;
  // A drop has no square on the board, so it is never the taught piece's move.
  if (key.from === null || pieceOn(fen, key.from) !== t.letter.toUpperCase()) return null;
  const line = [wins[0]];
  if (moves === 2) {
    // The reply leaving the fewest finishing moves is the most testing defence.
    let best: { reply: string; finish: string[] } | null = null;
    for (const reply of sharedReplies(rules, t.variant, fen, wins)) {
      const finish = finishers(rules, t.variant, fen, goal, wins[0], reply);
      if (finish.length && (!best || finish.length < best.finish.length)) best = { reply, finish };
    }
    if (!best) return null;
    line.push(best.reply, best.finish[0]);
  }
  return { prompt: PROMPTS[kind](goal), board: t.board(fen), goal, moves, line, hint: 'TODO: write a hint.' };
}

/** The content check's puzzle problems for `puzzle`, in a one-puzzle lesson teaching the piece. */
function puzzleProblems(rules: Rules, t: Target, puzzle: Puzzle): string[] {
  const lesson: Lesson = {
    id: 'search',
    track: 'fairy',
    order: 1,
    title: 'Search',
    cards: [],
    teaches: [t.teaches],
    steps: [{ kind: 'puzzles', title: 'Puzzles', puzzles: [puzzle] }],
  };
  // The lesson's shape (no see, try or read steps) is not the puzzle's problem, nor is the TODO hint it writes.
  return checkLesson(rules, lesson, register(rules)).filter((p) => p.startsWith('search step') && !isPlaceholderProblem(p));
}

/**
 * Up to `count` puzzles for the piece and goal, each passing the content check's puzzle rules: a legal
 * position with White to move and no castling rights, both kings, the taught piece and at most `MAX_EXTRAS`
 * more, where the only forced win is one move (any promotion suffix) by the taught piece.
 */
export function searchPuzzles(rules: Rules, opts: SearchOptions): Puzzle[] {
  const { piece, goal: kind, count = 5, seed = 1, timeLimitMs = Infinity, maxTries = 200000, extras } = opts;
  if (!SEARCH_GOALS.includes(kind)) throw new Error(`Unknown goal: ${kind} (use ${SEARCH_GOALS.join(', ')})`);
  const t = { ...targetOf(rules, piece), ...(extras ? { extras } : {}) };
  const rand = prng(seed);
  const deadline = Date.now() + timeLimitMs;
  const seen = new Set<string>();
  const found: Puzzle[] = [];
  for (let tries = 0; tries < maxTries && found.length < count && Date.now() < deadline; tries++) {
    const fen = randomPosition(rules, t, rand, kind.startsWith('capture'));
    if (fen === null || seen.has(fen)) continue;
    seen.add(fen);
    const goal = goalFor(kind, t, fen, rand);
    if (goal === null) continue;
    const puzzle = puzzleFor(rules, t, kind, fen, goal);
    if (puzzle && puzzleProblems(rules, t, puzzle).length === 0) found.push(puzzle);
  }
  return found;
}
