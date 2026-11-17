import { expect, type Page, test } from '@playwright/test';
import { expectRiverAndPalaces } from './board-colours';

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
  // Within the editor: the tutorial's lesson list has a Castling card of its own.
  const editor = page.getByTestId('editor');
  await expect(editor.getByText('Castling', { exact: true })).toBeVisible();
  await page.locator('#editor-base').selectOption('seirawan');
  await expect(editor.getByText('Castling and gating', { exact: true })).toBeVisible();
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

// ---- Shogi and Xiangqi: position-only bases ----------------------------------------------------------

/** A pocket piece on the game board: `bottom` is the side at the bottom of the board. */
const pocketPiece = (page: Page, pocket: 'top' | 'bottom', letter: string) =>
  page.locator(`[data-testid=board] .pocket.${pocket} piece.${letter}-piece`);

/** The centre of a UCI square on a board, honouring its size and orientation. */
async function squareCentre(page: Page, testid: string, square: string): Promise<{ x: number; y: number }> {
  const board = page.getByTestId(testid);
  const files = Number(await board.getAttribute('data-files'));
  const ranks = Number(await board.getAttribute('data-ranks'));
  const flipped = (await board.getAttribute('data-orientation')) === 'black';
  await board.scrollIntoViewIfNeeded();
  const box = (await board.locator('cg-board').boundingBox())!;
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square.slice(1)) - 1;
  const col = flipped ? files - 1 - file : file;
  const row = flipped ? rank : ranks - 1 - rank;
  return { x: box.x + ((col + 0.5) * box.width) / files, y: box.y + ((row + 0.5) * box.height) / ranks };
}

/** Drags with the mouse, as a player would, from one point to another. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

async function dragFromPocket(page: Page, pocket: 'top' | 'bottom', letter: string, square: string): Promise<void> {
  const box = (await pocketPiece(page, pocket, letter).boundingBox())!;
  await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, await squareCentre(page, 'board', square));
}

async function move(page: Page, from: string, to: string): Promise<void> {
  await clickSquare(page, 'board', from);
  await clickSquare(page, 'board', to);
}

/** Sets a count in the editor's Pieces in hand. */
async function setHand(page: Page, color: 'white' | 'black', letter: string, count: number): Promise<void> {
  const input = page.locator(`#editor-pocket-${color}-${letter}`);
  await input.fill(String(count));
  await input.dispatchEvent('change');
}

async function startHotseatFromEditor(page: Page): Promise<void> {
  await expect(page.getByTestId('editor-status')).toHaveText('Ready to play.', { timeout: 20000 });
  await page.getByTestId('editor-play').click();
  const dialog = page.getByTestId('play-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#play-opponent').selectOption('hotseat');
  await dialog.locator('#play-clock').selectOption('None');
  await dialog.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByTestId('game')).toBeVisible();
}

const savedGame = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('chess.game')!).data as { variant: string; startFen: string; moves: string[] });

