// The variant a game is played in: a curated one, or a custom one generated from an editor setup. The board,
// pieces and panel read this instead of the catalog, so they work for both. No DOM or UI imports.
import type { Rules } from '../rules/types';
import { type VariantId, variantById } from './catalog';
import { parseFen } from './fen';
import type { ActiveVariantShape } from './generator';
import { INHERITED, typesOfVariant } from './piece-types';
import type { SetupSpec } from './setup';

export interface ActiveVariant extends ActiveVariantShape {
  /** The name ffish and Fairy-Stockfish know the variant by: curated, or a generated `cx_<hash>`. */
  engineName: string;
  label: string;
  files: number;
  ranks: number;
  /** Whether the start position has pieces in hand, drawn as pockets beside the board. */
  pockets: boolean;
  /** The curated variant whose piece art (and promotion and gating names) the pieces use. */
  artBase: VariantId;
  /** Lowercase piece letters of the start position, on the board and in hand. */
  letters: string[];
  castling: boolean;
  /** The editor setup a custom variant was generated from; null for a curated variant. */
  setup: SetupSpec | null;
  /** A custom variant's base letter-to-type map (`typesOfVariant`), for drawing; null for a curated variant. */
  baseTypes: Map<string, string> | null;
}

const typesCache = new WeakMap<Rules, Map<string, Map<string, string>>>();

/** `typesOfVariant` once per Rules and variant: the first call per board size takes about a second. */
export function variantTypes(rules: Rules, engineName: string): Map<string, string> {
  let byName = typesCache.get(rules);
  if (!byName) typesCache.set(rules, (byName = new Map()));
  let types = byName.get(engineName);
  if (!types) byName.set(engineName, (types = typesOfVariant(rules, engineName)));
  return types;
}

function lettersOf(fen: string): string[] {
  const { squares, pocket } = parseFen(fen);
  return [...new Set([...squares.values(), ...pocket].map((c) => c.toLowerCase()))];
}

const hasPocket = (fen: string): boolean => /\[/.test(fen.split(' ')[0] ?? '');

export function curatedActive(id: VariantId, rules: Rules): ActiveVariant {
  const info = variantById(id);
  const game = rules.newGame(info.engineName);
  const fen = game.fen();
  game.dispose();
  return {
    engineName: info.engineName,
    label: info.label,
    files: info.files,
    ranks: info.ranks,
    pockets: hasPocket(fen),
    artBase: id,
    letters: lettersOf(fen),
    // The start FEN's castling field: '-' when the variant has no castling (Grand, Antichess).
    castling: (fen.split(' ')[2] ?? '-') !== '-',
    // Only the editor needs the types, so the board isn't kept waiting for the probe variants.
    get types() {
      return variantTypes(rules, info.engineName);
    },
    setup: null,
    baseTypes: null,
  };
}

/**
 * `name` is the generated variant name for `spec` (`generateVariant(spec).name`); `baseTypes` is the base
 * variant's letter-to-type map (`variantTypes`).
 */
export function customActive(spec: SetupSpec, name: string, baseTypes: Map<string, string>): ActiveVariant {
  return {
    engineName: name,
    label: `Custom (based on ${variantById(spec.base).label})`,
    files: spec.files,
    ranks: spec.ranks,
    pockets: hasPocket(spec.fen),
    artBase: spec.base,
    letters: lettersOf(spec.fen),
    castling: spec.castling,
    types: new Map(Object.entries(spec.pieces)),
    setup: spec,
    baseTypes,
  };
}

/**
 * The built-in type to draw a custom variant's letter as, or undefined to use the base variant's art: a
 * letter the base doesn't define, or gives another type, looks like what it moves like; a base letter that
 * keeps the base's type keeps the base's own art (Seirawan's hawk, Spartan's warlord).
 */
export function artTypeOf(v: ActiveVariant, letter: string): string | undefined {
  const type = v.setup?.pieces[letter];
  if (type === undefined || type === INHERITED) return undefined;
  return v.baseTypes?.get(letter) === type ? undefined : type;
}
