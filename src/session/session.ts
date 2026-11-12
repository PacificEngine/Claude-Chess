// One game: moves, per-ply snapshots, undo, clock, result and engine request ids. Pure: no DOM or UI imports.
import { AI_LEVELS, type AiLevelId } from '../engine/levels';
import type { Color, GameResult, Rules, RulesGame } from '../rules/types';
import { isSetupSpec, type SetupSpec } from '../variants/setup';
import { type ClockConfig, type ClockState, flagged, pause, press, resume, startClock } from './clock';

export type Opponent = { kind: 'hotseat' } | { kind: 'ai'; level: AiLevelId; aiColor: Color };

/** The position and clock before a ply. */
export interface Snapshot {
  fen: string;
  clock: ClockState;
}

/**
 * Plain, JSON-safe description of a session. snapshots[i] is the state before moves[i].
 * A custom game keeps the editor setup its variant was generated from, never the variants.ini text: stored
 * text must not reach the engine, so the app regenerates the definition from the setup and checks it.
 */
export interface SessionState {
  variant: string;
  setup?: SetupSpec;
  startFen: string;
  moves: string[];
  snapshots: Snapshot[];
  opponent: Opponent;
  clockConfig: ClockConfig;
  clock: ClockState;
  result: GameResult | null;
  engineRequestId: number;
}

const isColor = (c: unknown): c is Color => c === 'white' || c === 'black';
const isNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const isRecord = (d: unknown): d is Record<string, unknown> => typeof d === 'object' && d !== null;
const RESULT_REASONS: readonly string[] = [
  'checkmate', 'stalemate', 'repetition', 'fifty-move', 'insufficient', 'variant', 'timeout', 'timeout-insufficient',
] satisfies GameResult['reason'][];

function isClockState(d: unknown): d is ClockState {
  return (
    isRecord(d) &&
    isNumber(d.whiteMs) &&
    isNumber(d.blackMs) &&
    (d.running === null || isColor(d.running)) &&
    (d.since === null || isNumber(d.since))
  );
}

/**
 * Shape check for a SessionState read back from storage. It does not prove the moves are legal:
 * GameSession.restore replays them and throws if they are not.
 */
export function isSessionState(d: unknown): d is SessionState {
  if (!isRecord(d)) return false;
  const { opponent, clockConfig, result, moves, snapshots } = d;
  const opponentOk =
    isRecord(opponent) &&
    (opponent.kind === 'hotseat' ||
      (opponent.kind === 'ai' && isColor(opponent.aiColor) && AI_LEVELS.some((l) => l.id === opponent.level)));
  const clockConfigOk = clockConfig === null || (isRecord(clockConfig) && isNumber(clockConfig.baseMs) && isNumber(clockConfig.incrementMs));
  const resultOk =
    result === null ||
    (isRecord(result) && (result.winner === null || isColor(result.winner)) && RESULT_REASONS.includes(result.reason as string));
  return (
    typeof d.variant === 'string' &&
    // Plan 1 games could carry an ini; a stored one is refused rather than trusted.
    !('ini' in d) &&
    (d.setup === undefined || isSetupSpec(d.setup)) &&
    typeof d.startFen === 'string' &&
    Array.isArray(moves) &&
    moves.every((m) => typeof m === 'string') &&
    Array.isArray(snapshots) &&
    snapshots.length === moves.length &&
    snapshots.every((s) => isRecord(s) && typeof s.fen === 'string' && isClockState(s.clock)) &&
    opponentOk &&
    clockConfigOk &&
    isClockState(d.clock) &&
    resultOk &&
    isNumber(d.engineRequestId)
  );
}

const other = (c: Color): Color => (c === 'white' ? 'black' : 'white');
// Every ffish FEN carries the side to move as its second field.
const turnOfFen = (fen: string): Color => (fen.split(' ')[1] === 'b' ? 'black' : 'white');

export class GameSession {
  private constructor(
    private game: RulesGame,
    private s: SessionState,
  ) {}

  /**
   * A custom variant must already be registered (registerSetup): the session never loads one itself.
   * `clock`, when given, carries over times from an edited game: it starts from them, paused until the next move.
   */
  static create(
    rules: Rules,
    init: {
      variant: string;
      setup?: SetupSpec;
      fen?: string;
      opponent: Opponent;
      clockConfig: ClockConfig;
      clock?: ClockState;
    },
    now: number,
  ): GameSession {
    const game = rules.newGame(init.variant, init.fen);
    const state: SessionState = {
      variant: init.variant,
      ...(init.setup !== undefined && { setup: structuredClone(init.setup) }),
      startFen: game.fen(),
      moves: [],
      snapshots: [],
      opponent: structuredClone(init.opponent),
      clockConfig: init.clockConfig && { ...init.clockConfig },
      // Standard clocks: the side to move's time runs from the moment the game is created.
      clock: init.clock ? pause(init.clock, now) : startClock(init.clockConfig, game.turn(), now),
      result: game.result(),
      engineRequestId: 1,
    };
    const session = new GameSession(game, state);
    if (state.result) session.s.clock = pause(state.clock, now);
    return session;
  }

