/// <reference lib="webworker" />
// Hosts Fairy-Stockfish (fairy-stockfish-nnue.wasm) inside a dedicated worker so nothing engine-related
// runs on the main thread. The package is an Emscripten pthreads build (PROXY_TO_PTHREAD), so it spawns
// its own nested pthread workers and needs SharedArrayBuffer, i.e. a cross-origin-isolated page.
// Vite must not inline stockfish.worker.js as a data: URL (see vite.config.ts).
// This must stay a classic worker (it needs importScripts) with no runtime imports: `yarn dev` serves it
// unbundled, and a classic worker cannot run `import`. The page sends the engine's file URLs in an `init` message.

interface StockfishInstance {
  postMessage(command: string): void;
  addMessageListener(listener: (line: string) => void): void;
  FS: { writeFile(path: string, data: string): void };
}

declare const Stockfish: (options: {
  locateFile: (file: string) => string;
  mainScriptUrlOrBlob: string;
}) => Promise<StockfishInstance>;

// Inline type imports: an `import type` declaration would make the dev transform emit `export {}`, which a classic worker can't parse.
type EngineUrls = import('./engine-protocol').EngineUrls;
type FromEngine = import('./engine-protocol').FromEngine;
type ToEngine = import('./engine-protocol').ToEngine;

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const post = (msg: FromEngine) => ctx.postMessage(msg);

const absolute = (url: string) => new URL(url, ctx.location.href).href;

async function start(urls: EngineUrls): Promise<void> {
  try {
    ctx.importScripts(absolute(urls.js));
    const engine = await Stockfish({
      locateFile: (file) => absolute(file.endsWith('.wasm') ? urls.wasm : urls.pthread),
      // Nested pthread workers re-import the main script from this URL.
      mainScriptUrlOrBlob: absolute(urls.js),
    });
    engine.addMessageListener((line) => post({ type: 'line', line }));
    ctx.onmessage = (e: MessageEvent<ToEngine>) => {
      const msg = e.data;
      if (msg.type === 'cmd') engine.postMessage(msg.line);
      else if (msg.type === 'writeFile') engine.FS.writeFile(msg.path, msg.text);
    };
    post({ type: 'ready' });
  } catch (err) {
    post({ type: 'error', message: String(err) });
  }
}

ctx.onmessage = (e: MessageEvent<ToEngine>) => {
  if (e.data.type === 'init') void start(e.data.urls);
};
