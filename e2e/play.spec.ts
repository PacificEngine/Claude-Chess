import { expect, type Page, test } from '@playwright/test';
import type { ChessTestHooks } from '../src/ui/app';

declare global {
  interface Window {
    __chessTest?: ChessTestHooks;
  }
}

const FEN_GRAND_PAWN_ON_9TH = '9k/P9/10/10/10/10/10/10/10/K9 w - - 0 1';
const FEN_CAPABLANCA_PAWN_ON_7TH = '9k/P9/10/10/10/10/10/K9 w - - 0 1';

// Every legal move between the promotion squares, as ffish lists them for these positions (Playwright's loader cannot
// load ffish in Node, so the oracle is spelled out): one per promotion piece, and no plain move on the last rank.
const LEGAL_GRAND_A9_A10 = ['a9a10a', 'a9a10b', 'a9a10c', 'a9a10n', 'a9a10q', 'a9a10r'];
const LEGAL_CAPABLANCA_A7_A8 = ['a7a8a', 'a7a8b', 'a7a8c', 'a7a8n', 'a7a8q', 'a7a8r'];

/** The UCI moves the open choice dialog offers. */
async function offeredMoves(page: Page): Promise<string[]> {
  const ucis = await page.getByTestId('choice-dialog').locator('button[data-uci]').evaluateAll((bs) => bs.map((b) => (b as HTMLElement).dataset.uci ?? ''));
  return ucis.sort();
}

/** Opens the app, waits through the one-time service-worker reload, and waits for a rendered board. */
async function openApp(page: Page, { isolated = true } = {}): Promise<void> {
  await page.goto('/');
  if (isolated) {
    await expect
      .poll(() => page.evaluate(() => self.crossOriginIsolated).catch(() => false), { timeout: 15000 })
      .toBe(true);
  }
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', /.+/);
}

/** Clicks the centre of a UCI square ("e2", "a10") on the board, honouring its size and orientation. */
async function clickSquare(page: Page, square: string): Promise<void> {
  const board = page.getByTestId('board');
  const files = Number(await board.getAttribute('data-files'));
  const ranks = Number(await board.getAttribute('data-ranks'));
  const orientation = await board.getAttribute('data-orientation');
  const box = await page.locator('[data-testid=board] cg-board').boundingBox();
  if (!box) throw new Error('board has no layout box');
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square.slice(1)) - 1;
  const col = orientation === 'white' ? file : files - 1 - file;
  const row = orientation === 'white' ? ranks - 1 - rank : rank;
  await page.mouse.click(box.x + ((col + 0.5) * box.width) / files, box.y + ((row + 0.5) * box.height) / ranks);
}

/**
 * Clicks a piece, then its target. chessgroundx reports a move a tick later (setTimeout), so callers wait for
 * the move list before moving the other side; otherwise the second click can land before the turn changes.
 */
async function move(page: Page, from: string, to: string): Promise<void> {
  await clickSquare(page, from);
  await clickSquare(page, to);
}

const plies = (page: Page) => page.locator('[data-testid=move-list] .ply');

interface NewGame {
  variant: string;
  opponent: string; // 'hotseat' or an AI level id
  color?: 'white' | 'black';
  clock?: string; // preset label
}

async function newGame(page: Page, g: NewGame): Promise<void> {
  await page.getByTestId('top-play').click();
  const dialog = page.getByTestId('play-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#play-variant').selectOption(g.variant);
  await dialog.locator('#play-opponent').selectOption(g.opponent);
  // The color choice only applies against the AI, so the dialog hides it for hot-seat.
  if (g.opponent !== 'hotseat') await dialog.locator('#play-color').selectOption(g.color ?? 'white');
  await dialog.locator('#play-clock').selectOption(g.clock ?? 'None');
  await dialog.getByRole('button', { name: 'Start' }).click();
  await expect(dialog).toBeHidden();
  await expect(plies(page)).toHaveCount(0);
}

