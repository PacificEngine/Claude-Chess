import { expect, type Page, test } from '@playwright/test';

// Edit current game: the panel's Edit button (and Settings → "Edit current game") open the editor on the game
// in progress; Resume starts a new game from the edited position, Cancel goes back to the game unchanged.

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

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
const resume = (page: Page) => page.getByTestId('editor-resume');

async function startGame(page: Page, variant: string, opponent: string, clock: string, color = 'white'): Promise<void> {
  await page.getByTestId('top-play').click();
  const dialog = page.getByTestId('play-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#play-variant').selectOption(variant);
  await dialog.locator('#play-opponent').selectOption(opponent);
  if (opponent !== 'hotseat') await dialog.locator('#play-color').selectOption(color);
  await dialog.locator('#play-clock').selectOption(clock);
  await dialog.getByRole('button', { name: 'Start' }).click();
  await expect(dialog).toBeHidden();
}

async function editGame(page: Page): Promise<void> {
  await page.getByTestId('edit').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('game')).toBeHidden();
  await expect(editorBoard(page)).toHaveAttribute('data-fen', /.+/);
  await expect(page.getByTestId('editor-close')).toHaveText('Cancel');
  await expect(page.getByTestId('editor-play')).toBeHidden();
}

async function resumeGame(page: Page): Promise<void> {
  await expect(page.getByTestId('editor-status')).toHaveText('Ready to play.', { timeout: 20000 });
  await resume(page).click();
  await expect(page.getByTestId('game')).toBeVisible();
  await expect(page.getByTestId('editor')).toBeHidden();
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

/** Seconds shown on a clock ("4:59" or "0:09.8"). */
async function clockSeconds(page: Page, color: 'white' | 'black'): Promise<number> {
  const text = (await page.getByTestId(`clock-${color}`).textContent()) ?? '';
  const [m, s] = text.split(':');
  return Number(m) * 60 + Number(s);
}

/** The saved game, as the app stored it. */
async function savedGame(page: Page): Promise<{ variant: string; startFen: string; moves: string[] }> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('chess.game')!).data);
}

