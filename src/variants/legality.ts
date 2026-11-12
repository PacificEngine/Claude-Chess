// Plain-English reasons a position can't be played, for the editor's disabled Play/Resume button. No DOM imports.
import type { Rules } from '../rules/types';
import { royalLetters } from './fen';

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
