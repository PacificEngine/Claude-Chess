import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestRules } from '../rules/test-rules';
import type { Color, Rules } from '../rules/types';
import { generateVariant } from '../variants/generator';
import type { SetupSpec } from '../variants/setup';
import type { ClockConfig } from './clock';
import { GameSession, isSessionState } from './session';

const BIG = 10_000_000;
// White has only a king, so it cannot mate; Black (K+R) is to move and its clock is running.
const FEN_K_VS_KR_BLACK_TO_MOVE = '7r/8/8/8/8/2k5/8/K7 b - - 0 1';
// Same material reversed in spirit: White (K+R) can mate, Black (K) is to move.
const FEN_KR_VS_K_BLACK_TO_MOVE = '8/8/8/8/8/2k5/8/K6R b - - 0 1';
const FEN_FOOLS_MATE_BEFORE_QH4 = 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2';

/** A custom setup, and the variant name the generator gives it. */
const setup: SetupSpec = {
  base: 'chess',
  files: 8,
  ranks: 8,
  pieces: { k: 'king', q: 'queen', r: 'rook' },
  fen: 'r2qk3/8/8/8/8/8/8/R2QK3 w - - 0 1',
  castling: false,
  promotion: { rank: 'last', pieceTypes: ['q', 'r'] },
};
const { name, ini } = generateVariant(setup);

let rules: Rules;
beforeAll(async () => {
  rules = await loadTestRules();
  // The caller registers a custom variant before creating or restoring its game (the app via registerSetup).
  rules.loadConfig(ini);
});

const hotseat = (clockConfig: ClockConfig = null, fen?: string) =>
  GameSession.create(rules, { variant: 'chess', fen, opponent: { kind: 'hotseat' }, clockConfig }, 0);

const vsAi = (aiColor: Color) =>
  GameSession.create(
    rules,
    { variant: 'chess', opponent: { kind: 'ai', level: 'beginner', aiColor }, clockConfig: null },
    0,
  );

const sessionWithKingVsKingRook_blackFlags = () => hotseat({ baseMs: 60000, incrementMs: 0 }, FEN_K_VS_KR_BLACK_TO_MOVE);

it('accepts every hand-built test position as a legal FEN', () => {
  for (const fen of [FEN_K_VS_KR_BLACK_TO_MOVE, FEN_KR_VS_K_BLACK_TO_MOVE, FEN_FOOLS_MATE_BEFORE_QH4]) {
    expect(rules.validateFen('chess', fen), fen).toBe(true);
  }
});

describe('against the AI', () => {
  it('undo returns to the human turn by taking back the AI reply and the human move', () => {
    const s = vsAi('black'); s.play('e2e4', 0); s.acceptEngineMove(s.beginEngineRequest(), 'e7e5', 1);
    s.undo(2); expect(s.state().moves).toEqual([]); expect(s.isHumanTurn()).toBe(true);
  });
  it('throws away a bestmove that arrives after undo, so a stale search cannot corrupt the game', () => {
    const s = vsAi('black'); s.play('e2e4', 0); const id = s.beginEngineRequest(); s.undo(1);
    expect(s.acceptEngineMove(id, 'e7e5', 2)).toBe(false); expect(s.state().moves).toEqual([]);
  });
  it('rejects a bestmove from a search started before undo even once the AI is to move again', () => {
    const s = vsAi('black'); s.play('e2e4', 0); const id = s.beginEngineRequest(); s.undo(1); s.play('d2d4', 2);
    expect(s.acceptEngineMove(id, 'e7e5', 3)).toBe(false); expect(s.state().moves).toEqual(['d2d4']);
  });
  it('does not let the human move for the AI', () => {
    const s = vsAi('black'); s.play('e2e4', 0);
    expect(s.isHumanTurn()).toBe(false); expect(() => s.play('e7e5', 1)).toThrow();
  });
  it('cannot undo when the AI made the only move, since the AI would just play it again', () => {
    const s = vsAi('white'); expect(s.acceptEngineMove(s.beginEngineRequest(), 'e2e4', 1)).toBe(true);
    expect(s.canUndo()).toBe(false);
  });
});

