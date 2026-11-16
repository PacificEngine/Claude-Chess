import { expect, type Page, test } from '@playwright/test';
import type { ChessTestHooks } from '../src/ui/app';
import { generateVariant } from '../src/variants/generator';
import type { SetupSpec } from '../src/variants/setup';

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
