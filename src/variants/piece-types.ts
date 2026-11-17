// Fairy-Stockfish's built-in piece types, for the editor palette and the variant generator. Pure data plus a
// rules-backed letter mapper: no DOM or UI imports.
import type { Rules } from '../rules/types';
import { buildFen, parseFen, royalLetters } from './fen';

export interface PieceType {
  /** The variants.ini option name, e.g. `fersAlfil = e`. */
  type: string;
  /** Plain-English display name. */
  name: string;
  /** The letter Fairy-Stockfish's own variants most often give this type. Letters can repeat across types. */
  letter: string;
  /** Only the king is royal. The commoner moves the same but can be captured like any piece. */
  royal: boolean;
  /**
   * The Betza the engine plays this type with, so a designed piece can combine with it. '' when Betza can't
   * describe how the engine plays it: the pawn's double step, en passant and promotion are pawn rules in
   * Fairy-Stockfish's code, so its "fmWfceF" alone would make a different piece.
   */
  betza: string;
}

// Taken from the PieceMap in Fairy-Stockfish src/piece.cpp at the bundled engine commit (b2e693ef), in the
// same order. `immobile` (Betza "") is left out: it can never move, so it's not a playable piece.
// The Betza strings come from piece.cpp at upstream 84e305ff (2023-08-26), the source of ffish's "230826"
// build. The janggi elephant's is the "nZ" its moves are built from, not the "mafsmafW" it reports to XBoard.
export const BUILTIN_PIECES: readonly PieceType[] = [
  { type: 'pawn', name: 'Pawn', letter: 'p', royal: false, betza: '' },
  { type: 'knight', name: 'Knight', letter: 'n', royal: false, betza: 'N' },
  { type: 'bishop', name: 'Bishop', letter: 'b', royal: false, betza: 'B' },
  { type: 'rook', name: 'Rook', letter: 'r', royal: false, betza: 'R' },
  { type: 'queen', name: 'Queen', letter: 'q', royal: false, betza: 'Q' },
  { type: 'fers', name: 'Fers', letter: 'f', royal: false, betza: 'F' },
  { type: 'alfil', name: 'Alfil', letter: 'e', royal: false, betza: 'A' },
  { type: 'fersAlfil', name: 'Fers-Alfil', letter: 'e', royal: false, betza: 'FA' },
  { type: 'silver', name: 'Silver General', letter: 's', royal: false, betza: 'FfW' },
  { type: 'aiwok', name: 'Aiwok', letter: 'a', royal: false, betza: 'RNF' },
  { type: 'bers', name: 'Bers', letter: 'd', royal: false, betza: 'RF' },
  { type: 'archbishop', name: 'Archbishop', letter: 'a', royal: false, betza: 'BN' },
  { type: 'chancellor', name: 'Chancellor', letter: 'c', royal: false, betza: 'RN' },
  { type: 'amazon', name: 'Amazon', letter: 'a', royal: false, betza: 'QN' },
  { type: 'knibis', name: 'Knibis', letter: 'n', royal: false, betza: 'mNcB' },
  { type: 'biskni', name: 'Biskni', letter: 'b', royal: false, betza: 'mBcN' },
  { type: 'kniroo', name: 'Kniroo', letter: 'n', royal: false, betza: 'mNcR' },
  { type: 'rookni', name: 'Rookni', letter: 'r', royal: false, betza: 'mRcN' },
  { type: 'shogiPawn', name: 'Shogi Pawn', letter: 'p', royal: false, betza: 'fW' },
  { type: 'lance', name: 'Lance', letter: 'l', royal: false, betza: 'fR' },
  { type: 'shogiKnight', name: 'Shogi Knight', letter: 'n', royal: false, betza: 'fN' },
  { type: 'gold', name: 'Gold General', letter: 'g', royal: false, betza: 'WfF' },
  { type: 'dragonHorse', name: 'Dragon Horse', letter: 'h', royal: false, betza: 'BW' },
  { type: 'clobber', name: 'Clobber Piece', letter: 'p', royal: false, betza: 'cW' },
  { type: 'breakthrough', name: 'Breakthrough Piece', letter: 'p', royal: false, betza: 'fmWfF' },
  { type: 'cannon', name: 'Cannon', letter: 'c', royal: false, betza: 'mRcpR' },
  { type: 'janggiCannon', name: 'Janggi Cannon', letter: 'c', royal: false, betza: 'pR' },
  { type: 'soldier', name: 'Soldier', letter: 'p', royal: false, betza: 'fsW' },
  { type: 'horse', name: 'Horse', letter: 'n', royal: false, betza: 'nN' },
  { type: 'elephant', name: 'Elephant', letter: 'b', royal: false, betza: 'nA' },
  { type: 'janggiElephant', name: 'Janggi Elephant', letter: 'b', royal: false, betza: 'nZ' },
  { type: 'banner', name: 'Banner', letter: 'm', royal: false, betza: 'RcpRnN' },
  { type: 'wazir', name: 'Wazir', letter: 'w', royal: false, betza: 'W' },
  // 'k' would replace the king in a chess-based variant, so the commoner takes the 'm' ("man") FSF also uses.
  { type: 'commoner', name: 'Commoner', letter: 'm', royal: false, betza: 'K' },
  { type: 'centaur', name: 'Centaur', letter: 'c', royal: false, betza: 'KN' },
  { type: 'king', name: 'King', letter: 'k', royal: true, betza: 'K' },
];

