import { expect, type Page, test } from '@playwright/test';
import type { ChessTestHooks } from '../src/ui/app';

declare global {
  interface Window {
    __chessTest?: ChessTestHooks;
  }
}

// Hand-built positions, each checked against ffish when the tests were written (the moves named are its legal ones).
// White's rook on a1 can take Black's bishop on a5, putting a bishop in White's hand.
const FEN_ROOK_TAKES_BISHOP = '4k4/9/9/9/b8/9/9/9/R3K4[] w - - 0 1';
// White's silver on e6 can step into the far three ranks: e6e7 and e6e7+ are both legal.
const FEN_SILVER_BEFORE_THE_ZONE = '4k4/9/9/4S4/9/9/9/9/4K4[] w - - 0 1';
// White's pawn on c8 can only reach c9 promoted: c8c9+ is the only move from c8.
const FEN_PAWN_BEFORE_THE_LAST_RANK = 'k8/2P6/9/9/9/9/9/9/4K4[] w - - 0 1';
// Both of the above at once, and a pawn already in Black's hand.
const FEN_CAPTURE_AND_PROMOTE = '4k4/9/9/4S4/b8/9/9/9/R3K4[p] w - - 0 1';
// Black's king on a9 is in check from the rook on a1, and the dragon on b7 covers a8, b8 and b9: Black's only
// legal moves are dropping its gold between them, G@a2 to G@a8.
const FEN_BLACK_MUST_DROP = 'k8/9/1+R7/9/9/9/9/9/R7K[g] b - - 0 1';

async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => self.crossOriginIsolated).catch(() => false), { timeout: 15000 }).toBe(true);
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', /.+/);
}

/** Starts a hot-seat Shogi game from a FEN. */
async function load(page: Page, fen: string): Promise<void> {
  await page.evaluate((f) => window.__chessTest!.loadFen('shogi', f), fen);
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', fen);
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

/** A pocket piece: `bottom` is the side at the bottom of the board. */
const pocketPiece = (page: Page, pocket: 'top' | 'bottom', letter: string) =>
  page.locator(`[data-testid=board] .pocket.${pocket} piece.${letter}-piece`);

/** Drags a piece from a pocket onto a square, with the mouse, as a player would. */
async function dragFromPocket(page: Page, pocket: 'top' | 'bottom', letter: string, square: string): Promise<void> {
  const box = (await pocketPiece(page, pocket, letter).boundingBox())!;
  const to = await squareCentre(page, square);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

const plies = (page: Page) => page.locator('[data-testid=move-list] .ply');
const fenOf = (page: Page) => page.getByTestId('board').getAttribute('data-fen');
const bg = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).backgroundImage);

async function newGame(page: Page, opponent: string, color: 'white' | 'black' = 'white'): Promise<void> {
  await page.getByTestId('top-play').click();
  const dialog = page.getByTestId('play-dialog');
  await dialog.locator('#play-variant').selectOption('shogi');
  await dialog.locator('#play-opponent').selectOption(opponent);
  if (opponent !== 'hotseat') await dialog.locator('#play-color').selectOption(color);
  await dialog.locator('#play-clock').selectOption('None');
  await dialog.getByRole('button', { name: 'Start' }).click();
  await expect(dialog).toBeHidden();
}

test('both pockets show from the start, even while empty, so the layout does not jump', async ({ page }) => {
  await openApp(page);
  await newGame(page, 'hotseat');
  for (const pocket of ['top', 'bottom'] as const) {
    await expect(page.locator(`[data-testid=board] .pocket.${pocket} piece`)).toHaveCount(7);
    for (const letter of 'rbgsnlp') await expect(pocketPiece(page, pocket, letter)).toHaveAttribute('data-nb', '0');
  }
  const before = await page.locator('[data-testid=board] cg-board').boundingBox();
  await load(page, FEN_ROOK_TAKES_BISHOP);
  await move(page, 'a1', 'a5');
  await expect(pocketPiece(page, 'bottom', 'b')).toHaveAttribute('data-nb', '1');
  expect(await page.locator('[data-testid=board] cg-board').boundingBox()).toEqual(before);
});

