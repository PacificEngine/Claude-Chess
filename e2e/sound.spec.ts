import { expect, type Page, test } from '@playwright/test';
import type { ChessTestHooks } from '../src/ui/app';

declare global {
  interface Window {
    __chessTest?: ChessTestHooks;
  }
}

// A test can't listen, so the app (in test builds) records each cue it plays in window.__chessTest.sounds.

async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => self.crossOriginIsolated).catch(() => false), { timeout: 15000 }).toBe(true);
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', /.+/);
}

async function clickSquare(page: Page, square: string): Promise<void> {
  const box = (await page.locator('[data-testid=board] cg-board').boundingBox())!;
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square.slice(1)) - 1;
  await page.mouse.click(box.x + ((file + 0.5) * box.width) / 8, box.y + ((7 - rank + 0.5) * box.height) / 8);
}

async function move(page: Page, from: string, to: string, plies: number): Promise<void> {
  await clickSquare(page, from);
  await clickSquare(page, to);
  await expect(page.locator('[data-testid=move-list] .ply')).toHaveCount(plies);
}

const sounds = (page: Page) => page.evaluate(() => [...window.__chessTest!.sounds]);

async function turnSoundOn(page: Page): Promise<void> {
  await page.getByTestId('top-settings').click();
  const box = page.locator('#settings-sound');
  await expect(box).toBeEnabled();
  await expect(box).not.toBeChecked();
  await box.check();
  await page.getByTestId('settings-dialog').getByRole('button', { name: 'Save' }).click();
}

async function load(page: Page, fen: string): Promise<void> {
  await page.evaluate((f) => window.__chessTest!.loadFen('chess', f), fen);
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', fen);
}

test('sound starts off: a move plays nothing', async ({ page }) => {
  await openApp(page);
  await move(page, 'e2', 'e4', 1);
  expect(await sounds(page)).toEqual([]);
  await page.getByTestId('top-settings').click();
  await expect(page.locator('#settings-sound')).not.toBeChecked();
  await expect(page.getByTestId('settings-dialog')).toContainText('Sound');
  await expect(page.getByTestId('settings-dialog')).not.toContainText('not available');
});

test('with sound on, moves, captures and checks each play their sound, and a mate plays the win tune', async ({ page }) => {
  await openApp(page);
  await turnSoundOn(page);
  await move(page, 'f2', 'f3', 1);
  await move(page, 'e7', 'e5', 2);
  await move(page, 'g2', 'g4', 3);
  // Fool's mate: the check that ends the game plays the end sound, not the check sound.
  await move(page, 'd8', 'h4', 4);
  expect(await sounds(page)).toEqual(['move', 'move', 'move', 'win']);
  await load(page, 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
  await move(page, 'e4', 'd5', 1);
  await move(page, 'd8', 'd5', 2);
  await move(page, 'f1', 'b5', 3);
  expect((await sounds(page)).slice(-3)).toEqual(['capture', 'capture', 'check']);
});

test('undo, a new game and turning sound off are all silent', async ({ page }) => {
  await openApp(page);
  await turnSoundOn(page);
  await move(page, 'e2', 'e4', 1);
  await page.getByTestId('undo').click();
  await expect(page.locator('[data-testid=move-list] .ply')).toHaveCount(0);
  await load(page, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  expect(await sounds(page)).toEqual(['move']);
  await page.getByTestId('top-settings').click();
  await page.locator('#settings-sound').uncheck();
  await page.getByTestId('settings-dialog').getByRole('button', { name: 'Save' }).click();
  await move(page, 'd2', 'd4', 1);
  expect(await sounds(page)).toEqual(['move']);
});

test('settings saved while sound was unavailable come back with sound off', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('chess.settings', JSON.stringify({ version: 1, data: { highlightLegal: true, boardTheme: 'blue', pieceSet: 'default', sound: true } })),
  );
  await openApp(page);
  await page.getByTestId('top-settings').click();
  await expect(page.locator('#settings-sound')).not.toBeChecked();
  await expect(page.locator('#settings-theme')).toHaveValue('blue');
});

test('a solved tutorial puzzle plays the win tune', async ({ page }) => {
  await openApp(page);
  await turnSoundOn(page);
  await page.getByTestId('top-tutorial').click();
  await page.locator('[data-testid^="card-rook-"]').click();
  await page.getByTestId('step-3').click();
  await expect(page.getByTestId('lesson-heading')).toHaveText('Puzzle 1 of 4');
  const box = (await page.locator('[data-testid=tutorial-board] cg-board').boundingBox())!;
  await expect.poll(() => box.width).toBeGreaterThan(0);
  const at = (sq: string) => [box.x + ((sq.charCodeAt(0) - 97 + 0.5) * box.width) / 8, box.y + ((8 - Number(sq[1]) + 0.5) * box.height) / 8] as const;
  await page.mouse.click(...at('b1'));
  await page.mouse.click(...at('b5'));
  await expect(page.getByTestId('lesson-feedback')).toHaveText('Solved!');
  expect(await sounds(page)).toEqual(['win']);
});
