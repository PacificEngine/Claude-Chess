// Plain-English reasons a position can't be played, for the editor's disabled Play/Resume button. No DOM imports.
import type { Rules } from '../rules/types';
import { parseFen, royalLetters } from './fen';

const INVALID_FEN = 'The position is not a valid FEN for this variant.';
const NO_MOVES = 'There are no legal moves from this position.';
const IN_CHECK = 'The side not to move is in check.';

const countPiece = (fen: string, letter: string) => fen.split(' ')[0].replace(/\[[^\]]*\]/, '').split(letter).length - 1;

/** Puts each piece letter on the first empty square it finds (for testing whether kings are the only gap). */
function withPieces(fen: string, letters: string[]): string | undefined {
  const [placement, ...rest] = fen.split(' ');
  let board = placement;
  for (const letter of letters) {
    const next = board.replace(/\d+/, (d) => letter + (Number(d) > 1 ? Number(d) - 1 : ''));
    if (next === board) return undefined;
    board = next;
  }
  return [board, ...rest].join(' ');
}

/**
 * FEN with the other side to move. Field 4 is cleared only when it is an en passant square (a file letter
 * and a rank number), since a shorter FEN may not have one and the next field then isn't ours to touch.
 */
function flipTurn(fen: string): string {
  const fields = fen.split(' ');
  if (fields.length < 2) return fen;
  fields[1] = fields[1] === 'w' ? 'b' : 'w';
  if (fields.length > 3 && /^[a-z]+\d+$/.test(fields[3])) fields[3] = '-';
  return fields.join(' ');
}

/**
 * Reasons this position can't be played, in plain English; empty when it can. Checks stop early where later
 * ones would be meaningless: an invalid FEN, or a missing royal king, can't be evaluated for check or moves.
 *
 * `royalVariant` says which kings are required. For a generated variant pass its base: the generated start
 * position is the setup itself, so a setup without a black king would otherwise make that king optional.
 */
export function positionProblems(rules: Rules, variant: string, fen: string, royalVariant = variant): string[] {
  if (!rules.knows(variant) || !rules.knows(royalVariant)) return [INVALID_FEN];

  // A color needs a king when the variant treats it as royal (Antichess's k is an ordinary piece, so it
  // isn't). Spartan's two black kings need at least one.
  const royal = royalLetters(rules, royalVariant, true);
  const missing = ['K', 'k'].filter((k) => royal.includes(k) && countPiece(fen, k) === 0);
  const kingProblems = missing.map((k) => `${k === 'K' ? 'White' : 'Black'} needs a king.`);

  if (!rules.validateFen(variant, fen)) {
    // The engine rejects a FEN without its kings as invalid. If putting the kings back makes it valid,
    // the missing kings are the only problem, and that is what the user needs to hear.
    const repaired = missing.length ? withPieces(fen, missing) : undefined;
    return repaired && rules.validateFen(variant, repaired) ? kingProblems : [INVALID_FEN];
  }
  if (kingProblems.length) return kingProblems;

  // Placements the game forbids but the engine accepts (Xiangqi's palace, Shogi's dead pieces and nifu).
  const placement = placementProblems(variant, fen);
  if (placement.length) return placement;

  // The check test needs the other side to move. A flipped FEN the engine rejects can't be evaluated, so
  // (like every other position we can't evaluate) it is reported as invalid rather than skipped.
  const flipped = flipTurn(fen);
  if (!rules.validateFen(variant, flipped)) return [INVALID_FEN];

  const problems: string[] = [];
  if (inCheck(rules, variant, flipped)) problems.push(IN_CHECK);

  const game = rules.newGame(variant, fen);
  try {
    if (game.result() === null && game.legalMoves().length === 0) problems.push(NO_MOVES);
  } finally {
    game.dispose();
  }
  return problems;
}

function inCheck(rules: Rules, variant: string, fen: string): boolean {
  const board = rules.newGame(variant, fen);
  try {
    return board.inCheck();
  } finally {
    board.dispose();
  }
}

const SIDES = [
  { name: 'White', upper: true },
  { name: 'Black', upper: false },
] as const;

/** Pieces as the player places them: file 0-based from a, rank 1-based, promoted for a Shogi `+`. */
interface Placed {
  letter: string;
  white: boolean;
  file: number;
  rank: number;
  promoted: boolean;
}

