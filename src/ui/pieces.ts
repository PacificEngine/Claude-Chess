// Which pieces have art and which fall back to lettered tokens. Pure data: no DOM, so tests can run it in Node.
// chessgroundx names a piece by its FEN letter (`n-piece white`), and the same letter means different pieces in
// different variants (`c` is the chancellor in Capablanca, the cannon in Shako), so art is looked up per variant.
// A custom variant's letters are looked up by the built-in type they move as first, then in its base variant.
import type * as cg from 'chessgroundx/types';
import type { Color } from '../rules/types';
import type { ActiveVariant } from '../variants/active';
import type { VariantId } from '../variants/catalog';
import { INHERITED } from '../variants/piece-types';
import { artChoice } from './art-catalog';

type Colors = Color | 'both';
interface ArtRule {
  /** Folder under public/pieces holding `<w|b><LETTER>.svg`. */
  dir: string;
  /** Which side's pieces the art covers. */
  colors: Colors;
  /** Uppercase file letter by piece letter, where it differs from the piece letter. */
  files?: Record<string, string>;
}

const MERIDA: ArtRule = { dir: 'merida', colors: 'both' };
const ALFAERIE: ArtRule = { dir: 'alfaerie', colors: 'both' };
const SHOGI_TILE: ArtRule = { dir: 'shogi-tile', colors: 'both' };
const STANDARD = 'pnbrqk';
/** Duck Chess's duck: '*' in the FEN, a piece neither side owns. One image for both colours, in every set. */
const DUCK = '*';
const DUCK_URL = 'pieces/duck/duck.svg';
/** The built-in types drawn from the chosen piece set (the six standard pieces), by file letter. */
const STANDARD_TYPES: Record<string, string> = { pawn: 'P', knight: 'N', bishop: 'B', rook: 'R', queen: 'Q', king: 'K' };

// Art per variant and piece letter. A letter that is missing is drawn as a lettered token.
const ART: Record<string, Record<string, ArtRule>> = {
  capablanca: { a: MERIDA, c: MERIDA },
  grand: { a: MERIDA, c: MERIDA },
  seirawan: { h: MERIDA, e: MERIDA },
  shako: { c: { dir: 'merida/shako', colors: 'both' }, e: { dir: 'merida/shako', colors: 'both' } },
  // Spartan (Black) pieces: art only for Black. White plays standard pieces, which never use these letters,
  // except the king, where both sides have art.
  spartan: {
    l: { dir: 'spartan', colors: 'black', files: { l: 'Lieutenant' } },
    g: { dir: 'spartan', colors: 'black', files: { g: 'General' } },
    w: { dir: 'spartan', colors: 'black', files: { w: 'Warlord' } },
    c: { dir: 'spartan', colors: 'black', files: { c: 'Captain' } },
    h: { dir: 'spartan', colors: 'black', files: { h: 'P' } }, // the hoplite
  },
  amazon: { a: { ...ALFAERIE, files: { a: 'amazon' } } },
  // Shogi's king, rook and bishop are the standard pieces (from the chosen set); its pawn and knight move
  // differently, so they have their own tiles even though the letters are standard.
  shogi: {
    p: { ...SHOGI_TILE, files: { p: 'shogiPawn' } },
    l: { ...SHOGI_TILE, files: { l: 'lance' } },
    n: { ...SHOGI_TILE, files: { n: 'shogiKnight' } },
    s: { ...SHOGI_TILE, files: { s: 'silver' } },
    g: { ...SHOGI_TILE, files: { g: 'gold' } },
  },
  // Xiangqi's chariot (r) and general (k) are drawn as the rook and king from the chosen set.
  xiangqi: {
    a: { ...ALFAERIE, files: { a: 'ferz' } }, // advisor
    b: { ...ALFAERIE, files: { b: 'elephantwazir' } }, // elephant
    n: { ...ALFAERIE, files: { n: 'horse' } },
    c: { dir: 'merida/shako', colors: 'both' }, // cannon, Shako's
    p: { ...ALFAERIE, files: { p: 'chinesepawn' } }, // soldier
  },
};

