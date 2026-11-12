import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Engine } from '../engine/engine';
import { loadTestRules } from '../rules/test-rules';
import type { Rules } from '../rules/types';
import { generateVariant } from './generator';
import { ENGINE_NEEDED_MESSAGE, registerIni, registerSetup } from './registry';
import type { SetupSpec } from './setup';

let rules: Rules;
beforeAll(async () => {
  rules = await loadTestRules();
});

const spec = (): SetupSpec => ({
  base: 'chess',
  files: 8,
  ranks: 8,
  pieces: { k: 'king', q: 'queen', r: 'rook' },
  fen: 'r2qk3/8/8/8/8/8/8/R2QK3 w - - 0 1',
  castling: false,
  promotion: { rank: 'last', pieceTypes: ['q', 'r'] },
});

/** Only `status` and `check` are used by the registry. */
const fakeEngine = (check: (ini: string) => Promise<string[]>, status: ReturnType<Engine['status']> = 'ready') =>
  ({ status: () => status, check }) as unknown as Engine;

describe('registerSetup', () => {
  it('refuses a custom setup while the engine is unavailable, because ffish cannot validate it', async () =>
    expect(await registerSetup(rules, null, spec())).toEqual({ ok: false, problems: [ENGINE_NEEDED_MESSAGE] }));

  it('refuses while the engine is still loading or has failed', async () => {
    const check = vi.fn(async () => []);
    for (const status of ['loading', 'unavailable'] as const)
      expect(await registerSetup(rules, fakeEngine(check, status), spec())).toEqual({
        ok: false,
        problems: [ENGINE_NEEDED_MESSAGE],
      });
    expect(check).not.toHaveBeenCalled();
  });

  it('reports a setup the generator refuses as a problem instead of throwing', async () => {
    const bad = { ...spec(), files: 13 };
    const result = await registerSetup(rules, fakeEngine(async () => []), bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems).toEqual(['Files must be 5 to 12, not 13']);
  });

  it('reports an engine that fails during the check as a problem instead of rejecting', async () => {
    const dying = fakeEngine(async () => {
      throw new Error('worker died');
    });
    const other = { ...spec(), fen: 'r3k3/8/8/8/8/8/8/R2QK3 w - - 0 1' };
    expect(await registerSetup(rules, dying, other)).toEqual({
      ok: false,
      problems: ['The AI engine failed while checking this setup: worker died'],
    });
  });
});

describe('registerIni', () => {
  const s = { ...spec(), fen: 'r3k3/8/8/8/8/8/8/R3K3 w - - 0 1' };

  it('returns the engine\'s problems and does not load the definition into ffish', async () => {
    const { name, ini } = generateVariant(s);
    const result = await registerIni(rules, fakeEngine(async () => ['Invalid option: customPiece26']), name, ini);
    expect(result).toEqual({ ok: false, problems: ['Invalid option: customPiece26'] });
    expect(rules.knows(name)).toBe(false);
  });

  it('loads a definition the engine accepts, then skips the engine for the same name', async () => {
    const { name, ini } = generateVariant(s);
    const check = vi.fn(async () => []);
    expect(await registerIni(rules, fakeEngine(check), name, ini)).toEqual({ ok: true, name, ini });
    expect(rules.knows(name)).toBe(true);
    expect(await registerIni(rules, fakeEngine(check), name, ini)).toEqual({ ok: true, name, ini });
    expect(check).toHaveBeenCalledTimes(1);
    // A known name needs no engine at all.
    expect(await registerIni(rules, null, name, ini)).toEqual({ ok: true, name, ini });
  });

  it('reports a definition ffish does not accept even though the engine found no problem', async () => {
    const bad = await registerIni(rules, fakeEngine(async () => []), 'othername', '[different:chess]\n');
    expect(bad).toEqual({ ok: false, problems: ['The rules library did not accept this setup.'] });
  });
});