test('a capture goes to hand, a drag drops it, and undo puts it back in hand', async ({ page }) => {
  await openApp(page);
  await load(page, FEN_ROOK_TAKES_BISHOP);
  await move(page, 'a1', 'a5');
  await expect(plies(page)).toHaveCount(1);
  await expect(pocketPiece(page, 'bottom', 'b')).toHaveAttribute('data-nb', '1');
  await move(page, 'e9', 'e8');
  await expect(plies(page)).toHaveCount(2);

  await dragFromPocket(page, 'bottom', 'b', 'e5');
  await expect(plies(page)).toHaveCount(3);
  await expect(plies(page).last()).toHaveText('B@e5');
  expect(await fenOf(page)).toBe('9/4k4/9/9/R3B4/9/9/9/4K4[] b - - 0 2');
  await expect(pocketPiece(page, 'bottom', 'b')).toHaveAttribute('data-nb', '0');

  await page.getByTestId('undo').click();
  await expect(plies(page)).toHaveCount(2);
  expect(await fenOf(page)).toBe('9/4k4/9/9/R8/9/9/9/4K4[B] w - - 1 2');
  await expect(pocketPiece(page, 'bottom', 'b')).toHaveAttribute('data-nb', '1');
  // And it can be dropped again, anywhere the rules allow.
  await dragFromPocket(page, 'bottom', 'b', 'c3');
  await expect(plies(page).last()).toHaveText('B@c3');
});