/** Seconds shown on a clock ("4:58" -> 298). */
async function clockSeconds(page: Page, color: 'white' | 'black'): Promise<number> {
  const text = (await page.getByTestId(`clock-${color}`).textContent()) ?? '';
  const m = /(\d+):(\d+(?:\.\d+)?)/.exec(text);
  if (!m) throw new Error(`unreadable clock: ${text}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

const fenOf = (page: Page) => page.getByTestId('board').getAttribute('data-fen');

test('plays a move against the AI and gets a reply', async ({ page }) => {
  await openApp(page);
  await newGame(page, { variant: 'chess', opponent: 'beginner', color: 'white' });
  await expect(page.getByTestId('game-line')).toHaveText('Chess · AI: Beginner');
  await move(page, 'e2', 'e4');
  await expect(plies(page).first()).toHaveText('e4');
  await expect(plies(page)).toHaveCount(2, { timeout: 20000 });
});

test('undo against the AI returns to the human move with an empty move list', async ({ page }) => {
  await openApp(page);
  await newGame(page, { variant: 'chess', opponent: 'beginner', color: 'white' });
  const start = await fenOf(page);
  await move(page, 'e2', 'e4');
  await expect(plies(page)).toHaveCount(2, { timeout: 20000 });
  await page.getByTestId('undo').click();
  await expect(plies(page)).toHaveCount(0);
  expect(await fenOf(page)).toBe(start);
  await expect(page.getByTestId('undo')).toBeDisabled();
  // The AI must not answer a move that was taken back, and the human can move again.
  await page.waitForTimeout(1000);
  await expect(plies(page)).toHaveCount(0);
  await move(page, 'd2', 'd4');
  await expect(plies(page).first()).toHaveText('d4');
  await expect(plies(page)).toHaveCount(2, { timeout: 20000 });
});

test('undo while the AI is thinking stops the search and throws its move away', async ({ page }) => {
  await openApp(page);
  await newGame(page, { variant: 'chess', opponent: 'max', color: 'white' });
  await move(page, 'e2', 'e4');
  await expect(plies(page)).toHaveCount(1);
  await page.getByTestId('undo').click();
  await expect(plies(page)).toHaveCount(0);
  // Max thinks for 3 s; wait past that to prove its bestmove was discarded.
  await page.waitForTimeout(4000);
  await expect(plies(page)).toHaveCount(0);
});

test('offers every promotion piece in Grand instead of auto-queening', async ({ page }) => {
  await openApp(page);
  await page.evaluate((fen) => window.__chessTest!.loadFen('grand', fen), FEN_GRAND_PAWN_ON_9TH);
  await expect(page.getByTestId('game-line')).toHaveText('Grand Chess · Hot-seat');
  await move(page, 'a9', 'a10');
  const dialog = page.getByTestId('choice-dialog');
  await expect(dialog).toBeVisible();
  expect(await offeredMoves(page)).toEqual(LEGAL_GRAND_A9_A10);
  await expect(dialog.getByRole('button', { name: 'Queen' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Chancellor' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Chancellor' }).click();
  await expect(dialog).toBeHidden();
  await expect(plies(page)).toHaveCount(1);
  expect(await fenOf(page)).toMatch(/^C8k\//);
});

test('offers every promotion piece in Capablanca, Archbishop and Chancellor included', async ({ page }) => {
  await openApp(page);
  await page.evaluate((fen) => window.__chessTest!.loadFen('capablanca', fen), FEN_CAPABLANCA_PAWN_ON_7TH);
  await expect(page.getByTestId('game-line')).toHaveText('Capablanca · Hot-seat');
  await move(page, 'a7', 'a8');
  const dialog = page.getByTestId('choice-dialog');
  await expect(dialog).toBeVisible();
  expect(await offeredMoves(page)).toEqual(LEGAL_CAPABLANCA_A7_A8);
  await expect(dialog.getByRole('button', { name: 'Archbishop' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Archbishop' }).click();
  await expect(plies(page)).toHaveCount(1);
  expect(await fenOf(page)).toMatch(/^A8k\//);
});

test('cancelling the promotion choice leaves the pawn where it was', async ({ page }) => {
  await openApp(page);
  await page.evaluate((fen) => window.__chessTest!.loadFen('grand', fen), FEN_GRAND_PAWN_ON_9TH);
  await move(page, 'a9', 'a10');
  const dialog = page.getByTestId('choice-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(plies(page)).toHaveCount(0);
  expect(await fenOf(page)).toBe(FEN_GRAND_PAWN_ON_9TH);
});

test('offers Hawk, Elephant or nothing when a Seirawan back-rank piece first moves', async ({ page }) => {
  await openApp(page);
  await newGame(page, { variant: 'seirawan', opponent: 'hotseat' });
  // Seirawan shows the pieces in hand in pockets beside the board.
  await expect(page.locator('.pocket piece')).toHaveCount(4);
  await move(page, 'g1', 'f3');
  const dialog = page.getByTestId('choice-dialog');
  await expect(dialog).toBeVisible();
  const labels = await dialog.locator('button[data-uci]').allTextContents();
  expect(labels.sort()).toEqual(['Elephant', 'Hawk', 'Nothing']);
  await dialog.getByRole('button', { name: 'Hawk' }).click();
  await expect(plies(page)).toHaveCount(1);
  // The hawk now stands on g1, where the knight came from, and has left White's hand.
  const fen = (await fenOf(page)) ?? '';
  expect(fen).toMatch(/\/RNBQKBHR\[/);
  expect([...(/\[(\w*)\]/.exec(fen)?.[1] ?? '')].sort().join('')).toBe('Eeh');
});

test('clocks pause while the gating choice is open and run again after a cancel', async ({ page }) => {
  await openApp(page);
  await newGame(page, { variant: 'seirawan', opponent: 'hotseat', clock: '5+0' });
  await move(page, 'g1', 'f3');
  const dialog = page.getByTestId('choice-dialog');
  await expect(dialog).toBeVisible();
  const whileOpen = await clockSeconds(page, 'white');
  await page.waitForTimeout(2000);
  expect(await clockSeconds(page, 'white')).toBe(whileOpen);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await page.waitForTimeout(1500);
  expect(await clockSeconds(page, 'white')).toBeLessThan(whileOpen);

  // Picking a piece plays the move, and Black's clock takes over.
  await move(page, 'g1', 'f3');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Hawk' }).click();
  await expect(plies(page)).toHaveCount(1);
  const black = await clockSeconds(page, 'black');
  await page.waitForTimeout(1500);
  expect(await clockSeconds(page, 'black')).toBeLessThan(black);
});

test('a reload during the AI turn resumes the AI search instead of hanging', async ({ page }) => {
  await openApp(page);
  // Max thinks for 3 s, so the reload lands while it is still searching.
  await newGame(page, { variant: 'chess', opponent: 'max', color: 'white' });
  await move(page, 'e2', 'e4');
  await expect(plies(page)).toHaveCount(1);
  await page.reload();
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', /.+/);
  await expect(plies(page).first()).toHaveText('e4');
  await expect(plies(page)).toHaveCount(2, { timeout: 30000 });
});

test('a reload restores the game with clocks paused at their saved times', async ({ page }) => {
  await openApp(page);
  await newGame(page, { variant: 'chess', opponent: 'hotseat', clock: '5+0' });
  await expect(page.getByTestId('clock-white')).toBeVisible();
  await move(page, 'e2', 'e4');
  await expect(plies(page)).toHaveCount(1);
  await move(page, 'e7', 'e5');
  await expect(plies(page)).toHaveCount(2);
  await page.waitForTimeout(1200); // let White's clock visibly run
  const whiteBefore = await clockSeconds(page, 'white');
  const blackBefore = await clockSeconds(page, 'black');
  expect(whiteBefore).toBeLessThan(300);

  await page.reload();
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', /.+/);
  await expect(plies(page)).toHaveCount(2);
  const whiteAfter = await clockSeconds(page, 'white');
  expect(Math.abs(whiteAfter - whiteBefore)).toBeLessThanOrEqual(1);
  expect(await clockSeconds(page, 'black')).toBe(blackBefore);

  // Paused: nothing runs until the next move.
  await page.waitForTimeout(2000);
  expect(await clockSeconds(page, 'white')).toBe(whiteAfter);
  expect(await clockSeconds(page, 'black')).toBe(blackBefore);

  await move(page, 'g1', 'f3');
  await expect(plies(page)).toHaveCount(3);
  await page.waitForTimeout(2000);
  expect(await clockSeconds(page, 'white')).toBe(whiteAfter);
  expect(await clockSeconds(page, 'black')).toBeLessThan(blackBefore);
});

test('the AI side cannot be moved by the player while the AI is thinking', async ({ page }) => {
  await openApp(page);
  await newGame(page, { variant: 'chess', opponent: 'max', color: 'white' });
  await move(page, 'e2', 'e4');
  await expect(plies(page)).toHaveCount(1);
  const fen = await fenOf(page);
  await move(page, 'e7', 'e5');
  // chessgroundx reports a move a tick later; wait well past that (but well inside Max's 3 s search) before checking.
  await page.waitForTimeout(500);
  await expect(plies(page)).toHaveCount(1);
  expect(await fenOf(page)).toBe(fen);
  await expect(page.getByTestId('status')).toHaveText(/thinking/i);
  await expect(plies(page)).toHaveCount(2, { timeout: 20000 });
});

test('an engine that dies mid-search turns the AI off instead of thinking forever, and hot-seat still works', async ({ page }) => {
  test.setTimeout(60_000);
  await openApp(page);
  await newGame(page, { variant: 'chess', opponent: 'max', color: 'white' });
  await move(page, 'e2', 'e4');
  await expect(plies(page)).toHaveCount(1);
  await expect(page.getByTestId('status')).toHaveText('AI is thinking…');
  // Terminated behind the adapter's back, as a silent wasm crash would: only a deadline can notice. That is the
  // search watchdog (Max's 3 s + 5 s margin), or the 15 s readyok deadline if the kill lands while the variant is set.
  await page.evaluate(() => window.__chessTest!.engine.killWorker());
  await expect(page.getByTestId('status')).toHaveText(/The AI can't move: the engine is unavailable \(.+\)/, { timeout: 25000 });
  await expect(page.getByTestId('ai-retry')).toBeHidden();

  await page.getByTestId('top-play').click();
  const dialog = page.getByTestId('play-dialog');
  await expect(dialog.getByTestId('engine-status')).toHaveText(/Engine unavailable: .+Reload the page to retry/);
  await expect(dialog.locator('#play-opponent option[value=beginner]')).toBeDisabled();
  await expect(dialog.locator('#play-opponent')).toHaveValue('hotseat');
  await dialog.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByTestId('game-line')).toHaveText('Chess · Hot-seat');
  await move(page, 'e2', 'e4');
  await expect(plies(page)).toHaveCount(1);
  await move(page, 'e7', 'e5');
  await expect(plies(page)).toHaveText(['e4', 'e5']);
});

const FEN_FOOLS_MATE = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
// Black to move with only its king: whatever it plays is illegal in the real game after 1. e4.
const FEN_LONE_BLACK_KING = 'k7/8/8/8/8/8/8/K7 b - - 0 1';

for (const [what, fen] of [['finds no move', FEN_FOOLS_MATE], ['answers an illegal move', FEN_LONE_BLACK_KING]] as const) {
  test(`when the engine ${what}, the panel says the AI couldn't move and Retry asks again`, async ({ page }) => {
    await openApp(page);
    await newGame(page, { variant: 'chess', opponent: 'beginner', color: 'white' });
    // The next search analyses another position, so the real engine gives a real unusable answer.
    await page.evaluate((f) => window.__chessTest!.engine.searchFenOnce(f), fen);
    await move(page, 'e2', 'e4');
    await expect(page.getByTestId('status')).toHaveText("The AI couldn't move.", { timeout: 15000 });
    await expect(plies(page)).toHaveText(['e4']);
    await page.getByTestId('ai-retry').click();
    await expect(plies(page)).toHaveCount(2, { timeout: 20000 });
    await expect(page.getByTestId('ai-retry')).toBeHidden();
    await expect(page.getByTestId('status')).toHaveText('White to move');
  });
}

