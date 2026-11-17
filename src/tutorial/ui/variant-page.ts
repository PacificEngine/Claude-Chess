// A curated variant's page: how it differs from chess, its starting position (read-only), its pieces (each
// with a lesson a link to it), and Play this variant. Page text comes from the content files and the catalog,
// and is set with textContent only.
import type { Rules } from '../../rules/types';
import { createBoardView } from '../../ui/board-view';
import { pieceName } from '../../ui/choice-dialog';
import { curatedActive } from '../../variants/active';
import { type VariantId, variantById } from '../../variants/catalog';
import type { VariantPage } from '../lesson';
import { lessonFor } from '../links';

export interface VariantPageHandlers {
  play(id: VariantId): void;
  /** Opens the lesson `lessonId` ("Learn this piece"). */
  learn(lessonId: string): void;
  /** All lessons: back to the lesson list. */
  all(): void;
}

export interface VariantPageView {
  show(page: VariantPage): void;
  hide(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, testid?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = className;
  if (testid) e.dataset.testid = testid;
  return e;
};

export function createVariantPage(host: HTMLElement, rules: Rules, handlers: VariantPageHandlers): VariantPageView {
  const section = el('div', 'variant-page layout', 'variant-page');
  section.hidden = true;
  const boardHost = el('div', '');
  const panel = el('aside', 'lesson-panel');
  const track = el('div', 'lesson-track');
  track.textContent = 'Variants';
  const title = el('h2', 'lesson-title', 'variant-title');
  const blurb = el('p', 'lesson-instruction', 'variant-blurb');
  const differences = el('ul', 'variant-differences', 'variant-differences');
  const piecesHeading = el('h3', 'lesson-heading');
  piecesHeading.textContent = 'Pieces';
  const pieces = el('ul', 'variant-pieces', 'variant-pieces');
  const play = el('button', '', 'variant-play');
  play.type = 'button';
  play.textContent = 'Play this variant';
  const all = el('button', 'secondary', 'variant-all');
  all.type = 'button';
  all.textContent = 'All lessons';
  panel.append(track, title, blurb, differences, piecesHeading, pieces, play, all);
  section.append(boardHost, panel);
  host.append(section);
  const board = createBoardView(boardHost);
  boardHost.dataset.testid = 'variant-board';

  let shown: VariantId = 'chess';
  play.addEventListener('click', () => handlers.play(shown));
  all.addEventListener('click', () => handlers.all());

  return {
    show(page) {
      shown = page.variant;
      const info = variantById(page.variant);
      title.textContent = info.label;
      blurb.textContent = info.blurb;
      differences.replaceChildren(
        ...page.differences.map((text) => {
          const li = document.createElement('li');
          li.textContent = text;
          return li;
        }),
      );
      const variant = curatedActive(page.variant, rules);
      const game = rules.newGame(variant.engineName);
      const fen = game.fen();
      game.dispose();
      // One per letter in the start position (on the board or in hand); a piece with a lesson links to it.
      pieces.replaceChildren(
        ...variant.letters.map((letter) => {
          const li = document.createElement('li');
          li.dataset.letter = letter;
          const name = pieceName(page.variant, letter);
          const lessonId = lessonFor(variant, letter, variant.types);
          if (lessonId) {
            const link = document.createElement('button');
            link.type = 'button';
            link.className = 'link';
            link.textContent = name;
            link.title = `Learn the ${name}`;
            link.addEventListener('click', () => handlers.learn(lessonId));
            li.append(link);
          } else li.textContent = name;
          return li;
        }),
      );
      section.hidden = false;
      board.show({ variant, fen, turn: 'white', orientation: 'white', movable: null, legalFrom: () => [], lastMove: null, check: false, showDests: false });
    },
    hide() {
      section.hidden = true;
    },
  };
}
