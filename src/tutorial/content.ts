// Every lesson and variant page, loaded from the JSON files under ./content. Adding or fixing a lesson is a
// JSON change there only. No DOM or UI imports.
import { variantById } from '../variants/catalog';
import { isLesson, isVariantPage, type Lesson, type Track, type VariantPage } from './lesson';

export interface LessonCard {
  name: string;
  lessonId: string;
}

const VARIANT_FILE = /^\.\/content\/variants\/[^/]+\.json$/;

/**
 * Lessons and variant pages from content files keyed by path: `variants/*.json` files are variant pages and
 * every other file is a lesson. Throws on a file that fails its guard, naming the file, or on a repeated id.
 */
export function loadContent(files: Record<string, unknown>): { lessons: Lesson[]; pages: VariantPage[] } {
  const lessons: Lesson[] = [];
  const pages: VariantPage[] = [];
  for (const path of Object.keys(files).sort()) {
    const data = files[path];
    if (VARIANT_FILE.test(path)) {
      if (!isVariantPage(data)) throw new Error(`Tutorial content ${path} is not a valid variant page`);
      pages.push(data);
    } else {
      if (!isLesson(data)) throw new Error(`Tutorial content ${path} is not a valid lesson`);
      lessons.push(data);
    }
  }
  for (const list of [lessons, pages]) {
    const ids = list.map((item) => item.id);
    const repeated = ids.find((id, i) => ids.indexOf(id) !== i);
    if (repeated !== undefined) throw new Error(`Tutorial content has two files with the id ${repeated}`);
  }
  return { lessons, pages };
}

const CONTENT = loadContent(import.meta.glob('./content/**/*.json', { eager: true, import: 'default' }));
export const LESSONS: readonly Lesson[] = CONTENT.lessons;
export const VARIANT_PAGES: readonly VariantPage[] = CONTENT.pages;

export const lessonById = (id: string): Lesson | undefined => LESSONS.find((l) => l.id === id);

/**
 * The cards of a track, sorted by order (a card's own, else its lesson's) and then by name: one per lesson
 * card in that track (a look-alike's card opens the shared lesson), or one per variant page, named by its
 * variant.
 */
export function cardsOf(lessons: readonly Lesson[], pages: readonly VariantPage[], track: Track | 'variants'): LessonCard[] {
  const cards =
    track === 'variants'
      ? pages.map((p) => ({ order: p.order, name: variantById(p.variant).label, lessonId: p.id }))
      : lessons.flatMap((l) =>
          l.cards.filter((c) => c.track === track).map((c) => ({ order: c.order ?? l.order, name: c.name, lessonId: l.id })),
        );
  return cards
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map(({ name, lessonId }) => ({ name, lessonId }));
}

export const cardsByTrack = (track: Track | 'variants'): LessonCard[] => cardsOf(LESSONS, VARIANT_PAGES, track);

/**
 * The lesson after `id` in the lesson list of its own track, or null after the last. A lesson with several
 * cards there counts once, at its first card. Cards of another track's lesson (the King lesson's Commoner card
 * among the fairy pieces) are passed over, so Next never jumps to another track.
 */
export function nextLessonOf(lessons: readonly Lesson[], id: string): string | null {
  const track = lessons.find((l) => l.id === id)?.track;
  if (track === undefined) return null;
  const ids = [...new Set(cardsOf(lessons, [], track).map((c) => c.lessonId))].filter(
    (lessonId) => lessons.find((l) => l.id === lessonId)?.track === track,
  );
  return ids[ids.indexOf(id) + 1] ?? null;
}
