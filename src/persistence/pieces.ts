// The player's designed pieces, under chess.pieces. Betza and art values are checked where they are used, not
// here: this only guarantees each entry has the right shape. No DOM or UI imports.
import type { Store } from './store';

export const PIECES_VERSION = 1;

export interface DesignedPiece {
  /** `crypto.randomUUID()` when first saved. */
  id: string;
  /** The player's own text, 1-30 characters: only ever shown with textContent. */
  name: string;
  /** The FEN letter, a-z. */
  letter: string;
  /** The movement, as Betza notation. */
  betza: string;
  /** An ART_CHOICES id, or null for a lettered token. */
  art: string | null;
  savedAt: number;
}

const isRecord = (d: unknown): d is Record<string, unknown> => typeof d === 'object' && d !== null;

function isDesignedPiece(d: unknown): d is DesignedPiece {
  return (
    isRecord(d) &&
    typeof d.id === 'string' &&
    d.id !== '' &&
    typeof d.name === 'string' &&
    d.name.length >= 1 &&
    d.name.length <= 30 &&
    typeof d.letter === 'string' &&
    /^[a-z]$/.test(d.letter) &&
    typeof d.betza === 'string' &&
    (d.art === null || typeof d.art === 'string') &&
    typeof d.savedAt === 'number' &&
    Number.isFinite(d.savedAt)
  );
}

const isPieceList = (d: unknown): d is DesignedPiece[] => Array.isArray(d) && d.every(isDesignedPiece);

/** A list that fails validation is moved aside to chess.pieces.corrupt by the store, so the app starts with none. */
export function loadPieces(store: Store): { pieces: DesignedPiece[]; problem: 'corrupt' | null } {
  const loaded = store.load('chess.pieces', PIECES_VERSION, {}, isPieceList);
  return { pieces: loaded.data ?? [], problem: loaded.problem };
}

/** False when the browser refused to store them (no storage, or full). */
export function savePieces(store: Store, pieces: DesignedPiece[]): boolean {
  return store.save('chess.pieces', PIECES_VERSION, pieces);
}