test('a Shogi base keeps its size and its own pieces, promoted forms included, and Play starts Shogi from the FEN', async ({ page }) => {
  await openApp(page);
  await openEditor(page);
  await page.locator('#editor-base').selectOption('shogi');
  await expect(editorBoard(page)).toHaveAttribute('data-files', '9');
  // Position-only: the size is fixed (and says why), and there is no castling, no other piece and no designed piece.
  await expect(page.locator('#editor-files')).toBeDisabled();
  await expect(page.locator('#editor-ranks')).toBeDisabled();
  await expect(page.getByTestId('editor-size-reason')).toHaveText('Shogi and Xiangqi keep their own board size.');
  await expect(page.locator('#editor-castling')).toBeHidden();
  const palette = page.locator('.palette');
  await expect(palette.getByTestId('palette-white-queen')).toHaveCount(0);
  await expect(palette.getByTestId('palette-new-piece')).toHaveCount(0);
  await expect(palette.locator('[data-testid^=palette-white-own-]')).toHaveCount(8);
  for (const letter of 'plnsbr') await expect(palette.getByTestId(`palette-black-promoted-${letter}`)).toHaveCount(1);
  await expect(palette.getByTestId('palette-white-promoted-g')).toHaveCount(0);
  await expect(palette.getByTestId('palette-white-promoted-k')).toHaveCount(0);
  // The game's own names, as the tutorial and the game use them.
  await expect(palette.getByTestId('palette-white-own-l')).toHaveAttribute('aria-label', 'White Lance');
  await expect(palette.getByTestId('palette-white-own-p')).toHaveAttribute('aria-label', 'White Pawn');
  await expect(palette.getByTestId('palette-black-promoted-r')).toHaveAttribute('aria-label', 'Black Dragon King');
  await expect(palette.getByTestId('palette-white-promoted-b')).toHaveAttribute('aria-label', 'White Dragon Horse');
  await expect(palette.getByTestId('palette-white-promoted-s')).toHaveAttribute('aria-label', 'White Promoted Silver General');
  await expect(page.locator('.editor-pockets').getByLabel('White Silver General', { exact: true })).toHaveAttribute('id', 'editor-pocket-white-s');
  // The promoted pawn wears the gold tile with the promoted marker, as on the game board.
  const tokin = palette.getByTestId('palette-white-promoted-p').locator('.palette-icon');
  expect(await tokin.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('shogi-tile/wgold.svg');
  await expect(tokin).toHaveClass(/promoted-mark/);

  await page.getByRole('button', { name: 'Clear board' }).click();
  await placeOn(page, 'white-own-k', 'e1');
  await placeOn(page, 'black-own-k', 'e9');
  await placeOn(page, 'white-promoted-p', 'e5');
  await setHand(page, 'white', 'g', 1);
  const fen = '4k4/9/9/9/4+P4/9/9/9/4K4[G] w - - 0 1';
  await expect(editorBoard(page)).toHaveAttribute('data-fen', fen);
  await expect(problems(page)).toHaveCount(0);

  await startHotseatFromEditor(page);
  await expect(page.getByTestId('game-line')).toHaveText('Shogi · Hot-seat');
  await expect(page.getByTestId('board')).toHaveAttribute('data-variant', 'shogi');
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', fen);
  await expect(page.locator('[data-testid=board] cg-board piece.pp-piece.white')).toHaveCount(1);
  await expect(pocketPiece(page, 'bottom', 'g')).toHaveAttribute('data-nb', '1');
  expect((await savedGame(page)).variant).toBe('shogi');
});

test('a Shogi setup with nothing in hand still has full pockets: a capture goes to hand and can be dropped', async ({ page }) => {
  await openApp(page);
  await openEditor(page);
  await page.locator('#editor-base').selectOption('shogi');
  await page.getByRole('button', { name: 'Clear board' }).click();
  await placeOn(page, 'white-own-k', 'e1');
  await placeOn(page, 'black-own-k', 'e9');
  await placeOn(page, 'white-own-r', 'a1');
  await placeOn(page, 'black-own-b', 'a5');
  await expect(editorBoard(page)).toHaveAttribute('data-fen', '4k4/9/9/9/b8/9/9/9/R3K4[] w - - 0 1');
  await startHotseatFromEditor(page);
  await expect(page.getByTestId('game-line')).toHaveText('Shogi · Hot-seat');
  for (const pocket of ['top', 'bottom'] as const) await expect(page.locator(`[data-testid=board] .pocket.${pocket} piece`)).toHaveCount(7);
  await move(page, 'a1', 'a5');
  await expect(pocketPiece(page, 'bottom', 'b')).toHaveAttribute('data-nb', '1');
  await move(page, 'e9', 'e8');
  await expect(plies(page)).toHaveCount(2);
  await dragFromPocket(page, 'bottom', 'b', 'e5');
  await expect(plies(page)).toHaveCount(3);
  await expect(plies(page).last()).toHaveText('B@e5');
});

test('editing a Shogi game keeps the hands and the promoted pieces, and Resume plays Shogi from the edited FEN', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('top-play').click();
  const dialog = page.getByTestId('play-dialog');
  await dialog.locator('#play-variant').selectOption('shogi');
  await dialog.locator('#play-opponent').selectOption('hotseat');
  await dialog.locator('#play-clock').selectOption('5+0');
  await dialog.getByRole('button', { name: 'Start' }).click();
  await expect(dialog).toBeHidden();
  // The bishops' diagonal opens, and White's bishop takes Black's, promoting.
  await move(page, 'c3', 'c4');
  await move(page, 'g7', 'g6');
  await move(page, 'b2', 'h8');
  await page.getByTestId('choice-dialog').getByRole('button', { name: 'Promote', exact: true }).click();
  await move(page, 'a7', 'a6');
  await expect(plies(page)).toHaveCount(4);
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', 'lnsgkgsnl/1r5+B1/1ppppp1pp/p5p2/9/2P6/PP1PPPPPP/7R1/LNSGKGSNL[B] w - - 1 3');

  await page.getByTestId('edit').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(editorBoard(page)).toHaveAttribute('data-fen', 'lnsgkgsnl/1r5+B1/1ppppp1pp/p5p2/9/2P6/PP1PPPPPP/7R1/LNSGKGSNL[B] w - - 0 1');
  await expect(page.locator('#editor-pocket-white-b')).toHaveValue('1');
  await expect(page.locator('[data-testid=editor-board] piece.pb-piece.white')).toHaveCount(1);
  await expect(page.getByTestId('palette-white-promoted-b')).toBeVisible();
  // A drag on the board keeps the promoted bishop promoted; a pawn goes into Black's hand.
  await drag(page, await squareCentre(page, 'editor-board', 'i3'), await squareCentre(page, 'editor-board', 'i4'));
  // chessgroundx reports a drag a moment later (a timeout), so the drag is seen before the next edit redraws the board.
  await expect(editorBoard(page)).toHaveAttribute('data-fen', /\/2P5P\/PP1PPPPP1\/.*\[B\]/);
  await setHand(page, 'black', 'p', 1);
  const edited = 'lnsgkgsnl/1r5+B1/1ppppp1pp/p5p2/9/2P5P/PP1PPPPP1/7R1/LNSGKGSNL[Bp] w - - 0 1';
  await expect(editorBoard(page)).toHaveAttribute('data-fen', edited);
  await expect(page.getByTestId('editor-status')).toHaveText('Ready to play.', { timeout: 20000 });
  await page.getByTestId('editor-resume').click();
  await expect(page.getByTestId('game')).toBeVisible();

  await expect(page.getByTestId('game-line')).toHaveText(/^Shogi · Hot-seat/);
  await expect(page.getByTestId('board')).toHaveAttribute('data-variant', 'shogi');
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', edited);
  await expect(page.getByTestId('clock-white')).toBeVisible();
  await expect(plies(page)).toHaveCount(0);
  await expect(page.locator('[data-testid=board] cg-board piece.pb-piece.white')).toHaveCount(1);
  await expect(pocketPiece(page, 'bottom', 'b')).toHaveAttribute('data-nb', '1');
  await expect(pocketPiece(page, 'top', 'p')).toHaveAttribute('data-nb', '1');
  const saved = await savedGame(page);
  expect(saved.variant).toBe('shogi');
  expect(saved.startFen).toBe(edited);
});

