import { expect, test } from '@playwright/test';

test('engine answers bestmove on a server without isolation headers', async ({ page }) => {
  await page.goto('/spike/engine-spike.html');
  // The first visit reloads once when the service worker takes control, which destroys
  // the evaluation context mid-poll; treat that as "not isolated yet" and keep polling.
  await expect
    .poll(() => page.evaluate(() => self.crossOriginIsolated).catch(() => false), { timeout: 15000 })
    .toBe(true);
  const r = await page.evaluate(() => (window as any).runSpike());
  for (const v of ['chess','capablanca','grand','seirawan','amazon','shako','antichess','spartan','spikecustom'])
    expect(r.bestmove[v], v).toMatch(/^[a-l]\d+[a-l]\d+/);
  expect(r.ffishVariantsIncludeSpartan || r.spartanLoadedFromIni).toBe(true);
});