export function pieceTypeByName(type: string): PieceType {
  const found = BUILTIN_PIECES.find((p) => p.type === type);
  if (!found) throw new Error(`Unknown piece type: ${type}`);
  return found;
}

/** A letter whose movement matches no single built-in type: the base variant defines that piece itself. */
export const INHERITED = 'inherited';

/**
 * Maps each piece letter a variant uses (on the board or in hand at the start) to the built-in type that
 * moves the same way, or to 'inherited' when no single built-in type does.
 *
 * Fairy-Stockfish doesn't say which type a letter is, so this compares behaviour. Each letter is put, as
 * White, on a central square of an otherwise empty board of the variant's size, and its legal moves are
 * recorded as offsets. Then the 5x5 box around it is filled with Black pawns and its moves are recorded
 * again: that shows captures, hurdles and lame legs, which tell apart pieces that look alike on an empty
 * board (knight, horse, knibis, kniroo). Each built-in type is measured the same way in a probe variant.
 * Pawn-like pieces need no special case: they're measured only as White from a central rank, so no double
 * step or promotion applies, and the forward-only and capture-only moves are part of the offsets.
 *
 * Every measurement is taken twice, on two squares that mirror each other through the board's centre, one
 * on each side of its middle rank or file. A letter matches a type only when it moves like it on both. That
 * keeps out pieces whose moves depend on where they stand: Xiangqi's general and advisor can't move outside
 * the palace, and its elephant and soldier move differently on each side of the river, so all four come out
 * 'inherited' by measurement. They are not measured inside the palace on purpose: there the advisor would pass
 * for the fers, yet the palace is part of how it moves, and no built-in type keeps a piece in one.
 *
 * Royal letters are found first: removing every copy of a royal letter makes the FEN invalid. A royal
 * letter is compared only with the king, and other letters only with the non-royal types.
 */
