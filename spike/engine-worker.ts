/// <reference lib="webworker" />
// Spike: hosts Fairy-Stockfish (fairy-stockfish-nnue.wasm) inside a dedicated worker so
// nothing engine-related runs on the main thread. The package is an Emscripten pthreads
// build (PROXY_TO_PTHREAD), so it spawns its own nested pthread workers and needs
// SharedArrayBuffer, i.e. a cross-origin-isolated page.
import sfJsUrl from 'fairy-stockfish-nnue.wasm/stockfish.js?url';
import sfWasmUrl from 'fairy-stockfish-nnue.wasm/stockfish.wasm?url';
import sfPthreadUrl from 'fairy-stockfish-nnue.wasm/stockfish.worker.js?url';

interface StockfishInstance {
  postMessage(command: string): void;
  addMessageListener(listener: (line: string) => void): void;
  FS: { writeFile(path: string, data: string): void };
}

declare const Stockfish: (options: {
  locateFile: (file: string) => string;
  mainScriptUrlOrBlob: string;
}) => Promise<StockfishInstance>;

export type ToEngine = { type: 'cmd'; line: string } | { type: 'writeFile'; path: string; text: string };
export type FromEngine = { type: 'ready' } | { type: 'line'; line: string } | { type: 'error'; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const post = (msg: FromEngine) => ctx.postMessage(msg);

const absolute = (url: string) => new URL(url, ctx.location.href).href;

async function start(): Promise<void> {
  try {
    ctx.importScripts(absolute(sfJsUrl));
    const engine = await Stockfish({
      locateFile: (file) => absolute(file.endsWith('.wasm') ? sfWasmUrl : sfPthreadUrl),
      // Nested pthread workers re-import the main script from this URL.
      mainScriptUrlOrBlob: absolute(sfJsUrl),
    });
    engine.addMessageListener((line) => post({ type: 'line', line }));
    ctx.onmessage = (e: MessageEvent<ToEngine>) => {
      const msg = e.data;
      if (msg.type === 'cmd') engine.postMessage(msg.line);
      else engine.FS.writeFile(msg.path, msg.text);
    };
    post({ type: 'ready' });
  } catch (err) {
    post({ type: 'error', message: String(err) });
  }
}

void start();
