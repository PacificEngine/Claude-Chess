import { expect, type Page } from '@playwright/test';

/**
 * The colours of a board's own background at points given as a square and a spot inside it (fractions
 * from the square's a1-side corner), with the pieces, highlights and coordinates hidden, in either orientation.
 * `testid` names the board host: the game's `board` or the editor's `editor-board`.
 */
export async function boardColours(page: Page, points: [string, number, number][], testid = 'board'): Promise<number[][]> {
  const board = page.getByTestId(testid);
  const files = Number(await board.getAttribute('data-files'));
  const ranks = Number(await board.getAttribute('data-ranks'));
  const flipped = (await board.getAttribute('data-orientation')) === 'black';
  const hide = (on: boolean) =>
    page.evaluate(
      ([h, id]) => {
        for (const el of document.querySelectorAll<HTMLElement>(`[data-testid=${id}] cg-board > *, [data-testid=${id}] coords`)) {
          el.style.visibility = h ? 'hidden' : '';
        }
      },
      [on, testid] as const,
    );
  await hide(true);
  const png = (await page.locator(`[data-testid=${testid}] cg-board`).screenshot({ animations: 'disabled' })).toString('base64');
  await hide(false);
  const spots = points.map(([sq, dx, dy]) => {
    const file = sq.charCodeAt(0) - 97;
    const rank = Number(sq.slice(1)) - 1;
    const x = flipped ? files - 1 - file + (1 - dx) : file + dx;
    const y = flipped ? rank + dy : ranks - 1 - rank + (1 - dy);
    return [x / files, y / ranks];
  });
  return page.evaluate(async ([data, at]) => {
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const canvas = new OffscreenCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return (at as number[][]).map(([fx, fy]) => [
      ...ctx.getImageData(Math.floor(fx! * img.width), Math.floor(fy! * img.height), 1, 1).data.slice(0, 3),
    ]);
  }, [png, spots] as const);
}

export const differ = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]!), 0) > 15;

/**
 * Checks the river and palace shading by comparing squares of the same colour: a5's top edge (in the river)
 * with a3's, e2 (White's palace) with e4 and c2, e9 (Black's palace) with e7 and c9.
 */
export async function expectRiverAndPalaces(page: Page, shaded: boolean, testid = 'board'): Promise<void> {
  const [a5, a3, a6, a8, e2, e4, c2, e9, e7, c9] = await boardColours(
    page,
    [
      ['a5', 0.5, 0.9], ['a3', 0.5, 0.9], ['a6', 0.5, 0.1], ['a8', 0.5, 0.1],
      ['e2', 0.5, 0.5], ['e4', 0.5, 0.5], ['c2', 0.5, 0.5],
      ['e9', 0.5, 0.5], ['e7', 0.5, 0.5], ['c9', 0.5, 0.5],
    ],
    testid,
  );
  expect(differ(a5!, a3!), `river, rank 5: ${a5} vs ${a3}`).toBe(shaded);
  expect(differ(a6!, a8!), `river, rank 6: ${a6} vs ${a8}`).toBe(shaded);
  expect(differ(e2!, e4!), `White's palace: ${e2} vs ${e4}`).toBe(shaded);
  expect(differ(e2!, c2!), `White's palace: ${e2} vs ${c2}`).toBe(shaded);
  expect(differ(e9!, e7!), `Black's palace: ${e9} vs ${e7}`).toBe(shaded);
  expect(differ(e9!, c9!), `Black's palace: ${e9} vs ${c9}`).toBe(shaded);
  // Outside them the board is the plain checker.
  expect(differ(c2!, e4!), `plain squares: ${c2} vs ${e4}`).toBe(false);
}