test('editing only the position resumes the same curated variant with a fresh move history', async ({ page }) => {
  await openApp(page);
  await startGame(page, 'grand', 'hotseat', 'None');
  await expect(page.getByTestId('game-line')).toHaveText('Grand Chess · Hot-seat');
  await clickSquare(page, 'board', 'e3');
  await clickSquare(page, 'board', 'e4');
  await expect(plies(page)).toHaveCount(1);
  await expect(page.getByTestId('undo')).toBeEnabled();
  await editGame(page);
  // The editor starts from the game's position, on Grand's board.
  await expect(editorBoard(page)).toHaveAttribute('data-files', '10');
  await expect(editorBoard(page)).toHaveAttribute('data-fen', /^r8r\/1nbqkcabn1\/pppppppppp\/10\/10\/10\/4P5\//);
  await expect(page.locator('#editor-base')).toBeDisabled();
  await placeOn(page, 'eraser', 'a3');
  await expect(editorBoard(page)).toHaveAttribute('data-fen', /\/1PPP1PPPPP\/1NBQKCABN1\/R8R b /);
  const fen = await editorBoard(page).getAttribute('data-fen');
  await resumeGame(page);
  await expect(page.getByTestId('game-line')).toHaveText('Grand Chess · Hot-seat');
  await expect(page.getByTestId('board')).toHaveAttribute('data-variant', 'grand');
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', fen!);
  await expect(plies(page)).toHaveCount(0);
  await expect(page.getByTestId('undo')).toBeDisabled();
  await expect(page.getByTestId('status')).toHaveText('Black to move');
});

test('editing that adds a piece the variant lacks resumes as "Custom (based on Standard)"', async ({ page }) => {
  await openApp(page);
  await startGame(page, 'chess', 'hotseat', 'None');
  await editGame(page);
  await placeOn(page, 'white-archbishop', 'e3');
  await expect(editorBoard(page)).toHaveAttribute('data-fen', /^rnbqkbnr\/pppppppp\/8\/8\/8\/4A3\/PPPPPPPP\/RNBQKBNR w /);
  await resumeGame(page);
  // Chess is the curated "standard" variant; its label is "Chess".
  await expect(page.getByTestId('game-line')).toHaveText('Custom (based on Chess) · Hot-seat');
  await expect(page.getByTestId('board')).toHaveAttribute('data-variant', /^cx_[0-9a-f]{8}$/);
  await expect(plies(page)).toHaveCount(0);
  // The archbishop moves like one: a knight jump from e3.
  await clickSquare(page, 'board', 'e3');
  await clickSquare(page, 'board', 'f5');
  await expect(plies(page)).toHaveCount(1);
});

test('clocks pause while editing and resume from the paused times', async ({ page }) => {
  await openApp(page);
  await startGame(page, 'chess', 'hotseat', '5+0');
  // White uses a couple of seconds first, so a fresh 5:00 clock would show.
  await page.waitForTimeout(2000);
  await clickSquare(page, 'board', 'e2');
  await clickSquare(page, 'board', 'e4');
  await expect(plies(page)).toHaveCount(1);
  await editGame(page);
  const white = await clockSeconds(page, 'white');
  const black = await clockSeconds(page, 'black');
  await page.waitForTimeout(2000);
  expect(await clockSeconds(page, 'black')).toBe(black);
  await resumeGame(page);
  // The new game starts from the times the editor paused, not a fresh 5:00 and not 2 s less.
  expect(await clockSeconds(page, 'white')).toBe(white);
  expect(Math.abs((await clockSeconds(page, 'black')) - black)).toBeLessThanOrEqual(1);
  expect(white).toBeLessThan(300);
  // And Black's clock runs again straight away.
  await page.waitForTimeout(2500);
  expect(await clockSeconds(page, 'black')).toBeLessThan(black - 1);
  await expect(page.getByTestId('clock-black')).toHaveClass(/running/);
});

test('opening the editor while the AI is thinking discards its late move', async ({ page }) => {
  await openApp(page);
  await startGame(page, 'chess', 'expert', '1+0', 'black');
  // The AI plays White and starts thinking at once; edit the game during its search. The exact text, so the
  // engine has loaded and the search is really running (not "AI is thinking… (engine loading)").
  await expect(page.getByTestId('status')).toHaveText('AI is thinking…', { timeout: 20000 });
  await editGame(page);
  await expect(editorBoard(page)).toHaveAttribute('data-fen', START_FEN);
  // Long enough for the AI to answer on a 1+0 clock if its search were still running.
  await page.waitForTimeout(4000);
  await expect(editorBoard(page)).toHaveAttribute('data-fen', START_FEN);
  await expect(plies(page)).toHaveCount(0);
  await placeOn(page, 'eraser', 'a2');
  const fen = await editorBoard(page).getAttribute('data-fen');
  expect(fen).toBe('rnbqkbnr/pppppppp/8/8/8/8/1PPPPPPP/RNBQKBNR w KQkq - 0 1');
  await resumeGame(page);
  // The AI answers from the edited position, in the new game; the old search's move never lands.
  await expect(plies(page)).toHaveCount(1, { timeout: 20000 });
  const saved = await savedGame(page);
  expect(saved.startFen).toBe(fen);
  expect(saved.moves).toHaveLength(1);
  await expect(page.getByTestId('status')).toHaveText(/Black to move/);
});

test('Resume is blocked while the edited position is illegal, with the reason', async ({ page }) => {
  await openApp(page);
  await startGame(page, 'chess', 'hotseat', 'None');
  // Settings → "Edit current game" opens the same editor as the panel's Edit button.
  await page.getByTestId('settings').click();
  await page.getByTestId('settings-dialog').getByRole('button', { name: 'Edit current game' }).click();
  await expect(page.getByTestId('settings-dialog')).toBeHidden();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('editor-close')).toHaveText('Cancel');
  await placeOn(page, 'eraser', 'e8');
  await expect(problems(page)).toHaveText(['Black needs a king.']);
  await expect(resume(page)).toBeDisabled();
  await placeOn(page, 'black-king', 'e8');
  await expect(problems(page)).toHaveCount(0);
  await expect(resume(page)).toBeEnabled();
  // Cancel goes back to the game as it was.
  await placeOn(page, 'eraser', 'a1');
  await page.getByTestId('editor-close').click();
  await expect(page.getByTestId('game')).toBeVisible();
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', START_FEN);
});

