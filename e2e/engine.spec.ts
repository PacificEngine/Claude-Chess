import { expect, test } from '@playwright/test';
import type { EngineHarness } from './pages/engine-harness';

declare global {
  interface Window {
    __engineHarness: EngineHarness;
  }
}

test('engine returns a legal bestmove for every curated variant at the beginner level', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/e2e/pages/engine-harness.html');
  // The first visit reloads once when the service worker takes control; keep polling through it.
  await expect
    .poll(() => page.evaluate(() => self.crossOriginIsolated).catch(() => false), { timeout: 15000 })
    .toBe(true);

  const results = await page.evaluate(async () => {
    const { createEngine, loadRules, CURATED_VARIANTS } = window.__engineHarness;
    const rules = await loadRules();
    const engine = createEngine();
    await engine.ready;
    const out: { id: string; status: string; best: string; legal: string[] }[] = [];
    for (const v of CURATED_VARIANTS) {
      await engine.setVariant(v.engineName);
      const game = rules.newGame(v.engineName);
      const best = await engine.search({ fen: game.fen(), moves: [], level: 'beginner', clock: null, now: 0 });
      out.push({ id: v.id, status: engine.status(), best, legal: game.legalMoves() });
      game.dispose();
    }
    return out;
  });

  expect(results.length).toBeGreaterThan(0);
  for (const r of results) {
    expect(r.status, r.id).toBe('ready');
    expect(r.legal, `${r.id}: ${r.best}`).toContain(r.best);
  }
});

test('a second search stops the first and both settle', async ({ page }) => {
  await page.goto('/e2e/pages/engine-harness.html');
  await expect
    .poll(() => page.evaluate(() => self.crossOriginIsolated).catch(() => false), { timeout: 15000 })
    .toBe(true);
  const [first, second] = await page.evaluate(async () => {
    const { createEngine, loadRules } = window.__engineHarness;
    const rules = await loadRules();
    const engine = createEngine();
    await engine.ready;
    await engine.setVariant('chess');
    const fen = rules.newGame('chess').fen();
    const a = engine.search({ fen, moves: [], level: 'max', clock: null, now: 0 });
    const b = engine.search({ fen, moves: [], level: 'beginner', clock: null, now: 0 });
    return Promise.all([a, b]);
  });
  expect(first).toMatch(/^[a-h][1-8][a-h][1-8]/);
  expect(second).toMatch(/^[a-h][1-8][a-h][1-8]/);
});

// Faults are injected through the adapter's test-mode hooks into the real worker: nothing is mocked.
const FEN_FOOLS_MATE = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';

async function openHarness(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/e2e/pages/engine-harness.html');
  await expect
    .poll(() => page.evaluate(() => self.crossOriginIsolated).catch(() => false), { timeout: 15000 })
    .toBe(true);
}

for (const fault of ['killWorker', 'breakWorker'] as const) {
  test(`a worker that dies mid-search (${fault}) marks the engine unavailable and settles every request`, async ({ page }) => {
    test.setTimeout(60_000);
    await openHarness(page);
    const out = await page.evaluate(async (fault) => {
      const { createEngine, loadRules } = window.__engineHarness;
      const rules = await loadRules();
      const engine = createEngine();
      const statuses: string[] = [];
      engine.onStatus((s, reason) => statuses.push(reason ? `${s}: ${reason}` : s));
      await engine.ready;
      await engine.setVariant('chess');
      const fen = rules.newGame('chess').fen();
      const settle = (p: Promise<unknown>) =>
        p.then(
          (v) => `resolved ${String(v)}`,
          (e: unknown) => `rejected ${e instanceof Error ? e.message : String(e)}`,
        );
      const t0 = performance.now();
      const search = settle(engine.search({ fen, moves: [], level: 'max', clock: null, now: 0 }));
      await new Promise((r) => setTimeout(r, 300));
      engine.test![fault]();
      const first = await search;
      const elapsed = performance.now() - t0;
      const t1 = performance.now();
      const later = await settle(engine.search({ fen, moves: [], level: 'beginner', clock: null, now: 0 }));
      const variant = await settle(engine.setVariant('grand'));
      return { first, elapsed, later, variant, laterMs: performance.now() - t1, status: engine.status(), statuses };
    }, fault);
    expect(out.first).toMatch(/^rejected /);
    expect(out.later).toMatch(/^rejected /);
    expect(out.variant).toMatch(/^rejected /);
    expect(out.laterMs).toBeLessThan(500); // nothing queues behind a dead engine
    expect(out.status).toBe('unavailable');
    expect(out.statuses[0]).toBe('loading');
    expect(out.statuses).toContain('ready');
    expect(out.statuses.at(-1)).toMatch(/^unavailable: .+/);
    // A crash the worker reports is noticed at once; a silent one by the watchdog (Max's 3 s movetime + margin).
    if (fault === 'breakWorker') expect(out.elapsed).toBeLessThan(2500);
    else expect(out.elapsed).toBeLessThan(3000 + 5000 + 1500);
  });
}

test('a worker that dies while a variant is being set marks the engine unavailable instead of hanging', async ({ page }) => {
  test.setTimeout(60_000);
  await openHarness(page);
  const out = await page.evaluate(async () => {
    const { createEngine } = window.__engineHarness;
    const engine = createEngine();
    await engine.ready;
    const t0 = performance.now();
    const variant = engine.setVariant('grand');
    engine.test!.killWorker(); // before the job even sends its commands, so readyok can never come
    const result = await variant.then(
      () => 'resolved',
      (e: unknown) => `rejected ${e instanceof Error ? e.message : String(e)}`,
    );
    return { result, elapsed: performance.now() - t0, status: engine.status() };
  });
  expect(out.result).toMatch(/^rejected .*readyok/);
  expect(out.status).toBe('unavailable');
  expect(out.elapsed).toBeLessThan(15000 + 2000); // ENGINE_STARTUP_TIMEOUT_MS reused as the readyok deadline
});

test('a search that finds no move rejects but leaves the engine ready for the next one', async ({ page }) => {
  await openHarness(page);
  const out = await page.evaluate(async (mated) => {
    const { createEngine, loadRules } = window.__engineHarness;
    const rules = await loadRules();
    const engine = createEngine();
    await engine.ready;
    await engine.setVariant('chess');
    const fen = rules.newGame('chess').fen();
    engine.test!.searchFenOnce(mated);
    const first = await engine.search({ fen, moves: [], level: 'beginner', clock: null, now: 0 }).then(
      (m) => `resolved ${m}`,
      (e: unknown) => `rejected ${e instanceof Error ? e.message : String(e)}`,
    );
    const status = engine.status();
    const second = await engine.search({ fen, moves: [], level: 'beginner', clock: null, now: 0 });
    return { first, status, second, legal: rules.newGame('chess').legalMoves() };
  }, FEN_FOOLS_MATE);
  expect(out.first).toMatch(/^rejected .*no move/i);
  expect(out.status).toBe('ready');
  expect(out.legal).toContain(out.second);
});
