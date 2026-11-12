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
}

// Taken from the PieceMap in Fairy-Stockfish src/piece.cpp at the bundled engine commit (b2e693ef), in the
// same order. `immobile` (Betza "") is left out: it can never move, so it's not a playable piece.
export const BUILTIN_PIECES: readonly PieceType[] = [
  { type: 'pawn', name: 'Pawn', letter: 'p', royal: false },
  { type: 'knight', name: 'Knight', letter: 'n', royal: false },
  { type: 'bishop', name: 'Bishop', letter: 'b', royal: false },
  { type: 'rook', name: 'Rook', letter: 'r', royal: false },
  { type: 'queen', name: 'Queen', letter: 'q', royal: false },
  { type: 'fers', name: 'Fers', letter: 'f', royal: false },
  { type: 'alfil', name: 'Alfil', letter: 'e', royal: false },
  { type: 'fersAlfil', name: 'Fers-Alfil', letter: 'e', royal: false },
  { type: 'silver', name: 'Silver General', letter: 's', royal: false },
  { type: 'aiwok', name: 'Aiwok', letter: 'a', royal: false },
  { type: 'bers', name: 'Bers', letter: 'd', royal: false },
  { type: 'archbishop', name: 'Archbishop', letter: 'a', royal: false },
  { type: 'chancellor', name: 'Chancellor', letter: 'c', royal: false },
  { type: 'amazon', name: 'Amazon', letter: 'a', royal: false },
  { type: 'knibis', name: 'Knibis', letter: 'n', royal: false },
  { type: 'biskni', name: 'Biskni', letter: 'b', royal: false },
  { type: 'kniroo', name: 'Kniroo', letter: 'n', royal: false },
  { type: 'rookni', name: 'Rookni', letter: 'r', royal: false },
  { type: 'shogiPawn', name: 'Shogi Pawn', letter: 'p', royal: false },
  { type: 'lance', name: 'Lance', letter: 'l', royal: false },
  { type: 'shogiKnight', name: 'Shogi Knight', letter: 'n', royal: false },
  { type: 'gold', name: 'Gold General', letter: 'g', royal: false },
  { type: 'dragonHorse', name: 'Dragon Horse', letter: 'h', royal: false },
  { type: 'clobber', name: 'Clobber Piece', letter: 'p', royal: false },
  { type: 'breakthrough', name: 'Breakthrough Piece', letter: 'p', royal: false },
  { type: 'cannon', name: 'Cannon', letter: 'c', royal: false },
  { type: 'janggiCannon', name: 'Janggi Cannon', letter: 'c', royal: false },
  { type: 'soldier', name: 'Soldier', letter: 'p', royal: false },
  { type: 'horse', name: 'Horse', letter: 'n', royal: false },
  { type: 'elephant', name: 'Elephant', letter: 'b', royal: false },
  { type: 'janggiElephant', name: 'Janggi Elephant', letter: 'b', royal: false },
  { type: 'banner', name: 'Banner', letter: 'm', royal: false },
  { type: 'wazir', name: 'Wazir', letter: 'w', royal: false },
  // 'k' would replace the king in a chess-based variant, so the commoner takes the 'm' ("man") FSF also uses.
  { type: 'commoner', name: 'Commoner', letter: 'm', royal: false },
  { type: 'centaur', name: 'Centaur', letter: 'c', royal: false },
  { type: 'king', name: 'King', letter: 'k', royal: true },
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

interface Geometry {
  center: number;
  whiteCorner: number;
  blackCorner: number;
  box: number[];
}

/**
 * Picks a central square whose 5x5 box stays two squares clear of the corner kings, and from which no
 * rook or bishop line reaches either corner, so the probed piece never gives check or is blocked by a king.
 */
function probeGeometry(files: number, ranks: number): Geometry {
  const whiteCorner = { f: 0, r: 0 };
  const blackCorner = { f: files - 1, r: ranks - 1 };
  const onLine = (a: { f: number; r: number }, b: { f: number; r: number }) =>
    a.f === b.f || a.r === b.r || Math.abs(a.f - b.f) === Math.abs(a.r - b.r);
  for (const f of [Math.floor((files - 1) / 2), Math.ceil((files - 1) / 2)]) {
    for (const r of [Math.ceil((ranks - 1) / 2), Math.floor((ranks - 1) / 2)]) {
      const c = { f, r };
      const clear = (k: { f: number; r: number }) => Math.max(Math.abs(k.f - f), Math.abs(k.r - r)) >= 4;
      if (onLine(c, whiteCorner) || onLine(c, blackCorner) || !clear(whiteCorner) || !clear(blackCorner)) continue;
      const box: number[] = [];
      for (let df = -2; df <= 2; df++) for (let dr = -2; dr <= 2; dr++) if (df || dr) box.push(f + df + (r + dr) * files);
      return { center: f + r * files, whiteCorner: 0, blackCorner: files * ranks - 1, box };
    }
  }
  throw new Error(`No probe square on a ${files}x${ranks} board`);
}

interface Setup {
  letter: string;
  cornerLetter: string | undefined;
  fillerLetter: string | undefined;
  kingAtCenter: boolean;
}

/** The probed piece's moves as offsets, on an empty board and then boxed in by enemy pieces. */
function measure(
  rules: Rules,
  variant: string,
  files: number,
  ranks: number,
  g: Geometry,
  s: Setup,
): string | undefined {
  const scene = (boxed: boolean): string | undefined => {
    const squares = new Map<number, string>([[g.center, s.letter.toUpperCase()]]);
    if (s.cornerLetter) {
      if (!s.kingAtCenter) squares.set(g.whiteCorner, s.cornerLetter.toUpperCase());
      squares.set(g.blackCorner, s.cornerLetter.toLowerCase());
    }
    if (boxed) {
      if (!s.fillerLetter) return 'none';
      for (const sq of g.box) squares.set(sq, s.fillerLetter.toLowerCase());
    }
    const fen = buildFen({ files, ranks, squares, pocket: [] });
    if (!rules.validateFen(variant, fen)) return undefined;
    const game = rules.newGame(variant, fen);
    try {
      const from = squareName(g.center, files);
      const offsets = game.legalMovesFrom(from).map((m) => {
        const to = /^[a-z]\d+([a-z])(\d+)/.exec(m);
        if (!to) throw new Error(`Unexpected move: ${m}`);
        const tf = to[1].charCodeAt(0) - 97;
        const tr = Number(to[2]) - 1;
        return `${tf - (g.center % files)},${tr - Math.floor(g.center / files)}`;
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
