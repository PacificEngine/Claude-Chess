// Saved setups and the editor's setup as the Play dialog lists them: it holds the saved list, answers the dialog's
// setup checks and deletes, and saves the editor's setup. app.ts owns the game; this owns chess.setups.
import { type SavedSetup, saveSetups } from '../persistence/setups';
import type { Store } from '../persistence/store';
import { variantById } from '../variants/catalog';
import type { SetupSpec } from '../variants/setup';
import type { Editor } from './editor/editor';
import type { SetupChecker } from './editor/editor-check';
import { EDITOR_SETUP_ID, type PlayDialog, type SetupOption } from './play-dialog';

export interface SetupsController {
  /** The saved setups, and the editor's setup while the editor is open. */
  options(): SetupOption[];
  /** The setup an option id names, or undefined when it is gone (deleted, or the editor closed). */
  spec(id: string): SetupSpec | undefined;
  /** Saves the editor's setup, replacing the saved setup `id` when given. Returns the saved id, or null if storage refused it. */
  save(spec: SetupSpec, name: string, id: string | null): string | null;
}

export interface SetupsDeps {
  store: Store;
  initial: SavedSetup[];
  /** Read lazily: the editor is created after this controller's save handler is handed to it. */
  editor: () => Pick<Editor, 'isOpen' | 'spec' | 'name'>;
  checker: SetupChecker;
  playDialog: PlayDialog;
  /** Called when storage refuses a delete. */
  saveFailed(): void;
}

const setupBlurb = (spec: SetupSpec) => `A setup based on ${variantById(spec.base).label}, on a ${spec.files}×${spec.ranks} board.`;

export function createSetupsController({ store, initial, editor, checker, playDialog, saveFailed }: SetupsDeps): SetupsController {
  let setups: SavedSetup[] = initial;

  function options(): SetupOption[] {
    const saved = setups.map((x) => ({ id: x.id, name: x.name, blurb: setupBlurb(x.spec) }));
    const e = editor();
    if (!e.isOpen()) return saved;
    return [{ id: EDITOR_SETUP_ID, name: `Editor: ${e.name()}`, blurb: setupBlurb(e.spec()) }, ...saved];
  }

  function spec(id: string): SetupSpec | undefined {
    if (id !== EDITOR_SETUP_ID) return setups.find((x) => x.id === id)?.spec;
    const e = editor();
    return e.isOpen() ? e.spec() : undefined;
  }

  playDialog.onCheckSetup(async (id) => {
    const s = spec(id);
    if (!s) return ['This setup is no longer available.'];
    const verdict = await checker.check(s);
    return verdict.ok ? [] : verdict.problems;
  });
  playDialog.onDeleteSetup((id) => {
    setups = setups.filter((x) => x.id !== id);
    if (!saveSetups(store, setups) && store.available) saveFailed();
    playDialog.setSetups(options());
  });

  return {
    options,
    spec,
    save(s, name, id) {
      const entry: SavedSetup = { id: id ?? crypto.randomUUID(), name, spec: structuredClone(s), savedAt: Date.now() };
      const next = setups.some((x) => x.id === entry.id) ? setups.map((x) => (x.id === entry.id ? entry : x)) : [...setups, entry];
      if (!saveSetups(store, next)) return null;
      setups = next;
      return entry.id;
    },
  };
}
