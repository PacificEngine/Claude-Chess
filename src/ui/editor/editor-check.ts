// Whether a setup can be played, and as what: the curated base from the setup's FEN when only the position
// changed, or a generated variant the engine has checked. The editor's problems list and the Play dialog's
// saved setups both ask this. No DOM.
import type { Engine } from '../../engine/engine';
import type { Rules } from '../../rules/types';
import { needsCustomVariant } from '../../variants/generator';
import { positionProblems } from '../../variants/legality';
import { registerSetup } from '../../variants/registry';
import type { SetupSpec } from '../../variants/setup';
import type { BaseLookup } from './editor-model';

/**
 * How to start a game from a setup: `variant` is the engine name. A curated variant starts from `fen`; a
 * custom one carries its `setup` (stored with the game) and its `ini` (for the engine's setVariant).
 */
export type SetupVerdict =
  | { ok: true; variant: string; fen: string; setup?: undefined; ini?: undefined }
  | { ok: true; variant: string; setup: SetupSpec; ini: string; fen?: undefined }
  | { ok: false; problems: string[] };

export interface SetupChecker {
  /** The verdict when no engine is needed (only the position changed); null when the engine must check it. */
  quick(spec: SetupSpec): SetupVerdict | null;
  /** The full verdict: registers a custom setup (waiting for a loading engine) and checks its position. */
  check(spec: SetupSpec): Promise<SetupVerdict>;
}

const verdictOf = (problems: string[], ok: SetupVerdict): SetupVerdict => (problems.length ? { ok: false, problems } : ok);

export function createSetupChecker(rules: Rules, engine: Engine | null, bases: BaseLookup): SetupChecker {
  const quick = (spec: SetupSpec): SetupVerdict | null => {
    const base = bases(spec.base);
    if (needsCustomVariant(spec, base)) return null;
    return verdictOf(positionProblems(rules, base.engineName, spec.fen), { ok: true, variant: base.engineName, fen: spec.fen });
  };
  return {
    quick,
    async check(spec) {
      const settled = quick(spec);
      if (settled) return settled;
      // A loading engine is worth waiting for; a failed one is reported by registerSetup.
      if (engine) await engine.ready.catch(() => {});
      const registered = await registerSetup(rules, engine, spec);
      if (!registered.ok) return { ok: false, problems: registered.problems };
      // The base says which kings are required: the generated start position is this very setup.
      return verdictOf(positionProblems(rules, registered.name, spec.fen, bases(spec.base).engineName), {
        ok: true,
        variant: registered.name,
        setup: spec,
        ini: registered.ini,
      });
    },
  };
}

const failed = (e: unknown): SetupVerdict => ({
  ok: false,
  problems: [`The setup couldn't be checked: ${e instanceof Error ? e.message : String(e)}`],
});

/**
 * The same checker, except that a check that throws or rejects (a bug, or an engine that failed in a way the
 * registry didn't foresee) answers with that as a problem, so a caller waiting on it is never left waiting.
 */
export function guardChecker(checker: SetupChecker): SetupChecker {
  return {
    quick(spec) {
      try {
        return checker.quick(spec);
      } catch (e) {
        console.error('Setup check failed:', e);
        return failed(e);
      }
    },
    async check(spec) {
      try {
        return await checker.check(spec);
      } catch (e) {
        console.error('Setup check failed:', e);
        return failed(e);
      }
    },
  };
}
