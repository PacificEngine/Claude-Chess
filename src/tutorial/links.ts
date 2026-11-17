// "Learn this piece": the lesson a piece links to, from the editor palette, the game's panel and the variant
// pages. Pure lookups over the lessons' `teaches`: no DOM or UI imports.
import type { ActiveVariant } from '../variants/active';
import type { VariantId } from '../variants/catalog';
import { INHERITED } from '../variants/piece-types';
import { LESSONS } from './content';
import type { Lesson } from './lesson';

/** The id of the lesson that teaches the built-in `type`, or null when none does yet. */
export function lessonForType(type: string, lessons: readonly Lesson[] = LESSONS): string | null {
  return lessons.find((l) => l.teaches.some((t) => 'type' in t && t.type === type))?.id ?? null;
}

/** The id of the lesson that teaches a curated variant's own `letter` (one no built-in type moves like), or null. */
export function lessonForLetter(variant: VariantId, letter: string, lessons: readonly Lesson[] = LESSONS): string | null {
  const l = letter.toLowerCase();
  return lessons.find((x) => x.teaches.some((t) => 'variant' in t && t.variant === variant && t.letter === l))?.id ?? null;
}

/**
 * The id of the lesson for `letter` in `v`, or null when it has none. `types` is the letter-to-type map
 * (`typesOfVariant`) of a curated variant; a custom variant's own `setup.pieces` comes first. In order: a
 * designed letter has none; a built-in type gives the lesson teaching that type; a letter the base variant
 * defines itself (inherited) gives the lesson teaching that variant's letter.
 */
export function lessonFor(v: ActiveVariant, letter: string, types: Map<string, string>, lessons: readonly Lesson[] = LESSONS): string | null {
  const l = letter.toLowerCase();
  if (v.setup?.designed?.[l]) return null;
  const type = v.setup?.pieces[l] ?? types.get(l);
  if (type === undefined) return null;
  return type === INHERITED ? lessonForLetter(v.artBase, l, lessons) : lessonForType(type, lessons);
}
