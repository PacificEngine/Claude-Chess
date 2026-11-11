import { expect, type Page, test } from '@playwright/test';
import type { ChessTestHooks } from '../src/ui/app';

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

test('a fairy piece with art shows it, and a piece without art shows its letter on a token', async ({ page }) => {
  await openApp(page);
  await load(page, 'capablanca', 'rnabqkbcnr/pppppppppp/10/10/10/10/PPPPPPPPPP/RNABQKBCNR w KQkq - 0 1');
  expect(await bg(page, 'piece.a-piece.white')).toContain('pieces/merida/wA.svg');
  await load(page, 'amazon', 'rnbakbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBAKBNR w KQkq - 0 1');
  expect(await bg(page, 'piece.a-piece.white')).toBe('none');
  expect(await letter(page, 'piece.a-piece.white')).toBe('"A"');
  expect(await letter(page, 'piece.a-piece.black')).toBe('"A"');
  const colors = await page.locator('piece.a-piece').evaluateAll(els =>
    els.map(el => [getComputedStyle(el, '::after').color, getComputedStyle(el, '::after').backgroundColor]),
  );
  for (const [fg, back] of colors) expect(fg).not.toBe(back);
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
