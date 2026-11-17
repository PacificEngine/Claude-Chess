// An exhaustive forced-win search for lesson puzzles of one or two player moves. Pure logic over the rules
// library: no DOM or UI imports.
import type { Rules, RulesGame } from '../rules/types';
import { goalMet, startOf, trackAfter } from './goals';
import type { Goal } from './lesson';

/** Whether some player move in `game` meets the goal now. */
function winsNow(game: RulesGame, goal: Goal, tracked: string | null): boolean {
  return game.legalMoves().some((uci) => {
    game.push(uci);
    try {
      return goalMet(game, goal, tracked, uci);
    } finally {
      game.pop();
    }
  });
}

/**
 * After the player's first move: whether every legal reply leaves a player move that meets the goal. With no
 * reply at all, or a game already over (a draw, a variant's end), the goal is missed, as the first move didn't
 * meet it. A reply that ends the game is a defence.
 */
function winsAgainstEveryReply(game: RulesGame, goal: Goal, tracked: string | null): boolean {
  if (game.result()) return false;
  const replies = game.legalMoves();
  return (
    replies.length > 0 &&
    replies.every((reply) => {
      game.push(reply);
      try {
        return !game.result() && winsNow(game, goal, trackAfter(goal, tracked, reply));
      } finally {
        game.pop();
      }
    })
  );
}

/** Whether the first move `uci` in `game` forces the goal; the game is left as it was. */
function forcesFrom(game: RulesGame, goal: Goal, moves: 1 | 2, uci: string): boolean {
  const tracked = startOf(goal);
  game.push(uci);
  try {
    if (goalMet(game, goal, tracked, uci)) return true;
    return moves === 2 && winsAgainstEveryReply(game, goal, trackAfter(goal, tracked, uci));
  } finally {
    game.pop();
  }
}

/**
 * Whether the first move `uci` in `fen` meets `goal` at once, or (with `moves` 2) after it every reply leaves a
 * player move that meets it. The same judgement `forcedWins` makes of each first move, so a sibling of a
 * puzzle's key (another promotion suffix) can be judged on its own.
 */
export function forcesGoal(rules: Rules, variant: string, fen: string, goal: Goal, moves: 1 | 2, uci: string): boolean {
  const game = rules.newGame(variant, fen);
  try {
    return forcesFrom(game, goal, moves, uci);
  } finally {
    game.dispose();
  }
}

/**
 * Every first move in `fen` that `forcesGoal` accepts, in the order the rules library lists legal moves. With
 * `from`, only the first moves from those squares are judged (the puzzle search's cheap first look).
 */
export function forcedWins(rules: Rules, variant: string, fen: string, goal: Goal, moves: 1 | 2, from?: string[]): string[] {
  const game = rules.newGame(variant, fen);
  try {
    const first = from ? from.flatMap((sq) => game.legalMovesFrom(sq)) : game.legalMoves();
    return first.filter((uci) => forcesFrom(game, goal, moves, uci));
  } finally {
    game.dispose();
  }
}
