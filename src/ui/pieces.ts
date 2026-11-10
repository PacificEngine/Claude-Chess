// Which pieces have art and which fall back to lettered tokens. Pure data: no DOM, so tests can run it in Node.
// chessgroundx names a piece by its FEN letter (`n-piece white`), and the same letter means different pieces in
// different variants (`c` is the chancellor in Capablanca, the cannon in Shako), so art is looked up per variant.
import type { Color } from '../rules/types';

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
  // No suitable art for the Amazon (queen + knight): it is a lettered token.
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
 */
export function artUrl(letter: string, color: Color, variant: string): string | null {
  let r = rule(letter, variant);
  if (r && r.colors !== 'both' && r.colors !== color) r = letter === 'k' ? MERIDA : null;
  if (!r) return null;
  const file = r.files?.[letter] ?? letter.toUpperCase();
  return `pieces/${r.dir}/${color === 'white' ? 'w' : 'b'}${file}.svg`;
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
