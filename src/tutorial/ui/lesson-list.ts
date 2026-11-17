// The lesson list: its own page of cards, grouped by track (Chess basics, Fairy pieces, Variants), each ticked
// once its lesson or variant page is finished. A look-alike has a card per name, and each opens the shared lesson.
// Card names come from the content files and are set with textContent only.
import { cardsByTrack, type LessonCard } from '../content';
import type { Track } from '../lesson';

export const TRACK_NAMES: Record<Track | 'variants', string> = {
  basics: 'Chess basics',
  fairy: 'Fairy pieces',
  variants: 'Variants',
};
const TRACKS = ['basics', 'fairy', 'variants'] as const;

export interface LessonListHandlers {
  /** A lesson id, or a variant page id. */
  open(id: string): void;
  /** Back to game: closes the tutorial. */
  back(): void;
}

export interface LessonList {
  /** Shows the list, each card ticked when `isFinished` says so. */
  show(isFinished: (id: string) => boolean): void;
  hide(): void;
}

export function createLessonList(host: HTMLElement, handlers: LessonListHandlers): LessonList {
  const page = document.createElement('div');
  page.className = 'lesson-list';
  page.dataset.testid = 'lesson-list';
  page.hidden = true;
  const header = document.createElement('div');
  header.className = 'lesson-list-header';
  const title = document.createElement('h2');
  title.textContent = 'Tutorial';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'secondary';
  back.textContent = 'Back to game';
  back.dataset.testid = 'lesson-list-back';
  back.addEventListener('click', () => handlers.back());
  header.append(title, back);
  page.append(header);

  const cards: { el: HTMLButtonElement; card: LessonCard }[] = [];
  for (const track of TRACKS) {
    const group = document.createElement('section');
    group.className = 'lesson-track-group';
    group.dataset.testid = `track-${track}`;
    const heading = document.createElement('h3');
    heading.textContent = TRACK_NAMES[track];
    const grid = document.createElement('div');
    grid.className = 'lesson-cards';
    for (const card of cardsByTrack(track)) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'lesson-card';
      el.dataset.testid = `card-${card.lessonId}-${card.name}`;
      const name = document.createElement('span');
      name.textContent = card.name;
      const tick = document.createElement('span');
      tick.className = 'lesson-card-tick';
      tick.setAttribute('aria-hidden', 'true');
      tick.textContent = '✓';
      el.append(name, tick);
      el.addEventListener('click', () => handlers.open(card.lessonId));
      grid.append(el);
      cards.push({ el, card });
    }
    group.append(heading, grid);
    page.append(group);
  }
  host.append(page);

  return {
    show(isFinished) {
      for (const { el, card } of cards) {
        const finished = isFinished(card.lessonId);
        el.dataset.finished = String(finished);
        el.setAttribute('aria-label', finished ? `${card.name} (finished)` : card.name);
      }
      page.hidden = false;
    },
    hide() {
      page.hidden = true;
    },
  };
}
