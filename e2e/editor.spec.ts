import { expect, type Page, test } from '@playwright/test';

// The registry's own message (src/variants/registry.ts); Playwright's loader can't import modules that load ffish.
const ENGINE_NEEDED_MESSAGE = 'The AI engine is needed to check custom setups and is not available.';
/** Chess on a 10x8 board with an archbishop per side on the i-file. */
const ARCHBISHOP_FEN = 'rnbqkbnra1/pppppppp2/10/10/10/10/PPPPPPPP2/RNBQKBNRA1 w - - 0 1';

async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect
    .poll(() => page.evaluate(() => self.crossOriginIsolated).catch(() => false), { timeout: 15000 })
    .toBe(true);
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', /.+/);
}

const editorBoard = (page: Page) => page.getByTestId('editor-board');
const problems = (page: Page) => page.getByTestId('editor-problems').locator('li');
const plies = (page: Page) => page.locator('[data-testid=move-list] .ply');

async function openEditor(page: Page): Promise<void> {
  await page.getByTestId('top-editor').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('game')).toBeHidden();
  await expect(editorBoard(page)).toHaveAttribute('data-fen', /.+/);
}

/** Clicks the centre of a UCI square on a board (White at the bottom in the editor; honours orientation in the game). */
async function clickSquare(page: Page, testid: string, square: string): Promise<void> {
  const board = page.getByTestId(testid);
  const files = Number(await board.getAttribute('data-files'));
  const ranks = Number(await board.getAttribute('data-ranks'));
  const orientation = (await board.getAttribute('data-orientation')) ?? 'white';
  await board.scrollIntoViewIfNeeded();
  const box = await board.locator('cg-board').boundingBox();
  if (!box) throw new Error('board has no layout box');
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square.slice(1)) - 1;
  const col = orientation === 'white' ? file : files - 1 - file;
  const row = orientation === 'white' ? ranks - 1 - rank : rank;
  await page.mouse.click(box.x + ((col + 0.5) * box.width) / files, box.y + ((row + 0.5) * box.height) / ranks);
}

async function placeOn(page: Page, tool: string, square: string): Promise<void> {
  await page.getByTestId(`palette-${tool}`).click();
  await expect(page.getByTestId(`palette-${tool}`)).toHaveAttribute('aria-pressed', 'true');
  await clickSquare(page, 'editor-board', square);
}

/** Builds the archbishop setup in the editor and saves it under `name`. */
async function saveArchbishopSetup(page: Page, name: string): Promise<void> {
  await openEditor(page);
  await page.locator('#editor-files').selectOption('10');
  await placeOn(page, 'white-archbishop', 'i1');
  await placeOn(page, 'black-archbishop', 'i8');
  await expect(editorBoard(page)).toHaveAttribute('data-fen', ARCHBISHOP_FEN);
  await page.locator('#editor-name').fill(name);
  // The engine checks the generated variant first; Save waits for it.
  await expect(page.getByTestId('editor-status')).toHaveText('Ready to play.', { timeout: 20000 });
  await expect(problems(page)).toHaveCount(0);
  await page.getByTestId('editor-save').click();
  await expect(page.getByTestId('editor-notice')).toHaveText(`Saved “${name}”.`);
}

async function startSavedSetup(page: Page, name: string, opponent: string): Promise<void> {
  await page.getByTestId('top-play').click();
  const dialog = page.getByTestId('play-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#play-variant').selectOption({ label: name });
  await dialog.locator('#play-opponent').selectOption(opponent);
  if (opponent !== 'hotseat') await dialog.locator('#play-color').selectOption('white');
  await dialog.locator('#play-clock').selectOption('None');
  await expect(dialog.getByRole('button', { name: 'Start' })).toBeEnabled({ timeout: 20000 });
  await dialog.getByRole('button', { name: 'Start' }).click();
  await expect(dialog).toBeHidden();
}

test('builds a 10×8 setup with an archbishop, saves it, and plays it hot-seat from the Play dialog', async ({ page }) => {
  await openApp(page);
  await saveArchbishopSetup(page, 'Archbishops <b>wide</b>');
  await page.getByTestId('editor-close').click();
  await expect(page.getByTestId('game')).toBeVisible();
  await startSavedSetup(page, 'Archbishops <b>wide</b>', 'hotseat');
  await expect(page.getByTestId('game-line')).toHaveText('Custom (based on Chess) · Hot-seat');
  const board = page.getByTestId('board');
  await expect(board).toHaveAttribute('data-files', '10');
  await expect(board).toHaveAttribute('data-fen', ARCHBISHOP_FEN);
  await expect(board).toHaveAttribute('data-variant', /^cx_[0-9a-f]{8}$/);
  expect(await page.locator('[data-testid=board] piece.a-piece.white').first().evaluate((el) => getComputedStyle(el).backgroundImage)).toContain(
    'pieces/merida/wA.svg',
  );
  // The archbishop moves like one: a knight jump from i1.
  await clickSquare(page, 'board', 'i1');
  await clickSquare(page, 'board', 'h3');
  await expect(plies(page)).toHaveCount(1);
});

