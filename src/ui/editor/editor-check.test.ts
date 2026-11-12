import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Engine } from '../../engine/engine';
import { loadTestRules } from '../../rules/test-rules';
import type { Rules } from '../../rules/types';
import { ENGINE_NEEDED_MESSAGE } from '../../variants/registry';
import type { SetupSpec } from '../../variants/setup';
import { createSetupChecker, guardChecker, type SetupChecker } from './editor-check';
import { type BaseLookup, EditorModel, editorBases } from './editor-model';

let rules: Rules;
let bases: BaseLookup;
beforeAll(async () => {
  rules = await loadTestRules();
  bases = editorBases(rules);
});

const fakeEngine = (check: (ini: string) => Promise<string[]>) =>
  ({ status: () => 'ready', ready: Promise.resolve(), check }) as unknown as Engine;

/** Chess with a white archbishop on i1 on a 10x8 board: a custom variant. */
const customModel = () => {
  const m = EditorModel.fromBase('chess', bases);
  m.resize(10, 8);
  m.place('i1', m.letterFor('archbishop')!, 'white');
  return m;
};

describe('setup checker', () => {
  it('settles a position-only edit without the engine, as the curated variant from the setup FEN', () => {
    const m = EditorModel.fromBase('chess', bases);
    m.move('e2', 'e4');
    const spec = m.toSpec();
    expect(createSetupChecker(rules, null, bases).quick(spec)).toEqual({ ok: true, variant: 'chess', fen: spec.fen });
  });

  it('gives the legality problems of a position-only edit straight away', () => {
    const m = EditorModel.fromBase('chess', bases);
    m.remove('e8');
    expect(createSetupChecker(rules, null, bases).quick(m.toSpec())).toEqual({ ok: false, problems: ['Black needs a king.'] });
  });

  it('leaves a setup that needs a custom variant to the engine, and says so when there is none', async () => {
    const checker = createSetupChecker(rules, null, bases);
    const spec = customModel().toSpec();
    expect(checker.quick(spec)).toBeNull();
    expect(await checker.check(spec)).toEqual({ ok: false, problems: [ENGINE_NEEDED_MESSAGE] });
  });

  it('registers a custom setup the engine accepts and plays it as its generated variant', async () => {
    const check = vi.fn(async () => []);
    const spec = customModel().toSpec();
    const verdict = await createSetupChecker(rules, fakeEngine(check), bases).check(spec);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.variant).toMatch(/^cx_[0-9a-f]{8}$/);
    expect(verdict.setup).toEqual(spec);
    expect(verdict.ini).toContain('archbishop = a');
    expect(rules.knows(verdict.variant)).toBe(true);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("checks a registered custom setup's position under its own rules", async () => {
    const m = customModel();
    m.remove('e8');
    const verdict = await createSetupChecker(rules, fakeEngine(async () => []), bases).check(m.toSpec());
    expect(verdict).toEqual({ ok: false, problems: ['Black needs a king.'] });
  });

  it("reports the engine's problems with a definition", async () => {
    const m = customModel();
    m.move('a2', 'a3');
    const verdict = await createSetupChecker(rules, fakeEngine(async () => ['Invalid option: x']), bases).check(m.toSpec());
    expect(verdict).toEqual({ ok: false, problems: ['Invalid option: x'] });
  });
});

describe('guardChecker', () => {
  const spec = {} as SetupSpec;
  const failing: SetupChecker = {
    quick: () => {
      throw new Error('bad quick');
    },
    check: () => Promise.reject(new Error('bad check')),
  };

  it('turns a checker that throws into a problem, so the editor never waits on it', () => {
    expect(guardChecker(failing).quick(spec)).toEqual({ ok: false, problems: ["The setup couldn't be checked: bad quick"] });
  });

  it('turns a check that rejects into a problem', async () => {
    await expect(guardChecker(failing).check(spec)).resolves.toEqual({ ok: false, problems: ["The setup couldn't be checked: bad check"] });
  });

  it('passes verdicts through unchanged', async () => {
    const ok = { ok: true as const, variant: 'chess', fen: 'x' };
    const fine: SetupChecker = { quick: () => null, check: async () => ok };
    expect(guardChecker(fine).quick(spec)).toBeNull();
    await expect(guardChecker(fine).check(spec)).resolves.toBe(ok);
  });
});
