// Where one piece reaches in a position, as the rules library says. No DOM or UI imports.
// - Move squares are where the piece's legal moves go without capturing.
// - Capture-only squares are where it can capture but not move: the pieces it can take, and every other empty
//   square where it could capture an enemy piece put there (one at a time, so a cannon keeps its screens).
//   The piece put there is a pawn, or a knight on the first and last ranks, where a pawn can't stand.
import type { Rules } from '../rules/types';
import { buildFen, parseFen, type Position, squareIndex, squareName, uciSquares } from './fen';

export interface Reach {
  /** Squares the piece moves to without capturing, sorted. */
  moves: string[];
  /** Squares where it can capture but not move, sorted. */
  captures: string[];
}

function destinations(rules: Rules, variant: string, fen: string, square: string): string[] {
  const game = rules.newGame(variant, fen);
  try {
    return game.legalMovesFrom(square).map((uci) => uciSquares(uci).to);
  } finally {
    game.dispose();
  }
}

/** Where the piece on `square` goes in `fen`. Throws unless it is a piece of the FEN's side to move. */
export function reachFrom(rules: Rules, variant: string, fen: string, square: string): Reach {
  const position: Position = parseFen(fen);
  const { files, ranks, squares } = position;
  const rest = fen.split(' ').slice(1).join(' ');
  const piece = squares.get(squareIndex(square, files));
  if (piece === undefined) throw new Error(`No piece on ${square}`);
  const white = piece === piece.toUpperCase();
  // Only the side to move has legal moves, so the other side's piece would seem to reach nothing.
  if (white !== (fen.split(' ')[1] === 'w')) throw new Error(`The piece on ${square} is not the side to move`);
  const enemy = (letter: string) => (white ? letter : letter.toUpperCase());

  const moves: string[] = [];
  const captures = new Set<string>();
  for (const to of new Set(destinations(rules, variant, fen, square))) {
    if (squares.has(squareIndex(to, files))) captures.add(to);
    else moves.push(to);
  }
  for (let index = 0; index < files * ranks; index++) {
    const name = squareName(index, files);
    if (squares.has(index) || moves.includes(name)) continue;
    const rank = Math.floor(index / files);
    const target = enemy(rank === 0 || rank === ranks - 1 ? 'n' : 'p');
    const probe = buildFen({ ...position, squares: new Map([...squares, [index, target]]) }, rest);
    if (destinations(rules, variant, probe, square).includes(name)) captures.add(name);
  }
  return { moves: moves.sort(), captures: [...captures].sort() };
}
