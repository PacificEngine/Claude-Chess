# Attribution

This site is distributed under the GNU GPL v3 because it ships Fairy-Stockfish, ffish.js and chessgroundx.

## Piece art

The Merida and Spartan sets come from [pychess-variants](https://github.com/gbtami/pychess-variants) (`static/images/pieces/`).
Its [COPYING.md](https://github.com/gbtami/pychess-variants/blob/master/static/COPYING.md) lists the licence of each set.
The SVG files are copied unchanged; the Shako elephant and cannon are in `merida/shako/`.

| Files | Author | Licence | Licence text |
|---|---|---|---|
| `public/pieces/merida/*` (standard pieces, archbishop, chancellor, hawk, elephant, Shako cannon and elephant) | Armando Hernandez Marroquin | GPL v2 or later | `public/pieces/LICENSE-merida.txt` |
| `public/pieces/spartan/*` (Spartan king, hoplite, lieutenant, general, warlord, captain) | pychess-variants contributors | AGPL v3 or later | `public/pieces/LICENSE-spartan.txt` |
| `public/pieces/alfaerie/*` (the other fairy pieces) | David Howe (original Alfaerie set), after Eric Bentzen's Chess Alpha font; SVG version by H. G. Muller and Greg Strong | Permission only, no named licence (see below) | `public/pieces/LICENSE-alfaerie.txt` |
| `public/pieces/shogi-tile/*` (shogi pieces) | The Alfaerie pieces above, set on a shogi tile drawn for this site by `scripts/make-shogi-tiles.mjs` | As the Alfaerie pieces | `public/pieces/LICENSE-alfaerie.txt` |

The Merida and Spartan licences allow redistribution under GPL v3 (GPL v2-or-later may be used under v3; AGPL v3 may be combined with GPL v3).

### Alfaerie

Alfaerie has no formal licence. David Howe's Alfaerie pages say: "You may download and use the Alfaerie graphics if you wish."
The site uses them on that permission, as pychess-variants does (owner decision, 2026-11-13). If the authors object or name a
licence, follow it. The SVG files come from pychess-variants (`static/images/pieces/alfaerie/`) and are unchanged in shape, except that
four elephant files had an off-canvas `<image>` link to a file on the artist's computer removed.
Black's pieces are also recolored to match the Merida set: the blue body becomes near-black and the black lines become light
(`scripts/recolor-alfaerie-black.mjs`).

- Original set: https://www.chessvariants.com/graphics.dir/alfaerie/
- SVG version: https://www.chessvariants.com/graphics.dir/alfaerieSVG/

Source: https://github.com/gbtami/pychess-variants/tree/master/static/images/pieces
