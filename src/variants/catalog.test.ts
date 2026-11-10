import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import loadFfish, { type ModuleOptions } from 'ffish-es6';
import { describe, expect, it } from 'vitest';
import { CURATED_VARIANTS, variantById } from './catalog';

describe('variant catalog', () => {
  it('lists every owner-approved variant in menu order', () =>
    expect(CURATED_VARIANTS.map((v) => v.id)).toEqual([
      'chess', 'capablanca', 'grand', 'seirawan', 'amazon', 'shako', 'spartan', 'antichess',
    ]));

  it('knows board sizes so the UI can lay out large boards', () => {
    expect(variantById('capablanca')).toMatchObject({ files: 10, ranks: 8 });
    expect(variantById('grand')).toMatchObject({ files: 10, ranks: 10 });
    expect(variantById('shako')).toMatchObject({ files: 10, ranks: 10 });
  });

  it('uses only variant names the rules library knows, so no game can crash the wasm module', async () => {
    // Hand over the wasm bytes: Emscripten's loader tries fetch() under Vitest, which can't read a file path.
    // wasmBinary is a standard Emscripten option that ffish.d.ts doesn't declare.
    const options: ModuleOptions & { wasmBinary: Buffer } = {
      wasmBinary: readFileSync(resolve(import.meta.dirname, '../../node_modules/ffish-es6/ffish.wasm')),
    };
    const ffish = await loadFfish(options);
    // variants() is empty until the first Board initialises the library.
    new ffish.Board('chess').delete();
    const known = new Set(ffish.variants().split(' '));
    for (const v of CURATED_VARIANTS) expect(known, v.engineName).toContain(v.engineName);
  });
});