function placed(fen: string): Placed[] {
  const { files, squares, promoted } = parseFen(fen);
  return [...squares].map(([index, c]) => ({
    letter: c.toLowerCase(),
    white: c !== c.toLowerCase(),
    file: index % files,
    rank: Math.floor(index / files) + 1,
    promoted: promoted.has(index),
  }));
}

/** Squares as file letter and rank, White's side; Black's are the same files on rank 11 - r. */
const points = (list: string) => list.split(' ').map((sq) => ({ file: sq.charCodeAt(0) - 97, rank: Number(sq.slice(1)) }));
const XIANGQI_ADVISOR = points('d1 f1 e2 d3 f3');
const XIANGQI_ELEPHANT = points('a3 e3 i3 c1 g1 c5 g5');

/**
 * Where the game's rules forbid a piece to stand, though Fairy-Stockfish accepts the FEN: Xiangqi's general and
 * advisors leave the palace in no game, its elephants never cross the river nor leave their points, and its
 * soldiers never step back; a Shogi pawn, lance or knight can't stand where it could never move again, nor two
 * unpromoted pawns of a side on one file. Nor may the Xiangqi generals face each other on an open file. Other
 * variants have none. Each problem is named once per side.
 */
export function placementProblems(variant: string, fen: string): string[] {
  if (variant !== 'xiangqi' && variant !== 'shogi') return [];
  const pieces = placed(fen);
  const problems: string[] = [];
  for (const side of SIDES) {
    const own = pieces.filter((p) => p.white === side.upper);
    // Ranks counted from the side's own back rank (1), so one test serves both sides.
    const rel = (rank: number) => (side.upper ? rank : (variant === 'xiangqi' ? 11 : 10) - rank);
    const some = (letter: string, bad: (p: Placed) => boolean) => own.some((p) => p.letter === letter && bad(p));
    const at = (list: { file: number; rank: number }[]) => (p: Placed) => list.some((q) => q.file === p.file && q.rank === rel(p.rank));
    if (variant === 'xiangqi') {
      const inPalace = (p: Placed) => p.file >= 3 && p.file <= 5 && rel(p.rank) <= 3;
      if (some('k', (p) => !inPalace(p))) problems.push(`${side.name}'s general must stay inside its palace.`);
      if (some('a', (p) => !at(XIANGQI_ADVISOR)(p))) problems.push(`${side.name}'s advisors must stay on the diagonal points of its palace.`);
      if (some('b', (p) => !at(XIANGQI_ELEPHANT)(p))) {
        problems.push(`${side.name}'s elephants must stay on their own side of the river, on the elephant points.`);
      }
      if (some('p', (p) => rel(p.rank) <= 3)) problems.push(`${side.name}'s soldiers can't stand behind their starting rank.`);
    } else {
      const last = (p: Placed) => !p.promoted && rel(p.rank) === 9;
      if (some('p', last) || some('l', last)) problems.push(`${side.name} has a pawn or lance on its last rank, where it could never move.`);
      if (some('n', (p) => !p.promoted && rel(p.rank) >= 8)) problems.push(`${side.name} has a knight on its last two ranks, where it could never move.`);
      const pawnFiles = own.filter((p) => p.letter === 'p' && !p.promoted).map((p) => p.file);
      if (new Set(pawnFiles).size < pawnFiles.length) problems.push(`${side.name} has two unpromoted pawns on one file.`);
    }
  }
  if (variant === 'xiangqi' && generalsFace(pieces)) problems.push('The generals face each other on an open file.');
  return problems;
}

/**
 * Whether the two Xiangqi generals stand on one file with nothing between them. Fairy-Stockfish forbids moving
 * into it but counts it as no check, so a FEN that starts there would pass every other test.
 */
function generalsFace(pieces: Placed[]): boolean {
  const [white, black] = SIDES.map((side) => pieces.find((p) => p.letter === 'k' && p.white === side.upper));
  if (!white || !black || white.file !== black.file) return false;
  const [low, high] = [Math.min(white.rank, black.rank), Math.max(white.rank, black.rank)];
  return !pieces.some((p) => p.file === white.file && p.rank > low && p.rank < high);
}
