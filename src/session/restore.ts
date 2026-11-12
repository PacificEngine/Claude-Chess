// Decides whether a saved game can be resumed. A custom game is stored by its setup and must be regenerated
// and checked by the engine first, which can take seconds, so that part runs in the background and can be
// superseded. Pure: no DOM or UI imports.
import type { Engine } from '../engine/engine';
import type { Rules } from '../rules/types';
import { variantTypes } from '../variants/active';
import { CURATED_VARIANTS, variantById } from '../variants/catalog';
import { generateVariant } from '../variants/generator';
import { ENGINE_NEEDED_MESSAGE, registerIni, type RegisterResult } from '../variants/registry';
import { GameSession, type SessionState } from './session';

/**
 * `ini` is the regenerated definition of a custom game's variant, for the engine's setVariant.
 * 'engine' means the save could not be checked because no working engine was there to check it: the save
 * may be fine, so it is kept rather than quarantined.
 */
export type Restored = { ok: true; ini?: string } | { ok: false; reason: 'corrupt' | 'engine' };

const CORRUPT: Restored = { ok: false, reason: 'corrupt' };
const ENGINE: Restored = { ok: false, reason: 'engine' };

function replays(rules: Rules, d: SessionState): boolean {
  try {
    GameSession.restore(rules, d).dispose();
    return true;
  } catch {
    return false;
  }
}

/**
 * Everything that needs no engine. Settles a curated game; for a custom game, null means its setup still
 * generates the saved variant name and only the engine's check is left (`restorable`).
 */
export function checkWithoutEngine(rules: Rules, d: SessionState): Restored | null {
  if (d.setup === undefined) {
    if (!CURATED_VARIANTS.some((v) => v.engineName === d.variant)) return CORRUPT;
    return replays(rules, d) ? { ok: true } : CORRUPT;
  }
  try {
    return generateVariant(d.setup).name === d.variant ? null : CORRUPT;
  } catch {
    return CORRUPT;
  }
}

/**
 * A saved game is usable if its variant is curated, or if it is a custom game whose setup still generates the
 * saved variant name and passes the engine's check, and its moves and snapshots replay. Only generator-validated
 * text may reach the engine, so custom games are stored by setup and regenerated here.
 *
 * Only the generator and a working engine's refusal make a custom save corrupt. An engine that is missing,
 * fails or stops being ready during the check proves nothing about the save.
 */
export async function restorable(rules: Rules, engine: Engine | null, d: SessionState): Promise<Restored> {
  const quick = checkWithoutEngine(rules, d);
  if (quick) return quick;
  const setup = d.setup!;
  if (engine) await engine.ready.catch(() => {});
  if (!engine || engine.status() !== 'ready') return ENGINE;

  let generated: { name: string; ini: string };
  try {
    // With the base's piece types: a letter the base defines may not be given another type.
    generated = generateVariant(setup, variantTypes(rules, variantById(setup.base).engineName));
  } catch {
    return CORRUPT;
  }
  let registered: RegisterResult;
  try {
    registered = await registerIni(rules, engine, generated.name, generated.ini);
  } catch {
    return ENGINE; // the engine itself failed during the check
  }
  if (!registered.ok) {
    const engineNeeded = registered.problems.length === 1 && registered.problems[0] === ENGINE_NEEDED_MESSAGE;
    // Problems from an engine that died while answering may be partial output, not a verdict.
    return engineNeeded || engine.status() !== 'ready' ? ENGINE : CORRUPT;
  }
  if (registered.name !== d.variant) return CORRUPT;
  return replays(rules, d) ? { ok: true, ini: registered.ini } : CORRUPT;
}

export interface PendingRestore {
  /** Drops the result: call it when a new game or a move supersedes the saved game. */
  cancel(): void;
  /** Settles once the result has been reported or dropped. */
  done: Promise<void>;
}

/** Runs `restorable` in the background and reports its result unless cancelled first. */
export function restoreInBackground(
  rules: Rules,
  engine: Engine | null,
  d: SessionState,
  onResult: (r: Restored) => void,
): PendingRestore {
  let cancelled = false;
  const done = restorable(rules, engine, d)
    // Anything unexpected is no proof the save is bad, so it is kept like an engine failure.
    .catch((): Restored => ENGINE)
    .then((r) => {
      if (!cancelled) onResult(r);
    });
  return {
    cancel: () => {
      cancelled = true;
    },
    done,
  };
}