test('plays a saved setup against the AI and gets a legal reply', async ({ page }) => {
  await openApp(page);
  await saveArchbishopSetup(page, 'Versus the AI');
  await page.getByTestId('editor-close').click();
  await startSavedSetup(page, 'Versus the AI', 'beginner');
  await expect(page.getByTestId('game-line')).toHaveText('Custom (based on Chess) · AI: Beginner');
  await clickSquare(page, 'board', 'e2');
  await clickSquare(page, 'board', 'e4');
  await expect(plies(page).first()).toHaveText('e4');
  await expect(plies(page)).toHaveCount(2, { timeout: 20000 });
  await expect(page.getByTestId('status')).toHaveText(/White to move/);
});

test('shows why Play is disabled when black has no king, and enables it once a king is placed', async ({ page }) => {
  await openApp(page);
  await openEditor(page);
  await placeOn(page, 'eraser', 'e8');
  await expect(editorBoard(page)).toHaveAttribute('data-fen', /^rnbq1bnr\//);
  await expect(problems(page)).toHaveText(['Black needs a king.']);
  await expect(page.getByTestId('editor-play')).toBeDisabled();
  await expect(page.getByTestId('editor-save')).toBeDisabled();
  await placeOn(page, 'black-king', 'e8');
  await expect(problems(page)).toHaveCount(0);
  await expect(page.getByTestId('editor-play')).toBeEnabled();
  // Play opens the Play dialog with this setup chosen, and starts it as plain chess from the editor's position.
  await page.getByTestId('editor-play').click();
  const dialog = page.getByTestId('play-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#play-opponent').selectOption('hotseat');
  await dialog.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByTestId('game')).toBeVisible();
  await expect(page.getByTestId('editor')).toBeHidden();
  await expect(page.getByTestId('game-line')).toHaveText('Chess · Hot-seat');
});

test('tells the player how many pieces were removed when the board shrinks', async ({ page }) => {
  await openApp(page);
  await openEditor(page);
  await page.locator('#editor-files').selectOption('6');
  await expect(editorBoard(page)).toHaveAttribute('data-files', '6');
  await expect(page.getByTestId('editor-notice')).toHaveText('Removed 8 pieces that no longer fit on the board.');
  await expect(editorBoard(page)).toHaveAttribute('data-fen', /^rnbqkb\/pppppp\/6\/6\/6\/6\/PPPPPP\/RNBQKB /);
  // Castling has no effect on a board of another size than the base's, so it can't be ticked there.
  await expect(page.locator('#editor-castling')).toBeDisabled();
  await page.locator('#editor-files').selectOption('8');
  await expect(page.locator('#editor-castling')).toBeEnabled();
});

test('names the castling control "Castling and gating" for Seirawan, where it also holds the gating rights', async ({ page }) => {
  await openApp(page);
  await openEditor(page);
  await expect(page.getByText('Castling', { exact: true })).toBeVisible();
  await page.locator('#editor-base').selectOption('seirawan');
  await expect(page.getByText('Castling and gating', { exact: true })).toBeVisible();
  await page.locator('#editor-castling').uncheck();
  await expect(editorBoard(page)).toHaveAttribute('data-fen', /\[[A-Za-z]*\] w - /);
});

const right = (page: Page, label: string) => page.getByRole('checkbox', { name: label, exact: true });

test('has a box per castling right, each allowed only while its king and rook are in place', async ({ page }) => {
  await openApp(page);
  await openEditor(page);
  for (const label of ['White O-O', 'White O-O-O', 'Black O-O', 'Black O-O-O']) await expect(right(page, label)).toBeChecked();
  await right(page, 'Black O-O-O').uncheck();
  await expect(editorBoard(page)).toHaveAttribute('data-fen', / w KQk - /);
  await placeOn(page, 'eraser', 'a1');
  await expect(right(page, 'White O-O-O')).toBeDisabled();
  await expect(right(page, 'White O-O-O')).not.toBeChecked();
  await expect(editorBoard(page)).toHaveAttribute('data-fen', / w Kk - /);
  // Castling off: no rights at all, and the boxes go with it.
  await page.locator('#editor-castling').uncheck();
  await expect(right(page, 'White O-O')).toBeHidden();
  await expect(editorBoard(page)).toHaveAttribute('data-fen', / w - - /);
  await page.locator('#editor-castling').check();
  await expect(editorBoard(page)).toHaveAttribute('data-fen', / w Kk - /);
});

