// Builds public/pieces/shogi-tile/*.svg: each shogi piece's Alfaerie art set on a wooden shogi tile.
// The piece is copied into the tile, not linked: chessgroundx draws pieces as CSS background images, and an
// SVG used as an image may not load anything else. A tile points toward the opponent, as in real shogi: White's
// file points up and Black's down, and turned/ holds each the other way, for the board seen from Black's side.
// Run with `yarn art:pieces` (it recolors Black's Alfaerie pieces first) after changing a source file or the tile shape.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve('public/pieces/alfaerie');
const OUT = resolve('public/pieces/shogi-tile');
const TILE = 'M25 3 L38 9 L43 47 H7 L12 9 Z';
const WOOD = '#f0d28c';
const EDGE = '#5b3a1a';

// Built-in piece type -> Alfaerie file (without the w/b prefix).
const SHOGI = {
  shogiPawn: 'pawn',
  shogiKnight: 'narrowknight',
  lance: 'lance',
  silver: 'silvergeneral',
  gold: 'goldgeneral',
  dragonHorse: 'promotedbishop',
};

function pieceSvg(file) {
  const svg = readFileSync(resolve(SRC, file), 'utf8');
  const root = /<svg\b([^>]*)>/.exec(svg);
  if (!root) throw new Error(`${file}: no <svg> element`);
  const namespaces = root[1].match(/\sxmlns:[a-z]+="[^"]*"/g) ?? [];
  const viewBox = /viewBox="([^"]*)"/.exec(root[1])?.[1] ?? '0 0 2048 2048';
  const inner = svg.slice(root.index + root[0].length, svg.lastIndexOf('</svg>'));
  return { namespaces, viewBox, inner };
}

mkdirSync(resolve(OUT, 'turned'), { recursive: true });
for (const [type, name] of Object.entries(SHOGI)) {
  for (const side of ['w', 'b']) {
    const { namespaces, viewBox, inner } = pieceSvg(`${side}${name}.svg`);
    for (const [dir, down] of [['', side === 'b'], ['turned', side === 'w']]) {
      // Only the tile turns; the piece on it stays upright.
      const turn = down ? ' transform="rotate(180 25 25)"' : '';
      const out = `<svg xmlns="http://www.w3.org/2000/svg"${namespaces.join('')} viewBox="0 0 50 50">
<path d="${TILE}" fill="${WOOD}" stroke="${EDGE}" stroke-width="1.4" stroke-linejoin="round"${turn}/>
<svg x="9" y="12" width="32" height="32" viewBox="${viewBox}">${inner}</svg>
</svg>
`;
      writeFileSync(resolve(OUT, dir, `${side}${type}.svg`), out);
    }
  }
}
