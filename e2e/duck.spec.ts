import { expect, type Page, test } from '@playwright/test';
import type { ChessTestHooks } from '../src/ui/app';

declare global {
  interface Window {
    __chessTest?: ChessTestHooks;
  }
}

// Hand-built positions, each checked against ffish when the tests were written.
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// White's rook on e2 can take Black's king on e8; the duck stands on a1.
const FEN_ROOK_TAKES_KING = '4k3/8/8/8/8/8/4R3/*3K3 w - - 0 1';
// White's pawn on a7 promotes on a8; the duck stands on a1.
const FEN_PAWN_PROMOTES = '4k3/P7/8/8/8/8/8/*3K3 w - - 0 1';

async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => self.crossOriginIsolated).catch(() => false), { timeout: 15000 }).toBe(true);
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', /.+/);
}

/** Starts a hot-seat Duck Chess game from a FEN. */
async function load(page: Page, fen: string): Promise<void> {
  await page.evaluate((f) => window.__chessTest!.loadFen('duck', f), fen);
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', fen);
}

async function newGame(page: Page, opponent: string, color: 'white' | 'black' = 'white'): Promise<void> {
  await page.getByTestId('top-play').click();
  const dialog = page.getByTestId('play-dialog');
  await dialog.locator('#play-variant').selectOption('duck');
  await dialog.locator('#play-opponent').selectOption(opponent);
  if (opponent !== 'hotseat') await dialog.locator('#play-color').selectOption(color);
  await dialog.locator('#play-clock').selectOption('None');
  await dialog.getByRole('button', { name: 'Start' }).click();
  await expect(dialog).toBeHidden();
}

/** The centre of a UCI square on the page, honouring the board's size and orientation. */
async function squareCentre(page: Page, square: string): Promise<{ x: number; y: number }> {
  const board = page.getByTestId('board');
  const files = Number(await board.getAttribute('data-files'));
  const ranks = Number(await board.getAttribute('data-ranks'));
  const flipped = (await board.getAttribute('data-orientation')) === 'black';
  const box = (await page.locator('[data-testid=board] cg-board').boundingBox())!;
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square.slice(1)) - 1;
  const col = flipped ? files - 1 - file : file;
  const row = flipped ? rank : ranks - 1 - rank;
  return { x: box.x + ((col + 0.5) * box.width) / files, y: box.y + ((row + 0.5) * box.height) / ranks };
}

async function clickSquare(page: Page, square: string): Promise<void> {
  const { x, y } = await squareCentre(page, square);
  await page.mouse.click(x, y);
}

async function move(page: Page, from: string, to: string): Promise<void> {
  await clickSquare(page, from);
  await clickSquare(page, to);
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

const board = (page: Page) => page.getByTestId('board');
const tray = (page: Page) => page.locator('[data-testid=board] [data-testid=duck-tray]');
const trayDuck = (page: Page) => tray(page).locator('piece');
/** The ducks on the board itself (not the one beside it). */
const boardDucks = (page: Page) => page.locator('[data-testid=board] cg-board piece._-piece');
const lastMoveSquares = (page: Page) => page.locator('[data-testid=board] cg-board square.last-move');
/** The UCI squares chessgroundx lights as the last move, sorted (8x8 keys read as UCI). */
const lastMoveKeys = (page: Page) =>
  lastMoveSquares(page).evaluateAll((els) => els.map((el) => (el as HTMLElement & { cgKey: string }).cgKey).sort());
const plies = (page: Page) => page.locator('[data-testid=move-list] .ply');
const placement = async (page: Page) => (await board(page).getAttribute('data-fen'))!.split(' ')[0];

/** Drags the duck waiting beside the board onto a square. */
async function dragDuckOn(page: Page, square: string): Promise<void> {
  await expect(trayDuck(page)).toBeVisible();
  const box = (await trayDuck(page).boundingBox())!;
  await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, await squareCentre(page, square));
}