  /**
   * Rebuilds the game by replaying the saved moves from the saved start position. Throws if a move is
   * illegal or a snapshot's FEN is not the position before its move: the move list derives SAN from them.
   * As with create, a custom variant must already be registered.
   */
  static restore(rules: Rules, saved: SessionState): GameSession {
    const s = structuredClone(saved);
    const game = rules.newGame(s.variant, s.startFen);
    try {
      s.moves.forEach((uci, i) => {
        if (s.snapshots[i]?.fen !== game.fen()) throw new Error(`Saved snapshot ${i} does not match the replayed position`);
        game.push(uci);
      });
    } catch (e) {
      game.dispose();
      throw e;
    }
    return new GameSession(game, s);
  }

  state(): SessionState {
    return structuredClone(this.s);
  }

  /** Frees the wasm board. The session must not be used afterwards. */
  dispose(): void {
    this.game.dispose();
  }

  /** The current position, as ffish writes it. */
  fen(): string {
    return this.game.fen();
  }

  turn(): Color {
    return this.game.turn();
  }

  legalMovesFrom(sq: string): string[] {
    return this.s.result ? [] : this.game.legalMovesFrom(sq);
  }

  isHumanTurn(): boolean {
    return this.isHuman(this.game.turn());
  }

  /** A human move. Throws if the move is illegal, it is the AI's turn, the mover has flagged or the game is over. */
  play(uci: string, now: number): void {
    if (!this.isHumanTurn()) throw new Error(`Not the human's turn: ${uci}`);
    this.apply(uci, now);
  }

  canUndo(): boolean {
    const target = this.undoTarget();
    return target !== null && this.isHuman(turnOfFen(this.s.snapshots[target].fen));
  }

  /** Hot-seat: takes back one ply. Against the AI: takes back plies until it is the human's turn, never below ply 0. */
  undo(now: number): void {
    const target = this.undoTarget();
    if (target === null || !this.canUndo()) return;
    const snap = this.s.snapshots[target];
    while (this.s.moves.length > target) {
      this.game.pop();
      this.s.moves.pop();
    }
    this.s.snapshots.length = target;
    // Restore both times; the restored side to move starts its turn now.
    this.s.clock = { ...snap.clock, since: snap.clock.running === null ? null : now };
    this.s.result = null;
    this.s.engineRequestId++;
  }

  /** Starts an engine search. Only the latest request's bestmove is accepted. */
  beginEngineRequest(): number {
    return ++this.s.engineRequestId;
  }

  /** Plays the AI's move if the request is still current. Returns false for a stale or unusable bestmove. */
  acceptEngineMove(requestId: number, uci: string, now: number): boolean {
    if (requestId !== this.s.engineRequestId || this.s.result || this.isHumanTurn()) return false;
    if (this.checkFlag(now)) return false;
    this.apply(uci, now);
    return true;
  }

  /** Ends the game if a clock has run out. The flagged side loses unless the opponent cannot mate, which is a draw. */
  checkFlag(now: number): GameResult | null {
    if (this.s.result) return this.s.result;
    const loser = flagged(this.s.clock, now);
    if (loser === null) return null;
    const winner = other(loser);
    this.finish(
      this.game.hasInsufficientMaterial(winner)
        ? { winner: null, reason: 'timeout-insufficient' }
        : { winner, reason: 'timeout' },
      now,
    );
    return this.s.result;
  }

  pauseClock(now: number): void {
    this.s.clock = pause(this.s.clock, now);
  }

  resumeClock(now: number): void {
    if (this.s.result) return;
    this.s.clock = resume(this.s.clock, this.game.turn(), now);
  }

  private isHuman(color: Color): boolean {
    return this.s.opponent.kind === 'hotseat' || color !== this.s.opponent.aiColor;
  }

  // Index of the snapshot undo would return to, or null if there is nothing to take back.
  private undoTarget(): number | null {
    const n = this.s.moves.length;
    if (n === 0) return null;
    if (this.s.opponent.kind === 'hotseat') return n - 1;
    let i = n - 1;
    while (i > 0 && !this.isHuman(turnOfFen(this.s.snapshots[i].fen))) i--;
    return i;
  }

  private apply(uci: string, now: number): void {
    if (this.s.result) throw new Error(`Game is over: ${uci}`);
    // press() after a flag would add the increment back, so the flag is checked first.
    if (this.checkFlag(now)) throw new Error(`Flagged before moving: ${uci}`);
    const before: Snapshot = { fen: this.game.fen(), clock: this.s.clock };
    this.game.push(uci); // throws on an illegal move before anything changes
    this.s.snapshots.push(before);
    this.s.moves.push(uci);
    this.s.clock = press(this.s.clock, this.s.clockConfig, now);
    this.s.engineRequestId++;
    const result = this.game.result();
    if (result) this.finish(result, now);
  }

  private finish(result: GameResult, now: number): void {
    this.s.result = result;
    this.s.clock = pause(this.s.clock, now);
  }
}
