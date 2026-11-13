// Which pieces have art and which fall back to lettered tokens. Pure data: no DOM, so tests can run it in Node.
// chessgroundx names a piece by its FEN letter (`n-piece white`), and the same letter means different pieces in
// different variants (`c` is the chancellor in Capablanca, the cannon in Shako), so art is looked up per variant.
// A custom variant's letters are looked up by the built-in type they move as first, then in its base variant.
import type * as cg from 'chessgroundx/types';
import type { Color } from '../rules/types';
import type { ActiveVariant } from '../variants/active';
import type { VariantId } from '../variants/catalog';
import { INHERITED } from '../variants/piece-types';

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
};

// Art by built-in piece type, for a custom variant's letters. Each entry is
// the art a curated variant gives a letter of that type (pieces.test.ts checks this against the rules).
const TYPE_ART: Record<string, { rule: ArtRule; file: string }> = {
  pawn: { rule: MERIDA, file: 'P' },
  knight: { rule: MERIDA, file: 'N' },
  bishop: { rule: MERIDA, file: 'B' },
  rook: { rule: MERIDA, file: 'R' },
  queen: { rule: MERIDA, file: 'Q' },
  king: { rule: MERIDA, file: 'K' },
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

function rule(letter: string, variant: string): ArtRule | null {
  if (STANDARD.includes(letter)) {
    return variant === 'spartan' && letter === 'k' ? { dir: 'spartan', colors: 'black', files: { k: 'K' } } : MERIDA;
  }
  return ART[variant]?.[letter] ?? null;
}

/** Whether `letter` has art in `variant` (for at least one side). */
export function hasArt(letter: string, variant: string): boolean {
  return rule(letter, variant) !== null;
}

/**
 * Path under public/ of the piece's SVG, or null when this piece is a lettered token.
 * Spartan's king has art for both sides, so White's king falls back to the standard one.
 *
 * `type` is the built-in type a custom variant's letter moves as, when that differs from the base's piece
 * for the letter (`artTypeOf`). A type with art wins, so the piece looks like what it moves like; a type
 * without art is a token, never the base's art for a piece it no longer is. Without a type (or with
 * 'inherited') the base variant's art for the letter is used, then a token.
 */
export function artUrl(letter: string, color: Color, artBase: VariantId, type?: string): string | null {
  const side = color === 'white' ? 'w' : 'b';
  const byType = type === undefined ? undefined : TYPE_ART[type];
  if (byType) return `pieces/${byType.rule.dir}/${side}${byType.file}.svg`;
  if (type !== undefined && type !== INHERITED) return null;
  let r = rule(letter, artBase);
  if (r && r.colors !== 'both' && r.colors !== color) r = letter === 'k' ? MERIDA : null;
  if (!r) return null;
  const file = r.files?.[letter] ?? letter.toUpperCase();
  return `pieces/${r.dir}/${side}${file}.svg`;
}

/** The class chessgroundx puts on a piece element, e.g. `n-piece white`. */
export function pieceClass(letter: string, color: Color): string {
  return `${letter}-piece ${color}`;
}

/** Classes for a piece without art: `token` makes pieces.css draw its `data-letter` as a token. */
export function tokenClass(letter: string): string {
  return `token token-${letter}`;
}

/** Parses a piece class like `a-piece white` (a pocket piece may also carry other classes). */
export function parsePieceClass(className: string): { letter: string; color: Color } | null {
  const m = /(?:^|\s)([a-z])-piece(?:\s|$)/.exec(className);
  const color = /(?:^|\s)(white|black)(?:\s|$)/.exec(className)?.[1] as Color | undefined;
  return m && color ? { letter: m[1]!, color } : null;
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