export function typesOfVariant(rules: Rules, engineName: string): Map<string, string> {
  const start = rules.newGame(engineName);
  const startFen = start.fen();
  start.dispose();

  const position = parseFen(startFen);
  const { files, ranks } = position;
  const geometry = probeGeometry(files, ranks);
  const builtins = builtinSignatures(rules, files, ranks, geometry);

  const letters = [...new Set([...position.squares.values(), ...position.pocket].map((c) => c.toLowerCase()))];
  const royal = rules.validateFen(engineName, buildFen(position)) ? royalLetters(rules, engineName, false) : [];
  // Corner pieces only stand in for the kings; any letter works where there's no royal piece (antichess).
  const cornerLetter = royal[0] ?? (letters.includes('k') ? 'k' : undefined);
  const fillerLetter = letters.includes('p') ? 'p' : undefined;

  const result = new Map<string, string>();
  for (const letter of letters) {
    const isKing = royal.includes(letter);
    const signature = measure(rules, engineName, files, ranks, geometry, {
      letter,
      cornerLetter: isKing ? letter : cornerLetter,
      fillerLetter,
      kingAtCenter: isKing,
    });
    const candidates = BUILTIN_PIECES.filter((p) => p.royal === isKing && builtins.get(p.type) === signature);
    result.set(letter, signature !== undefined && candidates.length === 1 ? candidates[0].type : INHERITED);
  }
  return result;
}

interface Probe {
  center: number;
  box: number[];
}

interface Geometry {
  /** Two probe squares, each the other's mirror image through the board's centre. */
  probes: [Probe, Probe];
  whiteCorner: number;
  blackCorner: number;
}

/**
 * Picks the square nearest the centre whose 5x5 box fits on the board and stays two squares clear of the
 * corner kings, and from which no rook or bishop line reaches either corner, so the probed piece never gives
 * check or is blocked by a king. Its mirror image through the centre is the second probe square: swapping
 * the corners maps one onto the other, so it meets the same conditions. The tie-break keeps the first square
 * on 8x8, 10x8 and 10x10 at d5, e4 and e6.
 */
export function probeGeometry(files: number, ranks: number): Geometry {
  const whiteCorner = { f: 0, r: 0 };
  const blackCorner = { f: files - 1, r: ranks - 1 };
  const onLine = (a: { f: number; r: number }, b: { f: number; r: number }) =>
    a.f === b.f || a.r === b.r || Math.abs(a.f - b.f) === Math.abs(a.r - b.r);
  const mid = { f: (files - 1) / 2, r: (ranks - 1) / 2 };
  const distance = ({ f, r }: { f: number; r: number }) => (f - mid.f) ** 2 + (r - mid.r) ** 2;
  const squares: { f: number; r: number }[] = [];
  for (let f = 2; f <= files - 3; f++) for (let r = 2; r <= ranks - 3; r++) squares.push({ f, r });
  // Nearest first; among equals, the lower file and then the higher rank.
  squares.sort((a, b) => distance(a) - distance(b) || a.f - b.f || b.r - a.r);
  const probe = ({ f, r }: { f: number; r: number }): Probe => {
    const box: number[] = [];
    for (let df = -2; df <= 2; df++) for (let dr = -2; dr <= 2; dr++) if (df || dr) box.push(f + df + (r + dr) * files);
    return { center: f + r * files, box };
  };
  for (const c of squares) {
    const clear = (k: { f: number; r: number }) => Math.max(Math.abs(k.f - c.f), Math.abs(k.r - c.r)) >= 4;
    if (onLine(c, whiteCorner) || onLine(c, blackCorner) || !clear(whiteCorner) || !clear(blackCorner)) continue;
    const mirror = { f: files - 1 - c.f, r: ranks - 1 - c.r };
    return { probes: [probe(c), probe(mirror)], whiteCorner: 0, blackCorner: files * ranks - 1 };
  }
  throw new Error(`No probe square on a ${files}x${ranks} board`);
}

interface Setup {
  letter: string;
  cornerLetter: string | undefined;
  fillerLetter: string | undefined;
  kingAtCenter: boolean;
}

/** The probed piece's moves as offsets, on an empty board and then boxed in, on each probe square. */
function measure(
  rules: Rules,
  variant: string,
  files: number,
  ranks: number,
  g: Geometry,
  s: Setup,
): string | undefined {
  const [a, b] = g.probes.map((p) => measureAt(rules, variant, files, ranks, g, p, s));
  return a === undefined || b === undefined ? undefined : `${a} || ${b}`;
}

