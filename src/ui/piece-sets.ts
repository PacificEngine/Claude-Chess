// The piece sets Settings offers for the six standard pieces, and which one is in use. Every other piece keeps
// its own art (Merida's fairy pieces, Alfaerie, Spartan, shogi tiles), so it still looks like its name.
// Each set's files are public/pieces/<id>/<w|b><K|Q|R|B|N|P>.svg; ATTRIBUTION.md credits each set.
// No DOM, so tests run in Node.

export interface PieceSet {
  /** Folder under public/pieces, and the value saved in chess.settings. */
  id: string;
  label: string;
}

export const DEFAULT_PIECE_SET = 'merida';

export const PIECE_SETS: readonly PieceSet[] = [
  { id: 'merida', label: 'Merida' },
  { id: 'cburnett', label: 'Cburnett' },
  { id: 'chessnut', label: 'Chessnut' },
  { id: 'fantasy', label: 'Fantasy' },
  { id: 'spatial', label: 'Spatial' },
  { id: 'celtic', label: 'Celtic' },
  { id: 'mpchess', label: 'MPChess' },
  { id: 'kiwen-suwi', label: 'Kiwen-suwi' },
  { id: 'firi', label: 'Firi' },
  { id: 'totoy', label: 'Totoy' },
  { id: 'papercut', label: 'Papercut' },
  { id: 'rhosgfx', label: 'RhosGFX' },
  { id: 'shapes', label: 'Shapes' },
  { id: 'pixel', label: 'Pixel' },
  { id: 'letter', label: 'Letter' },
];

/**
 * The set to draw for a saved `pieceSet`. Settings saved before piece sets existed hold 'default', which is
 * Merida; a set this version doesn't ship is Merida too, never a broken image.
 */
export function pieceSetOf(saved: string): string {
  return PIECE_SETS.some((s) => s.id === saved) ? saved : DEFAULT_PIECE_SET;
}

// The set in use. Boards read it whenever they draw a piece and listen for changes, so a new choice in
// Settings redraws every board at once, open or hidden, without each screen being told.
let current = DEFAULT_PIECE_SET;
const listeners = new Set<() => void>();

export const currentPieceSet = (): string => current;

export function setPieceSet(saved: string): void {
  const next = pieceSetOf(saved);
  if (next === current) return;
  current = next;
  for (const l of listeners) l();
}

/** Calls `cb` after every change of set. */
export function onPieceSetChange(cb: () => void): void {
  listeners.add(cb);
}