test('hot-seat still works when the engine is unavailable', async ({ page, context }) => {
  // Fail every Fairy-Stockfish file (its script, wasm and pthread worker); ffish, the rules library, still loads.
  await context.route(/stockfish/, (route) => route.fulfill({ status: 404, body: 'not found' }));
  await openApp(page);
  await page.getByTestId('top-play').click();
  const dialog = page.getByTestId('play-dialog');
  await expect(dialog.getByTestId('engine-status')).toHaveText(/unavailable/i, { timeout: 20000 });
  await expect(dialog.locator('#play-opponent option[value=beginner]')).toBeDisabled();
  await expect(dialog.locator('#play-opponent option[value=max]')).toBeDisabled();
  await expect(dialog.locator('#play-opponent')).toHaveValue('hotseat');
  await dialog.locator('#play-variant').selectOption('chess');
  await dialog.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByTestId('game-line')).toHaveText('Chess · Hot-seat');
  await move(page, 'e2', 'e4');
  await expect(plies(page)).toHaveCount(1);
  await move(page, 'e7', 'e5');
  await expect(plies(page)).toHaveText(['e4', 'e5']);
});

test('the Play dialog says the engine is loading until it is ready', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('top-play').click();
  const status = page.getByTestId('play-dialog').getByTestId('engine-status');
  // Either still loading, or already ready; it must never claim to be unavailable on a working host.
  await expect(status).toHaveText(/Engine loading…|Engine ready/);
  await expect(status).toHaveText(/Engine ready/, { timeout: 20000 });
});