/** The probed piece's moves as offsets from one probe square, on an empty board and then boxed in. */
function measureAt(
  rules: Rules,
  variant: string,
  files: number,
  ranks: number,
  g: Geometry,
  p: Probe,
  s: Setup,
): string | undefined {
  const scene = (boxed: boolean): string | undefined => {
    const squares = new Map<number, string>([[p.center, s.letter.toUpperCase()]]);
    if (s.cornerLetter) {
      if (!s.kingAtCenter) squares.set(g.whiteCorner, s.cornerLetter.toUpperCase());
      squares.set(g.blackCorner, s.cornerLetter.toLowerCase());
    }
    if (boxed) {
      // A boxed-in king's moves depend on what the filler attacks (a Shogi pawn attacks straight ahead, a chess
      // pawn diagonally), and a royal letter is only ever compared with the king, so it is measured unboxed.
      if (!s.fillerLetter || s.kingAtCenter) return 'none';
      for (const sq of p.box) squares.set(sq, s.fillerLetter.toLowerCase());
    }
    const fen = buildFen({ files, ranks, squares, pocket: [] });
    if (!rules.validateFen(variant, fen)) return undefined;
    const game = rules.newGame(variant, fen);
    try {
      const from = squareName(p.center, files);
      const offsets = game.legalMovesFrom(from).map((m) => {
        const to = /^[a-z]\d+([a-z])(\d+)/.exec(m);
        if (!to) throw new Error(`Unexpected move: ${m}`);
        const tf = to[1].charCodeAt(0) - 97;
        const tr = Number(to[2]) - 1;
        return `${tf - (p.center % files)},${tr - Math.floor(p.center / files)}`;
      });
      return [...new Set(offsets)].sort().join(' ');
    } finally {
      game.dispose();
    }
  };
  const open = scene(false);
  const boxed = scene(true);
  return open === undefined || boxed === undefined ? undefined : `${open} | ${boxed}`;
}

function squareName(index: number, files: number): string {
  return String.fromCharCode(97 + (index % files)) + (Math.floor(index / files) + 1);
}

const signatureCache = new WeakMap<Rules, Map<string, Map<string, string | undefined>>>();

/**
 * Each built-in type's signature on a board of this size. The probe variants are loaded once per Rules
 * and board size: ffish refuses to redefine a variant name, and an identical reload would be refused anyway.
 */
function builtinSignatures(rules: Rules, files: number, ranks: number, g: Geometry): Map<string, string | undefined> {
  const size = `${files}x${ranks}`;
  let bySize = signatureCache.get(rules);
  if (!bySize) signatureCache.set(rules, (bySize = new Map()));
  const cached = bySize.get(size);
  if (cached) return cached;

  // The probed type goes on 'z', which chess doesn't use, so the pawn filler and the king stay as they are.
  const letterOf = (p: PieceType) => (p.type === 'pawn' || p.type === 'king' ? p.letter : 'z');
  const nameOf = (p: PieceType) => `builtin_${p.type}_${size}`;
  const maxFile = String.fromCharCode(96 + files);
  rules.loadConfig(
    BUILTIN_PIECES.map(
      (p) =>
        `[${nameOf(p)}:chess]\nmaxFile = ${maxFile}\nmaxRank = ${ranks}\n` +
        (letterOf(p) === 'z' ? `${p.type} = z\n` : ''),
    ).join('\n'),
  );
  const signatures = new Map(
    BUILTIN_PIECES.map((p) => [
      p.type,
      measure(rules, nameOf(p), files, ranks, g, {
        letter: letterOf(p),
        cornerLetter: 'k',
        fillerLetter: 'p',
        kingAtCenter: p.royal,
      }),
    ]),
  );
  bySize.set(size, signatures);
  return signatures;
}