test('a Xiangqi base keeps its size and its own pieces, with no promoted forms or hands, and its saved setup plays Xiangqi', async ({ page }) => {
  await openApp(page);
  await openEditor(page);
  await page.locator('#editor-base').selectOption('xiangqi');
  await expect(editorBoard(page)).toHaveAttribute('data-ranks', '10');
  // The editor's board wears the game's river and palaces, as the game's board does.
  await expectRiverAndPalaces(page, true, 'editor-board');
  await expect(page.locator('#editor-files')).toBeDisabled();
  await expect(page.getByTestId('editor-size-reason')).toHaveText('Shogi and Xiangqi keep their own board size.');
  await expect(page.locator('#editor-castling')).toBeHidden();
  await expect(page.locator('.editor-pockets')).toBeHidden();
  const palette = page.locator('.palette');
  await expect(palette.locator('[data-testid^=palette-white-own-]')).toHaveCount(7);
  await expect(palette.locator('[data-testid*=-promoted-]')).toHaveCount(0);
  await expect(palette.getByTestId('palette-white-queen')).toHaveCount(0);
  await expect(palette.getByTestId('palette-white-own-r')).toHaveAttribute('aria-label', 'White Chariot');
  await expect(palette.getByTestId('palette-new-piece')).toHaveCount(0);
  await placeOn(page, 'eraser', 'a7');
  const fen = 'rnbakabnr/9/1c5c1/2p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
  await expect(editorBoard(page)).toHaveAttribute('data-fen', fen);
  await page.locator('#editor-name').fill('Short a soldier');
  await expect(page.getByTestId('editor-status')).toHaveText('Ready to play.', { timeout: 20000 });
  await page.getByTestId('editor-save').click();
  await expect(page.getByTestId('editor-notice')).toHaveText('Saved “Short a soldier”.');
  await page.getByTestId('editor-close').click();
  await startSavedSetup(page, 'Short a soldier', 'hotseat');
  await expect(page.getByTestId('game-line')).toHaveText('Xiangqi · Hot-seat');
  await expect(page.getByTestId('board')).toHaveAttribute('data-variant', 'xiangqi');
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', fen);
});

