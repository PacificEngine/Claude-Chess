// Turns an editor setup into one Fairy-Stockfish variants.ini section. Pure: no ffish, DOM or UI imports.
// Option names follow src/parser.cpp at upstream commit 84e305ff (2023-08-26), the engine ffish-es6@0.7.10
// reports as "Fairy-Stockfish 230826".
import { variantById } from './catalog';
import { INHERITED, pieceTypeByName } from './piece-types';
import { MAX_FILES, MAX_RANKS, MIN_FILES, MIN_RANKS, type SetupSpec } from './setup';

/** What needsCustomVariant needs to know about the variant the setup started from. */
export interface ActiveVariantShape {
  files: number;
  ranks: number;
  letters: string[];
  castling: boolean;
  /** Letter to built-in type or 'inherited', as `typesOfVariant` returns. */
  types: Map<string, string>;
}

// Anything else (newline, '[', ']', '=', ';') could end the value or start another line or section.
const SAFE_VALUE = /^[A-Za-z0-9_*~+ /-]*$/;
const LETTER = /^[a-z]$/;
// A FEN is checked on its own: board placement, then at most one pocket of letters (`[HEhe]`, maybe empty),
// then the space-separated fields. No newline, '=', ';' or any other '[' or ']' can get through.
const SAFE_FEN = /^[A-Za-z0-9/~+*]+(?:\[[A-Za-z]*\])?(?: [A-Za-z0-9/~+*_ -]+)?$/;

function safe(value: string, what: string): string {
  if (!SAFE_VALUE.test(value)) throw new Error(`Unsafe ${what} for a variant definition: ${JSON.stringify(value)}`);
  return value;
}

