// Test-only page: gives Playwright the real engine adapter, rules and variant list.
import { createEngine } from '../../src/engine/engine';
import { loadRules } from '../../src/rules/rules';
import { restorable } from '../../src/session/restore';
import { CURATED_VARIANTS } from '../../src/variants/catalog';
import { generateVariant } from '../../src/variants/generator';
import { registerIni, registerSetup } from '../../src/variants/registry';

const harness = { createEngine, loadRules, CURATED_VARIANTS, generateVariant, registerIni, registerSetup, restorable };
export type EngineHarness = typeof harness;

declare global {
  interface Window {
    __engineHarness: EngineHarness;
  }
}
window.__engineHarness = harness;