test('editing a Xiangqi game mid-game resumes Xiangqi from the edited FEN', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('top-play').click();
  const dialog = page.getByTestId('play-dialog');
  await dialog.locator('#play-variant').selectOption('xiangqi');
  await dialog.locator('#play-opponent').selectOption('hotseat');
  await dialog.locator('#play-clock').selectOption('None');
  await dialog.getByRole('button', { name: 'Start' }).click();
  await move(page, 'b3', 'e3');
  await expect(plies(page)).toHaveCount(1);
  await page.getByTestId('edit').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.locator('#editor-files')).toBeDisabled();
  await expect(page.locator('[data-testid*=-promoted-]')).toHaveCount(0);
  await placeOn(page, 'eraser', 'a7');
  const edited = 'rnbakabnr/9/1c5c1/2p1p1p1p/9/9/P1P1P1P1P/4C2C1/9/RNBAKABNR b - - 0 1';
  await expect(editorBoard(page)).toHaveAttribute('data-fen', edited);
  await expect(page.getByTestId('editor-status')).toHaveText('Ready to play.', { timeout: 20000 });
  await page.getByTestId('editor-resume').click();
  await expect(page.getByTestId('game')).toBeVisible();
  await expect(page.getByTestId('game-line')).toHaveText('Xiangqi · Hot-seat');
  await expect(page.getByTestId('board')).toHaveAttribute('data-variant', 'xiangqi');
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', edited);
  expect((await savedGame(page)).variant).toBe('xiangqi');
});

test("the editor names a Xiangqi or Shogi placement the game forbids, and Play stays disabled until it is fixed", async ({ page }) => {
  await openApp(page);
  await openEditor(page);
  await page.locator('#editor-base').selectOption('xiangqi');
  // The general steps out of its palace, to a2: ffish accepts the FEN, the game does not.
  await placeOn(page, 'eraser', 'e1');
  await placeOn(page, 'white-own-k', 'a2');
  await expect(problems(page)).toHaveText(["White's general must stay inside its palace."]);
  await expect(page.getByTestId('editor-play')).toBeDisabled();
  await expect(page.getByTestId('editor-save')).toBeDisabled();
  await placeOn(page, 'eraser', 'a2');
  await placeOn(page, 'white-own-k', 'e2');
  await expect(problems(page)).toHaveCount(0);
  await expect(page.getByTestId('editor-play')).toBeEnabled();

  await page.locator('#editor-base').selectOption('shogi');
  await placeOn(page, 'white-own-p', 'a5'); // a second pawn on the a-file: nifu
  await expect(problems(page)).toHaveText(['White has two unpromoted pawns on one file.']);
  await expect(page.getByTestId('editor-play')).toBeDisabled();
  await placeOn(page, 'white-promoted-p', 'a5');
  await expect(problems(page)).toHaveCount(0);
  await expect(page.getByTestId('editor-play')).toBeEnabled();
});

test('a saved Shogi setup starts from the Play dialog as Shogi, with its hand and promoted piece', async ({ page }) => {
  await openApp(page);
  await openEditor(page);
  await page.locator('#editor-base').selectOption('shogi');
  await placeOn(page, 'black-promoted-s', 'e5');
  await setHand(page, 'white', 'r', 1);
  const fen = 'lnsgkgsnl/1r5b1/ppppppppp/9/4+s4/9/PPPPPPPPP/1B5R1/LNSGKGSNL[R] w - - 0 1';
  await expect(editorBoard(page)).toHaveAttribute('data-fen', fen);
  await page.locator('#editor-name').fill('Rook up');
  await expect(page.getByTestId('editor-status')).toHaveText('Ready to play.', { timeout: 20000 });
  await page.getByTestId('editor-save').click();
  await expect(page.getByTestId('editor-notice')).toHaveText('Saved “Rook up”.');
  await page.getByTestId('editor-close').click();
  await startSavedSetup(page, 'Rook up', 'hotseat');
  await expect(page.getByTestId('game-line')).toHaveText('Shogi · Hot-seat');
  await expect(page.getByTestId('board')).toHaveAttribute('data-variant', 'shogi');
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', fen);
  await expect(page.locator('[data-testid=board] cg-board piece.ps-piece.black')).toHaveCount(1);
  await expect(pocketPiece(page, 'bottom', 'r')).toHaveAttribute('data-nb', '1');
  expect((await savedGame(page)).variant).toBe('shogi');
});
