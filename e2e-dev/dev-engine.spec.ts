import { expect, test } from '@playwright/test';

// `yarn dev` serves the engine worker unbundled, unlike the built site the main e2e suite tests.
test('the AI engine loads and replies under the dev server', async ({ page }) => {
  await page.goto('/');
  await expect
    .poll(() => page.evaluate(() => self.crossOriginIsolated).catch(() => false), { timeout: 15000 })
    .toBe(true);
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', /.+/);

  await page.getByTestId('top-play').click();
  const dialog = page.getByTestId('play-dialog');
  await expect(dialog).not.toContainText('Engine unavailable', { timeout: 15000 });
  await dialog.locator('#play-opponent').selectOption('beginner');
  await dialog.locator('#play-color').selectOption('white');
  await dialog.getByRole('button', { name: 'Start' }).click();
  await expect(dialog).toBeHidden();

  const board = page.locator('[data-testid=board] cg-board');
  const box = await board.boundingBox();
  if (!box) throw new Error('board has no layout box');
  const square = (file: number, rank: number) => ({ x: box.x + ((file + 0.5) * box.width) / 8, y: box.y + ((7 - rank + 0.5) * box.height) / 8 });
  const e2 = square(4, 1);
  const e4 = square(4, 3);
  await page.mouse.click(e2.x, e2.y);
  await page.mouse.click(e4.x, e4.y);
  await expect(page.locator('[data-testid=move-list] .ply')).toHaveCount(2, { timeout: 20000 });
});
