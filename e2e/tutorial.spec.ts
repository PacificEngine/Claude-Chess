import { expect, type Page, test } from '@playwright/test';

// The app's own texts; Playwright's loader can't import modules that load ffish.
const ENGINE_NEEDED_MESSAGE = 'The AI engine is needed to check custom setups and is not available.';
const WRONG = 'Not quite. Try again.';
const SOLVED = 'Solved!';
const ROOK_FIRST_HINT = 'The knight is on the same file as your rook.';
const CORRUPT_TUTORIAL = 'Your tutorial progress could not be read and was reset.';

async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect
    .poll(() => page.evaluate(() => self.crossOriginIsolated).catch(() => false), { timeout: 15000 })
    .toBe(true);
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', /.+/);
}

const list = (page: Page) => page.getByTestId('lesson-list');
/** A lesson's (or variant page's) first card in the list; a look-alike has one card per name. */
const card = (page: Page, id: string) => list(page).locator(`[data-testid^="card-${id}-"]`).first();

/** Opens the lesson list with the top bar's Tutorial, from any screen. */
async function openList(page: Page): Promise<void> {
  await page.getByTestId('top-tutorial').click();
  await expect(list(page)).toBeVisible();
  await expect(page.getByTestId('game')).toBeHidden();
}

/** Opens a lesson from its card in the lesson list. */
async function openLesson(page: Page, id: string): Promise<void> {
  await openList(page);
  await card(page, id).click();
  await expect(list(page)).toBeHidden();
  await expect(page.getByTestId('lesson')).toBeVisible();
}

/** The value under a store key, or null. */
const stored = (page: Page, key: string) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), key);

const board = (page: Page) => page.getByTestId('tutorial-board');
const feedback = (page: Page) => page.getByTestId('lesson-feedback');
const step = (page: Page, index: number) => page.getByTestId(`step-${index}`);
/** Marks use the designer's reach styles, so both boards show reach the same way. */
const marks = (page: Page, kind: string) => board(page).locator(`.reach-layer .reach-square.${kind}`);

/** Clicks the centre of a UCI square on a board, honouring its size and orientation. */
async function clickSquare(page: Page, testid: string, square: string): Promise<void> {
  const host = page.getByTestId(testid);
  const files = Number(await host.getAttribute('data-files'));
  const ranks = Number(await host.getAttribute('data-ranks'));
  const orientation = (await host.getAttribute('data-orientation')) ?? 'white';
  // A board that was just shown again is laid out by chessgroundx on its next resize callback.
  await expect.poll(async () => (await host.locator('cg-board').boundingBox())?.width ?? 0).toBeGreaterThan(0);
  const box = await host.locator('cg-board').boundingBox();
  if (!box) throw new Error('board has no layout box');
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square.slice(1)) - 1;
  const col = orientation === 'white' ? file : files - 1 - file;
  const row = orientation === 'white' ? ranks - 1 - rank : rank;
  await page.mouse.click(box.x + ((col + 0.5) * box.width) / files, box.y + ((row + 0.5) * box.height) / ranks);
}

/** Clicks a piece on the lesson board, then its target. */
async function move(page: Page, from: string, to: string): Promise<void> {
  await clickSquare(page, 'tutorial-board', from);
  await clickSquare(page, 'tutorial-board', to);
}

/** Starts recording every position the lesson board draws, so a short-lived one can't be missed. */
async function recordFens(page: Page): Promise<void> {
  await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('[data-testid=tutorial-board]')!;
    const seen: string[] = [];
    (window as unknown as { __fens: string[] }).__fens = seen;
    new MutationObserver(() => {
      const fen = host.dataset.fen ?? '';
      if (seen.at(-1) !== fen) seen.push(fen);
    }).observe(host, { attributes: true, attributeFilter: ['data-fen'] });
  });
}
const recordedFens = (page: Page) => page.evaluate(() => (window as unknown as { __fens: string[] }).__fens);

/** Each promotion puzzle's pawn move, in order; a queen is chosen for every one. */
const PROMOTIONS: [string, string][] = [['a7', 'a8'], ['g7', 'g8'], ['c7', 'd8'], ['a7', 'a8']];

/** Solves every promotion puzzle in order, from the lesson's puzzles step at puzzle 1. */
async function solvePromotions(page: Page): Promise<void> {
  for (const [i, [from, to]] of PROMOTIONS.entries()) {
    if (i > 0) await page.getByTestId('lesson-next').click();
    await expect(page.getByTestId('lesson-heading')).toHaveText(`Puzzle ${i + 1} of ${PROMOTIONS.length}`);
    await move(page, from, to);
    await page.getByTestId('choice-dialog').locator(`button[data-uci=${from}${to}q]`).click();
    await expect(feedback(page)).toHaveText(SOLVED);
  }
}

/** Opens the rook lesson's puzzles step at puzzle `n` (1-based). */
async function rookPuzzle(page: Page, n: number): Promise<void> {
  await openLesson(page, 'rook');
  await step(page, 3).click();
  await expect(step(page, 3)).toHaveAttribute('aria-current', 'step');
  for (let i = 1; i < n; i++) await page.getByTestId('lesson-next').click();
  await expect(page.getByTestId('lesson-heading')).toHaveText(`Puzzle ${n} of 4`);
  await expect(board(page)).toHaveAttribute('data-fen', /.+/);
}

