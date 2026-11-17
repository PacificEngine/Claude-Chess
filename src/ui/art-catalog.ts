// Every piece image a designed piece may use. A static list, not a disk scan: the browser cannot list public/.
// art-catalog.test.ts walks public/pieces to fail when new two-colour art is shipped but not listed here.
// Spartan art is left out on purpose: it exists for Black only. Pure data, no DOM, so tests run in Node.
import { PIECE_SETS } from './piece-sets';

export interface ArtChoice {
  /** `<dir>/<file>`: the file name without its w/b prefix or .svg, e.g. `alfaerie/amazon`, `merida/Q`. */
  id: string;
  /** Plain English: "<Piece> (<Set>)". */
  label: string;
  /** Paths under public/, in the form `artUrl` returns. */
  white: string;
  black: string;
}

const SETS: { dir: string; set: string; pieces: Record<string, string> }[] = [
  {
    dir: 'merida',
    set: 'Merida',
    pieces: {
      P: 'Pawn', N: 'Knight', B: 'Bishop', R: 'Rook', Q: 'Queen', K: 'King',
      A: 'Archbishop', C: 'Chancellor', H: 'Hawk', E: 'Elephant',
    },
  },
  { dir: 'merida/shako', set: 'Shako', pieces: { C: 'Cannon', E: 'Elephant' } },
  {
    dir: 'alfaerie',
    set: 'Alfaerie',
    pieces: {
      amazon: 'Amazon', banner: 'Banner', berolinapawn: 'Breakthrough Piece', cannon: 'Janggi Cannon',
      cardinal1: 'Knibis', cardinal2: 'Biskni', chancellor1: 'Kniroo', chancellor2: 'Rookni',
      chancellorferz: 'Aiwok', chinesepawn: 'Soldier', elephant: 'Alfil', elephantrider: 'Janggi Elephant',
      elephantwazir: 'Elephant', equesrex: 'Centaur', ferz: 'Fers', goldgeneral: 'Gold General',
      horse: 'Horse', kingrook: 'Bers', lance: 'Lance', man: 'Commoner', narrowknight: 'Narrow Knight',
      ox: 'Clobber Piece', pawn: 'Pawn', promotedbishop: 'Promoted Bishop', silvergeneral: 'Silver General',
      wazir: 'Wazir',
    },
  },
  {
    dir: 'shogi-tile',
    set: 'Shogi tile',
    pieces: {
      dragonHorse: 'Dragon Horse', gold: 'Gold General', lance: 'Lance', shogiKnight: 'Shogi Knight',
      shogiPawn: 'Shogi Pawn', silver: 'Silver General',
    },
  },
];

// The standard pieces of every piece set Settings offers (Merida's are listed above with its fairy pieces).
const STANDARD_PIECES = { P: 'Pawn', N: 'Knight', B: 'Bishop', R: 'Rook', Q: 'Queen', K: 'King' };
const PIECE_SET_ART = PIECE_SETS.filter((s) => s.id !== 'merida').map((s) => ({ dir: s.id, set: s.label, pieces: STANDARD_PIECES }));

export const ART_CHOICES: readonly ArtChoice[] = [...SETS, ...PIECE_SET_ART].flatMap(({ dir, set, pieces }) =>
  Object.entries(pieces).map(([file, name]) => ({
    id: `${dir}/${file}`,
    label: `${name} (${set})`,
    white: `pieces/${dir}/w${file}.svg`,
    black: `pieces/${dir}/b${file}.svg`,
  })),
);

/** The art for a saved id, or null for no art or an id this version of the site does not ship. */
export function artChoice(id: string | null): ArtChoice | null {
  return ART_CHOICES.find((c) => c.id === id) ?? null;
}
