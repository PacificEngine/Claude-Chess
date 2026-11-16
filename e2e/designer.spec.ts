import { expect, type Page, test } from '@playwright/test';
import type { DesignedPiece } from '../src/persistence/pieces';
import type { SetupSpec } from '../src/variants/setup';

// The texts the app shows (src/variants/betza.ts, registry.ts, designer-model.ts, editor-model.ts, generator.ts):
// Playwright's loader can't import modules that load ffish.
const ENGINE_NEEDED_MESSAGE = 'The AI engine is needed to check custom setups and is not available.';
const J_UNSUPPORTED = 'The "j" modifier is not supported by the engine.';
const UNSAFE_BETZA = 'This move description uses characters the engine does not accept.';
const CANNOT_MOVE = 'This piece cannot move anywhere.';
const TOO_MANY_TYPES = 'Too many different piece types for one setup.';
const TOO_MANY_DESIGNED = 'A setup can use at most 25 designed pieces.';
const IN_CHECK = 'The side not to move is in check.';
const TOO_MANY_PARTS = 'A piece can have at most 8 moves and pieces to move like, together.';

const NIGHTRIDER: DesignedPiece = { id: 'nightrider-1', name: 'Nightrider', letter: 'z', betza: 'NN', art: 'alfaerie/horse', savedAt: 1 };

async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect
    .poll(() => page.evaluate(() => self.crossOriginIsolated).catch(() => false), { timeout: 15000 })
    .toBe(true);
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', /.+/);
}

/** Seeds the piece library before the app starts. */
async function seedPieces(page: Page, pieces: DesignedPiece[]): Promise<void> {
  await page.addInitScript((json) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('chess.pieces', json);
      sessionStorage.setItem('seeded', '1');
    }
  }, JSON.stringify({ version: 1, data: pieces }));
}

const editorBoard = (page: Page) => page.getByTestId('editor-board');
const designer = (page: Page) => page.getByTestId('designer');
const designerProblems = (page: Page) => page.getByTestId('designer-problems').locator('li');
const preview = (page: Page) => page.getByTestId('designer-preview');
const plies = (page: Page) => page.locator('[data-testid=move-list] .ply');
const bg = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).backgroundImage);

async function openEditor(page: Page): Promise<void> {
  await page.getByTestId('top-editor').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(editorBoard(page)).toHaveAttribute('data-fen', /.+/);
}

async function newPiece(page: Page): Promise<void> {
  await page.getByTestId('palette-new-piece').click();
  await expect(designer(page)).toBeVisible();
  await expect(page.getByTestId('editor')).toBeHidden();
}

/** Clicks the centre of a UCI square on a board with White at the bottom. */
async function clickSquare(page: Page, testid: string, square: string): Promise<void> {
  const board = page.getByTestId(testid);
  const files = Number(await board.getAttribute('data-files'));
  const ranks = Number(await board.getAttribute('data-ranks'));
  await board.scrollIntoViewIfNeeded();
  const box = await board.locator('cg-board').boundingBox();
  if (!box) throw new Error('board has no layout box');
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square.slice(1)) - 1;
  await page.mouse.click(box.x + ((file + 0.5) * box.width) / files, box.y + ((ranks - 1 - rank + 0.5) * box.height) / ranks);
}

async function placeOn(page: Page, tool: string, square: string): Promise<void> {
  const button = page.getByTestId(`palette-${tool}`);
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await clickSquare(page, 'editor-board', square);
}

/** Opens the Play dialog on the editor's setup and starts it once the engine has checked it. */
async function playEditorSetup(page: Page, opponent: string, clock = 'None'): Promise<void> {
  await expect(page.getByTestId('editor-status')).toHaveText('Ready to play.', { timeout: 20000 });
  await page.getByTestId('editor-play').click();
  const dialog = page.getByTestId('play-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#play-opponent').selectOption(opponent);
  if (opponent !== 'hotseat') await dialog.locator('#play-color').selectOption('white');
  await dialog.locator('#play-clock').selectOption(clock);
  await expect(dialog.getByRole('button', { name: 'Start' })).toBeEnabled({ timeout: 20000 });
  await dialog.getByRole('button', { name: 'Start' }).click();
  await expect(dialog).toBeHidden();
}