test('see it highlights every rook square', async ({ page }) => {
  await openApp(page);
  await openLesson(page, 'rook');
  await expect(step(page, 0)).toHaveAttribute('data-state', 'current');
  await expect(board(page)).toHaveAttribute('data-fen', '4k3/8/8/8/3R4/8/8/4K3 w - - 0 1');
  await expect(marks(page, 'move')).toHaveCount(14);
  await expect(marks(page, 'capture')).toHaveCount(0);
  await expect(page.getByTestId('lesson-instruction')).toHaveText(/The rook moves in a straight line/);
});

test('try it moves the rook to each target, then marks the step done', async ({ page }) => {
  await openApp(page);
  await openLesson(page, 'rook');
  await page.getByTestId('lesson-next').click();
  await expect(step(page, 0)).toHaveAttribute('data-state', 'done');
  await expect(step(page, 1)).toHaveAttribute('data-state', 'current');
  await expect(marks(page, 'target')).toHaveCount(1);
  await expect(board(page).locator('.reach-square.target[data-square=b6]')).toHaveCount(1);
  await move(page, 'd4', 'b4');
  await expect(board(page)).toHaveAttribute('data-fen', /^7k\/8\/8\/8\/1R6\//);
  await move(page, 'b4', 'b6');
  await expect(board(page).locator('.reach-square.target[data-square=g2]')).toHaveCount(1);
  await move(page, 'b6', 'g6');
  await expect(board(page)).toHaveAttribute('data-fen', /^7k\/8\/6R1\//);
  await expect(step(page, 1)).toHaveAttribute('data-state', 'current');
  await move(page, 'g6', 'g2');
  await expect(step(page, 1)).toHaveAttribute('data-state', 'done');
  await expect(marks(page, 'target')).toHaveCount(0);
  // The step is over: the rook can no longer be picked up (chessgroundx draws a selection on its next frame).
  await clickSquare(page, 'tutorial-board', 'g2');
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(board(page).locator('square.selected, square.move-dest')).toHaveCount(0);
});

test('strategy pages are paged with Next, with their arrows', async ({ page }) => {
  await openApp(page);
  await openLesson(page, 'rook');
  await step(page, 2).click();
  await expect(page.getByTestId('lesson-heading')).toHaveText('Strategy 1 of 2');
  await expect(board(page)).toHaveAttribute('data-fen', '4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
  await expect(board(page).locator('svg.cg-shapes line')).toHaveCount(1);
  await page.getByTestId('lesson-next').click();
  await expect(page.getByTestId('lesson-heading')).toHaveText('Strategy 2 of 2');
  await expect(board(page).locator('svg.cg-shapes line')).toHaveCount(2);
  await page.getByTestId('lesson-next').click();
  await expect(step(page, 2)).toHaveAttribute('data-state', 'done');
  await expect(page.getByTestId('lesson-heading')).toHaveText('Puzzle 1 of 4');
});

test('a wrong puzzle move says "Not quite. Try again." and puts the piece back', async ({ page }) => {
  await openApp(page);
  await rookPuzzle(page, 1);
  const start = await board(page).getAttribute('data-fen');
  await move(page, 'b1', 'b2');
  await expect(feedback(page)).toHaveText(WRONG);
  await expect(board(page)).toHaveAttribute('data-fen', start!);
  // The right move still solves it.
  await move(page, 'b1', 'b5');
  await expect(feedback(page)).toHaveText(SOLVED);
  // A solved puzzle needs no hint, and "Solved!" stays.
  await expect(page.getByTestId('lesson-hint')).toBeDisabled();
});

test('hint shows only when pressed', async ({ page }) => {
  await openApp(page);
  await rookPuzzle(page, 1);
  await expect(feedback(page)).toHaveText('');
  await page.getByTestId('lesson-hint').click();
  await expect(feedback(page)).toHaveText(ROOK_FIRST_HINT);
});

test('a mate in 2: right key, the written reply plays, then mate says "Solved!"', async ({ page }) => {
  await openApp(page);
  await rookPuzzle(page, 4);
  await recordFens(page);
  await move(page, 'e2', 'e8');
  await expect(board(page)).toHaveAttribute('data-fen', /^4r1k1\/5ppp\/8\/8\/8\/8\/5PPP\/4R1K1 w/);
  // The player's move was drawn first, then the reply.
  expect((await recordedFens(page)).map((f) => f.split(' ')[0])).toEqual(['2r1R1k1/5ppp/8/8/8/8/5PPP/4R1K1', '4r1k1/5ppp/8/8/8/8/5PPP/4R1K1']);
  await move(page, 'e1', 'e8');
  await expect(feedback(page)).toHaveText(SOLVED);
  await expect(board(page)).toHaveAttribute('data-fen', /^4R1k1\//);
});

test('a wrong last move returns to the position after the reply', async ({ page }) => {
  await openApp(page);
  await rookPuzzle(page, 4);
  await move(page, 'e2', 'e8');
  await expect(board(page)).toHaveAttribute('data-fen', /^4r1k1\/5ppp\/8\/8\/8\/8\/5PPP\/4R1K1 w/);
  const afterReply = await board(page).getAttribute('data-fen');
  await move(page, 'e1', 'e2');
  await expect(feedback(page)).toHaveText(WRONG);
  await expect(board(page)).toHaveAttribute('data-fen', afterReply!);
  // Restart puts the puzzle back at its start.
  await page.getByTestId('lesson-restart').click();
  await expect(board(page)).toHaveAttribute('data-fen', '2r3k1/5ppp/8/8/8/8/4RPPP/4R1K1 w - - 0 1');
  await expect(feedback(page)).toHaveText('');
});

test('a castling puzzle is solved by dragging the king two squares, and the rook follows', async ({ page }) => {
  await openApp(page);
  await openLesson(page, 'castling');
  await step(page, 1).click();
  await expect(page.getByTestId('lesson-heading')).toHaveText('Puzzle 1 of 3');
  await expect(board(page)).toHaveAttribute('data-fen', '4k3/8/8/8/8/8/PPPPPPPP/RNBQK2R w K - 0 1');
  const cg = board(page).locator('cg-board');
  await expect.poll(async () => (await cg.boundingBox())?.width ?? 0).toBeGreaterThan(0);
  const box = (await cg.boundingBox())!;
  // White's view, so file e is column 4 and rank 1 the bottom row.
  const centre = (file: number) => [box.x + ((file + 0.5) * box.width) / 8, box.y + (7.5 * box.height) / 8] as const;
  await page.mouse.move(...centre(4));
  await page.mouse.down();
  await page.mouse.move(...centre(6), { steps: 8 });
  await page.mouse.up();
  await expect(feedback(page)).toHaveText(SOLVED);
  await expect(board(page)).toHaveAttribute('data-fen', /^4k3\/8\/8\/8\/8\/8\/PPPPPPPP\/RNBQ1RK1 /);
});

test('a promotion puzzle asks for the piece, and cancel is not wrong', async ({ page }) => {
  await openApp(page);
  await openLesson(page, 'promotion');
  await expect(step(page, 0)).toHaveText(/Learn/);
  await step(page, 1).click();
  await expect(page.getByTestId('lesson-heading')).toHaveText(`Puzzle 1 of ${PROMOTIONS.length}`);
  const start = await board(page).getAttribute('data-fen');
  const dialog = page.getByTestId('choice-dialog');
  await move(page, 'a7', 'a8');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(board(page)).toHaveAttribute('data-fen', start!);
  await expect(feedback(page)).toHaveText('');
  await move(page, 'a7', 'a8');
  await dialog.locator('button[data-uci=a7a8q]').click();
  await expect(feedback(page)).toHaveText(SOLVED);
  // One solved puzzle of several does not finish the puzzles step.
  await expect(step(page, 1)).not.toHaveAttribute('data-state', 'done');
});

test('without the engine, a custom-board lesson says the engine is needed', async ({ page, context }) => {
  await context.route(/stockfish/, (route) => route.fulfill({ status: 404, body: 'not found' }));
  await openApp(page);
  await openLesson(page, 'wazir');
  const notice = page.getByTestId('tutorial-notice');
  await expect(notice).toHaveText(ENGINE_NEEDED_MESSAGE, { timeout: 25000 });
  await expect(board(page)).toBeHidden();
  // Its steps stay navigable.
  await step(page, 3).click();
  await expect(step(page, 3)).toHaveAttribute('aria-current', 'step');
  await expect(notice).toHaveText(ENGINE_NEEDED_MESSAGE);
  // A lesson on a curated board still works.
  await openLesson(page, 'rook');
  await expect(notice).toBeHidden();
  await expect(board(page)).toHaveAttribute('data-fen', '4k3/8/8/8/3R4/8/8/4K3 w - - 0 1');
});

test('a custom-board lesson plays once the engine is ready', async ({ page }) => {
  await openApp(page);
  await openLesson(page, 'wazir');
  await expect(board(page)).toHaveAttribute('data-fen', '4k3/8/8/8/3W4/8/8/4K3 w - - 0 1', { timeout: 25000 });
  await expect(marks(page, 'move')).toHaveCount(4);
  // Each board is its own variant (its FEN is part of the definition). Once one is registered, coming back
  // to it shows no loading notice in between.
  await page.getByTestId('lesson-next').click();
  await expect(board(page)).toHaveAttribute('data-fen', '7k/8/8/8/3W4/8/8/K7 w - - 0 1');
  await page.evaluate(() => {
    const notice = document.querySelector<HTMLElement>('[data-testid=tutorial-notice]')!;
    const w = window as unknown as { __noticeShown: boolean };
    w.__noticeShown = false;
    new MutationObserver(() => {
      if (!notice.hidden) w.__noticeShown = true;
    }).observe(notice, { attributes: true, attributeFilter: ['hidden'] });
  });
  await step(page, 0).click();
  await expect(board(page)).toHaveAttribute('data-fen', '4k3/8/8/8/3W4/8/8/4K3 w - - 0 1');
  await step(page, 1).click();
  await expect(board(page)).toHaveAttribute('data-fen', '7k/8/8/8/3W4/8/8/K7 w - - 0 1');
  expect(await page.evaluate(() => (window as unknown as { __noticeShown: boolean }).__noticeShown)).toBe(false);
});

/** Starts a 5+0 hot-seat game and plays 1. e4, so Black's clock runs. */
async function startTimedGame(page: Page): Promise<void> {
  await page.getByTestId('top-play').click();
  const dialog = page.getByTestId('play-dialog');
  await dialog.locator('#play-variant').selectOption('chess');
  await dialog.locator('#play-opponent').selectOption('hotseat');
  await dialog.locator('#play-clock').selectOption('5+0');
  await dialog.getByRole('button', { name: 'Start' }).click();
  await clickSquare(page, 'board', 'e2');
  await clickSquare(page, 'board', 'e4');
  await expect(page.locator('[data-testid=move-list] .ply')).toHaveCount(1);
  await expect(page.getByTestId('clock-black')).toHaveClass(/running/);
}

const blackClock = (page: Page) => page.getByTestId('clock-black').textContent();

/** Black's clock is ticking: it shows a time other than `shown`. */
async function expectRunning(page: Page, shown: string | null): Promise<void> {
  await expect(page.getByTestId('clock-black')).toHaveClass(/running/);
  await expect.poll(() => blackClock(page), { timeout: 5000 }).not.toBe(shown);
}

/** The saved game without its clock, which is compared on its own. */
async function storedGame(page: Page): Promise<{ rest: Record<string, unknown>; clock: { whiteMs: number; blackMs: number; running: string | null } }> {
  const { clock, ...rest } = (await stored(page, 'chess.game')).data;
  return { rest, clock };
}

test('opening the tutorial mid-game pauses the clock, and the game and chess.game are unchanged after closing and after a reload', async ({ page }) => {
  await openApp(page);
  await startTimedGame(page);
  const fen = await page.getByTestId('board').getAttribute('data-fen');
  await openList(page);
  await expect(page.getByTestId('clock-black')).not.toHaveClass(/running/);
  const black = await blackClock(page);
  const paused = await storedGame(page);
  expect(paused.rest.moves).toEqual(['e2e4']);
  expect(paused.clock.running).toBeNull();
  // Work through a lesson, which takes real time; the paused clock and the saved game stay as they were.
  await card(page, 'rook').click();
  await page.getByTestId('lesson-next').click();
  await move(page, 'd4', 'b4');
  await expect(board(page)).toHaveAttribute('data-fen', /^7k\/8\/8\/8\/1R6\//);
  await page.waitForTimeout(1100);
  expect(await blackClock(page)).toBe(black);
  expect(await storedGame(page)).toEqual(paused);
  // All lessons goes back to the list, and Back to game closes the tutorial.
  await page.getByTestId('lesson-all').click();
  await expect(list(page)).toBeVisible();
  await page.getByTestId('lesson-list-back').click();
  await expect(page.getByTestId('tutorial')).toBeHidden();
  await expect(page.getByTestId('game')).toBeVisible();
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', fen!);
  await expect(page.locator('[data-testid=move-list] .ply')).toHaveCount(1);
  // The clock runs again from the time it was paused at.
  const resumed = await storedGame(page);
  expect(resumed.rest).toEqual(paused.rest);
  expect(resumed.clock).toMatchObject({ whiteMs: paused.clock.whiteMs, blackMs: paused.clock.blackMs, running: 'black' });
  await expectRunning(page, black);
  // A reload restores the same game, its clock paused until the next move, having lost no more than the time it ran.
  await page.reload();
  await expect.poll(() => page.evaluate(() => self.crossOriginIsolated).catch(() => false), { timeout: 15000 }).toBe(true);
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', fen!);
  await expect(page.locator('[data-testid=move-list] .ply')).toHaveCount(1);
  const reloaded = await storedGame(page);
  expect(reloaded.rest).toEqual(paused.rest);
  expect(reloaded.clock.whiteMs).toBe(paused.clock.whiteMs);
  expect(reloaded.clock.blackMs).toBeLessThan(paused.clock.blackMs);
  expect(reloaded.clock.blackMs).toBeGreaterThan(paused.clock.blackMs - 10000);
});

test("the top bar's Tutorial opens the lesson list grouped by track", async ({ page }) => {
  await openApp(page);
  await openList(page);
  const tracks = list(page).locator('[data-testid^=track-]');
  await expect(tracks).toHaveCount(3);
  await expect(tracks.locator('h3')).toHaveText(['Chess basics', 'Fairy pieces', 'Variants']);
  const cards = (track: string) => list(page).getByTestId(`track-${track}`).locator('[data-testid^=card-]');
  // Lessons keep landing, so check membership and order rather than the whole set.
  const names = async (track: string) => (await cards(track).allTextContents()).map((t) => t.trim());
  const basics = await names('basics');
  expect(basics[0]).toMatch(/^How a game is won/);
  await expect(cards('basics').first()).toHaveAttribute('data-testid', /^card-how-to-win-/);
  const at = (name: string) => basics.findIndex((t) => t.startsWith(name));
  for (const name of ['The board', 'Pawn', 'Knight', 'Bishop', 'Rook', 'Queen', 'King', 'Promotion', 'Draws']) expect(at(name), name).toBeGreaterThan(-1);
  expect(at('Bishop')).toBeLessThan(at('Rook'));
  expect(at('Rook')).toBeLessThan(at('Queen'));
  expect(at('Promotion')).toBeLessThan(at('Draws'));
  const fairy = await names('fairy');
  const fairyAt = (name: string) => fairy.findIndex((t) => t.startsWith(name));
  const fairyNames = ['Fers', 'Wazir', 'Commoner', 'Alfil', 'Archbishop', 'Hawk (Seirawan)', 'Warlord (Spartan)', 'Banner', 'Hoplite (Spartan)', 'Lieutenant (Spartan)', 'Captain (Spartan)', 'General (Xiangqi)', 'Advisor (Xiangqi)', 'Elephant (Xiangqi)', 'Soldier (Xiangqi)'];
  for (const name of [...fairyNames, 'General (Spartan)', 'Dragon King (Shogi)']) expect(fairyAt(name), name).toBeGreaterThan(-1);
  // A commoner is a fers and a wazir together, so its card follows the Wazir's; the Spartan pieces come last.
  for (const [a, b] of fairyNames.slice(1).map((name, i) => [fairyNames[i], name])) expect(fairyAt(a), `${a} before ${b}`).toBeLessThan(fairyAt(b));
  await expect(cards('variants')).toHaveText([/^Chess/, /Capablanca/, /Grand Chess/, /Seirawan/, /Amazon/, /Shako/, /Spartan/, /Antichess/, /Shogi/, /Xiangqi/, /Duck Chess/]);
  for (const c of await list(page).locator('[data-testid^=card-]').all()) await expect(c).toHaveAttribute('data-finished', 'false');
  // Back to game closes the tutorial.
  await page.getByTestId('lesson-list-back').click();
  await expect(page.getByTestId('tutorial')).toBeHidden();
  await expect(page.getByTestId('game')).toBeVisible();
});

test("solving all of a lesson's puzzles ticks its card, and the tick survives a reload", async ({ page }) => {
  await openApp(page);
  await openLesson(page, 'promotion');
  await step(page, 1).click();
  await solvePromotions(page);
  await expect(step(page, 1)).toHaveAttribute('data-state', 'done');
  await page.getByTestId('lesson-all').click();
  await expect(card(page, 'promotion')).toHaveAttribute('data-finished', 'true');
  await expect(card(page, 'rook')).toHaveAttribute('data-finished', 'false');
  expect(await stored(page, 'chess.tutorial')).toEqual({ version: 1, data: { finished: ['promotion'], solved: { promotion: [0, 1, 2, 3] } } });
  await openApp(page);
  await openList(page);
  await expect(card(page, 'promotion')).toHaveAttribute('data-finished', 'true');
});

test('once the last puzzle is solved, Next becomes Next lesson and opens the next lesson in the list', async ({ page }) => {
  await openApp(page);
  await openLesson(page, 'promotion');
  await step(page, 1).click();
  const next = page.getByTestId('lesson-next');
  await expect(next).toHaveText('Next');
  await solvePromotions(page);
  await expect(next).toBeEnabled();
  await expect(next).toHaveText('Next lesson');
  await next.click();
  await expect(page.getByTestId('lesson-title')).toHaveText('Draws');
  await expect(step(page, 0)).toHaveAttribute('aria-current', 'step');
  await expect(next).toHaveText('Next');
});

test('on the last puzzle, Next stays off until that puzzle is solved', async ({ page }) => {
  await openApp(page);
  await rookPuzzle(page, 4);
  const next = page.getByTestId('lesson-next');
  await expect(page.getByTestId('lesson-heading')).toHaveText('Puzzle 4 of 4');
  await expect(next).toBeDisabled();
  await expect(next).toHaveText('Next');
});

test('a half-done lesson resumes at its first unsolved puzzle, after a reload too', async ({ page }) => {
  await openApp(page);
  await rookPuzzle(page, 1);
  await move(page, 'b1', 'b5');
  await expect(feedback(page)).toHaveText(SOLVED);
  await openApp(page);
  await openLesson(page, 'rook');
  await expect(step(page, 0)).toHaveAttribute('aria-current', 'step');
  await step(page, 3).click();
  await expect(page.getByTestId('lesson-heading')).toHaveText('Puzzle 2 of 4');
});

test('a corrupt chess.tutorial shows the banner and an empty list', async ({ page }) => {
  // Valid-looking ids with a bad solved list: a lenient reader would tick the rook.
  const bad = JSON.stringify({ version: 1, data: { finished: ['rook'], solved: { rook: 'all' } } });
  await page.addInitScript((raw) => localStorage.setItem('chess.tutorial', raw), bad);
  await openApp(page);
  await expect(page.getByTestId('storage-banner')).toContainText(CORRUPT_TUTORIAL);
  expect(await page.evaluate(() => localStorage.getItem('chess.tutorial.corrupt'))).toBe(bad);
  await openList(page);
  for (const c of await list(page).locator('[data-testid^=card-]').all()) await expect(c).toHaveAttribute('data-finished', 'false');
});

test('a variant page is ticked once opened', async ({ page }) => {
  await openApp(page);
  await openList(page);
  await expect(card(page, 'variant-shako')).toHaveAttribute('data-finished', 'false');
  await card(page, 'variant-shako').click();
  const vp = page.getByTestId('variant-page');
  await expect(vp).toBeVisible();
  await expect(vp.getByTestId('variant-title')).toHaveText('Shako');
  await expect(vp.getByTestId('variant-blurb')).toHaveText('Played on a 10x10 board with cannons and elephants added to the usual pieces.');
  await expect(vp.getByTestId('variant-differences').locator('li')).not.toHaveCount(0);
  await expect(vp.getByTestId('variant-board')).toHaveAttribute('data-files', '10');
  await expect(vp.getByTestId('variant-board')).toHaveAttribute('data-fen', /^c8c\/ernbqkbnre\//);
  const pieces = vp.getByTestId('variant-pieces').locator('li');
  await expect(pieces).toHaveCount(8);
  for (const name of ['Cannon', 'Elephant', 'Rook', 'Knight', 'Bishop', 'Queen', 'King', 'Pawn']) await expect(pieces.filter({ hasText: name })).toHaveCount(1);
  await page.getByTestId('variant-all').click();
  await expect(card(page, 'variant-shako')).toHaveAttribute('data-finished', 'true');
  await expect(card(page, 'variant-grand')).toHaveAttribute('data-finished', 'false');
});

test('the Duck Chess page explains the duck, winning by capturing the king, and no check', async ({ page }) => {
  await openApp(page);
  await openList(page);
  await card(page, 'variant-duck').click();
  const vp = page.getByTestId('variant-page');
  await expect(vp.getByTestId('variant-title')).toHaveText('Duck Chess');
  const differences = vp.getByTestId('variant-differences').locator('li');
  await expect(differences).toHaveCount(4);
  await expect(differences.nth(0)).toContainText('belongs to neither side');
  await expect(differences.nth(1)).toHaveText('You win by capturing the king.');
  await expect(differences.nth(2)).toContainText('There is no check');
  // The game starts without the duck: White places it with the first move.
  await expect(vp.getByTestId('variant-board')).toHaveAttribute('data-fen', /^rnbqkbnr\/pppppppp\/8\/8\/8\/8\//);
  await page.getByTestId('variant-play').click();
  await expect(page.getByTestId('play-dialog').locator('#play-variant')).toHaveValue('duck');
});

test('Play this variant opens the Play dialog with the variant chosen, and nothing changes until Start', async ({ page }) => {
  await openApp(page);
  await startTimedGame(page);
  await openList(page);
  const paused = await stored(page, 'chess.game');
  await card(page, 'variant-capablanca').click();
  await expect(page.getByTestId('variant-board')).toHaveAttribute('data-fen', /^rnabqkbcnr\//);
  const dialog = page.getByTestId('play-dialog');
  await page.getByTestId('variant-play').click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#play-variant')).toHaveValue('capablanca');
  // Cancel leaves everything as it was: the variant page is still shown, the game paused and unsaved.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('variant-page')).toBeVisible();
  await expect(page.getByTestId('clock-black')).not.toHaveClass(/running/);
  expect(await stored(page, 'chess.game')).toEqual(paused);
  // Start plays it.
  await page.getByTestId('variant-play').click();
  await dialog.locator('#play-opponent').selectOption('hotseat');
  await dialog.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByTestId('tutorial')).toBeHidden();
  await expect(page.getByTestId('game')).toBeVisible();
  await expect(page.getByTestId('game-line')).toHaveText(/^Capablanca/);
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', /^rnabqkbcnr\//);
});

test('Settings, Edit game over a lesson leaves one screen, and the clock runs once the editor closes', async ({ page }) => {
  await openApp(page);
  await startTimedGame(page);
  await openLesson(page, 'rook');
  await page.getByTestId('top-settings').click();
  await page.getByTestId('settings-edit-game').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('tutorial')).toBeHidden();
  await expect(page.getByTestId('game')).toBeHidden();
  const black = await blackClock(page);
  await page.getByTestId('editor-close').click();
  await expect(page.getByTestId('editor')).toBeHidden();
  await expect(page.getByTestId('tutorial')).toBeHidden();
  await expect(page.getByTestId('game')).toBeVisible();
  await expectRunning(page, black);
});

test('Play over a lesson starts the game and leaves the tutorial', async ({ page }) => {
  await openApp(page);
  await openLesson(page, 'rook');
  await startTimedGame(page);
  await expect(page.getByTestId('tutorial')).toBeHidden();
  await expect(page.getByTestId('game')).toBeVisible();
});

test('the editor over a lesson leaves one screen', async ({ page }) => {
  await openApp(page);
  await openLesson(page, 'rook');
  await page.getByTestId('top-editor').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('tutorial')).toBeHidden();
  await page.getByTestId('editor-close').click();
  await expect(page.getByTestId('game')).toBeVisible();
  await expect(page.getByTestId('tutorial')).toBeHidden();
});

// ---- "Learn this piece" links ----------------------------------------------------------------

/** Expects the rook lesson on screen, at its first step, with the game and the editor hidden. */
async function expectRookLesson(page: Page): Promise<void> {
  await expect(page.getByTestId('lesson')).toBeVisible();
  await expect(page.getByTestId('lesson-title')).toHaveText('The rook');
  await expect(step(page, 0)).toHaveAttribute('data-state', 'current');
  await expect(page.getByTestId('editor')).toBeHidden();
  await expect(page.getByTestId('game')).toBeHidden();
}

/** Leaves the tutorial by All lessons and Back, for the game. */
async function leaveTutorial(page: Page): Promise<void> {
  await page.getByTestId('lesson-all').click();
  await page.getByTestId('lesson-list-back').click();
  await expect(page.getByTestId('tutorial')).toBeHidden();
  await expect(page.getByTestId('game')).toBeVisible();
}

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 820, height: 1180 } });

  test("the palette's ? is big enough to tap, and tapping the piece beside it still arms the piece", async ({ page }) => {
    await openApp(page);
    await page.getByTestId('top-editor').click();
    const learn = page.getByTestId('learn-rook');
    const box = (await learn.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(24);
    // It stays clear of the next piece in the row.
    const neighbour = (await page.getByTestId('palette-white-queen').boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(neighbour.x);
    // The piece's own button keeps a clear centre to tap.
    const piece = page.getByTestId('palette-white-rook');
    await piece.tap();
    await expect(piece).toHaveAttribute('aria-pressed', 'true');
    await learn.tap();
    await expectRookLesson(page);
  });
});

test('on a desktop the ? stays small', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('top-editor').click();
  const box = (await page.getByTestId('learn-rook').boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(20);
});

test("the rook's ? in the editor palette opens the rook lesson, and every built-in piece has one", async ({ page }) => {
  await openApp(page);
  await page.getByTestId('top-editor').click();
  await expect(page.getByTestId('editor-board')).toHaveAttribute('data-fen', /.+/);
  const fen = await page.getByTestId('editor-board').getAttribute('data-fen');
  await expect(page.getByTestId('learn-wazir')).toBeVisible();
  await expect(page.getByTestId('learn-knight')).toBeVisible();
  // Every built-in piece has a lesson, so every built-in White entry has its ?.
  const builtins = page.locator('[data-testid^="palette-white-"]:not([data-testid^="palette-white-own-"])');
  const ids = (await builtins.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.testid!))).map((t) => t.slice('palette-white-'.length));
  expect(ids.length).toBeGreaterThan(30);
  for (const id of ids) await expect(page.getByTestId(`learn-${id}`), id).toBeVisible();
  await expect(page.getByTestId('learn-rook')).toHaveAccessibleName('Learn the Rook');
  await page.getByTestId('learn-rook').click();
  await expectRookLesson(page);
  await leaveTutorial(page);
  // The ? neither armed the rook nor placed one: the editor comes back as it was.
  await page.getByTestId('top-editor').click();
  await expect(page.getByTestId('editor-board')).toHaveAttribute('data-fen', fen!);
  await expect(page.getByTestId('palette-white-rook')).toHaveAttribute('aria-pressed', 'false');
});

