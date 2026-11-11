// Node/Vitest helper: real Rules for tests. Not imported by app code.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadRules } from './rules';
import type { Rules } from './types';

export function loadTestRules(): Promise<Rules> {
  // Emscripten's loader can't fetch a file path under Vitest, so hand it the wasm bytes.
  const wasmBinary = readFileSync(resolve(import.meta.dirname, '../../node_modules/ffish-es6/ffish.wasm'));
  return loadRules({ wasmBinary });
}
