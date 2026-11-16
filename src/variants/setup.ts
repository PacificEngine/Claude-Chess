// An editor setup: what saved setups and saved custom games store instead of variants.ini text. Pure data
// and a structural guard: no DOM or UI imports.
import { CURATED_VARIANTS, type VariantId } from './catalog';

export const MIN_FILES = 5;
export const MIN_RANKS = 5;
export const MAX_FILES = 12;
export const MAX_RANKS = 10;

/**
 * A setup's own copy of a designed piece. The copy is the source of truth for the setup: deleting or changing
 * the library piece `id` names never changes a saved setup's rules. `art` is never written to the variant.
 */
export interface DesignedCopy {
  id: string;
  betza: string;
  art: string | null;
}

export interface SetupSpec {
  base: VariantId;
  files: number;
  ranks: number;
  /**
   * Lowercase piece letter to the built-in piece `type` it moves as, or 'inherited' when the base variant
   * defines that letter itself.
   */
  pieces: Record<string, string>;
  /**
   * Lowercase letter to the setup's copy of a designed piece. The letters are disjoint from `pieces`.
   * Optional so setups saved before designed pieces existed stay valid, and keep their names.
   */
  designed?: Record<string, DesignedCopy>;
  fen: string;
  castling: boolean;
  /** `pieceTypes` holds the lowercase letters (keys of `pieces` or `designed`) a pawn may promote to. */
  promotion: { rank: 'last'; pieceTypes: string[] };
}

const isRecord = (d: unknown): d is Record<string, unknown> => typeof d === 'object' && d !== null && !Array.isArray(d);

const isDesignedCopy = (d: unknown): d is DesignedCopy =>
  isRecord(d) && typeof d.id === 'string' && typeof d.betza === 'string' && (d.art === null || typeof d.art === 'string');

/** Checks the shape only. The generator checks the values (sizes, letters, types, FEN characters). */
export function isSetupSpec(d: unknown): d is SetupSpec {
  if (!isRecord(d)) return false;
  const { base, files, ranks, pieces, designed, fen, castling, promotion } = d;
  return (
    CURATED_VARIANTS.some((v) => v.id === base) &&
    Number.isInteger(files) &&
    Number.isInteger(ranks) &&
    isRecord(pieces) &&
    Object.values(pieces).every((t) => typeof t === 'string') &&
    (designed === undefined || (isRecord(designed) && Object.values(designed).every(isDesignedCopy))) &&
    typeof fen === 'string' &&
    typeof castling === 'boolean' &&
    isRecord(promotion) &&
    promotion.rank === 'last' &&
    Array.isArray(promotion.pieceTypes) &&
    promotion.pieceTypes.every((t) => typeof t === 'string')
  );
}
