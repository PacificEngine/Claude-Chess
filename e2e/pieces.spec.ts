import { expect, type Page, test } from '@playwright/test';
import type { ChessTestHooks } from '../src/ui/app';
import { generateVariant } from '../src/variants/generator';
import type { SetupSpec } from '../src/variants/setup';
import { boardColours, differ, expectRiverAndPalaces } from './board-colours';

declare global {
  interface Window {
    __chessTest?: ChessTestHooks;
  }
}

async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => self.crossOriginIsolated).catch(() => false), { timeout: 15000 }).toBe(true);
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', /.+/);
}

async function load(page: Page, variant: string, fen: string): Promise<void> {
  await page.evaluate(([v, f]) => window.__chessTest!.loadFen(v!, f!), [variant, fen]);
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', fen);
}

const bg = (page: Page, selector: string) => page.locator(selector).first().evaluate(el => getComputedStyle(el).backgroundImage);
const letter = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate(el => getComputedStyle(el, '::after').content);

test('standard pieces show art and no token', async ({ page }) => {
  await openApp(page);
  expect(await bg(page, 'piece.p-piece.white')).toContain('pieces/merida/wP.svg');
  expect(await letter(page, 'piece.p-piece.white')).toBe('none');
});

test('fairy pieces show their art, the Amazon included, with no lettered token', async ({ page }) => {
  await openApp(page);
  await load(page, 'capablanca', 'rnabqkbcnr/pppppppppp/10/10/10/10/PPPPPPPPPP/RNABQKBCNR w KQkq - 0 1');
  expect(await bg(page, 'piece.a-piece.white')).toContain('pieces/merida/wA.svg');
  await load(page, 'amazon', 'rnbakbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBAKBNR w KQkq - 0 1');
  expect(await bg(page, 'piece.a-piece.white')).toContain('pieces/alfaerie/wamazon.svg');
  expect(await bg(page, 'piece.a-piece.black')).toContain('pieces/alfaerie/bamazon.svg');
  expect(await letter(page, 'piece.a-piece.white')).toBe('none');
});

test('the same letter is a different piece per variant, and Spartan has its own art', async ({ page }) => {
  await openApp(page);
  await load(page, 'shako', 'c8c/ernbqkbnre/pppppppppp/10/10/10/10/PPPPPPPPPP/ERNBQKBNRE/C8C w KQkq - 0 1');
  expect(await bg(page, 'piece.c-piece.white')).toContain('pieces/merida/shako/wC.svg');
  await load(page, 'spartan', 'lgkcckwl/hhhhhhhh/8/8/8/8/PPPPPPPP/RNBQKBNR w KQ - 0 1');
  expect(await bg(page, 'piece.w-piece.black')).toContain('pieces/spartan/bWarlord.svg');
  expect(await bg(page, 'piece.h-piece.black')).toContain('pieces/spartan/bP.svg');
  expect(await bg(page, 'piece.k-piece.black')).toContain('pieces/spartan/bK.svg');
  expect(await bg(page, 'piece.k-piece.white')).toContain('pieces/merida/wK.svg');
});