test('on the first turn the duck waits lit up beside the board and is dragged on, onto an empty square only', async ({ page }) => {
  await openApp(page);
  await newGame(page, 'hotseat');
  await expect(tray(page)).toBeHidden();
  await move(page, 'e2', 'e4');
  // The piece has moved, the turn is not over, and the duck waits beside the board, lit up.
  await expect(board(page)).toHaveAttribute('data-duck-step', 'true');
  expect(await placement(page)).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR');
  await expect(plies(page)).toHaveCount(0);
  await expect(page.getByTestId('status')).toHaveText('White: move the duck');
  await expect(tray(page)).toBeVisible();
  await expect(trayDuck(page)).toHaveClass(/duck-lit/);
  expect(await trayDuck(page).evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('pieces/duck/duck.svg');
  // An occupied square is not offered: the duck stays beside the board.
  await dragDuckOn(page, 'd2');
  await expect(plies(page)).toHaveCount(0);
  await expect(tray(page)).toBeVisible();

  await dragDuckOn(page, 'd5');
  await expect(plies(page)).toHaveText(['e4,d5']);
  await expect(board(page)).not.toHaveAttribute('data-duck-step', 'true');
  expect(await placement(page)).toBe('rnbqkbnr/pppppppp/8/3*4/4P3/8/PPPP1PPP/RNBQKBNR');
  await expect(tray(page)).toBeHidden();
  await expect(boardDucks(page)).toHaveCount(1);
  await expect(page.getByTestId('status')).toHaveText('Black to move');
});

test('the waiting duck can also be clicked and then put on a square, shown only its squares', async ({ page }) => {
  await openApp(page);
  await newGame(page, 'hotseat');
  await move(page, 'e2', 'e4');
  await expect(trayDuck(page)).toBeVisible();
  await trayDuck(page).click();
  // Every empty square, and only those: 64 squares less 32 pieces.
  await expect(page.locator('[data-testid=board] .board-mark.move')).toHaveCount(32);
  await expect(page.locator('[data-testid=board] .board-mark.move[data-square=d2]')).toHaveCount(0);
  await clickSquare(page, 'f6');
  await expect(plies(page)).toHaveText(['e4,f6']);
  await expect(page.locator('[data-testid=board] .board-mark')).toHaveCount(0);
});

test('in hot-seat Black moves the duck too, by clicking it and then a square, and only empty squares are offered', async ({ page }) => {
  await openApp(page);
  await newGame(page, 'hotseat');
  await move(page, 'e2', 'e4');
  await dragDuckOn(page, 'd5');
  await expect(plies(page)).toHaveCount(1);

  await move(page, 'e7', 'e5');
  await expect(board(page)).toHaveAttribute('data-duck-step', 'true');
  await expect(page.getByTestId('status')).toHaveText('Black: move the duck');
  await expect(tray(page)).toBeHidden();
  // The duck on d5 is lit up; nothing else is.
  await expect(boardDucks(page)).toHaveCount(1);
  await expect(boardDucks(page)).toHaveClass(/duck-lit/);
  await expect(page.locator('[data-testid=board] cg-board piece.duck-lit')).toHaveCount(1);
  await clickSquare(page, 'd5');
  // Every empty square, and only those: 64 squares less 32 pieces and the duck itself.
  await expect(page.locator('[data-testid=board] cg-board square.move-dest')).toHaveCount(31);
  await clickSquare(page, 'a3');
  await expect(plies(page)).toHaveText(['e4,d5', 'e5,a3']);
  expect(await placement(page)).toBe('rnbqkbnr/pppp1ppp/8/4p3/4P3/*7/PPPP1PPP/RNBQKBNR');
  // The last move lights the piece's squares and where the duck went.
  await expect(lastMoveSquares(page)).toHaveCount(3);
  expect(await lastMoveKeys(page)).toEqual(['a3', 'e5', 'e7']);

  // And White's later duck move is a drag across the board.
  await move(page, 'g1', 'f3');
  await expect(board(page)).toHaveAttribute('data-duck-step', 'true');
  await drag(page, await squareCentre(page, 'a3'), await squareCentre(page, 'h6'));
  await expect(plies(page)).toHaveText(['e4,d5', 'e5,a3', 'Nf3,h6']);
  expect(await placement(page)).toBe('rnbqkbnr/pppp1ppp/7*/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R');
});

test('Escape before the duck moves puts the piece back, and so does a click on the moved piece', async ({ page }) => {
  await openApp(page);
  await newGame(page, 'hotseat');
  await move(page, 'e2', 'e4');
  await expect(board(page)).toHaveAttribute('data-duck-step', 'true');
  await page.keyboard.press('Escape');
  await expect(board(page)).toHaveAttribute('data-fen', START);
  await expect(board(page)).not.toHaveAttribute('data-duck-step', 'true');
  await expect(tray(page)).toBeHidden();
  await expect(page.getByTestId('status')).toHaveText('White to move');

  await move(page, 'g1', 'f3');
  await expect(board(page)).toHaveAttribute('data-duck-step', 'true');
  await clickSquare(page, 'f3');
  await expect(board(page)).toHaveAttribute('data-fen', START);
  await expect(board(page)).not.toHaveAttribute('data-duck-step', 'true');

  // The turn can then be played as any other.
  await move(page, 'd2', 'd4');
  await dragDuckOn(page, 'd6');
  await expect(plies(page)).toHaveText(['d4,d6']);
});

test('Undo takes back the whole turn, the piece move and the duck move together', async ({ page }) => {
  await openApp(page);
  await newGame(page, 'hotseat');
  await move(page, 'e2', 'e4');
  await dragDuckOn(page, 'd5');
  // chessgroundx reports board events a moment later (setTimeout), so each step waits for the last to land.
  await expect(plies(page)).toHaveCount(1);
  await move(page, 'e7', 'e5');
  await expect(board(page)).toHaveAttribute('data-duck-step', 'true');
  await move(page, 'd5', 'a3');
  await expect(plies(page)).toHaveCount(2);

  await page.getByTestId('undo').click();
  await expect(plies(page)).toHaveText(['e4,d5']);
  expect(await placement(page)).toBe('rnbqkbnr/pppppppp/8/3*4/4P3/8/PPPP1PPP/RNBQKBNR');
  await page.getByTestId('undo').click();
  await expect(plies(page)).toHaveCount(0);
  await expect(board(page)).toHaveAttribute('data-fen', START);
});

test('a promotion is chosen before the duck moves', async ({ page }) => {
  await openApp(page);
  await load(page, FEN_PAWN_PROMOTES);
  await move(page, 'a7', 'a8');
  const dialog = page.getByTestId('choice-dialog');
  await expect(dialog).toBeVisible();
  // One button per piece, not one per duck square.
  await expect(dialog.locator('button[data-uci]')).toHaveCount(4);
  await dialog.locator('button[data-uci^="a7a8n"]').click();
  await expect(board(page)).toHaveAttribute('data-duck-step', 'true');
  expect(await placement(page)).toBe('N3k3/8/8/8/8/8/8/*3K3');
  await move(page, 'a1', 'b1');
  await expect(plies(page)).toHaveText(['a8=N,b1']);
});

test('capturing the king wins, and the result is shown', async ({ page }) => {
  await openApp(page);
  await load(page, FEN_ROOK_TAKES_KING);
  await move(page, 'e2', 'e8');
  await expect(board(page)).toHaveAttribute('data-duck-step', 'true');
  await move(page, 'a1', 'a2');
  await expect(plies(page)).toHaveCount(1);
  await expect(page.getByTestId('status')).toHaveText("White wins by the variant's rules");
  await expect(board(page)).not.toHaveAttribute('data-duck-step', 'true');
});

test('the AI answers with a piece move and a duck move in one, with no duck step', async ({ page }) => {
  await openApp(page);
  await newGame(page, 'beginner', 'white');
  await move(page, 'e2', 'e4');
  await dragDuckOn(page, 'd5');
  await expect(plies(page)).toHaveCount(2, { timeout: 30000 });
  await expect(plies(page).last()).toHaveText(/^[^,]+,[a-h][1-8]$/);
  await expect(board(page)).not.toHaveAttribute('data-duck-step', 'true');
  await expect(page.getByTestId('status')).toHaveText('White to move');
  // The duck the AI moved is White's to move next, after a piece move.
  await expect(boardDucks(page)).toHaveCount(1);
  expect(await placement(page)).not.toContain('3*4/4P3');
});

for (const { name, viewport, phone } of [
  { name: 'a 1280x900 desktop', viewport: { width: 1280, height: 900 }, phone: false },
  { name: 'a 375 px wide phone', viewport: { width: 375, height: 740 }, phone: true },
]) {
  test.describe(`on ${name}`, () => {
    test.use({ viewport, hasTouch: phone, isMobile: phone });

    test('the waiting duck is wholly on screen, and nothing moves as it comes and goes', async ({ page }) => {
      await openApp(page);
      await newGame(page, 'hotseat');
      const boardBox = () => page.locator('[data-testid=board] cg-board').boundingBox();
      const statusBox = () => page.getByTestId('status').boundingBox();
      const before = { board: await boardBox(), status: await statusBox() };
      await move(page, 'e2', 'e4');
      await expect(tray(page)).toBeVisible();
      const duck = (await trayDuck(page).boundingBox())!;
      expect(duck.x).toBeGreaterThanOrEqual(0);
      expect(duck.y).toBeGreaterThanOrEqual(0);
      expect(duck.x + duck.width).toBeLessThanOrEqual(viewport.width);
      expect(duck.y + duck.height).toBeLessThanOrEqual(viewport.height);
      expect(await boardBox()).toEqual(before.board);
      expect(await statusBox()).toEqual(before.status);
      await dragDuckOn(page, 'd5');
      await expect(plies(page)).toHaveCount(1);
      await expect(tray(page)).toBeHidden();
      expect(await boardBox()).toEqual(before.board);
      expect((await statusBox())!.y).toBe(before.status!.y);
    });

    if (phone) {
      test('a tap on the waiting duck shows its squares, and a tap on one puts it there', async ({ page }) => {
        await openApp(page);
        await newGame(page, 'hotseat');
        await move(page, 'e2', 'e4');
        await expect(tray(page)).toBeVisible();
        await trayDuck(page).tap();
        await expect(page.locator('[data-testid=board] .board-mark.move')).toHaveCount(32);
        const { x, y } = await squareCentre(page, 'f6');
        await page.touchscreen.tap(x, y);
        await expect(plies(page)).toHaveText(['e4,f6']);
      });
    }
  });
}

/** The occupant of each square of a FEN placement, by UCI square ('' when empty), on an 8x8 board. */
function occupants(placement: string): Map<string, string> {
  const squares = new Map<string, string>();
  placement.split('/').forEach((row, i) => {
    let file = 0;
    for (const c of row.match(/\d+|./g) ?? []) {
      if (/\d/.test(c)) for (let n = 0; n < Number(c); n++) squares.set(`${String.fromCharCode(97 + file++)}${8 - i}`, '');
      else squares.set(`${String.fromCharCode(97 + file++)}${8 - i}`, c);
    }
  });
  return squares;
}

test('playing Black against the AI, the duck moves on the flipped board to the square under the mouse', async ({ page }) => {
  await openApp(page);
  await newGame(page, 'beginner', 'black');
  await expect(board(page)).toHaveAttribute('data-orientation', 'black');
  // The AI opens, bringing the duck on itself.
  await expect(plies(page)).toHaveCount(1, { timeout: 30000 });
  await expect(page.getByTestId('status')).toHaveText('Black to move');
  const opened = occupants(await placement(page));
  const knightTo = opened.get('c6') === '' ? 'c6' : 'a6';
  await move(page, 'b8', knightTo);
  await expect(board(page)).toHaveAttribute('data-duck-step', 'true');
  await expect(tray(page)).toBeHidden();
  const shown = occupants(await placement(page));
  const duckFrom = [...shown].find(([, c]) => c === '*')![0];
  const duckTo = ['h5', 'a5', 'h4', 'a4', 'g5', 'b5'].find((sq) => shown.get(sq) === '')!;
  await drag(page, await squareCentre(page, duckFrom), await squareCentre(page, duckTo));
  await expect(plies(page).nth(1)).toHaveText(`N${knightTo},${duckTo}`);
  expect(occupants(await placement(page)).get(duckTo)).toBe('*');
  await expect(plies(page)).toHaveCount(3, { timeout: 30000 });
});

test('editing the game during the duck step drops the half-made turn, so Cancel returns to the turn start', async ({ page }) => {
  await openApp(page);
  await newGame(page, 'hotseat');
  await move(page, 'e2', 'e4');
  await expect(board(page)).toHaveAttribute('data-duck-step', 'true');
  await page.getByTestId('edit').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.getByTestId('editor-close').click();
  await expect(page.getByTestId('game')).toBeVisible();
  await expect(board(page)).toHaveAttribute('data-fen', START);
  await expect(board(page)).not.toHaveAttribute('data-duck-step', 'true');
  await expect(page.getByTestId('status')).toHaveText('White to move');
});