test("the panel's Pieces line names the game's pieces in board order, and its Rook link opens the rook lesson", async ({ page }) => {
  await openApp(page);
  const line = page.getByTestId('game-pieces');
  await expect(line.locator('[data-letter]')).toHaveText(['Rook', 'Knight', 'Bishop', 'Queen', 'King', 'Pawn']);
  // Every standard piece has a lesson, so each name is a link.
  await expect(line.getByRole('button')).toHaveText(['Rook', 'Knight', 'Bishop', 'Queen', 'King', 'Pawn']);
  const fen = await page.getByTestId('board').getAttribute('data-fen');
  await line.getByRole('button', { name: 'Rook' }).click();
  await expectRookLesson(page);
  await leaveTutorial(page);
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', fen!);
});

test("a variant page links each piece that has a lesson to it", async ({ page }) => {
  await openApp(page);
  await openList(page);
  await card(page, 'variant-chess').click();
  const pieces = page.getByTestId('variant-pieces');
  await expect(pieces.locator('li')).toHaveCount(6);
  // Every standard piece has a lesson, so each one is a link.
  await expect(pieces.getByRole('button')).toHaveCount(6);
  await pieces.getByRole('button', { name: 'Rook' }).click();
  await expectRookLesson(page);
});

// ---- Paths the other tests don't reach -------------------------------------------------------