test('Seirawan pieces in hand have art', async ({ page }) => {
  await openApp(page);
  await load(page, 'seirawan', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR[EHeh] w KQBCDFGkqbcdfg - 0 1');
  expect(await bg(page, '.pocket piece.h-piece.white')).toContain('pieces/merida/wH.svg');
});

/** Opens the app on a saved custom game whose setup has a designed `z` with the given art. */
async function openDesigned(page: Page, art: string | null): Promise<void> {
  const setup: SetupSpec = {
    base: 'chess', files: 8, ranks: 8, pieces: { k: 'king' },
    designed: { z: { id: 'ox-piece', betza: 'NN', art } },
    fen: '7k/8/8/8/8/8/8/Z6K w - - 0 1', castling: false, promotion: { rank: 'last', pieceTypes: [] },
  };
  const NO_CLOCK = Number.MAX_SAFE_INTEGER;
  const data = {
    variant: generateVariant(setup).name, setup, startFen: setup.fen, moves: [], snapshots: [],
    opponent: { kind: 'hotseat' }, clockConfig: null,
    clock: { whiteMs: NO_CLOCK, blackMs: NO_CLOCK, running: null, since: null }, result: null, engineRequestId: 1,
  };
  await page.addInitScript((json) => localStorage.setItem('chess.game', json), JSON.stringify({ version: 1, data }));
  await page.goto('/');
  await expect(page.getByTestId('game-line')).toHaveText('Custom (based on Chess) · Hot-seat', { timeout: 20000 });
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', setup.fen);
}

test('a designed piece is drawn with the art the player chose', async ({ page }) => {
  await openDesigned(page, 'alfaerie/ox');
  expect(await bg(page, 'piece.z-piece.white')).toContain('pieces/alfaerie/wox.svg');
  expect(await letter(page, 'piece.z-piece.white')).toBe('none');
});

test('a designed piece whose art is no longer in the catalog is a lettered token, and the app starts', async ({ page }) => {
  await openDesigned(page, 'gone/x');
  expect(await bg(page, 'piece.z-piece.white')).toBe('none');
  expect(await letter(page, 'piece.z-piece.white')).toBe('"Z"');
});

test('a piece set chosen in Settings draws the standard pieces everywhere, keeps fairy art, and survives a reload', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('top-settings').click();
  await expect(page.getByTestId('settings-pieces')).toHaveValue('merida');
  await page.getByTestId('settings-pieces').selectOption('cburnett');
  await page.getByTestId('settings-dialog').getByRole('button', { name: 'Save' }).click();
  // The board redraws at once.
  await expect.poll(() => bg(page, '[data-testid=board] piece.n-piece.white')).toContain('pieces/cburnett/wN.svg');
  expect(await bg(page, '[data-testid=board] piece.k-piece.black')).toContain('pieces/cburnett/bK.svg');
  // A fairy piece keeps its own art.
  await load(page, 'capablanca', 'rnabqkbcnr/pppppppppp/10/10/10/10/PPPPPPPPPP/RNABQKBCNR w KQkq - 0 1');
  expect(await bg(page, '[data-testid=board] piece.a-piece.white')).toContain('pieces/merida/wA.svg');
  expect(await bg(page, '[data-testid=board] piece.q-piece.white')).toContain('pieces/cburnett/wQ.svg');
  // The editor palette and the tutorial board use it too.
  await page.getByTestId('top-editor').click();
  expect(await page.getByTestId('palette-white-rook').locator('.palette-icon').evaluate((el) => getComputedStyle(el).backgroundImage)).toContain(
    'pieces/cburnett/wR.svg',
  );
  await page.getByTestId('editor').getByRole('button', { name: 'Close' }).click();
  await page.getByTestId('top-tutorial').click();
  await page.locator('[data-testid^="card-rook-"]').click();
  await expect.poll(() => bg(page, '[data-testid=tutorial-board] piece.r-piece.white')).toContain('pieces/cburnett/wR.svg');
  // Saved: a reload keeps it.
  await openApp(page);
  await expect.poll(() => bg(page, '[data-testid=board] piece.n-piece.white')).toContain('pieces/cburnett/wN.svg');
  await page.getByTestId('top-settings').click();
  await expect(page.getByTestId('settings-pieces')).toHaveValue('cburnett');
});

const SHOGI_START = 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL[] w - - 0 1';
// Every promoted form of White's, and Black's promoted pawn and bishop.
const SHOGI_PROMOTED = '4k4/9/1+p3+b3/9/+L1+S1+N1+B1+R/9/4+P4/9/4K4[] w - - 0 1';
const XIANGQI_START = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

test('Shogi pieces show their own art, the king, rook and bishop in the set, with no lettered token', async ({ page }) => {
  await openApp(page);
  await load(page, 'shogi', SHOGI_START);
  const art: Record<string, string> = {
    p: 'shogi-tile/?shogiPawn', l: 'shogi-tile/?lance', n: 'shogi-tile/?shogiKnight', s: 'shogi-tile/?silver',
    g: 'shogi-tile/?gold', k: 'merida/?K', r: 'merida/?R', b: 'merida/?B',
  };
  for (const [l, file] of Object.entries(art)) {
    for (const [color, side] of [['white', 'w'], ['black', 'b']]) {
      expect(await bg(page, `[data-testid=board] piece.${l}-piece.${color}`), `${l} ${color}`).toContain(`pieces/${file.replace('?', side!)}.svg`);
    }
  }
  await expect(page.locator('[data-testid=board] piece.token')).toHaveCount(0);
});