// Art for promoted pieces (chessgroundx's `+P`, drawn as role `pp-piece`), per variant and unpromoted letter.
// `mark` puts a small marker on a promoted piece whose image another, unpromoted piece also wears, so a
// promoted pawn never passes for a gold (pieces.css draws it).
const PROMOTED_ART: Record<string, Record<string, { rule: ArtRule; file: string; mark?: true }>> = {
  shogi: {
    // The promoted pawn, lance, knight and silver move like the gold, so they wear its tile.
    p: { rule: SHOGI_TILE, file: 'gold', mark: true },
    l: { rule: SHOGI_TILE, file: 'gold', mark: true },
    n: { rule: SHOGI_TILE, file: 'gold', mark: true },
    s: { rule: SHOGI_TILE, file: 'gold', mark: true },
    b: { rule: SHOGI_TILE, file: 'dragonHorse' },
    r: { rule: ALFAERIE, file: 'kingrook' }, // the dragon king moves as the bers
  },
};

// Art by built-in piece type, for a custom variant's letters. Each entry is
// the art a curated variant gives a letter of that type (pieces.test.ts checks this against the rules).
const TYPE_ART: Record<string, { rule: ArtRule; file: string }> = {
  archbishop: { rule: MERIDA, file: 'A' }, // Capablanca's
  chancellor: { rule: MERIDA, file: 'C' }, // Capablanca's
  cannon: { rule: { dir: 'merida/shako', colors: 'both' }, file: 'C' }, // Shako's
  fersAlfil: { rule: { dir: 'merida/shako', colors: 'both' }, file: 'E' }, // Shako's elephant
  // Alfaerie art (see ATTRIBUTION.md), matched to each piece by its name.
  fers: { rule: ALFAERIE, file: 'ferz' },
  wazir: { rule: ALFAERIE, file: 'wazir' },
  alfil: { rule: ALFAERIE, file: 'elephant' },
  elephant: { rule: ALFAERIE, file: 'elephantwazir' }, // xiangqi's; the three elephants differ on purpose
  janggiElephant: { rule: ALFAERIE, file: 'elephantrider' },
  soldier: { rule: ALFAERIE, file: 'chinesepawn' },
  horse: { rule: ALFAERIE, file: 'horse' },
  janggiCannon: { rule: ALFAERIE, file: 'cannon' },
  amazon: { rule: ALFAERIE, file: 'amazon' },
  banner: { rule: ALFAERIE, file: 'banner' },
  commoner: { rule: ALFAERIE, file: 'man' },
  centaur: { rule: ALFAERIE, file: 'equesrex' },
  aiwok: { rule: ALFAERIE, file: 'chancellorferz' },
  bers: { rule: ALFAERIE, file: 'kingrook' },
  knibis: { rule: ALFAERIE, file: 'cardinal1' },
  biskni: { rule: ALFAERIE, file: 'cardinal2' },
  kniroo: { rule: ALFAERIE, file: 'chancellor1' },
  rookni: { rule: ALFAERIE, file: 'chancellor2' },
  clobber: { rule: ALFAERIE, file: 'ox' },
  breakthrough: { rule: ALFAERIE, file: 'berolinapawn' },
  // Shogi pieces: the Alfaerie piece on a shogi tile, built by scripts/make-shogi-tiles.mjs.
  shogiPawn: { rule: SHOGI_TILE, file: 'shogiPawn' },
  shogiKnight: { rule: SHOGI_TILE, file: 'shogiKnight' },
  lance: { rule: SHOGI_TILE, file: 'lance' },
  silver: { rule: SHOGI_TILE, file: 'silver' },
  gold: { rule: SHOGI_TILE, file: 'gold' },
  dragonHorse: { rule: SHOGI_TILE, file: 'dragonHorse' },
};