test('a resumed custom game survives a reload', async ({ page }) => {
  await openApp(page);
  await startGame(page, 'chess', 'hotseat', 'None');
  await editGame(page);
  await page.locator('#editor-files').selectOption('10');
  await placeOn(page, 'white-archbishop', 'i1');
  await placeOn(page, 'black-archbishop', 'i8');
  const fen = 'rnbqkbnra1/pppppppp2/10/10/10/10/PPPPPPPP2/RNBQKBNRA1 w - - 0 1';
  await expect(editorBoard(page)).toHaveAttribute('data-fen', fen);
  await resumeGame(page);
  await expect(page.getByTestId('game-line')).toHaveText('Custom (based on Chess) · Hot-seat');
  await clickSquare(page, 'board', 'e2');
  await clickSquare(page, 'board', 'e4');
  await expect(plies(page)).toHaveCount(1);
  const variant = await page.getByTestId('board').getAttribute('data-variant');
  await page.reload();
  await expect(page.getByTestId('game-line')).toHaveText('Custom (based on Chess) · Hot-seat', { timeout: 20000 });
  await expect(page.getByTestId('board')).toHaveAttribute('data-variant', variant!);
  await expect(page.getByTestId('board')).toHaveAttribute('data-files', '10');
  await expect(plies(page)).toHaveText(['e4']);
});

test('after resuming, if it is the AI’s turn the AI moves', async ({ page }) => {
  await openApp(page);
  await startGame(page, 'chess', 'beginner', 'None', 'white');
  await editGame(page);
  await page.locator('#editor-turn').selectOption('black');
  await expect(editorBoard(page)).toHaveAttribute('data-fen', / b KQkq /);
  await resumeGame(page);
  await expect(plies(page)).toHaveCount(1, { timeout: 20000 });
  await expect(page.getByTestId('status')).toHaveText('White to move');
});

