// Asks which of several legal moves between the same two squares the player means: a promotion piece,
// or (Seirawan) which piece in hand to gate in. The caller supplies the candidates; nothing is auto-picked.
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
};

/** Human name for a piece letter in a variant; unknown letters fall back to the letter itself. */
export function pieceName(variant: VariantId, letter: string): string {
  const l = letter.toLowerCase();
  return VARIANT_NAMES[variant]?.[l] ?? NAMES[l] ?? letter.toUpperCase();
}

export interface Choice {
  uci: string;
  /** Promotion or gating letter; '' for the plain move. */
  suffix: string;
}

/** Label for one candidate: the piece's name, or "Nothing"/"No promotion" for the plain move. */
export function choiceLabel(variant: VariantId, suffix: string): string {
  if (suffix === '') return variant === 'seirawan' ? 'Nothing' : 'No promotion';
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