test('promoted Shogi pieces show their promoted art, and the gold-movers a marker, with no lettered token', async ({ page }) => {
  await openApp(page);
  await load(page, 'shogi', SHOGI_PROMOTED);
  const piece = (role: string, color: string) => `[data-testid=board] piece.${role}-piece.${color}`;
  const mark = (selector: string) => page.locator(selector).first().evaluate(el => getComputedStyle(el, '::before').content);
  for (const role of ['pp', 'pl', 'pn', 'ps']) {
    expect(await bg(page, piece(role, 'white')), role).toContain('pieces/shogi-tile/wgold.svg');
    await expect(page.locator(piece(role, 'white')), role).toHaveClass(/promoted-mark/);
    expect(await mark(piece(role, 'white')), role).not.toBe('none');
  }
  expect(await bg(page, piece('pp', 'black'))).toContain('pieces/shogi-tile/bgold.svg');
  await expect(page.locator(piece('pp', 'black'))).toHaveClass(/promoted-mark/);
  expect(await bg(page, piece('pb', 'white'))).toContain('pieces/shogi-tile/wdragonHorse.svg');
  expect(await bg(page, piece('pb', 'black'))).toContain('pieces/shogi-tile/bdragonHorse.svg');
  expect(await bg(page, piece('pr', 'white'))).toContain('pieces/alfaerie/wkingrook.svg');
  // The dragon horse and the bers art differ from every unpromoted piece, so they need no marker.
  expect(await mark(piece('pb', 'white'))).toBe('none');
  expect(await mark(piece('pr', 'white'))).toBe('none');
  await expect(page.locator('[data-testid=board] piece.token')).toHaveCount(0);
  // A promoted piece that is captured and gone leaves no marker behind on the piece reused for another.
  await load(page, 'shogi', SHOGI_START);
  await expect(page.locator('[data-testid=board] piece.promoted-mark')).toHaveCount(0);
});

test('Xiangqi pieces show their own art, the chariot and general in the set, with no lettered token', async ({ page }) => {
  await openApp(page);
  await load(page, 'xiangqi', XIANGQI_START);
  const art: Record<string, string> = {
    r: 'merida/?R', k: 'merida/?K', a: 'alfaerie/?ferz', b: 'alfaerie/?elephantwazir', n: 'alfaerie/?horse',
    c: 'merida/shako/?C', p: 'alfaerie/?chinesepawn',
  };
  for (const [l, file] of Object.entries(art)) {
    for (const [color, side] of [['white', 'w'], ['black', 'b']]) {
      expect(await bg(page, `[data-testid=board] piece.${l}-piece.${color}`), `${l} ${color}`).toContain(`pieces/${file.replace('?', side!)}.svg`);
    }
  }
  await expect(page.locator('[data-testid=board] piece.token')).toHaveCount(0);
});

test('the Xiangqi board shades its river and palaces in both orientations, and they take no clicks', async ({ page }) => {
  await openApp(page);
  await load(page, 'xiangqi', XIANGQI_START);
  await expect(page.getByTestId('board')).toHaveAttribute('data-variant', 'xiangqi');
  await expectRiverAndPalaces(page, true);
  // A move into the palace: the shading lets the clicks through to the board.
  const box = (await page.locator('[data-testid=board] cg-board').boundingBox())!;
  const at = (file: number, rank: number) => page.mouse.click(box.x + ((file + 0.5) * box.width) / 9, box.y + ((9 - rank + 0.5) * box.height) / 10);
  await at(3, 0); // d1, the advisor
  await at(4, 1); // e2
  await expect(page.getByTestId('board')).toHaveAttribute('data-fen', /^rnbakabnr\/9\/1c5c1\/p1p1p1p1p\/9\/9\/P1P1P1P1P\/1C5C1\/4A4\/RNB1KABNR b/);
  // Black at the bottom: the same squares are shaded.
  await page.getByTestId('top-play').click();
  const dialog = page.getByTestId('play-dialog');
  await dialog.locator('#play-variant').selectOption('xiangqi');
  await dialog.locator('#play-opponent').selectOption('beginner');
  await dialog.locator('#play-color').selectOption('black');
  await dialog.locator('#play-clock').selectOption('None');
  await dialog.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByTestId('board')).toHaveAttribute('data-orientation', 'black');
  // Wait for the AI's first move: it redraws the board, and could land in the middle of the screenshot.
  await expect(page.getByTestId('status')).toHaveText('Black to move', { timeout: 20000 });
  await expectRiverAndPalaces(page, true);
});

test('a board that is not Xiangqi has no river or palaces', async ({ page }) => {
  await openApp(page);
  // Shogi's board is the same width, so the same spots would be shaded if the shading leaked to it.
  await load(page, 'shogi', SHOGI_START);
  const [a5, a3, e2, e4] = await boardColours(page, [['a5', 0.5, 0.9], ['a3', 0.5, 0.9], ['e2', 0.5, 0.5], ['e4', 0.5, 0.5]]);
  expect(differ(a5!, a3!)).toBe(false);
  expect(differ(e2!, e4!)).toBe(false);
});
