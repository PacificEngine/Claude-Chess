import { expect, test } from '@playwright/test';
import type { SetupSpec } from '../src/variants/setup';
import type { EngineHarness } from './pages/engine-harness';

declare global {
  interface Window {
    __engineHarness: EngineHarness;
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/e2e/pages/engine-harness.html');
  // The first visit reloads once when the service worker takes control; keep polling through it.
  await expect
    .poll(() => page.evaluate(() => self.crossOriginIsolated).catch(() => false), { timeout: 15000 })
    .toBe(true);
});

/** A setup with a king, queen and rook per side on an 8x8 chess base. */
const SPEC: SetupSpec = {
  base: 'chess',
  files: 8,
  ranks: 8,
  pieces: { k: 'king', q: 'queen', r: 'rook' },
  fen: 'r2qk3/8/8/8/8/8/8/R2QK3 w - - 0 1',
  castling: false,
  promotion: { rank: 'last', pieceTypes: ['q', 'r'] },
};

test('a valid setup registers in both ffish and the engine and the engine can move in it', async ({ page }) => {
  const r = await page.evaluate(async (spec) => {
    const { createEngine, loadRules, registerSetup } = window.__engineHarness;
    const rules = await loadRules();
    const engine = createEngine();
    await engine.ready;
    const result = await registerSetup(rules, engine, spec);
    if (!result.ok) return { result };
    await engine.setVariant(result.name, result.ini);
    const game = rules.newGame(result.name);
    const best = await engine.search({ fen: game.fen(), moves: [], level: 'beginner', clock: null, now: 0 });
    return { result, known: rules.knows(result.name), best, legal: game.legalMoves() };
  }, SPEC);
  expect(r.result.ok, JSON.stringify(r.result)).toBe(true);
  expect(r.known).toBe(true);
  expect(r.legal).toContain(r.best);
});

test('registering the same setup twice succeeds without an "already exists" error', async ({ page }) => {
  const [first, second] = await page.evaluate(async (spec) => {
    const { createEngine, loadRules, registerSetup } = window.__engineHarness;
    const rules = await loadRules();
    const engine = createEngine();
    await engine.ready;
    return [await registerSetup(rules, engine, spec), await registerSetup(rules, engine, spec)];
  }, SPEC);
  expect(first.ok).toBe(true);
  expect(second).toEqual(first);
});

test('an invalid definition is refused with the engine’s own problem lines', async ({ page }) => {
  const r = await page.evaluate(async (spec) => {
    const { createEngine, loadRules, generateVariant, registerIni } = window.__engineHarness;
    const rules = await loadRules();
    const engine = createEngine();
    await engine.ready;
    const { name, ini } = generateVariant(spec);
    const corrupted = `${ini}\ncustomPiece26 = z:K\nnotAnOption = 1\n`;
    const result = await registerIni(rules, engine, name, corrupted);
    // The engine stays usable after a refusal.
    const again = await engine.check(ini);
    return { result, known: rules.knows(name), again };
  }, SPEC);
  expect(r.result.ok).toBe(false);
  if (!r.result.ok) expect(r.result.problems.join('\n')).toMatch(/Invalid option/);
  expect(r.known).toBe(false);
  expect(r.again).toEqual([]);
});

test('a saved custom game whose engine check dies with the worker is kept for later, not called corrupt', async ({ page }) => {
  const r = await page.evaluate(async (spec) => {
    const { createEngine, loadRules, generateVariant, restorable } = window.__engineHarness;
    const rules = await loadRules();
    const engine = createEngine();
    await engine.ready;
    // The worker dies once the check has been sent, as a wasm crash in the middle of it would.
    const check = engine.check.bind(engine);
    engine.check = (ini) => {
      const answer = check(ini);
      engine.test!.killWorker();
      return answer;
    };
    const saved = {
      variant: generateVariant(spec).name,
      setup: spec,
      startFen: spec.fen,
      moves: [],
      snapshots: [],
      opponent: { kind: 'hotseat' as const },
      clockConfig: null,
      clock: { whiteMs: 1, blackMs: 1, running: null, since: null },
      result: null,
      engineRequestId: 1,
    };
    return { result: await restorable(rules, engine, saved), status: engine.status() };
  }, SPEC);
  expect(r.status).toBe('unavailable');
  expect(r.result).toEqual({ ok: false, reason: 'engine' });
});