test('designs a piece from components, sees its moves on the preview, picks Alfaerie art, and saves it to the library', async ({ page }) => {
  await openApp(page);
  await openEditor(page);
  await newPiece(page);
  await page.locator('#designer-name').fill('Knight <b>rider</b>');
  // A knight jump that slides: the nightrider.
  const first = page.getByTestId('designer-move').nth(0);
  await first.locator('.designer-atom').selectOption('N');
  await first.locator('.designer-slide').check();
  // Leaps the engine can't slide or hop are offered disabled, with the reason.
  await first.locator('.designer-atom').selectOption('C');
  await expect(first.locator('.designer-slide')).toBeDisabled();
  await expect(first.locator('.designer-slide')).toHaveAttribute('title', /can't slide/);
  await first.locator('.designer-atom').selectOption('N');
  await first.locator('.designer-slide').check();
  await expect(first.locator('.designer-mode option[value=cannon]')).toBeDisabled();
  // Plus a diagonal step that only captures.
  await page.getByTestId('designer-add-move').click();
  const second = page.getByTestId('designer-move').nth(1);
  await second.locator('.designer-atom').selectOption('F');
  await second.locator('.designer-mode').selectOption('capture');
  await expect(page.locator('#designer-betza')).toHaveValue('NNcF');

  // The preview: move squares (two nightrider jumps reach h6) and capture-only squares (the diagonal steps).
  await expect(page.getByTestId('designer-status')).toHaveText('This piece can move to 12 squares, and capture on 4 more.', { timeout: 20000 });
  await expect(preview(page).locator('[data-square=h6]')).toHaveClass(/\bmove\b/);
  await expect(preview(page).locator('[data-square=e5]')).toHaveClass(/\bcapture\b/);
  await expect(preview(page).locator('[data-square=d5]')).not.toHaveClass(/\b(move|capture)\b/);
  await expect(designerProblems(page)).toHaveCount(0);

  // Art: the lettered token first and chosen, then every two-colour image.
  const art = page.getByTestId('designer-art').locator('button');
  await expect(art.first()).toHaveAttribute('data-testid', 'art-token');
  await expect(page.getByTestId('art-token')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('art-alfaerie/horse').click();
  await expect(page.getByTestId('art-alfaerie/horse')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('art-token')).toHaveAttribute('aria-pressed', 'false');
  expect(await bg(page, '[data-testid=designer-preview] piece.z-piece.white')).toContain('pieces/alfaerie/whorse.svg');

  await expect(page.getByTestId('designer-save')).toBeEnabled();
  await page.getByTestId('designer-save').click();
  await expect(page.getByTestId('designer-notice')).toHaveText('Saved “Knight <b>rider</b>”.');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('chess.pieces')!));
  expect(stored.data).toHaveLength(1);
  expect(stored.data[0]).toMatchObject({ name: 'Knight <b>rider</b>', letter: 'z', betza: 'NNcF', art: 'alfaerie/horse' });

  // Closing returns to the editor, whose palette now lists the piece with its art.
  await page.getByTestId('designer-close').click();
  await expect(designer(page)).toBeHidden();
  await expect(page.getByTestId('editor')).toBeVisible();
  const entry = page.getByRole('button', { name: 'White Knight <b>rider</b>' });
  await expect(entry).toBeVisible();
  expect(await entry.locator('.palette-icon').evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('pieces/alfaerie/whorse.svg');
});

test('places a designed piece in a setup and plays it hot-seat: the piece moves as designed and shows its art', async ({ page }) => {
  await seedPieces(page, [NIGHTRIDER]);
  await openApp(page);
  await openEditor(page);
  await placeOn(page, `white-designed-${NIGHTRIDER.id}`, 'd4');
  await expect(editorBoard(page)).toHaveAttribute('data-fen', /^rnbqkbnr\/pppppppp\/8\/8\/3Z4\//);
  expect(await bg(page, '[data-testid=editor-board] piece.z-piece.white')).toContain('pieces/alfaerie/whorse.svg');
  await playEditorSetup(page, 'hotseat');
  await expect(page.getByTestId('game-line')).toHaveText('Custom (based on Chess) · Hot-seat');
  expect(await bg(page, '[data-testid=board] piece.z-piece.white')).toContain('pieces/alfaerie/whorse.svg');
  // Two knight jumps in one move: only a nightrider gets from d4 to h6.
  await clickSquare(page, 'board', 'd4');
  await clickSquare(page, 'board', 'h6');
  await expect(plies(page)).toHaveCount(1);
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', /^rnbqkbnr\/pppppppp\/7Z\//);
});

test('plays a setup with a designed piece against the AI and gets a legal reply', async ({ page }) => {
  await seedPieces(page, [NIGHTRIDER]);
  await openApp(page);
  await openEditor(page);
  await placeOn(page, `white-designed-${NIGHTRIDER.id}`, 'd4');
  await placeOn(page, `black-designed-${NIGHTRIDER.id}`, 'e5');
  await playEditorSetup(page, 'beginner');
  await expect(page.getByTestId('game-line')).toHaveText('Custom (based on Chess) · AI: Beginner');
  await clickSquare(page, 'board', 'e2');
  await clickSquare(page, 'board', 'e4');
  await expect(plies(page).first()).toHaveText('e4');
  await expect(plies(page)).toHaveCount(2, { timeout: 20000 });
  await expect(page.getByTestId('status')).toHaveText(/White to move/);
});

test('refuses hand-typed Betza with j or bad characters, with the reason, and keeps Save disabled', async ({ page }) => {
  await openApp(page);
  await openEditor(page);
  await newPiece(page);
  await page.locator('#designer-name').fill('Typed');
  const betza = page.locator('#designer-betza');
  await betza.fill('jN');
  await expect(designerProblems(page)).toHaveText([J_UNSUPPORTED]);
  await expect(page.getByTestId('designer-save')).toBeDisabled();
  await betza.fill('N[x]');
  await expect(designerProblems(page)).toHaveText([UNSAFE_BETZA]);
  await expect(page.getByTestId('designer-save')).toBeDisabled();
  // Something the engine accepts can be saved, once the preview has checked it.
  await betza.fill('fN');
  await expect(designerProblems(page)).toHaveCount(0, { timeout: 20000 });
  await expect(page.getByTestId('designer-save')).toBeEnabled();
  // And going back to the moves above drops the typed Betza.
  await page.getByTestId('designer-use-moves').click();
  await expect(betza).toHaveValue('W');
});

test('refuses a piece that cannot move anywhere', async ({ page }) => {
  await openApp(page);
  await openEditor(page);
  await newPiece(page);
  await page.locator('#designer-name').fill('Statue');
  // A knight that may only hop over a piece: a leap has nothing to hop over, so it never moves.
  await page.locator('#designer-betza').fill('pN');
  await expect(designerProblems(page)).toHaveText([CANNOT_MOVE], { timeout: 20000 });
  await expect(page.getByTestId('designer-save')).toBeDisabled();
  await expect(preview(page).locator('.move, .capture')).toHaveCount(0);
});

test('keeps designed pieces and their art across a reload', async ({ page }) => {
  await openApp(page);
  await openEditor(page);
  await newPiece(page);
  await page.locator('#designer-name').fill('Wazir rider');
  await page.getByTestId('designer-move').nth(0).locator('.designer-slide').check();
  await page.getByTestId('art-alfaerie/wazir').click();
  await expect(page.getByTestId('designer-save')).toBeEnabled({ timeout: 20000 });
  await page.getByTestId('designer-save').click();
  await expect(page.getByTestId('designer-notice')).toHaveText('Saved “Wazir rider”.');

  await page.reload();
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', /.+/);
  await openEditor(page);
  const entry = page.getByRole('button', { name: 'Black Wazir rider' });
  expect(await entry.locator('.palette-icon').evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('pieces/alfaerie/bwazir.svg');
  // Edit… opens it again as it was saved.
  await page.getByRole('button', { name: 'Edit Wazir rider' }).click();
  await expect(designer(page)).toBeVisible();
  await expect(page.locator('#designer-name')).toHaveValue('Wazir rider');
  await expect(page.locator('#designer-betza')).toHaveValue('WW');
  await expect(page.getByTestId('art-alfaerie/wazir')).toHaveAttribute('aria-pressed', 'true');
  // Delete asks first; No keeps it, Yes removes it from the library and the palette.
  await page.getByTestId('designer-delete').click();
  await expect(page.getByTestId('designer-delete-confirm')).toHaveText(/Delete\?/);
  await page.getByTestId('designer-delete-no').click();
  await expect(page.getByTestId('designer-delete-confirm')).toBeHidden();
  await page.getByTestId('designer-delete').click();
  await page.getByTestId('designer-delete-yes').click();
  await expect(designer(page)).toBeHidden();
  await expect(page.getByRole('button', { name: 'Black Wazir rider' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', /.+/);
  await openEditor(page);
  await expect(page.getByRole('button', { name: 'Black Wazir rider' })).toHaveCount(0);
});

test('disables the preview and Save while the engine is unavailable, with the reason', async ({ page, context }) => {
  await context.route(/stockfish/, (route) => route.fulfill({ status: 404, body: 'not found' }));
  await openApp(page);
  await openEditor(page);
  await newPiece(page);
  await page.locator('#designer-name').fill('No engine');
  await expect(designerProblems(page)).toHaveText([ENGINE_NEEDED_MESSAGE], { timeout: 25000 });
  await expect(page.getByTestId('designer-save')).toBeDisabled();
  await expect(preview(page)).toHaveAttribute('data-disabled', 'true');
  await expect(preview(page).locator('.move, .capture')).toHaveCount(0);
  // Closing returns to the editor with the setup unchanged.
  await page.getByTestId('designer-close').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(editorBoard(page)).toHaveAttribute('data-fen', /^rnbqkbnr\/pppppppp\/8\/8\/8\/8\/PPPPPPPP\/RNBQKBNR w KQkq - 0 1$/);
});

test('shows the slot-limit problem when a setup would use 26 designed pieces', async ({ page }) => {
  const pieces: DesignedPiece[] = Array.from({ length: 26 }, (_, i) => ({
    id: `piece-${i}`, name: `Piece ${i}`, letter: 'z', betza: 'W', art: null, savedAt: i,
  }));
  // A setup that already uses 26 designed pieces (all 26 letters, none left for a base piece).
  const designed = Object.fromEntries(pieces.map((p, i) => [String.fromCharCode(97 + i), { id: p.id, betza: p.betza, art: null }]));
  const crowded: SetupSpec = {
    base: 'chess', files: 8, ranks: 8, pieces: {}, designed,
    fen: 'abcdefgh/ijklmnop/qrstuvwx/yz6/8/8/8/8 w - - 0 1', castling: false, promotion: { rank: 'last', pieceTypes: [] },
  };
  await page.addInitScript((json) => {
    if (!sessionStorage.getItem('seeded-setups')) {
      localStorage.setItem('chess.setups', json);
      sessionStorage.setItem('seeded-setups', '1');
    }
  }, JSON.stringify({ version: 1, data: [{ id: 'crowded', name: 'Crowded', spec: crowded, savedAt: 1 }] }));
  await seedPieces(page, pieces);
  await openApp(page);
  await openEditor(page);
  await page.getByRole('button', { name: 'Clear board' }).click();
  // In the editor the letters run out first: Chess keeps its six, so 20 designed pieces fit and the 21st is refused.
  const squares = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].flatMap((f) => [1, 2, 3, 4].map((r) => `${f}${r}`));
  for (let i = 0; i < 21; i++) await placeOn(page, `white-designed-piece-${i}`, squares[i]!);
  await expect(page.getByTestId('editor-problems').locator('li').first()).toHaveText(TOO_MANY_TYPES);
  const fen = await editorBoard(page).getAttribute('data-fen');
  expect(new Set(fen!.split(' ')[0]!.replace(/[^A-Z]/g, '')).size).toBe(20);
  await page.getByTestId('editor-close').click();
  // The setup that would use 26 shows the slot limit in the Play dialog, and can't be started.
  await page.getByTestId('top-play').click();
  const dialog = page.getByTestId('play-dialog');
  await dialog.locator('#play-variant').selectOption({ label: 'Crowded' });
  await expect(dialog.getByTestId('setup-status')).toHaveText(TOO_MANY_DESIGNED, { timeout: 20000 });
  await expect(dialog.getByRole('button', { name: 'Start' })).toBeDisabled();
});

// ---- Changing a piece that is already used ----------------------------------------------------------

const stored = (page: Page, key: string) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null')?.data, key);

/**
 * A saved setup "Riders" with the nightrider on d4, and a hot-seat game of it after 1. e4 e5. Returns the
 * game's FEN.
 */
async function useNightrider(page: Page, clock = 'None'): Promise<string> {
  await seedPieces(page, [NIGHTRIDER]);
  await openApp(page);
  await openEditor(page);
  await placeOn(page, `white-designed-${NIGHTRIDER.id}`, 'd4');
  await page.locator('#editor-name').fill('Riders');
  await expect(page.getByTestId('editor-status')).toHaveText('Ready to play.', { timeout: 20000 });
  await page.getByTestId('editor-save').click();
  await expect(page.getByTestId('editor-notice')).toHaveText('Saved “Riders”.');
  await playEditorSetup(page, 'hotseat', clock);
  for (const [from, to] of [['e2', 'e4'], ['e7', 'e5']]) {
    await clickSquare(page, 'board', from!);
    await clickSquare(page, 'board', to!);
  }
  await expect(plies(page)).toHaveCount(2);
  return (await page.getByTestId('board').getAttribute('data-fen'))!;
}

/** Opens the nightrider in the designer from a freshly opened editor and types new Betza. */
async function editNightrider(page: Page, betza: string): Promise<void> {
  await openEditor(page);
  await page.getByTestId(`palette-edit-${NIGHTRIDER.id}`).click();
  await expect(designer(page)).toBeVisible();
  await page.locator('#designer-betza').fill(betza);
  await expect(page.getByTestId('designer-save')).toBeEnabled({ timeout: 20000 });
}

const choice = (page: Page) => page.getByTestId('designer-change-choice');

/**
 * Holds every message to the engine's worker while window.__hold is set, so an engine check stays in flight
 * until release(). Install before the app starts.
 */
async function holdEngine(page: Page): Promise<{ hold(): Promise<void>; release(): Promise<void> }> {
  await page.addInitScript(() => {
    const w = window as unknown as { __hold: boolean; __held: [Worker, unknown][]; __release(): void };
    w.__hold = false;
    w.__held = [];
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, msg: unknown, ...rest: unknown[]) {
      if (w.__hold) w.__held.push([this, msg]);
      else (post as (m: unknown, ...r: unknown[]) => void).call(this, msg, ...rest);
    } as Worker['postMessage'];
    w.__release = () => {
      w.__hold = false;
      for (const [worker, msg] of w.__held.splice(0)) post.call(worker, msg);
    };
  });
  return {
    hold: () => page.evaluate(() => void ((window as unknown as { __hold: boolean }).__hold = true)),
    release: () => page.evaluate(() => (window as unknown as { __release(): void }).__release()),
  };
}


test('saving a used piece as new leaves saved setups and the game unchanged', async ({ page }) => {
  const fen = await useNightrider(page);
  const setupsBefore = await stored(page, 'chess.setups');
  const gameBefore = await stored(page, 'chess.game');
  await openEditor(page);
  // Renaming alone changes no setup's rules, so it saves without asking.
  await page.getByTestId(`palette-edit-${NIGHTRIDER.id}`).click();
  await page.locator('#designer-name').fill('Rider');
  await expect(page.getByTestId('designer-save')).toBeEnabled({ timeout: 20000 });
  await page.getByTestId('designer-save').click();
  await expect(page.getByTestId('designer-notice')).toHaveText('Saved “Rider”.');
  await expect(choice(page)).toBeHidden();

  // New moves do: the player chooses.
  await page.locator('#designer-betza').fill('NNF');
  await expect(page.getByTestId('designer-save')).toBeEnabled({ timeout: 20000 });
  await page.getByTestId('designer-save').click();
  await expect(choice(page)).toBeVisible();
  await expect(choice(page)).toContainText('Saved setups or the game in progress use this piece.');
  // The choice takes the focus, on its first button.
  await expect(page.getByTestId('designer-change-cancel')).toBeFocused();
  await page.getByTestId('designer-save-as-new').click();
  await expect(choice(page)).toBeHidden();
  await expect(page.getByTestId('designer-notice')).toHaveText('Saved “Rider” as a new piece.');
  const library: DesignedPiece[] = await stored(page, 'chess.pieces');
  expect(library).toHaveLength(2);
  expect(library[0]).toMatchObject({ id: NIGHTRIDER.id, betza: 'NN' });
  expect(library[1]).toMatchObject({ name: 'Rider', betza: 'NNF' });
  expect(library[1]!.id).not.toBe(NIGHTRIDER.id);
  expect(await stored(page, 'chess.setups')).toEqual(setupsBefore);
  // The editor pauses the game's clock, so only its rules and history are compared.
  const gameAfter = await stored(page, 'chess.game');
  for (const key of ['variant', 'setup', 'startFen', 'moves', 'snapshots', 'opponent']) expect(gameAfter[key], key).toEqual(gameBefore[key]);

  // The new piece is used nowhere, so changing it again asks nothing.
  await page.locator('#designer-betza').fill('NNW');
  await expect(page.getByTestId('designer-save')).toBeEnabled({ timeout: 20000 });
  await page.getByTestId('designer-save').click();
  await expect(page.getByTestId('designer-notice')).toHaveText('Saved “Rider”.');
  await expect(choice(page)).toBeHidden();

  await page.getByTestId('designer-close').click();
  await page.getByTestId('editor-close').click();
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', fen);
  await expect(plies(page)).toHaveCount(2);
});

test('updating a used piece everywhere changes saved setups and the game in progress, which keeps its position under a new variant name', async ({ page }) => {
  const fen = await useNightrider(page);
  const gameBefore = await stored(page, 'chess.game');
  await editNightrider(page, 'NNF');
  await page.getByTestId('art-merida/N').click();
  await page.getByTestId('designer-save').click();
  await page.getByTestId('designer-update-everywhere').click();
  await expect(page.getByTestId('designer-notice')).toHaveText('Saved “Nightrider” and updated the setups and the game that use it.', {
    timeout: 20000,
  });
  const library: DesignedPiece[] = await stored(page, 'chess.pieces');
  expect(library).toEqual([expect.objectContaining({ id: NIGHTRIDER.id, betza: 'NNF', art: 'merida/N' })]);
  const setups = await stored(page, 'chess.setups');
  expect(setups[0].spec.designed).toEqual({ z: { id: NIGHTRIDER.id, betza: 'NNF', art: 'merida/N' } });
  const game = await stored(page, 'chess.game');
  expect(game.variant).not.toBe(gameBefore.variant);
  expect(game.setup.designed).toEqual({ z: { id: NIGHTRIDER.id, betza: 'NNF', art: 'merida/N' } });
  expect(game.startFen).toBe(fen);
  expect(game.opponent).toEqual(gameBefore.opponent);

  await page.getByTestId('designer-close').click();
  await page.getByTestId('editor-close').click();
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', fen);
  // The updated game is the saved game: it comes back after a reload, with the new piece.
  await page.reload();
  await expect(page.getByTestId('status')).toHaveText(/White to move/, { timeout: 20000 });
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', fen);
  await expect(page.getByTestId('game-line')).toHaveText('Custom (based on Chess) · Hot-seat');
  expect(await bg(page, '[data-testid=board] piece.z-piece.white')).toContain('pieces/merida/wN.svg');
  // The ferz step is new: a nightrider can't go from d4 to c3.
  await clickSquare(page, 'board', 'd4');
  await clickSquare(page, 'board', 'c3');
  await expect(plies(page)).toHaveCount(1);
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', /\/2Z5\/PPPP1PPP\//);
});

test('deleting a library piece leaves setups and games that use it playable from their copies', async ({ page }) => {
  await useNightrider(page);
  await openEditor(page);
  await page.getByTestId(`palette-edit-${NIGHTRIDER.id}`).click();
  await page.getByTestId('designer-delete').click();
  await page.getByTestId('designer-delete-yes').click();
  await expect(designer(page)).toBeHidden();
  expect(await stored(page, 'chess.pieces')).toEqual([]);
  await page.getByTestId('editor-close').click();

  // The saved game comes back after a reload, and the nightrider still jumps twice.
  await page.reload();
  await expect(page.getByTestId('status')).toHaveText(/White to move/, { timeout: 20000 });
  await expect(plies(page)).toHaveCount(2);
  await clickSquare(page, 'board', 'd4');
  await clickSquare(page, 'board', 'h6');
  await expect(plies(page)).toHaveCount(3);
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', /^rnbqkbnr\/pppp1ppp\/7Z\//);

  // So does the saved setup.
  await page.getByTestId('top-play').click();
  const dialog = page.getByTestId('play-dialog');
  await dialog.locator('#play-variant').selectOption({ label: 'Riders' });
  await dialog.locator('#play-opponent').selectOption('hotseat');
  await dialog.locator('#play-clock').selectOption('None');
  await expect(dialog.getByRole('button', { name: 'Start' })).toBeEnabled({ timeout: 20000 });
  await dialog.getByRole('button', { name: 'Start' }).click();
  await clickSquare(page, 'board', 'd4');
  await clickSquare(page, 'board', 'h6');
  await expect(plies(page)).toHaveCount(1);
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', /^rnbqkbnr\/pppppppp\/7Z\//);
});

test('updating a piece everywhere while editing the game keeps the new piece when the game resumes', async ({ page }) => {
  await useNightrider(page);
  await page.getByTestId('edit').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.getByTestId(`palette-edit-${NIGHTRIDER.id}`).click();
  await page.locator('#designer-betza').fill('NNF');
  await expect(page.getByTestId('designer-save')).toBeEnabled({ timeout: 20000 });
  await page.getByTestId('designer-save').click();
  await page.getByTestId('designer-update-everywhere').click();
  await expect(page.getByTestId('designer-notice')).toHaveText('Saved “Nightrider” and updated the setups and the game that use it.', {
    timeout: 20000,
  });
  await page.getByTestId('designer-close').click();
  // The edited game is resumed from the editor's setup, which holds the new piece too.
  await expect(page.getByTestId('editor-resume')).toBeEnabled({ timeout: 20000 });
  await page.getByTestId('editor-resume').click();
  await expect(page.getByTestId('editor')).toBeHidden();
  const game = await stored(page, 'chess.game');
  expect(game.setup.designed).toEqual({ z: { id: NIGHTRIDER.id, betza: 'NNF', art: 'alfaerie/horse' } });
  await clickSquare(page, 'board', 'd4');
  await clickSquare(page, 'board', 'c3');
  await expect(plies(page)).toHaveCount(1);
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', /\/2Z5\/PPPP1PPP\//);
});

test('keeps the old piece in a game the new moves would make illegal, and says why', async ({ page }) => {
  await seedPieces(page, [NIGHTRIDER]);
  await openApp(page);
  await openEditor(page);
  await placeOn(page, `white-designed-${NIGHTRIDER.id}`, 'e4');
  await playEditorSetup(page, 'hotseat');
  const gameBefore = await stored(page, 'chess.game');
  await openEditor(page);
  // A cannon on e4 hops the e7 pawn onto Black's king: Black would be in check with White to move.
  await page.getByTestId(`palette-edit-${NIGHTRIDER.id}`).click();
  await page.locator('#designer-betza').fill('mWWcpWW');
  await expect(page.getByTestId('designer-save')).toBeEnabled({ timeout: 20000 });
  await page.getByTestId('designer-save').click();
  await page.getByTestId('designer-update-everywhere').click();
  await expect(page.getByTestId('designer-notice')).toHaveText(
    `Saved “Nightrider”, but not everything that uses it could be updated: ${IN_CHECK}`,
    { timeout: 20000 },
  );
  await expect(page.getByTestId('storage-banner')).toContainText(`The game in progress keeps the piece as it was: ${IN_CHECK}`);
  expect(await stored(page, 'chess.pieces')).toEqual([expect.objectContaining({ id: NIGHTRIDER.id, betza: 'mWWcpWW' })]);
  const game = await stored(page, 'chess.game');
  expect(game.variant).toBe(gameBefore.variant);
  expect(game.setup).toEqual(gameBefore.setup);
});

test('keeps Save disabled while an update everywhere is still being checked', async ({ page }) => {
  const engine = await holdEngine(page);
  await useNightrider(page);
  await editNightrider(page, 'NNF');
  await page.getByTestId('designer-save').click();
  await engine.hold();
  await page.getByTestId('designer-update-everywhere').click();
  await expect(page.getByTestId('designer-notice')).toHaveText('Updating the setups and the game that use it…');
  await expect(page.getByTestId('designer-save')).toBeDisabled();
  await engine.release();
  await expect(page.getByTestId('designer-notice')).toHaveText('Saved “Nightrider” and updated the setups and the game that use it.', {
    timeout: 20000,
  });
  await expect(page.getByTestId('designer-save')).toBeEnabled();
});

test('caps the moves and the pieces to move like at 8 together, with the reason', async ({ page }) => {
  await openApp(page);
  await openEditor(page);
  await newPiece(page);
  // One move, and seven pieces to move like whose Betza ends in N: ordering them is the slow case.
  for (const type of ['archbishop', 'chancellor', 'amazon', 'horse', 'shogiKnight', 'centaur', 'knight']) {
    await page.locator(`#designer-combine-${type}`).check();
  }
  await expect(page.getByTestId('designer-add-move')).toBeDisabled();
  await expect(page.getByTestId('designer-add-move')).toHaveAttribute('title', TOO_MANY_PARTS);
  await expect(page.locator('#designer-combine-rook')).toBeDisabled();
  await expect(page.locator('label', { has: page.locator('#designer-combine-rook') })).toHaveAttribute('title', TOO_MANY_PARTS);
  // Unticking one makes room again.
  await page.locator('#designer-combine-knight').uncheck();
  await expect(page.getByTestId('designer-add-move')).toBeEnabled();
  await expect(page.locator('#designer-combine-rook')).toBeEnabled();
});

test('updating a piece everywhere rewrites it on the setup being built, which keeps its letter', async ({ page }) => {
  // Only the editor's board uses the piece: no saved setup, no game.
  await seedPieces(page, [NIGHTRIDER]);
  await openApp(page);
  await openEditor(page);
  await placeOn(page, `white-designed-${NIGHTRIDER.id}`, 'd4');
  await page.getByTestId(`palette-edit-${NIGHTRIDER.id}`).click();
  await page.locator('#designer-betza').fill('NNF');
  await expect(page.getByTestId('designer-save')).toBeEnabled({ timeout: 20000 });
  await page.getByTestId('designer-save').click();
  await expect(choice(page)).toBeVisible();
  await page.getByTestId('designer-update-everywhere').click();
  await expect(page.getByTestId('designer-notice')).toHaveText('Saved “Nightrider” and updated the setups and the game that use it.', {
    timeout: 20000,
  });
  await page.getByTestId('designer-close').click();
  // The updated piece is the board's piece: placing it again uses the same letter.
  await placeOn(page, `black-designed-${NIGHTRIDER.id}`, 'e6');
  await expect(editorBoard(page)).toHaveAttribute('data-fen', /^rnbqkbnr\/pppppppp\/4z3\/8\/3Z4\//);
  // And the setup plays it the new way: the ferz step d4-c3.
  await playEditorSetup(page, 'hotseat');
  expect((await stored(page, 'chess.game')).setup.designed).toEqual({ z: { id: NIGHTRIDER.id, betza: 'NNF', art: 'alfaerie/horse' } });
  await clickSquare(page, 'board', 'd4');
  await clickSquare(page, 'board', 'c3');
  await expect(plies(page)).toHaveCount(1);
});

test('says the game was not updated when the game is resumed while the update is being checked', async ({ page }) => {
  const engine = await holdEngine(page);
  await useNightrider(page);
  await page.getByTestId('edit').click();
  await expect(page.getByTestId('editor-resume')).toBeEnabled({ timeout: 20000 });
  await page.getByTestId(`palette-edit-${NIGHTRIDER.id}`).click();
  await page.locator('#designer-betza').fill('NNF');
  await expect(page.getByTestId('designer-save')).toBeEnabled({ timeout: 20000 });
  await page.getByTestId('designer-save').click();
  await engine.hold();
  await page.getByTestId('designer-update-everywhere').click();
  // The player doesn't wait: back to the editor, and Resume, which replaces the game being updated.
  await page.getByTestId('designer-close').click();
  await page.getByTestId('editor-resume').click();
  await expect(page.getByTestId('editor')).toBeHidden();
  await engine.release();
  await expect(page.getByTestId('storage-banner')).toContainText('The game changed meanwhile and was not updated.', { timeout: 20000 });
  expect((await stored(page, 'chess.game')).setup.designed.z.betza).toBe('NN');
});

test("keeps a timed game's clock running when the editor closes before the update is checked", async ({ page }) => {
  const engine = await holdEngine(page);
  await useNightrider(page, '10+5');
  const before = await stored(page, 'chess.game');
  expect(before.clock.running).toBe('white');
  await editNightrider(page, 'NNF');
  await page.getByTestId('designer-save').click();
  await engine.hold();
  await page.getByTestId('designer-update-everywhere').click();
  // Closing the editor starts the clock again before the check answers.
  await page.getByTestId('designer-close').click();
  await page.getByTestId('editor-close').click();
  await expect(page.getByTestId('editor')).toBeHidden();
  await engine.release();
  await expect.poll(async () => (await stored(page, 'chess.game')).variant, { timeout: 20000 }).not.toBe(before.variant);
  expect((await stored(page, 'chess.game')).clock.running).toBe('white');
  await expect(page.getByTestId('status')).toHaveText('White to move');
});
