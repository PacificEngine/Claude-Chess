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

test('a setup with a designed nightrider registers and the engine plays a legal move in it', async ({ page }) => {
  const spec: SetupSpec = {
    base: 'chess',
    files: 8,
    ranks: 8,
    pieces: { k: 'king' },
    designed: { z: { id: 'nightrider', betza: 'NN', art: null } },
    fen: '7k/8/8/8/8/8/8/Z6K w - - 0 1',
    castling: false,
    promotion: { rank: 'last', pieceTypes: [] },
  };
  const r = await page.evaluate(async (spec) => {
    const { createEngine, loadRules, registerSetup } = window.__engineHarness;
    const rules = await loadRules();
    const engine = createEngine();
    await engine.ready;
    const result = await registerSetup(rules, engine, spec);
    if (!result.ok) return { result };
    await engine.setVariant(result.name, result.ini);
    const game = rules.newGame(result.name, spec.fen);
    const best = await engine.search({ fen: game.fen(), moves: [], level: 'beginner', clock: null, now: 0 });
    return { result, best, legal: game.legalMoves() };
  }, spec);
  expect(r.result.ok, JSON.stringify(r.result)).toBe(true);
  // The nightrider's three-jump ride is legal in ffish, so the designed piece really is a nightrider there.
  expect(r.legal).toContain('a1d7');
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

test("the engine deletes each variant file once it has read it, and still plays the variants it loaded", async ({ page }) => {
  const r = await page.evaluate(async (spec) => {
    const { createEngine, loadRules, generateVariant, registerSetup } = window.__engineHarness;
    const rules = await loadRules();
    const engine = createEngine();
    await engine.ready;
    // Twenty checks, as twenty designer previews would make, then a custom variant loaded for play.
    for (let i = 0; i < 20; i++) {
      const designed = { ...spec, designed: { z: { id: `p${i}`, betza: `W${(i % 7) + 1}`, art: null } }, fen: '7k/8/8/8/8/8/8/Z6K w - - 0 1' };
      await engine.check(generateVariant(designed).ini);
    }
    const result = await registerSetup(rules, engine, spec);
    if (!result.ok) return { result };
    await engine.setVariant(result.name, result.ini);
    const files = await engine.test!.variantFiles();
    // The loaded variant still plays after switching away and back by name alone.
    await engine.setVariant('chess');
    await engine.setVariant(result.name);
    const game = rules.newGame(result.name);
    const best = await engine.search({ fen: game.fen(), moves: [], level: 'beginner', clock: null, now: 0 });
    return { result, files, best, legal: game.legalMoves() };
  }, SPEC);
  expect(r.result.ok, JSON.stringify(r.result)).toBe(true);
  expect(r.files).toEqual([]);
  expect(r.legal).toContain(r.best);
});

test('the engine accepts every custom board in the tutorial', async ({ page }) => {
  test.setTimeout(120_000);
  // The content tests check lessons with ffish alone, which never refuses a variant; the lesson screen
  // registers custom boards through the engine's check too, so a board ffish accepts can still fail there.
  const refused = await page.evaluate(async () => {
    const { createEngine, loadRules, registerSetup, LESSONS } = window.__engineHarness;
    const rules = await loadRules();
    const engine = createEngine();
    await engine.ready;
    const setups: { lesson: string; spec: unknown }[] = [];
    const walk = (lesson: string, o: unknown): void => {
      if (!o || typeof o !== 'object') return;
      if ('setup' in o) setups.push({ lesson, spec: (o as { setup: unknown }).setup });
      for (const v of Object.values(o)) walk(lesson, v);
    };
    for (const l of LESSONS) walk(l.id, l.steps);
    const out: string[] = [];
    for (const { lesson, spec } of setups) {
      const r = await registerSetup(rules, engine, spec as Parameters<typeof registerSetup>[2]);
      if (!r.ok) out.push(`${lesson}: ${r.problems.join(' ')}`);
    }
    return { count: setups.length, out: [...new Set(out)] };
  });
  expect(refused.count).toBeGreaterThan(100);
  expect(refused.out).toEqual([]);
});
