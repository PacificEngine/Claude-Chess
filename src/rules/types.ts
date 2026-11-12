// Public rules types. The game session and UI depend on these, never on ffish directly.
export type Color = 'white' | 'black';

export type GameResult = {
  winner: Color | null;
  reason:
    | 'checkmate'
    | 'stalemate'
    | 'repetition'
    | 'fifty-move'
    | 'insufficient'
    | 'variant'
    | 'timeout'
    | 'timeout-insufficient';
};

export interface RulesGame {
  fen(): string;
  turn(): Color;
  legalMoves(): string[];
  legalMovesFrom(square: string): string[];
  san(uci: string): string;
  push(uci: string): void;
  pop(): void;
  result(): GameResult | null;
  hasInsufficientMaterial(color: Color): boolean;
  /** Whether the side to move is in check. */
  inCheck(): boolean;
  dispose(): void;
}

export interface Rules {
  newGame(variant: string, fen?: string): RulesGame;
  loadConfig(ini: string): void;
  /** Whether ffish has a variant of this name (built in, or loaded with `loadConfig`). */
  knows(name: string): boolean;
  validateFen(variant: string, fen: string): boolean;
}