// A variant's own art for a letter wins over the standard piece, so a standard letter that is another piece
// there (the Shogi pawn, the Xiangqi horse) never falls back to the chess piece's art.
function rule(letter: string, variant: string): ArtRule | null {
  if (variant === 'spartan' && letter === 'k') return { dir: 'spartan', colors: 'black', files: { k: 'K' } };
  return ART[variant]?.[letter] ?? (STANDARD.includes(letter) ? MERIDA : null);
}

/** Whether `letter` has art in `variant` (for at least one side). */
export function hasArt(letter: string, variant: string): boolean {
  return letter === DUCK || rule(letter, variant) !== null;
}

/**
 * Path under public/ of the piece's SVG, or null when this piece is a lettered token.
 * Spartan's king has art for both sides, so White's king falls back to the standard one.
 *
 * `type` is the built-in type a custom variant's letter moves as, when that differs from the base's piece
 * for the letter (`artTypeOf`). A type with art wins, so the piece looks like what it moves like; a type
 * without art is a token, never the base's art for a piece it no longer is. Without a type (or with
 * 'inherited') the base variant's art for the letter is used, then a token.
 *
 * `designedArt` is given (even as null) for a designed letter (`designedArt` in active.ts): it draws the art
 * the player chose, or a token for none or an id no longer in the catalog, never the base's or a type's art.
 *
 * `pieceSet` (a folder from piece-sets.ts) draws the six standard pieces; every other piece keeps its own art,
 * and so does a designed piece, even one that chose Merida's standard art.
 *
 * The Duck Chess duck ('*') is the same image for both colours, in every variant and set.
 */
export function artUrl(
  letter: string,
  color: Color,
  artBase: VariantId,
  type?: string,
  designedArt?: string | null,
  pieceSet = 'merida',
): string | null {
  if (letter === DUCK) return DUCK_URL;
  if (designedArt !== undefined) return artChoice(designedArt)?.[color] ?? null;
  const side = color === 'white' ? 'w' : 'b';
  const standard = type === undefined ? undefined : STANDARD_TYPES[type];
  if (standard) return `pieces/${pieceSet}/${side}${standard}.svg`;
  const byType = type === undefined ? undefined : TYPE_ART[type];
  if (byType) return `pieces/${byType.rule.dir}/${side}${byType.file}.svg`;
  if (type !== undefined && type !== INHERITED) return null;
  let r = rule(letter, artBase);
  if (r && r.colors !== 'both' && r.colors !== color) r = letter === 'k' ? MERIDA : null;
  if (!r) return null;
  // A standard piece drawn as standard (not Spartan's king) comes from the chosen set.
  if (r === MERIDA && STANDARD.includes(letter)) return `pieces/${pieceSet}/${side}${letter.toUpperCase()}.svg`;
  const file = r.files?.[letter] ?? letter.toUpperCase();
  return `pieces/${r.dir}/${side}${file}.svg`;
}

/**
 * Path under public/ of a promoted piece's SVG (`+P`, by its unpromoted letter), or null when the variant
 * gives that promoted piece no art, so it is a lettered token. Promoted art is never the piece set's: the set
 * draws the six standard pieces, and no promoted form is one of them.
 *
 * It takes no piece type or designed art, unlike artUrl: only Shogi has promoted pieces, and a Shogi setup is
 * position-only (POSITION_ONLY_BASES), never a custom variant, so no letter of a promoted piece changes type.
 */
export function promotedArtUrl(letter: string, color: Color, artBase: VariantId): string | null {
  const art = PROMOTED_ART[artBase]?.[letter];
  return art ? `pieces/${art.rule.dir}/${color === 'white' ? 'w' : 'b'}${art.file}.svg` : null;
}

const TILE_DIR = `pieces/${SHOGI_TILE.dir}/`;