it('hot-seat undo takes back exactly one ply', () => {
  const s = hotseat(); s.play('e2e4', 0); s.play('e7e5', 1); s.undo(2); expect(s.state().moves).toEqual(['e2e4']);
});

it('restores both clock times from the snapshot when undoing', () => {
  const s = hotseat({ baseMs: 60000, incrementMs: 0 }); s.play('e2e4', 10000); s.play('e7e5', 25000); s.undo(30000);
  expect(s.state().clock).toMatchObject({ whiteMs: 50000, blackMs: 60000, running: 'black' });
});

it('keeps one snapshot per ply holding the position before that ply', () => {
  const s = hotseat(); const start = s.state().startFen; s.play('e2e4', 0);
  expect(s.state().snapshots.map((x) => x.fen)).toEqual([start]);
});

it('scores a flag as a draw when the opponent cannot mate', () =>
  expect(sessionWithKingVsKingRook_blackFlags().checkFlag(BIG)).toEqual({ winner: null, reason: 'timeout-insufficient' }));

it('scores a flag as a loss when the opponent can still mate', () =>
  expect(hotseat({ baseMs: 60000, incrementMs: 0 }, FEN_KR_VS_K_BLACK_TO_MOVE).checkFlag(BIG))
    .toEqual({ winner: 'white', reason: 'timeout' }));

it('rejects a move made after the mover flagged and records the timeout', () => {
  const s = hotseat({ baseMs: 60000, incrementMs: 0 });
  expect(() => s.play('e2e4', 70000)).toThrow();
  expect(s.state().result).toEqual({ winner: 'black', reason: 'timeout' }); expect(s.state().moves).toEqual([]);
});

it('ends the game on checkmate, stops the clock and rejects further moves', () => {
  const s = hotseat({ baseMs: 60000, incrementMs: 0 }, FEN_FOOLS_MATE_BEFORE_QH4); s.play('d8h4', 1000);
  expect(s.state().result).toEqual({ winner: 'black', reason: 'checkmate' });
  expect(s.state().clock.running).toBeNull(); expect(() => s.play('e1f2', 2000)).toThrow();
});

it('undoing out of a finished game clears the result so play can continue', () => {
  const s = hotseat(null, FEN_FOOLS_MATE_BEFORE_QH4); s.play('d8h4', 0); s.undo(1);
  expect(s.state().result).toBeNull(); expect(s.legalMovesFrom('d8')).toContain('d8h4');
});

it('rejects an illegal move without changing the game', () => {
  const s = hotseat(); expect(() => s.play('e2e5', 0)).toThrow(); expect(s.state().moves).toEqual([]);
});

it('bumps the engine request id on create, play and undo', () => {
  const s = hotseat(); const a = s.state().engineRequestId; s.play('e2e4', 0); const b = s.state().engineRequestId;
  s.undo(1); expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(a); expect(s.state().engineRequestId).toBeGreaterThan(b);
});

it('round-trips through state() and restore() so a reload resumes the same game', () => {
  const s = hotseat(); s.play('e2e4', 0);
  expect(GameSession.restore(rules, JSON.parse(JSON.stringify(s.state()))).state()).toEqual(s.state());
});

it('refuses to restore a save whose snapshot FEN does not match the replayed position', () => {
  // The move list would render its SAN from these FENs, so a tampered one must never get that far.
  const s = hotseat(); s.play('e2e4', 0); s.play('e7e5', 1);
  for (const fen of ['garbage', '8/8/8/8/8/8/8/K6k w - - 0 1']) {
    const saved = s.state();
    saved.snapshots[1].fen = fen;
    expect(() => GameSession.restore(rules, saved), fen).toThrow(/snapshot/);
  }
});

