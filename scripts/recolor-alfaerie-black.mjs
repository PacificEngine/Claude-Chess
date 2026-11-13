// Recolors Black's Alfaerie pieces (public/pieces/alfaerie/b*.svg) to match Black's Merida pieces: pychess-variants
// ships them with a blue body (#5984bd) and black outlines and details. Merida's Black is a near-black body with
// light inner lines, so the body becomes Merida's #1f1a17 and the black lines become the light #f9f9f9 that
// Alfaerie's White pieces use (owner decision, 2026-11-13). Safe to run again: it only rewrites those colours.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = resolve('public/pieces/alfaerie');
const ALFAERIE_BLUE = /#5984bd/gi;
const BLACK_LINE = /(fill|stroke):#000000/gi;
const MERIDA_DARK = '#1f1a17';
const LIGHT_LINE = '#f9f9f9';

for (const file of readdirSync(DIR).filter((f) => f.startsWith('b') && f.endsWith('.svg'))) {
  const path = resolve(DIR, file);
  const svg = readFileSync(path, 'utf8');
  const recolored = svg.replace(ALFAERIE_BLUE, MERIDA_DARK).replace(BLACK_LINE, `$1:${LIGHT_LINE}`);
  if (recolored !== svg) writeFileSync(path, recolored);
}