/**
 * A shogi tile points toward the opponent, whichever way up the board is: the side at the bottom of the board
 * (chessgroundx's `ally`) points up and the side at the top (`enemy`) down. A tile's own file points up for
 * White and down for Black, so a tile on the other side gets its `turned/` file. `side` is null off a board
 * (no ally or enemy class), where the tile keeps its own direction; art that is not a tile never turns.
 */
export function facingUrl(url: string, color: Color, side: 'ally' | 'enemy' | null): string {
  if (!url.startsWith(TILE_DIR) || side === null) return url;
  const turn = color === 'white' ? side === 'enemy' : side === 'ally';
  return turn ? `${TILE_DIR}turned/${url.slice(TILE_DIR.length)}` : url;
}

/** Whether a promoted piece wears the promoted marker (`promotedMarkClass`), because it shares its image. */
export function promotedMark(letter: string, artBase: VariantId): boolean {
  return PROMOTED_ART[artBase]?.[letter]?.mark === true;
}

/** The class pieces.css draws the promoted marker from. */
export const promotedMarkClass = 'promoted-mark';

/** The class chessgroundx puts on a piece element, e.g. `n-piece white`. */
export function pieceClass(letter: string, color: Color): string {
  return `${letter}-piece ${color}`;
}

/** Classes for a piece without art: `token` makes pieces.css draw its `data-letter` as a token. */
export function tokenClass(letter: string): string {
  return `token token-${letter}`;
}

/**
 * Parses a piece class like `a-piece white` (a pocket piece may also carry other classes). chessgroundx draws
 * a `+P` from a FEN as role `pp-piece`, so a role of `p` and a letter is that letter promoted. (A `~` piece,
 * as in Crazyhouse, keeps its own role and is not promoted here: it looks like the piece it became.) The Duck
 * Chess duck ('*' in the FEN) is role `_-piece`, which chessgroundx always colours black: its letter is '*'.
 */
export function parsePieceClass(className: string): { letter: string; color: Color; promoted: boolean } | null {
  const m = /(?:^|\s)(p)?([a-z_])-piece(?:\s|$)/.exec(className);
  const color = /(?:^|\s)(white|black)(?:\s|$)/.exec(className)?.[1] as Color | undefined;
  return m && color ? { letter: m[2] === '_' ? '*' : m[2]!, color, promoted: m[1] !== undefined } : null;
}

/** Distinct lowercase piece letters in a FEN: the board, and the pockets of a drop variant like Seirawan. */
export function pieceLettersOf(fen: string): string[] {
  const placement = fen.split(' ')[0] ?? '';
  const letters = new Set<string>();
  for (const ch of placement) if (/[a-z]/i.test(ch)) letters.add(ch.toLowerCase());
  return [...letters];
}

// Pieces held in hand, shown as pockets beside the board, for curated variants with pockets.
const POCKET_ROLES: Partial<Record<string, cg.Role[]>> = {
  seirawan: ['h-piece', 'e-piece'],
  // Every piece but the king can be captured into hand (a promoted piece goes back unpromoted).
  shogi: ['r-piece', 'b-piece', 'g-piece', 's-piece', 'n-piece', 'l-piece', 'p-piece'],
};

/**
 * The pocket roles of a variant with pockets: a custom variant's are the letters its setup puts in hand.
 * Undefined when there is nothing to show, so an empty hand draws no empty pocket rows.
 */
export function pocketRoles(v: ActiveVariant): cg.Role[] | undefined {
  if (!v.pockets) return undefined;
  if (!v.setup) return POCKET_ROLES[v.artBase];
  const pocket = /\[([^\]]*)\]/.exec(v.setup.fen.split(' ')[0] ?? '')?.[1] ?? '';
  const roles = [...new Set([...pocket].map((c) => `${c.toLowerCase()}-piece` as cg.Role))];
  return roles.length ? roles : undefined;
}
