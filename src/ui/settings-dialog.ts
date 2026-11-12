// The Settings dialog. It edits a copy of Settings and hands the result back; app.ts saves it. It also holds
// "Edit current game", which closes the dialog (unsaved changes dropped) and opens the editor on the game.
import type { Settings } from '../persistence/store';

export const BOARD_THEMES = ['brown', 'blue', 'green'] as const;

export interface SettingsDialog {
  open(current: Settings): void;
  onSave(cb: (s: Settings) => void): void;
  onClose(cb: () => void): void;
  onEditGame(cb: () => void): void;
  /** Whether "Edit current game" can be used now: the same rule as the panel's Edit button. */
  setCanEditGame(can: boolean): void;
}

function checkbox(id: string, text: string): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = document.createElement('label');
  label.className = 'check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = id;
  const span = document.createElement('span');
  span.textContent = text;
  label.append(input, span);
  return { label, input };
}

export function createSettingsDialog(host: HTMLElement): SettingsDialog {
  const dialog = document.createElement('dialog');
  dialog.dataset.testid = 'settings-dialog';
  const form = document.createElement('form');
  form.method = 'dialog';
  const heading = document.createElement('h2');
  heading.textContent = 'Settings';

  const highlight = checkbox('settings-highlight', 'Highlight legal moves');
  const sound = checkbox('settings-sound', 'Sound (not available yet)');
  sound.input.disabled = true;

  const themeLabel = document.createElement('label');
  themeLabel.className = 'field';
  const themeText = document.createElement('span');
  themeText.textContent = 'Board colors';
  const theme = document.createElement('select');
  theme.id = 'settings-theme';
  for (const t of BOARD_THEMES) {
    const o = document.createElement('option');
    o.value = t;
    o.textContent = t[0].toUpperCase() + t.slice(1);
    theme.append(o);
  }
  themeLabel.append(themeText, theme);

  const editGame = document.createElement('button');
  editGame.type = 'button';
  editGame.className = 'secondary';
  editGame.dataset.testid = 'settings-edit-game';
  editGame.textContent = 'Edit current game';

  const actions = document.createElement('div');
  actions.className = 'actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'secondary';
  cancel.textContent = 'Cancel';
  const save = document.createElement('button');
  save.type = 'submit';
  save.textContent = 'Save';
  actions.append(cancel, save);

  form.append(heading, highlight.label, themeLabel, sound.label, editGame, actions);
  dialog.append(form);
  host.append(dialog);

  let base: Settings | null = null;
  let saveListener: (s: Settings) => void = () => {};
  let closeListener: () => void = () => {};
  let editGameListener: () => void = () => {};
  editGame.addEventListener('click', () => {
    // The editor opens first, so the dialog's close doesn't restart the clock it keeps paused.
    editGameListener();
    dialog.close();
  });
  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => closeListener());
  form.addEventListener('submit', () => {
    if (!base) return;
    saveListener({ ...base, highlightLegal: highlight.input.checked, boardTheme: theme.value });
  });

  return {
    open(current) {
      base = { ...current };
      highlight.input.checked = current.highlightLegal;
      sound.input.checked = current.sound;
      theme.value = (BOARD_THEMES as readonly string[]).includes(current.boardTheme) ? current.boardTheme : 'brown';
      dialog.showModal();
    },
    onSave(cb) {
      saveListener = cb;
    },
    onClose(cb) {
      closeListener = cb;
    },
    onEditGame(cb) {
      editGameListener = cb;
    },
    setCanEditGame(can) {
      editGame.disabled = !can;
    },
  };
}
