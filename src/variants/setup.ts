// An editor setup: what saved setups and saved custom games store instead of variants.ini text. Pure data
// and a structural guard: no DOM or UI imports.
import { CURATED_VARIANTS, type VariantId } from './catalog';

export const MIN_FILES = 5;
export const MIN_RANKS = 5;
export const MAX_FILES = 12;
export const MAX_RANKS = 10;

export interface SetupSpec {
  base: VariantId;
  files: number;
  ranks: number;
  /**
   * Lowercase piece letter to the built-in piece `type` it moves as, or 'inherited' when the base variant
   * defines that letter itself. Plan 3 adds `designed: Record<string, string>` (letter to designed-piece id).
   */
  pieces: Record<string, string>;
  fen: string;
  castling: boolean;
  /** `pieceTypes` holds the lowercase letters (keys of `pieces`) a pawn may promote to. */
  promotion: { rank: 'last'; pieceTypes: string[] };
}

const isRecord = (d: unknown): d is Record<string, unknown> => typeof d === 'object' && d !== null && !Array.isArray(d);

/** Checks the shape only. The generator checks the values (sizes, letters, types, FEN characters). */
export function isSetupSpec(d: unknown): d is SetupSpec {
  if (!isRecord(d)) return false;
  const { base, files, ranks, pieces, fen, castling, promotion } = d;
  return (
    CURATED_VARIANTS.some((v) => v.id === base) &&
    Number.isInteger(files) &&
    Number.isInteger(ranks) &&
    isRecord(pieces) &&
    Object.values(pieces).every((t) => typeof t === 'string') &&
    typeof fen === 'string' &&
    typeof castling === 'boolean' &&
    isRecord(promotion) &&
    promotion.rank === 'last' &&
    Array.isArray(promotion.pieceTypes) &&
    promotion.pieceTypes.every((t) => typeof t === 'string')
  );
}
