// Whether a player's move meets a lesson goal, and where the goal's piece stands as moves are played.
// Pure logic over the rules library: no DOM or UI imports.
import type { RulesGame } from '../rules/types';
import { pieceOn, uciSquares } from '../variants/fen';
import type { Goal } from './lesson';

/** Runs `look` on the position before the last move `uci`, then plays it again. */
function beforeMove<T>(game: RulesGame, uci: string, look: () => T): T {
  game.pop();
  try {
    return look();
  } finally {
    game.push(uci);
  }
}

/** A pawn moving to another file onto an empty square: only an en passant capture does that. */
function isEnPassant(game: RulesGame, uci: string): boolean {
  const { from, to } = uciSquares(uci);
  return beforeMove(game, uci, () => {
    const fen = game.fen();
    return from !== null && pieceOn(fen, from)?.toLowerCase() === 'p' && from[0] !== to[0] && pieceOn(fen, to) === undefined;
  });
}

const isWhite = (piece: string): boolean => piece === piece.toUpperCase();

/**
 * Whether the move took the piece on `tracked`: it stood there before the move, and afterwards the square is
 * empty (en passant) or holds the mover's piece. The board is checked, not only the move's destination, so a
 * square the piece left unseen (a castling rook) never counts.
 */
function captured(game: RulesGame, tracked: string, uci: string): boolean {
  const after = pieceOn(game.fen(), tracked);
  const before = beforeMove(game, uci, () => pieceOn(game.fen(), tracked));
  return before !== undefined && (after === undefined || isWhite(after) !== isWhite(before));
}

/**
 * Whether `uci`, already pushed on `game`, meets `goal`. `tracked` is the square the goal's piece stood on
 * before the move (see `trackAfter`), or null for goals that track no piece.
 */
export function goalMet(game: RulesGame, goal: Goal, tracked: string | null, uci: string): boolean {
  const { from, to } = uciSquares(uci);
  switch (goal.kind) {
    case 'mate':
      return game.result()?.reason === 'checkmate';
    case 'stalemate':
      return game.result()?.reason === 'stalemate';
    case 'castle':
      return beforeMove(game, uci, () => game.san(uci)).startsWith('O-O');
    case 'promote':
      return beforeMove(game, uci, () => game.san(uci)).includes('=');
    case 'enPassant':
      return isEnPassant(game, uci);
    case 'capture':
      return tracked !== null && captured(game, tracked, uci);
    case 'reach':
      return tracked !== null && from === tracked && to === goal.to;
  }
}

/** The square the goal's piece starts on, or null for goals that track no piece. */
export const startOf = (goal: Goal): string | null =>
  goal.kind === 'capture' ? goal.square : goal.kind === 'reach' ? goal.from : null;

/** Where the goal's piece stands after `uci` (either side's move): moved with it, or null once captured. */
export function trackAfter(goal: Goal, tracked: string | null, uci: string): string | null {
  if (tracked === null || (goal.kind !== 'capture' && goal.kind !== 'reach')) return null;
  const { from, to } = uciSquares(uci);
  if (from === tracked) return to;
  return to === tracked ? null : tracked;
}