test('the Edit button is present but disabled, and the panel names variant and opponent', async ({ page }) => {
  await openApp(page);
  await expect(page.getByTestId('edit')).toBeDisabled();
  await newGame(page, { variant: 'grand', opponent: 'expert', color: 'black' });
  await expect(page.getByTestId('game-line')).toHaveText('Grand Chess · AI: Expert');
  await expect(page.getByTestId('board')).toHaveAttribute('data-orientation', 'black');
  // The AI plays White, so it moves first.
  await expect(plies(page)).toHaveCount(1, { timeout: 20000 });
});

test('a corrupt saved game shows a storage banner and starts fresh', async ({ page }) => {
  // Plant the bad data before the app's scripts run on every load (including the service-worker reload).
  await page.addInitScript(() => localStorage.setItem('chess.game', '{"version":1,"data":{"nonsense":true}}'));
  await openApp(page);
  await expect(page.getByTestId('storage-banner')).toBeVisible();
  await expect(page.getByTestId('storage-banner')).toContainText(/couldn't be read/);
  expect(await page.evaluate(() => localStorage.getItem('chess.game.corrupt'))).toContain('nonsense');
  await expect(page.getByTestId('game-line')).toHaveText('Chess · Hot-seat');
});

/** A well-formed saved hot-seat game after 1. e4, which the app would restore as is. */
function savedGameAfterE4(): Record<string, unknown> {
  const NO_CLOCK = Number.MAX_SAFE_INTEGER;
  const clock = (running: 'white' | 'black') => ({ whiteMs: NO_CLOCK, blackMs: NO_CLOCK, running, since: 0 });
  const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  return {
    variant: 'chess',
    startFen: start,
    moves: ['e2e4'],
    snapshots: [{ fen: start, clock: clock('white') }],
    opponent: { kind: 'hotseat' },
    clockConfig: null,
    clock: clock('black'),
    result: null,
    engineRequestId: 2,
  };
}

async function openWithSavedGame(page: Page, data: Record<string, unknown>): Promise<void> {
  await page.addInitScript((json) => localStorage.setItem('chess.game', json), JSON.stringify({ version: 1, data }));
  await openApp(page);
}

test('a well-formed saved game is restored', async ({ page }) => {
  await openWithSavedGame(page, savedGameAfterE4());
  await expect(plies(page)).toHaveText(['e4']);
  await expect(page.getByTestId('storage-banner')).toBeHidden();
});

for (const fen of ['garbage', '8/8/8/8/8/8/8/K6k w - - 0 1']) {
  test(`a saved game with a tampered snapshot FEN (${fen}) is treated as corrupt, not crashed on`, async ({ page }) => {
    const data = savedGameAfterE4();
    (data.snapshots as { fen: string }[])[0].fen = fen;
    await openWithSavedGame(page, data);
    await expect(page.getByTestId('storage-banner')).toContainText(/couldn't be read/);
    await expect(page.getByTestId('game-line')).toHaveText('Chess · Hot-seat');
    await expect(plies(page)).toHaveCount(0);
  });
}

test('a saved game carrying a variant ini is treated as corrupt, so stored text never reaches the engine', async ({ page }) => {
  await openWithSavedGame(page, { ...savedGameAfterE4(), ini: '[chess]' });
  await expect(page.getByTestId('storage-banner')).toContainText(/couldn't be read/);
  await expect(plies(page)).toHaveCount(0);
});

test('a refused save shows the "progress won\'t be saved" banner', async ({ page }) => {
  await openApp(page);
  await expect(page.getByTestId('storage-banner')).toBeHidden();
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
  });
  await move(page, 'e2', 'e4');
  await expect(page.getByTestId('storage-banner')).toContainText("Progress won't be saved");
});

test('the footer links to the source, falling back to the placeholder when VITE_SOURCE_URL is unset (the e2e build clears it)', async ({ page }) => {
  await openApp(page);
  const link = page.getByTestId('source-link');
  await expect(link).toHaveText('Source');
  await expect(link).toHaveAttribute('href', 'https://github.com/OWNER/claude-chess');
});