function checkSize(n: number, min: number, max: number, what: string): void {
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${what} must be ${min} to ${max}, not ${n}`);
}

/** 32-bit FNV-1a over UTF-16 code units; every body is ASCII, so that's the same as over bytes. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/**
 * `baseTypes` is the base variant's letter-to-type map (`typesOfVariant`). When given, the setup may not
 * give a base letter a different type: the engine would silently evict the base's piece for that letter.
 *
 * Only the options below are written. Every other rule (e.g. Grand's promotionLimit) is inherited on purpose.
 */
export function generateVariant(spec: SetupSpec, baseTypes?: Map<string, string>): { name: string; ini: string } {
  const base = variantById(spec.base);
  checkSize(spec.files, MIN_FILES, MAX_FILES, 'Files');
  checkSize(spec.ranks, MIN_RANKS, MAX_RANKS, 'Ranks');

  // Sorted so the body, and therefore the name, doesn't depend on the order the editor added pieces in.
  const letters = Object.keys(spec.pieces).sort();
  const pieceLines: string[] = [];
  for (const letter of letters) {
    if (!LETTER.test(letter)) throw new Error(`Piece letters must be one lowercase letter: ${JSON.stringify(letter)}`);
    const type = spec.pieces[letter];
    checkBaseLetter(letter, type, baseTypes);
    if (type === INHERITED) continue; // the base variant already defines this letter
    pieceLines.push(`${safe(pieceTypeByName(type).type, 'piece type')} = ${letter}`);
  }

  // The engine keeps a type on one letter only: a later line moves it, and the earlier letter is lost.
  const byType = new Map<string, string[]>();
  for (const letter of letters) {
    const type = spec.pieces[letter];
    if (type !== INHERITED) byType.set(type, [...(byType.get(type) ?? []), letter]);
  }
  for (const [type, shared] of byType) {
    if (shared.length > 1) throw new Error(`The letters ${shared.join(', ')} are all the piece type ${type}`);
  }

  const promotion = [...new Set(spec.promotion.pieceTypes)].sort();
  for (const letter of promotion) {
    if (!LETTER.test(letter) || !(letter in spec.pieces)) throw new Error(`Promotion to a piece not in the setup: ${letter}`);
    const type = spec.pieces[letter];
    if (type !== INHERITED && pieceTypeByName(type).royal) throw new Error(`Pawns cannot promote to a ${type}`);
    if (type === 'pawn') throw new Error('Pawns cannot promote to a pawn');
  }
  if (spec.promotion.rank !== 'last') throw new Error(`Unsupported promotion rank: ${String(spec.promotion.rank)}`);
  if (typeof spec.castling !== 'boolean') throw new Error('Castling must be true or false');

  // Only the FEN's shape is checked here; its legality is checked later (Task 4).
  const fen = spec.fen;
  if (!SAFE_FEN.test(fen)) throw new Error(`Unsafe FEN for a variant definition: ${JSON.stringify(fen)}`);

  const body = [
    `maxFile = ${String.fromCharCode(96 + spec.files)}`,
    `maxRank = ${spec.ranks}`,
    ...pieceLines,
    `castling = ${spec.castling}`,
    // promotionRank is deprecated at this engine version; a region of '*<rank>' is the whole rank.
    `promotionRegionWhite = *${spec.ranks}`,
    'promotionRegionBlack = *1',
    // '-' is the engine's empty piece set; an empty value would be reported as an invalid piece type.
    `promotionPieceTypes = ${promotion.join('') || '-'}`,
    // Every letter of the setup, so `check` never reports "Missing piece type". Only XBoard reads the
    // table's layout, and the app never talks to XBoard.
    `pieceToCharTable = ${letters.join('').toUpperCase()}${letters.join('')}`,
    `startFen = ${fen}`,
  ]
    .map((line) => `${line}\n`)
    .join('');

  // The parent is hashed too: the same body on another base is another variant, and ffish would keep
  // whichever definition of a name it saw first.
  const parent = safe(base.engineName, 'base variant');
  const name = `cx_${fnv1a(`${parent}\n${body}`)}`;
  return { name, ini: `[${name}:${parent}]\n${body}` };
}

function checkBaseLetter(letter: string, type: string, baseTypes: Map<string, string> | undefined): void {
  if (!baseTypes) return;
  const baseType = baseTypes.get(letter);
  if (baseType === undefined) {
    if (type === INHERITED) throw new Error(`The letter ${letter} is not a letter the base variant defines`);
  } else if (type !== baseType) {
    throw new Error(
      baseType === INHERITED
        ? `The letter ${letter} is the base variant's own piece, not ${type}`
        : `The letter ${letter} is the base variant's ${baseType}, not ${type}`,
    );
  }
}

/**
 * False when only the position differs from the base variant, so the curated variant can be played from
 * the setup's FEN. The shape carries no promotion rules, so the setup's promotion counts as the base's when
 * it is to every base letter that isn't a king, a pawn or 'k': what the custom-setup default gives for the base.
 */
export function needsCustomVariant(spec: SetupSpec, base: ActiveVariantShape): boolean {
  const letters = Object.keys(spec.pieces);
  const baseLetters = new Set(base.letters.map((l) => l.toLowerCase()));
  // A letter the setup doesn't map, or maps to 'inherited', has the base's own type.
  const typeOf = (l: string) => (spec.pieces[l] && spec.pieces[l] !== INHERITED ? spec.pieces[l] : base.types.get(l));
  // 'k' is never a promotion target, even where it maps to a commoner (Spartan's kings, Antichess).
  const basePromotion = [...baseLetters].filter((l) => l !== 'k' && !['king', 'pawn'].includes(typeOf(l) ?? '')).sort();
  const promotion = [...new Set(spec.promotion.pieceTypes)].sort();
  return (
    spec.files !== base.files ||
    spec.ranks !== base.ranks ||
    letters.some((l) => !baseLetters.has(l)) ||
    letters.some((l) => spec.pieces[l] !== INHERITED && spec.pieces[l] !== base.types.get(l)) ||
    spec.castling !== base.castling ||
    spec.promotion.rank !== 'last' ||
    promotion.join() !== basePromotion.join()
  );
}
