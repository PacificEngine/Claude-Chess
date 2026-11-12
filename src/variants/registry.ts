// The only path by which a custom variant definition reaches ffish. ffish's loadVariantConfig reports no
// errors (invalid options are dropped silently), so the engine's `check` validates first. No DOM or UI imports.
import type { Engine } from '../engine/engine';
import type { Rules } from '../rules/types';
import { variantTypes } from './active';
import { variantById } from './catalog';
import { generateVariant } from './generator';
import type { SetupSpec } from './setup';

export const ENGINE_NEEDED_MESSAGE = 'The AI engine is needed to check custom setups and is not available.';
const REJECTED_MESSAGE = 'The rules library did not accept this setup.';

export type RegisterResult = { ok: true; name: string; ini: string } | { ok: false; problems: string[] };

/**
 * Registers a generated definition with ffish after the engine has validated it. A name already known is
 * accepted as is: names carry a hash of the content, so the same name is the same definition (and ffish
 * refuses to redefine one). The engine itself loads the ini later, through `setVariant(name, ini)`.
 */
export async function registerIni(rules: Rules, engine: Engine | null, name: string, ini: string): Promise<RegisterResult> {
  if (rules.knows(name)) return { ok: true, name, ini };
  if (!engine || engine.status() !== 'ready') return { ok: false, problems: [ENGINE_NEEDED_MESSAGE] };
  const problems = await engine.check(ini);
  if (problems.length > 0) return { ok: false, problems };
  rules.loadConfig(ini);
  if (!rules.knows(name)) return { ok: false, problems: [REJECTED_MESSAGE] };
  return { ok: true, name, ini };
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Generates the definition for a setup and registers it. Never rejects: a setup the generator refuses, and an
 * engine that fails while checking, come back as problems, so the editor has one way to show a failure.
 */
export async function registerSetup(rules: Rules, engine: Engine | null, spec: SetupSpec): Promise<RegisterResult> {
  let generated: { name: string; ini: string };
  try {
    // With the base's piece types, so a letter the base defines can't be given another type.
    generated = generateVariant(spec, variantTypes(rules, variantById(spec.base).engineName));
  } catch (e) {
    return { ok: false, problems: [message(e)] };
  }
  try {
    return await registerIni(rules, engine, generated.name, generated.ini);
  } catch (e) {
    return { ok: false, problems: [`The AI engine failed while checking this setup: ${message(e)}`] };
  }
}
