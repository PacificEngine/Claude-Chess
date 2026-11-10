// Loads the ffish.js wasm module. No DOM or UI imports: the browser path only needs the wasm URL.
import loadFfish, { type FairyStockfish, type ModuleOptions } from 'ffish-es6';
import ffishWasmUrl from 'ffish-es6/ffish.wasm?url';

export interface FfishLoadOptions {
  /**
   * The wasm bytes, for hosts where Emscripten can't fetch the file itself (Node/Vitest fails with
   * ERR_INVALID_URL). In the browser leave it out and the Vite asset URL is used.
   */
  wasmBinary?: Uint8Array;
}

/** Loads ffish and initialises it, so ffish.variants() is populated before anyone asks. */
export async function loadFfishModule(options: FfishLoadOptions = {}): Promise<FairyStockfish> {
  // wasmBinary is a standard Emscripten option that ffish.d.ts doesn't declare.
  const moduleOptions: ModuleOptions & { wasmBinary?: Uint8Array } = options.wasmBinary
    ? { wasmBinary: options.wasmBinary }
    : { locateFile: () => ffishWasmUrl };
  const ffish = await loadFfish(moduleOptions);
  // variants() returns "" until the first Board initialises the library.
  new ffish.Board('chess').delete();
  return ffish;
}
