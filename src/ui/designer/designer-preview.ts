// The piece designer's preview: the setup a design is registered as, and the squares it reaches there. No DOM:
// the rules library says where the piece goes, never the UI.
//
// The board is chess on 8×8: the piece on d4, White's king on h1 and Black's on a8, and Black pawns on b6, d6, f6
// and f4 as screens, so slides stop at them and a cannon can hop them.
// - Trap: a king on one of d4's lines is checked by a cannon hopping a screen (h8, behind f6, was), and the
//   position is then illegal. h1 and a8 are four squares away (beyond every leap), off d4's ranks, files and
//   diagonals, and off the nightrider's lines, so no move the designer offers reaches either king or is
//   blocked by one.
// - What it reaches there (move squares and capture-only squares) is `reachFrom`'s probe.
import type { Rules } from '../../rules/types';
import { type Reach, reachFrom } from '../../variants/reach';
import type { SetupSpec } from '../../variants/setup';

export type { Reach } from '../../variants/reach';

export const PREVIEW_SQUARE = 'd4';
/** Any letter chess leaves free: the preview's piece is never placed in a setup. */
const LETTER = 'z';
const KINGS = { h1: 'K', a8: 'k' };
const SCREENS = ['b6', 'd6', 'f6', 'f4'];

function fenOf(pieces: Record<string, string>): string {
  const rows: string[] = [];
  for (let rank = 8; rank >= 1; rank--) {
    let row = '';
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const piece = pieces[`${String.fromCharCode(97 + file)}${rank}`];
      if (!piece) {
        empty++;
        continue;
      }
      if (empty) row += String(empty);
      empty = 0;
      row += piece;
    }
    rows.push(empty ? row + String(empty) : row);
  }
  return `${rows.join('/')} w - - 0 1`;
}

const POSITION: Record<string, string> = { ...KINGS, ...Object.fromEntries(SCREENS.map((s) => [s, 'p'])), [PREVIEW_SQUARE]: LETTER.toUpperCase() };
export const PREVIEW_FEN = fenOf(POSITION);

/** The setup the design is registered as, through registerSetup like any other: the engine checks it first. */
export function previewSpec(betza: string): SetupSpec {
  return {
    base: 'chess',
    files: 8,
    ranks: 8,
    // The knight is only for the capture probes on the first and last ranks.
    pieces: { k: 'king', p: 'pawn', n: 'knight' },
    designed: { [LETTER]: { id: 'preview', betza, art: null } },
    fen: PREVIEW_FEN,
    castling: false,
    promotion: { rank: 'last', pieceTypes: [] },
  };
}

/** Where the preview piece goes in `variant`, a registered `previewSpec`. */
export function reachOf(rules: Rules, variant: string): Reach {
  return reachFrom(rules, variant, PREVIEW_FEN, PREVIEW_SQUARE);
}

/** Every piece must move: somewhere to go, or something to capture. */
export const canMove = (r: Reach): boolean => r.moves.length > 0 || r.captures.length > 0;