test('a reload with a lesson open restores the paused game exactly as it was saved', async ({ page }) => {
  await openApp(page);
  await startTimedGame(page);
  const fen = await page.getByTestId('board').getAttribute('data-fen');
  await openLesson(page, 'rook');
  const paused = await stored(page, 'chess.game');
  expect(paused.data.clock.running).toBeNull();
  // Time passes with the lesson open; none of it may be charged to the paused clock.
  await page.waitForTimeout(1100);
  await page.reload();
  await expect.poll(() => page.evaluate(() => self.crossOriginIsolated).catch(() => false), { timeout: 15000 }).toBe(true);
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', fen!);
  await expect(page.locator('[data-testid=move-list] .ply')).toHaveCount(1);
  await expect(page.getByTestId('clock-black')).not.toHaveClass(/running/);
  expect(await stored(page, 'chess.game')).toEqual(paused);
  const { whiteMs, blackMs, running } = (await stored(page, 'chess.game')).data.clock;
  expect({ whiteMs, blackMs, running }).toEqual({ whiteMs: paused.data.clock.whiteMs, blackMs: paused.data.clock.blackMs, running: null });
});

test('a Try it move on a custom board plays, by click and by drag', async ({ page }) => {
  await openApp(page);
  await openLesson(page, 'wazir');
  await page.getByTestId('lesson-next').click();
  await expect(board(page)).toHaveAttribute('data-fen', '7k/8/8/8/3W4/8/8/K7 w - - 0 1', { timeout: 25000 });
  await expect(board(page).locator('.reach-square.target[data-square=e5]')).toHaveCount(1);
  await move(page, 'd4', 'd5');
  await expect(board(page)).toHaveAttribute('data-fen', /^7k\/8\/8\/3W4\/8\//);
  await expect(step(page, 1)).toHaveAttribute('data-state', 'current');
  const cg = board(page).locator('cg-board');
  const box = (await cg.boundingBox())!;
  // White's view: file d is column 3, file e column 4, rank 5 the fourth row from the top.
  const centre = (col: number) => [box.x + ((col + 0.5) * box.width) / 8, box.y + (3.5 * box.height) / 8] as const;
  await page.mouse.move(...centre(3));
  await page.mouse.down();
  await page.mouse.move(...centre(4), { steps: 8 });
  await page.mouse.up();
  await expect(board(page)).toHaveAttribute('data-fen', /^7k\/8\/8\/4W3\/8\//);
  await expect(step(page, 1)).toHaveAttribute('data-state', 'done');
});

test('without the engine, a variant page still shows its start position', async ({ page, context }) => {
  await context.route(/stockfish/, (route) => route.fulfill({ status: 404, body: 'not found' }));
  await openApp(page);
  // Wait until the engine is known to be unavailable, so the variant page is drawn without it.
  await openLesson(page, 'wazir');
  await expect(page.getByTestId('tutorial-notice')).toHaveText(ENGINE_NEEDED_MESSAGE, { timeout: 25000 });
  await page.getByTestId('lesson-all').click();
  await card(page, 'variant-shako').click();
  const vp = page.getByTestId('variant-page');
  await expect(vp.getByTestId('variant-board')).toHaveAttribute('data-files', '10');
  await expect(vp.getByTestId('variant-board')).toHaveAttribute('data-fen', /^c8c\/ernbqkbnre\//);
  await expect(vp.getByTestId('variant-board').locator('piece')).not.toHaveCount(0);
});

test("the top bar's Tutorial is ignored while the piece designer is open, so a half-designed piece is kept", async ({ page }) => {
  await openApp(page);
  await page.getByTestId('top-editor').click();
  await page.getByTestId('palette-new-piece').click();
  await expect(page.getByTestId('designer')).toBeVisible();
  await page.locator('#designer-name').fill('Half done');
  await page.getByTestId('top-tutorial').click();
  await expect(page.getByTestId('tutorial')).toBeHidden();
  await expect(page.getByTestId('designer')).toBeVisible();
  await expect(page.locator('#designer-name')).toHaveValue('Half done');
});

test("in Edit current game, the top bar's Tutorial is ignored and the palette has no ?, so pending edits are kept", async ({ page }) => {
  await openApp(page);
  await page.getByTestId('edit').click();
  await expect(page.getByTestId('editor-close')).toHaveText('Cancel');
  const editorBoard = page.getByTestId('editor-board');
  await expect(editorBoard).toHaveAttribute('data-fen', /.+/);
  await page.getByTestId('palette-eraser').click();
  await expect(page.getByTestId('palette-eraser')).toHaveAttribute('aria-pressed', 'true');
  await clickSquare(page, 'editor-board', 'a2');
  await expect(editorBoard).toHaveAttribute('data-fen', /^rnbqkbnr\/pppppppp\/8\/8\/8\/8\/1PPPPPPP\//);
  const edited = await editorBoard.getAttribute('data-fen');
  // A ? would leave the editor and lose the edits, so the palette has none here.
  await expect(page.getByTestId('palette-white-rook')).toBeVisible();
  await expect(page.getByTestId('learn-rook')).toBeHidden();
  await page.getByTestId('top-tutorial').click();
  await expect(page.getByTestId('tutorial')).toBeHidden();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(editorBoard).toHaveAttribute('data-fen', edited!);
  await expect(page.getByTestId('editor-close')).toHaveText('Cancel');
});
