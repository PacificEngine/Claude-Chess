// Duck Chess's two-step turn, for the board: the rules list each turn as one move (`e2e4,e4d5`: the piece's move,
// then the duck's square), and the board lets the player make it in two. These helpers only regroup the rules'
// own legal moves and redraw a FEN; they never decide what is legal.
import { buildFen, parseFen, parseUci, squareName } from './fen';

/**
 * The candidates that carry a duck part, by their piece move (the part before the comma), each with its duck
 * squares paired to the full move. Promotions stay apart (`a7a8q`, `a7a8n`), so one is chosen before the duck.
 */
export function duckSteps(candidates: string[]): Map<string, Map<string, string>> {
  const steps = new Map<string, Map<string, string>>();
  for (const uci of candidates) {
    const duck = parseUci(uci)?.duck;
    if (!duck) continue;
    const first = uci.slice(0, uci.indexOf(','));
    let squares = steps.get(first);
    if (!squares) steps.set(first, (squares = new Map()));
    squares.set(duck, uci);
  }
  return steps;
}

/** The squares of every duck (`*`) on the board, in board order. */
export function duckSquaresOf(fen: string): string[] {
  const { files, squares } = parseFen(fen);
  return [...squares]
    .filter(([, c]) => c === '*')
    .map(([i]) => i)
    .sort((a, b) => a - b)
    .map((i) => squareName(i, files));
}

/**
 * The position to show between the two steps: the pieces as `after` (one full candidate's result) has them, but
 * the ducks where they stood in `before`, or none on the first turn. The rest of the FEN is `before`'s, as the
 * mover's turn is not over. For display only: ffish never sees it.
 */
export function duckStepFen(before: string, after: string): string {
  const old = parseFen(before);
  const next = parseFen(after);
  const squares = new Map([...next.squares].filter(([, c]) => c !== '*'));
  for (const [i, c] of old.squares) if (c === '*') squares.set(i, c);
  return buildFen({ ...next, squares }, before.split(' ').slice(1).join(' '));
}
