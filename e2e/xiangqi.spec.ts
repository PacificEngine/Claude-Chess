import { expect, type Page, test } from '@playwright/test';
import type { ChessTestHooks } from '../src/ui/app';

declare global {
  interface Window {
    __chessTest?: ChessTestHooks;
  }
}

// Black's general on d10 and White's on e1: White's general may not step to d1, where the two would face each
// other down an open file. ffish allows only e1e2 and e1f1 from e1. A soldier each keeps the game from being a
// dead draw, which would leave no moves at all.
const FEN_GENERALS = '3k5/9/9/p8/9/9/8P/9/9/4K4 w - - 0 1';

async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => self.crossOriginIsolated).catch(() => false), { timeout: 15000 }).toBe(true);
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', /.+/);
}

async function clickSquare(page: Page, square: string): Promise<void> {
  const board = page.getByTestId('board');
  const files = Number(await board.getAttribute('data-files'));
  const ranks = Number(await board.getAttribute('data-ranks'));
  const flipped = (await board.getAttribute('data-orientation')) === 'black';
  const box = (await page.locator('[data-testid=board] cg-board').boundingBox())!;
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square.slice(1)) - 1;
  const col = flipped ? files - 1 - file : file;
  const row = flipped ? rank : ranks - 1 - rank;
  await page.mouse.click(box.x + ((col + 0.5) * box.width) / files, box.y + ((row + 0.5) * box.height) / ranks);
}

async function move(page: Page, from: string, to: string): Promise<void> {
  await clickSquare(page, from);
  await clickSquare(page, to);
}

const plies = (page: Page) => page.locator('[data-testid=move-list] .ply');

async function newGame(page: Page, opponent: string): Promise<void> {
  await page.getByTestId('top-play').click();
  const dialog = page.getByTestId('play-dialog');
  await dialog.locator('#play-variant').selectOption('xiangqi');
  await dialog.locator('#play-opponent').selectOption(opponent);
  if (opponent !== 'hotseat') await dialog.locator('#play-color').selectOption('white');
  await dialog.locator('#play-clock').selectOption('None');
  await dialog.getByRole('button', { name: 'Start' }).click();
  await expect(dialog).toBeHidden();
  await expect(plies(page)).toHaveCount(0);
}

test('a hot-seat game plays the opening moves of both sides, with no pockets', async ({ page }) => {
  await openApp(page);
  await newGame(page, 'hotseat');
  await expect(page.getByTestId('game-line')).toHaveText('Xiangqi · Hot-seat');
  await expect(page.locator('[data-testid=board] .pocket')).toHaveCount(0);
  await move(page, 'h3', 'e3'); // the central cannon
  await expect(plies(page)).toHaveCount(1);
  await move(page, 'h8', 'e8');
  await expect(plies(page)).toHaveText(['Che3', 'Che8']);
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', 'rnbakabnr/9/1c2c4/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR w - - 2 2');
});

test('the AI at the beginner level replies with a legal move', async ({ page }) => {
  await openApp(page);
  await newGame(page, 'beginner');
  await move(page, 'h3', 'e3');
  await expect(plies(page).first()).toHaveText('Che3');
  await expect(plies(page)).toHaveCount(2, { timeout: 20000 });
  await expect(page.getByTestId('status')).toHaveText('White to move');
});

test('the generals may not face each other: the board offers only the moves the rules allow', async ({ page }) => {
  await openApp(page);
  await page.evaluate((f) => window.__chessTest!.loadFen('xiangqi', f), FEN_GENERALS);
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', FEN_GENERALS);
  await clickSquare(page, 'e1');
  await expect(page.locator('[data-testid=board] square.move-dest')).toHaveCount(2);
  await clickSquare(page, 'd1');
  await expect(plies(page)).toHaveCount(0);
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', FEN_GENERALS);
  await move(page, 'e1', 'e2');
  await expect(plies(page)).toHaveCount(1);
});
