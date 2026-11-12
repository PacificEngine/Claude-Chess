// FEN helpers shared by the piece-type mapper and the position checks. No DOM or UI imports.
import type { Rules } from '../rules/types';

export interface Position {
  files: number;
  ranks: number;
  /** Square index (file + rank * files, rank 0 = rank 1) to FEN piece character. */
  squares: Map<number, string>;
  pocket: string[];
}

export function parseFen(fen: string): Position {
  const [placement] = fen.split(' ');
  const pocketMatch = /\[([^\]]*)\]/.exec(placement);
  // Bottom row first. Digits are runs of empty squares; '~' (promoted) and '+' markers aren't pieces.
  const rows: string[][] = placement
    .replace(/\[[^\]]*\]/, '')
    .split('/')
    .reverse()
    .map((row) =>
      (row.match(/\d+|[A-Za-z]/g) ?? []).flatMap((t) => (/\d/.test(t) ? new Array<string>(Number(t)).fill('') : [t])),
    );
  const files = rows[0].length;
  const squares = new Map<number, string>();
  rows.forEach((row, rank) => row.forEach((c, file) => c && squares.set(file + rank * files, c)));
  return { files, ranks: rows.length, squares, pocket: [...(pocketMatch?.[1] ?? '')] };
}

/** A FEN from its pieces; by default with no castling, en passant or gating rights, so only the pieces decide what's legal. */
export function buildFen({ files, ranks, squares, pocket }: Position, rest = 'w - - 0 1'): string {
  const rows: string[] = [];
  for (let rank = ranks - 1; rank >= 0; rank--) {
    let row = '';
    let empty = 0;
    for (let file = 0; file < files; file++) {
      const c = squares.get(file + rank * files);
      if (c === undefined) empty++;
      else {
        if (empty) row += empty;
        row += c;
        empty = 0;
      }
    }
    if (empty) row += empty;
    rows.push(row);
  }
  const hand = pocket.length ? `[${pocket.join('')}]` : '';
  return `${rows.join('/')}${hand} ${rest}`;
}

/**
 * Whether a lone king of this colour, attacked by a rook, is in check. Some variants (Spartan) accept a FEN
 * without the king, so removal alone can't show the king is royal; Antichess's king is never in check.
 */
function kingGivesCheck(rules: Rules, variant: string, position: Position, king: 'K' | 'k'): boolean {
  const { files, ranks } = position;
  const bottomLeft = 0;
  const topLeft = (ranks - 1) * files;
  const squares =
    king === 'K'
      ? new Map([[bottomLeft, 'K'], [topLeft, 'r'], [files * ranks - 1, 'k']])
      : new Map([[topLeft, 'k'], [bottomLeft, 'R'], [files - 1, 'K']]);
  const fen = buildFen({ files, ranks, squares, pocket: [] }, king === 'K' ? 'w - - 0 1' : 'b - - 0 1');
  if (!rules.validateFen(variant, fen)) return false;
  const game = rules.newGame(variant, fen);
  try {
    return game.inCheck();
  } finally {
    game.dispose();
  }
}

/**
 * The piece letters the variant treats as royal: those whose removal from the start position makes the FEN
 * invalid. With `perColour` each result is the exact FEN character ('K' and 'k' are separate, so a variant
 * can be royal for one side only) and a king the engine lets you remove still counts as royal when it can be
 * put in check; otherwise results are lowercase and removal takes both cases.
 */
export function royalLetters(rules: Rules, variant: string, perColour: boolean): string[] {
  const start = rules.newGame(variant);
  const startFen = start.fen();
  start.dispose();
  const position = parseFen(startFen);
  const chars = [...new Set([...position.squares.values()].map((c) => (perColour ? c : c.toLowerCase())))];
  return chars.filter((ch) => {
    const kept = new Map([...position.squares].filter(([, c]) => (perColour ? c !== ch : c.toLowerCase() !== ch)));
    if (!rules.validateFen(variant, buildFen({ ...position, squares: kept }))) return true;
    return perColour && (ch === 'K' || ch === 'k') && kingGivesCheck(rules, variant, position, ch);
  });
}
