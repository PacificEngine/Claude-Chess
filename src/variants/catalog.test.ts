import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import loadFfish, { type ModuleOptions } from 'ffish-es6';
import { describe, expect, it } from 'vitest';
import { CURATED_VARIANTS, variantById } from './catalog';
import { parseFen } from './fen';

function loadTestFfish() {
  // Hand over the wasm bytes: Emscripten's loader tries fetch() under Vitest, which can't read a file path.
  // wasmBinary is a standard Emscripten option that ffish.d.ts doesn't declare.
  const options: ModuleOptions & { wasmBinary: Buffer } = {
    wasmBinary: readFileSync(resolve(import.meta.dirname, '../../node_modules/ffish-es6/ffish.wasm')),
  };
  return loadFfish(options);
}

describe('variant catalog', () => {
  it('lists every owner-approved variant in menu order', () =>
    expect(CURATED_VARIANTS.map((v) => v.id)).toEqual([
      'chess', 'capablanca', 'grand', 'seirawan', 'amazon', 'shako', 'spartan', 'antichess', 'shogi', 'xiangqi',
    ]));

  it('knows board sizes so the UI can lay out large boards', () => {
    expect(variantById('capablanca')).toMatchObject({ files: 10, ranks: 8 });
    expect(variantById('grand')).toMatchObject({ files: 10, ranks: 10 });
    expect(variantById('shako')).toMatchObject({ files: 10, ranks: 10 });
  });

  it("lists Shogi and Xiangqi with ffish's sizes", async () => {
    expect(variantById('shogi')).toMatchObject({ label: 'Shogi', engineName: 'shogi', files: 9, ranks: 9 });
    expect(variantById('xiangqi')).toMatchObject({ label: 'Xiangqi', engineName: 'xiangqi', files: 9, ranks: 10 });
    const ffish = await loadTestFfish();
    for (const id of ['shogi', 'xiangqi'] as const) {
      const board = new ffish.Board(id);
      const { files, ranks } = parseFen(board.fen());
      board.delete();
      expect({ files, ranks }, id).toEqual({ files: variantById(id).files, ranks: variantById(id).ranks });
    }
  });

  it('uses only variant names the rules library knows, so no game can crash the wasm module', async () => {
    const ffish = await loadTestFfish();
    // variants() is empty until the first Board initialises the library.
    new ffish.Board('chess').delete();
    const known = new Set(ffish.variants().split(' '));
    for (const v of CURATED_VARIANTS) expect(known, v.engineName).toContain(v.engineName);
  });
});
