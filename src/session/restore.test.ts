import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Engine, EngineStatus } from '../engine/engine';
import { loadTestRules } from '../rules/test-rules';
import type { Rules } from '../rules/types';
import { generateVariant } from '../variants/generator';
import type { SetupSpec } from '../variants/setup';
import { checkWithoutEngine, restorable, restoreInBackground } from './restore';
import { GameSession, type SessionState } from './session';

let rules: Rules;
beforeAll(async () => {
  rules = await loadTestRules();
});

// Each test gets its own setup (the White queen stands on another square), so each has a name ffish doesn't
// know yet and the engine's check really runs.
let next = 0;
const freshSetup = (over: Partial<SetupSpec> = {}): SetupSpec => {
  const file = next % 8;
  const rank = 2 + Math.floor(next / 8); // ranks 2 to 7
  next++;
  const rows = Array.from({ length: 8 }, (_, i) => {
    const r = 8 - i;
    if (r === 8) return '4k3';
    if (r === 1) return '4K3';
    return r === rank ? `${file || ''}Q${7 - file || ''}` : '8';
  });
  return {
    base: 'chess',
    files: 8,
    ranks: 8,
    pieces: { k: 'king', q: 'queen' },
    fen: `${rows.join('/')} w - - 0 1`,
    castling: false,
    promotion: { rank: 'last', pieceTypes: ['q'] },
    ...over,
  };
};

/** A saved custom game at its start, as the app would store it. */
const savedCustom = (setup: SetupSpec): SessionState => ({
  variant: generateVariant(setup).name,
  setup,
  startFen: setup.fen,
  moves: [],
  snapshots: [],
  opponent: { kind: 'hotseat' },
  clockConfig: null,
  clock: { whiteMs: 1, blackMs: 1, running: null, since: null },
  result: null,
  engineRequestId: 1,
});

/** The registry only uses `status` and `check`; restorable also awaits `ready`. */
function fakeEngine(check: (ini: string) => Promise<string[]>, status: EngineStatus = 'ready') {
  const engine = { ready: Promise.resolve(), status: () => status, check: vi.fn(check) };
  return { engine: engine as unknown as Engine, check: engine.check, setStatus: (s: EngineStatus) => (status = s) };
}

const curatedSave = (): SessionState => {
  const s = GameSession.create(rules, { variant: 'chess', opponent: { kind: 'hotseat' }, clockConfig: null }, 0);
  s.play('e2e4', 0);
  return s.state();
};

describe('checkWithoutEngine', () => {
  it('settles a curated game straight away', () => expect(checkWithoutEngine(rules, curatedSave())).toEqual({ ok: true }));

  it('calls a curated game that does not replay corrupt', () => {
    const saved = curatedSave();
    saved.snapshots[0].fen = 'garbage';
    expect(checkWithoutEngine(rules, saved)).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('calls a game in an unknown variant with no setup corrupt', () =>
    expect(checkWithoutEngine(rules, { ...curatedSave(), variant: 'cx_00000000' })).toEqual({ ok: false, reason: 'corrupt' }));

  it('leaves a custom game to the engine', () => expect(checkWithoutEngine(rules, savedCustom(freshSetup()))).toBeNull());

  it('calls a custom game corrupt without the engine when its setup no longer validates or names another variant', () => {
    const bad = savedCustom(freshSetup());
    expect(checkWithoutEngine(rules, { ...bad, setup: { ...bad.setup!, files: 13 } })).toEqual({ ok: false, reason: 'corrupt' });
    expect(checkWithoutEngine(rules, { ...bad, variant: 'cx_00000000' })).toEqual({ ok: false, reason: 'corrupt' });
  });
});

describe('restorable', () => {
  it('registers a valid custom game and hands back its regenerated ini for the engine', async () => {
    const saved = savedCustom(freshSetup());
    const { engine, check } = fakeEngine(async () => []);
    const r = await restorable(rules, engine, saved);
    expect(r).toEqual({ ok: true, ini: generateVariant(saved.setup!).ini });
    expect(check).toHaveBeenCalledOnce();
    expect(rules.knows(saved.variant)).toBe(true);
  });

  it('keeps the save (engine, not corrupt) when the engine crashes during the check', async () => {
    const fake = fakeEngine(async () => {
      fake.setStatus('unavailable');
      throw new Error('worker died');
    });
    expect(await restorable(rules, fake.engine, savedCustom(freshSetup()))).toEqual({ ok: false, reason: 'engine' });
  });

  it('keeps the save when the engine stopped being ready while it checked', async () => {
    const fake = fakeEngine(async () => {
      fake.setStatus('unavailable');
      return ['partial output'];
    });
    expect(await restorable(rules, fake.engine, savedCustom(freshSetup()))).toEqual({ ok: false, reason: 'engine' });
  });

  it('keeps the save when there is no working engine at all', async () => {
    expect(await restorable(rules, null, savedCustom(freshSetup()))).toEqual({ ok: false, reason: 'engine' });
    const { engine } = fakeEngine(async () => [], 'unavailable');
    expect(await restorable(rules, engine, savedCustom(freshSetup()))).toEqual({ ok: false, reason: 'engine' });
  });

  it('calls a custom game corrupt when the working engine refuses its definition', async () => {
    const { engine } = fakeEngine(async () => ['Invalid option: maxFile']);
    expect(await restorable(rules, engine, savedCustom(freshSetup()))).toEqual({ ok: false, reason: 'corrupt' });
  });

  it("calls a custom game corrupt, without asking the engine, when it gives a base letter another type", async () => {
    const setup = freshSetup({ pieces: { k: 'king', q: 'archbishop' } });
    const { engine, check } = fakeEngine(async () => []);
    expect(await restorable(rules, engine, savedCustom(setup))).toEqual({ ok: false, reason: 'corrupt' });
    expect(check).not.toHaveBeenCalled();
  });

  it('calls a custom game corrupt when its moves do not replay', async () => {
    const saved = { ...savedCustom(freshSetup()), moves: ['a1a9'], snapshots: [{ fen: 'x', clock: { whiteMs: 1, blackMs: 1, running: null, since: null } }] };
    const { engine } = fakeEngine(async () => []);
    expect(await restorable(rules, engine, saved)).toEqual({ ok: false, reason: 'corrupt' });
  });
});

describe('restoreInBackground', () => {
  it('reports the result when nothing superseded the restore', async () => {
    const onResult = vi.fn();
    const { engine } = fakeEngine(async () => []);
    await restoreInBackground(rules, engine, savedCustom(freshSetup()), onResult).done;
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it('drops the result once cancelled, so a new game or a move made meanwhile is not replaced', async () => {
    const onResult = vi.fn();
    const { engine } = fakeEngine(async () => []);
    const pending = restoreInBackground(rules, engine, savedCustom(freshSetup()), onResult);
    pending.cancel();
    await pending.done;
    expect(onResult).not.toHaveBeenCalled();
  });
});