test("lists Seirawan's gating files with its castling rights, and none for a base without castling", async ({ page }) => {
  await openApp(page);
  await openEditor(page);
  await page.locator('#editor-base').selectOption('seirawan');
  await expect(right(page, 'White O-O and gating')).toBeChecked();
  await expect(right(page, 'Black gating on the g-file')).toBeChecked();
  await right(page, 'Black gating on the g-file').uncheck();
  await expect(editorBoard(page)).toHaveAttribute('data-fen', / w KQBCDFGkqbcdf - /);
  await page.locator('#editor-base').selectOption('grand');
  await expect(page.getByRole('checkbox', { name: /O-O|gating/ })).toHaveCount(0);
});

test('keeps saved setups across a reload', async ({ page }) => {
  await openApp(page);
  await saveArchbishopSetup(page, 'Kept');
  await page.reload();
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', /.+/);
  await page.getByTestId('top-play').click();
  const saved = page.getByTestId('play-dialog').locator('optgroup[label="Saved setups"] option');
  await expect(saved).toHaveText(['Kept']);
  // A saved setup can be deleted from the list.
  await page.getByTestId('play-dialog').locator('#play-variant').selectOption({ label: 'Kept' });
  // Deleting asks first; No keeps the setup.
  await page.getByTestId('delete-setup').click();
  await expect(page.getByTestId('delete-confirm')).toHaveText(/Delete “Kept”\?/);
  await page.getByTestId('delete-setup-no').click();
  await expect(page.getByTestId('delete-confirm')).toBeHidden();
  await expect(saved).toHaveText(['Kept']);
  await page.getByTestId('delete-setup').click();
  await page.getByTestId('delete-setup-yes').click();
  await expect(saved).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', /.+/);
  await page.getByTestId('top-play').click();
  await expect(saved).toHaveCount(0);
});

test('disables Play for a custom setup while the engine is unavailable, with the reason', async ({ page, context }) => {
  await context.route(/stockfish/, (route) => route.fulfill({ status: 404, body: 'not found' }));
  await openApp(page);
  await openEditor(page);
  await page.locator('#editor-files').selectOption('10');
  await expect(problems(page)).toHaveText([ENGINE_NEEDED_MESSAGE], { timeout: 25000 });
  await expect(page.getByTestId('editor-play')).toBeDisabled();
  // A position-only edit needs no engine.
  await page.locator('#editor-files').selectOption('8');
  await page.locator('#editor-castling').check();
  await expect(problems(page)).toHaveCount(0);
  await expect(page.getByTestId('editor-play')).toBeEnabled();
});

test("pauses the game's clock while the editor is open and leaves the game as it was", async ({ page }) => {
  await openApp(page);
  await page.getByTestId('top-play').click();
  const dialog = page.getByTestId('play-dialog');
  await dialog.locator('#play-variant').selectOption('chess');
  await dialog.locator('#play-opponent').selectOption('hotseat');
  await dialog.locator('#play-clock').selectOption('5+0');
  await dialog.getByRole('button', { name: 'Start' }).click();
  await clickSquare(page, 'board', 'e2');
  await clickSquare(page, 'board', 'e4');
  await expect(plies(page)).toHaveCount(1);
  const fen = await page.getByTestId('board').getAttribute('data-fen');
  await openEditor(page);
  const black = await page.getByTestId('clock-black').textContent();
  await page.waitForTimeout(2000);
  expect(await page.getByTestId('clock-black').textContent()).toBe(black);
  await placeOn(page, 'eraser', 'a1');
  await page.getByTestId('editor-close').click();
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', fen!);
  await expect(plies(page)).toHaveCount(1);
  await page.waitForTimeout(1500);
  expect(await page.getByTestId('clock-black').textContent()).not.toBe(black);
});

test("stops the AI's search while the editor is open, so no clock runs, and the AI moves once it closes", async ({ page }) => {
  await openApp(page);
  await page.getByTestId('top-play').click();
  const dialog = page.getByTestId('play-dialog');
  await dialog.locator('#play-variant').selectOption('chess');
  await dialog.locator('#play-opponent').selectOption('expert');
  await dialog.locator('#play-color').selectOption('black');
  await dialog.locator('#play-clock').selectOption('1+0');
  await dialog.getByRole('button', { name: 'Start' }).click();
  // The AI plays White and starts thinking at once; open the editor during its search. The exact text, so the
  // engine has loaded and the search is really running (not "AI is thinking… (engine loading)").
  await expect(page.getByTestId('status')).toHaveText('AI is thinking…', { timeout: 20000 });
  await openEditor(page);
  await expect(plies(page)).toHaveCount(0);
  const white = await page.getByTestId('clock-white').textContent();
  const black = await page.getByTestId('clock-black').textContent();
  // Long enough for the AI to answer on a 1+0 clock if its search were still running.
  await page.waitForTimeout(4000);
  expect(await page.getByTestId('clock-white').textContent()).toBe(white);
  expect(await page.getByTestId('clock-black').textContent()).toBe(black);
  await expect(plies(page)).toHaveCount(0);
  await page.getByTestId('editor-close').click();
  await expect(plies(page)).toHaveCount(1, { timeout: 20000 });
});
