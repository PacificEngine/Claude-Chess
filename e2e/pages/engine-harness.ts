// Test-only page: gives Playwright the real engine adapter, rules and variant list.
import { createEngine } from '../../src/engine/engine';
import { loadRules } from '../../src/rules/rules';
import { CURATED_VARIANTS } from '../../src/variants/catalog';

const harness = { createEngine, loadRules, CURATED_VARIANTS };
export type EngineHarness = typeof harness;

declare global {
  interface Window {
    __engineHarness: EngineHarness;
  }
}
window.__engineHarness = harness;
