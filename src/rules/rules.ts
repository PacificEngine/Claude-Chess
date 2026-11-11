// The only source of move legality and game end for the app. Wraps ffish.js; no DOM or UI imports.
import type { Board, FairyStockfish } from 'ffish-es6';
import { type FfishLoadOptions, loadFfishModule } from './ffish-loader';
import type { Color, GameResult, Rules, RulesGame } from './types';

export type { Color, GameResult, Rules, RulesGame } from './types';

let rulesPromise: Promise<Rules> | undefined;

/** Initialises ffish once; later calls return the same Rules. Spartan is built in, so no ini is loaded. */
export function loadRules(options?: FfishLoadOptions): Promise<Rules> {
  rulesPromise ??= loadFfishModule(options).then(createRules);
  rulesPromise.catch(() => (rulesPromise = undefined)); // let a failed load be retried
  return rulesPromise;
}

export function createRules(ffish: FairyStockfish): Rules {
  // new ffish.Board('<unknown>') crashes the wasm module, so every variant name is checked first.
  const isKnown = (variant: string) => ffish.variants().split(' ').includes(variant);

  return {
    newGame(variant, fen) {
      if (!isKnown(variant)) throw new Error(`Unknown variant: ${variant}`);
      if (fen !== undefined && ffish.validateFen(fen, variant) !== 1) {
        throw new Error(`Invalid FEN for ${variant}: ${fen}`);
      }
      const board = fen === undefined ? new ffish.Board(variant) : new ffish.Board(variant, fen);
      return createGame(board);
    },
    loadConfig(ini) {
      ffish.loadVariantConfig(ini);
    },
    validateFen(variant, fen) {
      return isKnown(variant) && ffish.validateFen(fen, variant) === 1;
    },
  };
}

const colorOf = (white: boolean): Color => (white ? 'white' : 'black');
const splitMoves = (moves: string): string[] => (moves ? moves.split(' ') : []);

function createGame(board: Board): RulesGame {
  const legalMoves = () => splitMoves(board.legalMoves());
  return {
    fen: () => board.fen(),
    turn: () => colorOf(board.turn()),
    legalMoves,
    // UCI moves start with the from-square; the trailing digit guard stops "a1" matching "a10" on 10-rank boards.
    legalMovesFrom: (square) => legalMoves().filter((m) => m.startsWith(square) && !/\d/.test(m[square.length])),
    san: (uci) => board.sanMove(uci),
    push(uci) {
      if (!legalMoves().includes(uci) || !board.push(uci)) throw new Error(`Illegal move: ${uci}`);
    },
    pop: () => board.pop(),
    result: () => resultOf(board),
    hasInsufficientMaterial: (color) => board.hasInsufficientMaterial(color === 'white'),
    dispose: () => board.delete(),
  };
}

function resultOf(board: Board): GameResult | null {
  // claimDraw=true: repetition and the fifty-move rule end the game automatically; there is no claim button.
  const claimed = board.result(true);
  if (claimed === '*') return null;
  const noMoves = board.numberLegalMoves() === 0;
  const inCheck = board.isCheck();

  if (claimed === '1-0' || claimed === '0-1') {
    const winner: Color = claimed === '1-0' ? 'white' : 'black';
    // Anything decisive other than mate (antichess stalemate-win, all pieces lost, Spartan) is a variant rule.
    return { winner, reason: noMoves && inCheck ? 'checkmate' : 'variant' };
  }

  if (noMoves && !inCheck) return { winner: null, reason: 'stalemate' };
  if (board.isInsufficientMaterial()) return { winner: null, reason: 'insufficient' };
  // ffish's result doesn't say which claimable draw applied. The unclaimed result is still "*" for both
  // repetition and the n-move rule; a halfmove clock of 100+ means the fifty-move rule, otherwise repetition.
  if (board.result(false) === '*') {
    return { winner: null, reason: board.halfmoveClock() >= 100 ? 'fifty-move' : 'repetition' };
  }
  return { winner: null, reason: 'variant' };
}
