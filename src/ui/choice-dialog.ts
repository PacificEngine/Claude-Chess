// Asks which of several legal moves between the same two squares the player means: a promotion piece,
// whether to promote (Shogi), or (Seirawan) which piece in hand to gate in. The caller supplies the candidates; nothing is auto-picked.
import type { VariantId } from '../variants/catalog';

const NAMES: Record<string, string> = {
  p: 'Pawn',
  n: 'Knight',
  b: 'Bishop',
  r: 'Rook',
  q: 'Queen',
  k: 'King',
  a: 'Archbishop',
  c: 'Chancellor',
  h: 'Hawk',
  e: 'Elephant',
};

const VARIANT_NAMES: Partial<Record<VariantId, Record<string, string>>> = {
  amazon: { a: 'Amazon' },
  shako: { c: 'Cannon', e: 'Elephant' },
  spartan: { h: 'Hoplite', l: 'Lieutenant', g: 'General', w: 'Warlord', c: 'Captain' },
  // Shogi's own names where they differ from the chess fallback; its pawn and knight are just Pawn and Knight.
  // Promoted forms are `+` and the letter; the rook and bishop have their own names, the rest are "Promoted …".
  shogi: { g: 'Gold General', s: 'Silver General', l: 'Lance', '+r': 'Dragon King', '+b': 'Dragon Horse' },
  xiangqi: { k: 'General', a: 'Advisor', b: 'Elephant', n: 'Horse', r: 'Chariot', c: 'Cannon', p: 'Soldier' },
};

/**
 * Human name for a piece letter in a variant, or a promoted one (`+r`, Shogi's dragon king); unknown letters
 * fall back to the letter itself.
 */
export function pieceName(variant: VariantId, letter: string): string {
  const l = letter.toLowerCase();
  const own = VARIANT_NAMES[variant]?.[l];
  if (own) return own;
  if (l.startsWith('+')) return `Promoted ${pieceName(variant, l.slice(1))}`;
  return NAMES[l] ?? letter.toUpperCase();
}

export interface Choice {
  uci: string;
  /** Promotion or gating letter; '' for the plain move. */
  suffix: string;
}

/**
 * Label for one candidate: the piece's name, "Promote" for Shogi's `+`, or "Nothing", "Don't promote" (Shogi)
 * or "No promotion" for the plain move.
 */
export function choiceLabel(variant: VariantId, suffix: string): string {
  if (suffix === '+') return 'Promote';
  if (suffix === '') return variant === 'seirawan' ? 'Nothing' : variant === 'shogi' ? "Don't promote" : 'No promotion';
  return pieceName(variant, suffix);
}

export interface ChoiceDialog {
  /** Resolves with the chosen UCI move, or null if the player cancels. */
  ask(variant: VariantId, title: string, choices: Choice[]): Promise<string | null>;
}

export function createChoiceDialog(host: HTMLElement): ChoiceDialog {
  const dialog = document.createElement('dialog');
  dialog.dataset.testid = 'choice-dialog';
  dialog.className = 'choice-dialog';
  const heading = document.createElement('h2');
  const options = document.createElement('div');
  options.className = 'choice-options';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.className = 'secondary';
  dialog.append(heading, options, cancel);
  host.append(dialog);

  let settle: ((uci: string | null) => void) | null = null;
  const finish = (uci: string | null) => {
    const s = settle;
    settle = null;
    if (dialog.open) dialog.close();
    s?.(uci);
  };
  cancel.addEventListener('click', () => finish(null));
  // Escape closes the dialog natively; treat it as cancel.
  dialog.addEventListener('close', () => finish(null));

  return {
    ask(variant, title, choices) {
      finish(null); // never leave an earlier question dangling
      heading.textContent = title;
      options.replaceChildren(
        ...choices.map((c) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.dataset.uci = c.uci;
          b.textContent = choiceLabel(variant, c.suffix);
          b.addEventListener('click', () => finish(c.uci));
          return b;
        }),
      );
      dialog.showModal();
      return new Promise((resolve) => (settle = resolve));
    },
  };
}
