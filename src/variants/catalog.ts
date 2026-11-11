// Curated variant list consumed by the rules adapter, engine and UI. Pure data: no DOM or UI imports.
export type VariantId =
  | 'chess'
  | 'capablanca'
  | 'grand'
  | 'seirawan'
  | 'amazon'
  | 'shako'
  | 'spartan'
  | 'antichess';

export interface VariantInfo {
  id: VariantId;
  label: string;
  /** Variant name as ffish.js and Fairy-Stockfish know it. */
  engineName: string;
  files: number;
  ranks: number;
  blurb: string;
}

export const CURATED_VARIANTS: readonly VariantInfo[] = [
  { id: 'chess', label: 'Chess', engineName: 'chess', files: 8, ranks: 8, blurb: 'Standard chess.' },
  {
    id: 'capablanca',
    label: 'Capablanca',
    engineName: 'capablanca',
    files: 10,
    ranks: 8,
    blurb: 'Played on a 10x8 board with two extra pieces, the archbishop and the chancellor.',
  },
  {
    id: 'grand',
    label: 'Grand Chess',
    engineName: 'grand',
    files: 10,
    ranks: 10,
    blurb: 'Played on a 10x10 board with archbishop and chancellor pieces, and pawns that promote on the last three ranks.',
  },
  {
    id: 'seirawan',
    label: 'Seirawan',
    engineName: 'seirawan',
    files: 8,
    ranks: 8,
    blurb: 'Each side holds a hawk and an elephant in reserve and may bring them onto the board as pieces leave the back rank.',
  },
  {
    id: 'amazon',
    label: 'Amazon',
    engineName: 'amazon',
    files: 8,
    ranks: 8,
    blurb: 'The queen is replaced by an amazon, which moves as a queen and a knight combined.',
  },
  {
    id: 'shako',
    label: 'Shako',
    engineName: 'shako',
    files: 10,
    ranks: 10,
    blurb: 'Played on a 10x10 board with cannons and elephants added to the usual pieces.',
  },
  {
    id: 'spartan',
    label: 'Spartan',
    engineName: 'spartan',
    files: 8,
    ranks: 8,
    blurb: 'One side plays standard chess against Spartan pieces such as hoplites, a pair of kings and warlords.',
  },
  {
    id: 'antichess',
    label: 'Antichess',
    engineName: 'antichess',
    files: 8,
    ranks: 8,
    blurb: 'Captures are mandatory and you win by losing all your pieces or by being stalemated.',
  },
];

export function variantById(id: VariantId): VariantInfo {
  const found = CURATED_VARIANTS.find((v) => v.id === id);
  if (!found) throw new Error(`Unknown variant: ${id}`);
  return found;
}