test('a finished game can still be edited, and Resume starts it again with no result', async ({ page }) => {
  await openApp(page);
  await startGame(page, 'chess', 'hotseat', 'None');
  for (const [from, to] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) {
    const n = await plies(page).count();
    await clickSquare(page, 'board', from);
    await clickSquare(page, 'board', to);
    await expect(plies(page)).toHaveCount(n + 1);
  }
  await expect(page.getByTestId('status')).toHaveText('Black wins by checkmate');
  await page.getByTestId('settings').click();
  await expect(page.getByTestId('settings-edit-game')).toBeEnabled();
  await page.getByTestId('settings-dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('edit')).toBeEnabled();
  await editGame(page);
  // Take the mating queen away, so White is no longer mated.
  await placeOn(page, 'eraser', 'h4');
  await resumeGame(page);
  await expect(page.getByTestId('status')).toHaveText('White to move');
  await expect(plies(page)).toHaveCount(0);
  await clickSquare(page, 'board', 'e2');
  await clickSquare(page, 'board', 'e4');
  await expect(plies(page)).toHaveText(['e4']);
  await expect(page.getByTestId('status')).toHaveText('Black to move');
});

/** Opens the app on a saved game at the chess start position, with 5+0 clocks paused at 3:20 each. */
async function openWithPausedGame(page: Page, opponent: Record<string, unknown>, changes: Record<string, unknown> = {}): Promise<void> {
  const data = {
    variant: 'chess',
    startFen: START_FEN,
    moves: [],
    snapshots: [],
    opponent,
    clockConfig: { baseMs: 300000, incrementMs: 0 },
    clock: { whiteMs: 200000, blackMs: 200000, running: null, since: null },
    result: null,
    engineRequestId: 1,
    ...changes,
  };
  await page.addInitScript((json) => localStorage.setItem('chess.game', json), JSON.stringify({ version: 1, data }));
  await openApp(page);
}

test('a game paused until the next move stays paused after Resume', async ({ page }) => {
  await openWithPausedGame(page, { kind: 'hotseat' });
  await expect(page.getByTestId('status')).toHaveText('White to move · clocks paused until the next move');
  await editGame(page);
  await resumeGame(page);
  await expect(page.getByTestId('status')).toHaveText('White to move · clocks paused until the next move');
  await page.waitForTimeout(1500);
  expect(await clockSeconds(page, 'white')).toBe(200);
  await expect(page.getByTestId('clock-white')).not.toHaveClass(/running/);
});

test("a paused game resumed on the AI's turn runs the AI's clock while it thinks", async ({ page, context }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await context.route(/stockfish/, async (route) => {
    await held;
    await route.continue();
  });
  await openWithPausedGame(page, { kind: 'ai', level: 'beginner', aiColor: 'black' });
  await expect(page.getByTestId('status')).toHaveText('White to move · clocks paused until the next move');
  await editGame(page);
  await page.locator('#editor-turn').selectOption('black');
  await resumeGame(page);
  await expect(page.getByTestId('status')).toHaveText('AI is thinking… (engine loading)');
  await expect(page.getByTestId('clock-black')).toHaveClass(/running/);
  release();
});

const clockInput = (page: Page, color: 'white' | 'black') => page.locator(`#editor-clock-${color}`);

test('the editor shows a timed game\'s paused times, and Resume uses the times entered', async ({ page }) => {
  await openWithPausedGame(page, { kind: 'hotseat' });
  await editGame(page);
  await expect(clockInput(page, 'white')).toHaveValue('3:20');
  await expect(clockInput(page, 'black')).toHaveValue('3:20');
  await clockInput(page, 'white').fill('1:30');
  await clockInput(page, 'black').fill('1:02:03');
  await resumeGame(page);
  expect(await clockSeconds(page, 'white')).toBe(90);
  expect(await clockSeconds(page, 'black')).toBe(3723);
});

test('an unreadable or empty clock time blocks Resume, with the reason', async ({ page }) => {
  await openWithPausedGame(page, { kind: 'hotseat' });
  await editGame(page);
  await expect(resume(page)).toBeEnabled({ timeout: 20000 });
  await clockInput(page, 'black').fill('4:7');
  await expect(problems(page)).toHaveText(["Black's clock must be a time from 0:01 to 9:59:59, such as 4:30."]);
  await expect(resume(page)).toBeDisabled();
  await clockInput(page, 'black').fill('');
  await expect(problems(page)).toHaveText(["Black's clock must be a time from 0:01 to 9:59:59, such as 4:30."]);
  await expect(resume(page)).toBeDisabled();
  await clockInput(page, 'black').fill('4:07');
  await expect(problems(page)).toHaveCount(0);
  await expect(resume(page)).toBeEnabled();
});

test('a side that lost on time must be given time before the game can resume', async ({ page }) => {
  await openWithPausedGame(page, { kind: 'hotseat' }, {
    clock: { whiteMs: 0, blackMs: 200000, running: null, since: null },
    result: { winner: 'black', reason: 'timeout' },
  });
  await expect(page.getByTestId('status')).toHaveText('Black wins on time');
  await editGame(page);
  await expect(clockInput(page, 'white')).toHaveValue('0:00');
  await expect(problems(page)).toHaveText(['White has no time left — set its clock above 0:00.']);
  await expect(resume(page)).toBeDisabled();
  await clockInput(page, 'white').fill('2:00');
  await resumeGame(page);
  await expect(page.getByTestId('status')).toHaveText('White to move · clocks paused until the next move');
  expect(await clockSeconds(page, 'white')).toBe(120);
  await clickSquare(page, 'board', 'e2');
  await clickSquare(page, 'board', 'e4');
  await expect(plies(page)).toHaveText(['e4']);
  await expect(page.getByTestId('status')).toHaveText('Black to move');
});

test('an untimed game shows no clock times in the editor', async ({ page }) => {
  await openApp(page);
  await startGame(page, 'chess', 'hotseat', 'None');
  await editGame(page);
  await expect(clockInput(page, 'white')).toBeHidden();
  await expect(clockInput(page, 'black')).toBeHidden();
});

test("the editor starts from the game's own castling rights, and a lost right can be ticked back", async ({ page }) => {
  await openApp(page);
  await startGame(page, 'chess', 'hotseat', 'None');
  // White's king walks out and back: White has lost both castling rights.
  for (const [from, to] of [['e2', 'e4'], ['e7', 'e5'], ['e1', 'e2'], ['b8', 'c6'], ['e2', 'e1'], ['c6', 'b8']]) {
    const n = await plies(page).count();
    await clickSquare(page, 'board', from);
    await clickSquare(page, 'board', to);
    await expect(plies(page)).toHaveCount(n + 1);
  }
  await editGame(page);
  const right = (label: string) => page.getByRole('checkbox', { name: label, exact: true });
  await expect(right('White O-O')).not.toBeChecked();
  await expect(right('White O-O-O')).not.toBeChecked();
  await expect(right('Black O-O')).toBeChecked();
  await expect(right('Black O-O-O')).toBeChecked();
  await expect(editorBoard(page)).toHaveAttribute('data-fen', / w kq - /);
  await right('White O-O').check();
  await right('Black O-O-O').uncheck();
  await expect(editorBoard(page)).toHaveAttribute('data-fen', / w Kk - /);
  await resumeGame(page);
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', / w Kk - /);
});