it('hands out state that callers cannot use to mutate the session', () => {
  const s = hotseat(); s.state().moves.push('e2e4'); expect(s.state().moves).toEqual([]);
});

it('reports the current position and side to move so the board can draw it', () => {
  const s = hotseat();
  expect(s.turn()).toBe('white');
  s.play('e2e4', 0);
  expect(s.fen()).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
  expect(s.turn()).toBe('black');
});

describe('isSessionState', () => {
  const saved = () => {
    const s = hotseat({ baseMs: 60000, incrementMs: 0 });
    s.play('e2e4', 10);
    return JSON.parse(JSON.stringify(s.state())) as unknown;
  };

  it('accepts a state that went through JSON', () => expect(isSessionState(saved())).toBe(true));

  it('accepts an AI game with no clock', () => expect(isSessionState(vsAi('black').state())).toBe(true));

  it.each([
    ['null', () => null],
    ['missing moves', () => ({ ...(saved() as object), moves: undefined })],
    ['a non-string move', () => ({ ...(saved() as object), moves: [42] })],
    ['snapshots that do not match the moves', () => ({ ...(saved() as object), snapshots: [] })],
    ['an unknown opponent', () => ({ ...(saved() as object), opponent: { kind: 'robot' } })],
    ['an unknown AI level', () => ({ ...(saved() as object), opponent: { kind: 'ai', level: 'god', aiColor: 'black' } })],
    ['a bad clock', () => ({ ...(saved() as object), clock: { whiteMs: '1', blackMs: 1, running: null, since: null } })],
    ['a bad result', () => ({ ...(saved() as object), result: { winner: 'green', reason: 'checkmate' } })],
  ])('rejects %s', (_, make) => expect(isSessionState(make())).toBe(false));
});

describe('custom games', () => {
  const hotseat = { kind: 'hotseat' } as const;
  const cfg: ClockConfig = { baseMs: 60000, incrementMs: 0 };

  it('stores a custom game by its setup, never by ini text', () => {
    const s = GameSession.create(rules, { variant: name, setup, opponent: hotseat, clockConfig: null }, 0);
    expect(s.state()).toMatchObject({ setup }); expect('ini' in s.state()).toBe(false);
  });
  it('can start from carried-over paused clock times so editing costs no time', () => {
    const s = GameSession.create(rules, { variant: 'chess', opponent: hotseat, clockConfig: cfg, clock: { whiteMs: 1000, blackMs: 2000, running: null, since: null } }, 0);
    expect(s.state().clock).toMatchObject({ whiteMs: 1000, blackMs: 2000, running: null });
  });
  it('restores a custom game the caller registered, keeping its setup', () => {
    const s = GameSession.create(rules, { variant: name, setup, opponent: hotseat, clockConfig: null }, 0);
    s.play('d1d7', 0);
    const back = GameSession.restore(rules, JSON.parse(JSON.stringify(s.state())));
    expect(back.state()).toEqual(s.state());
  });
  it('never loads a variant itself, so an unregistered custom game cannot be restored', () => {
    const saved = GameSession.create(rules, { variant: 'chess', opponent: hotseat, clockConfig: null }, 0).state();
    expect(() => GameSession.restore(rules, { ...saved, variant: 'cx_00000000' })).toThrow();
  });
  it('accepts a saved custom game and rejects a stored ini or a malformed setup', () => {
    const saved = JSON.parse(JSON.stringify(
      GameSession.create(rules, { variant: name, setup, opponent: hotseat, clockConfig: null }, 0).state(),
    )) as Record<string, unknown>;
    expect(isSessionState(saved)).toBe(true);
    expect(isSessionState({ ...saved, ini })).toBe(false);
    expect(isSessionState({ ...saved, setup: { ...setup, castling: 'yes' } })).toBe(false);
    expect(isSessionState({ ...saved, setup: null })).toBe(false);
  });
});
