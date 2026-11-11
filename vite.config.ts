import { defineConfig } from 'vite';
import { buildInputs } from './build/inputs';
import { checkDeploySourceUrl } from './build/source-url';

export default defineConfig(({ mode }) => {
  checkDeploySourceUrl(mode, process.env);
  return {
    // Relative base so the built site works under any GitHub Pages repo path.
    base: './',
    // Both packages are Emscripten builds that locate their .wasm (and the engine's
    // pthread worker script) at runtime. Pre-bundling would rewrite them and break that.
    optimizeDeps: { exclude: ['ffish-es6', 'fairy-stockfish-nnue.wasm'] },
    worker: { format: 'iife' },
    build: {
      // Never inline the engine's pthread worker script as a data: URL: a data: worker has an
      // opaque origin, so it is not cross-origin isolated and cannot use SharedArrayBuffer.
      assetsInlineLimit: (file: string) => (file.endsWith('stockfish.worker.js') ? false : undefined),
      rollupOptions: {
        input: buildInputs(mode, import.meta.dirname),
      },
    },
  };
});
