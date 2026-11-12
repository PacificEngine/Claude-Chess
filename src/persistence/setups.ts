// Saved editor setups, under chess.setups. They store the setup, never variants.ini text: the definition is
// regenerated and checked by the engine whenever a setup is played. No DOM or UI imports.
import { isSetupSpec, type SetupSpec } from '../variants/setup';
import type { Store } from './store';

export const SETUPS_VERSION = 1;

export interface SavedSetup {
  /** `crypto.randomUUID()` when first saved. */
  id: string;
  /** The player's own text: only ever shown with textContent, and never part of a variant definition. */
  name: string;
  spec: SetupSpec;
  savedAt: number;
}

const isRecord = (d: unknown): d is Record<string, unknown> => typeof d === 'object' && d !== null;

function isSavedSetup(d: unknown): d is SavedSetup {
  return (
    isRecord(d) &&
    typeof d.id === 'string' &&
    d.id !== '' &&
    typeof d.name === 'string' &&
    isSetupSpec(d.spec) &&
    typeof d.savedAt === 'number' &&
    Number.isFinite(d.savedAt)
  );
}

const isSetupList = (d: unknown): d is SavedSetup[] => Array.isArray(d) && d.every(isSavedSetup);

/** A list that fails validation is moved aside to chess.setups.corrupt by the store, so the app starts with none. */
export function loadSetups(store: Store): { setups: SavedSetup[]; problem: 'corrupt' | null } {
  const loaded = store.load('chess.setups', SETUPS_VERSION, {}, isSetupList);
  return { setups: loaded.data ?? [], problem: loaded.problem };
}

/** False when the browser refused to store them (no storage, or full). */
export function saveSetups(store: Store, setups: SavedSetup[]): boolean {
  return store.save('chess.setups', SETUPS_VERSION, setups);
}