test('a drop that gives check is written with + and the board marks the king in check', async ({ page }) => {
  await openApp(page);
  await load(page, '4k4/9/9/9/9/9/9/9/4K4[G] w - - 0 1');
  await expect(page.locator('[data-testid=board] cg-board square.check')).toHaveCount(0);
  await dragFromPocket(page, 'bottom', 'g', 'e8');
  await expect(plies(page)).toHaveText(['G@e8+']);
  expect(await fenOf(page)).toMatch(/^4k4\/4G4\//);
  await expect(page.locator('[data-testid=board] cg-board square.check')).toHaveCount(1);
});

test('a human playing Black drops on the flipped board, onto the square under the mouse, and the AI replies', async ({ page }) => {
  const NO_CLOCK = Number.MAX_SAFE_INTEGER;
  const data = {
    variant: 'shogi',
    // Black to move with a pawn in hand; the AI plays White.
    startFen: '4k4/9/9/9/9/9/9/9/4K4[p] b - - 0 1',
    moves: [],
    snapshots: [],
    opponent: { kind: 'ai', level: 'beginner', aiColor: 'white' },
    clockConfig: null,
    clock: { whiteMs: NO_CLOCK, blackMs: NO_CLOCK, running: 'black', since: 0 },
    result: null,
    engineRequestId: 0,
  };
  await page.addInitScript((json) => localStorage.setItem('chess.game', json), JSON.stringify({ version: 1, data }));
  await openApp(page);
  await expect(page.getByTestId('board')).toHaveAttribute('data-orientation', 'black');
  await expect(pocketPiece(page, 'bottom', 'p')).toHaveAttribute('data-nb', '1');
  // c4 is off every axis of symmetry, so a drop that ignored the flip would land elsewhere.
  await dragFromPocket(page, 'bottom', 'p', 'c4');
  await expect(plies(page).first()).toHaveText('P@c4');
  await expect(pocketPiece(page, 'bottom', 'p')).toHaveAttribute('data-nb', '0');
  await expect(plies(page)).toHaveCount(2, { timeout: 20000 });
  expect((await fenOf(page))!.split(' ')[0]!.split('/')[5], 'rank 4').toBe('2p6');
  await expect(page.getByTestId('status')).toHaveText('Black to move');
});

test('a drop onto a square the rules refuse puts the piece back in hand', async ({ page }) => {
  await openApp(page);
  // A pawn in hand may not go on the e-file, where White already has one, nor on the last rank.
  await load(page, '4k4/9/9/9/9/9/4P4/9/4K4[P] w - - 0 1');
  await dragFromPocket(page, 'bottom', 'p', 'e5');
  await dragFromPocket(page, 'bottom', 'p', 'a9');
  await expect(pocketPiece(page, 'bottom', 'p')).toHaveAttribute('data-nb', '1');
  expect(await fenOf(page)).toBe('4k4/9/9/9/9/9/4P4/9/4K4[P] w - - 0 1');
  await expect(plies(page)).toHaveCount(0);
  await dragFromPocket(page, 'bottom', 'p', 'd5');
  await expect(plies(page)).toHaveText(['P@d5']);
});

test('a move into the far ranks asks Promote or Don\'t promote, and Cancel puts the piece back', async ({ page }) => {
  await openApp(page);
  await load(page, FEN_SILVER_BEFORE_THE_ZONE);
  await move(page, 'e6', 'e7');
  const dialog = page.getByTestId('choice-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('button[data-uci]')).toHaveText(['Promote', "Don't promote"]);
  expect(await dialog.locator('button[data-uci]').evaluateAll((bs) => bs.map((b) => (b as HTMLElement).dataset.uci))).toEqual(['e6e7+', 'e6e7']);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(plies(page)).toHaveCount(0);
  expect(await fenOf(page)).toBe(FEN_SILVER_BEFORE_THE_ZONE);
  await expect(page.locator('[data-testid=board] cg-board piece.s-piece.white')).toHaveCount(1);

  await move(page, 'e6', 'e7');
  await dialog.getByRole('button', { name: "Don't promote" }).click();
  await expect(plies(page)).toHaveCount(1);
  expect(await fenOf(page)).toMatch(/^4k4\/9\/4S4\//);

  await page.getByTestId('undo').click();
  await move(page, 'e6', 'e7');
  await dialog.getByRole('button', { name: 'Promote', exact: true }).click();
  await expect(plies(page)).toHaveCount(1);
  expect(await fenOf(page)).toMatch(/^4k4\/9\/4\+S4\//);
  await expect(page.locator('[data-testid=board] cg-board piece.ps-piece.white')).toHaveCount(1);
});

test('a forced promotion just happens, with no question', async ({ page }) => {
  await openApp(page);
  await load(page, FEN_PAWN_BEFORE_THE_LAST_RANK);
  await move(page, 'c8', 'c9');
  await expect(plies(page)).toHaveCount(1);
  await expect(page.getByTestId('choice-dialog')).toBeHidden();
  expect(await fenOf(page)).toMatch(/^k1\+P6\/9\//);
  await expect(page.locator('[data-testid=board] cg-board piece.pp-piece.white')).toHaveCount(1);
});

test('a reload restores the board, both hands and the promoted art', async ({ page }) => {
  await openApp(page);
  await load(page, FEN_CAPTURE_AND_PROMOTE);
  await move(page, 'a1', 'a5');
  await expect(plies(page)).toHaveCount(1);
  await move(page, 'e9', 'd9');
  await expect(plies(page)).toHaveCount(2);
  await move(page, 'e6', 'e7');
  await page.getByTestId('choice-dialog').getByRole('button', { name: 'Promote', exact: true }).click();
  await expect(plies(page)).toHaveCount(3);
  const fen = await fenOf(page);
  expect(fen).toBe('3k5/9/4+S4/9/R8/9/9/9/4K4[Bp] b - - 0 2');

  await page.reload();
  await expect.poll(() => page.evaluate(() => self.crossOriginIsolated).catch(() => false), { timeout: 15000 }).toBe(true);
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', fen!);
  await expect(plies(page)).toHaveCount(3);
  await expect(pocketPiece(page, 'bottom', 'b')).toHaveAttribute('data-nb', '1');
  await expect(pocketPiece(page, 'top', 'p')).toHaveAttribute('data-nb', '1');
  expect(await bg(page, '[data-testid=board] cg-board piece.ps-piece.white')).toContain('pieces/shogi-tile/wgold.svg');
  await expect(page.locator('[data-testid=board] cg-board piece.ps-piece.white')).toHaveClass(/promoted-mark/);
  await expect(page.locator('[data-testid=board] piece.token')).toHaveCount(0);
});

test('the AI at the beginner level replies with a legal move', async ({ page }) => {
  await openApp(page);
  await newGame(page, 'beginner');
  await expect(page.getByTestId('game-line')).toHaveText('Shogi · AI: Beginner');
  await move(page, 'c3', 'c4');
  await expect(plies(page).first()).toHaveText('Pc4');
  await expect(plies(page)).toHaveCount(2, { timeout: 20000 });
  await expect(page.getByTestId('status')).toHaveText('White to move');
});

test('the AI drops a piece when that is all it can do, and the board shows it leave the pocket', async ({ page }) => {
  const NO_CLOCK = Number.MAX_SAFE_INTEGER;
  const data = {
    variant: 'shogi',
    startFen: FEN_BLACK_MUST_DROP,
    moves: [],
    snapshots: [],
    opponent: { kind: 'ai', level: 'beginner', aiColor: 'black' },
    clockConfig: null,
    clock: { whiteMs: NO_CLOCK, blackMs: NO_CLOCK, running: 'black', since: 0 },
    result: null,
    engineRequestId: 0,
  };
  await page.addInitScript((json) => localStorage.setItem('chess.game', json), JSON.stringify({ version: 1, data }));
  await openApp(page);
  await expect(plies(page)).toHaveCount(1, { timeout: 20000 });
  await expect(plies(page).first()).toHaveText(/^G@a[2-8]$/);
  await expect(pocketPiece(page, 'top', 'g')).toHaveAttribute('data-nb', '0');
  await expect(page.locator('[data-testid=board] cg-board piece.g-piece.black')).toHaveCount(1);
  await expect(page.getByTestId('status')).toHaveText('White to move');
});

test('Shogi tiles point toward the opponent in either orientation', async ({ page }) => {
  await openApp(page);
  await load(page, '4k4/9/4p4/9/9/9/4P4/9/4K4[Pp] w - - 0 1');
  // White at the bottom: White's tiles point up (their own art), Black's down.
  expect(await bg(page, '[data-testid=board] cg-board piece.p-piece.white')).toMatch(/pieces\/shogi-tile\/wshogiPawn\.svg/);
  expect(await bg(page, '[data-testid=board] cg-board piece.p-piece.black')).toMatch(/pieces\/shogi-tile\/bshogiPawn\.svg/);
  expect(await bg(page, '[data-testid=board] .pocket.bottom piece.p-piece')).toMatch(/pieces\/shogi-tile\/wshogiPawn\.svg/);
  // Black at the bottom: White's tiles turn to point down, Black's up, on the board and in the pockets.
  await newGame(page, 'beginner', 'black');
  await expect(page.getByTestId('board')).toHaveAttribute('data-orientation', 'black');
  await expect(plies(page)).toHaveCount(1, { timeout: 20000 }); // the AI's first move, so the board is settled
  expect(await bg(page, '[data-testid=board] cg-board piece.p-piece.white')).toMatch(/pieces\/shogi-tile\/turned\/wshogiPawn\.svg/);
  expect(await bg(page, '[data-testid=board] cg-board piece.p-piece.black')).toMatch(/pieces\/shogi-tile\/turned\/bshogiPawn\.svg/);
  expect(await bg(page, '[data-testid=board] cg-board piece.g-piece.black')).toMatch(/pieces\/shogi-tile\/turned\/bgold\.svg/);
  expect(await bg(page, '[data-testid=board] .pocket.bottom piece.p-piece')).toMatch(/pieces\/shogi-tile\/turned\/bshogiPawn\.svg/);
  expect(await bg(page, '[data-testid=board] .pocket.top piece.p-piece')).toMatch(/pieces\/shogi-tile\/turned\/wshogiPawn\.svg/);
});
