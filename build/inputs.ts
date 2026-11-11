import { resolve } from 'node:path';

/** Pages Vite builds. The spike and engine harness exist only for e2e, so production never ships them. */
export function buildInputs(mode: string, root: string): Record<string, string> {
  const inputs: Record<string, string> = { main: resolve(root, 'index.html') };
  if (mode === 'test') {
    inputs.spike = resolve(root, 'spike/engine-spike.html');
    // Test-only page for e2e/engine.spec.ts; the production app (index.html) never imports it.
    inputs.engineHarness = resolve(root, 'e2e/pages/engine-harness.html');
  }
  return inputs;
}
