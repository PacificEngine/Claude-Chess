// Messages between the engine adapter (page) and engine-worker.ts. Types only, so the worker stays import-free at runtime.
export interface EngineUrls {
  js: string;
  wasm: string;
  pthread: string;
}

export type ToEngine =
  | { type: 'init'; urls: EngineUrls }
  | { type: 'cmd'; line: string }
  | { type: 'writeFile'; path: string; text: string }
  | { type: 'removeFile'; path: string }
  /** Test builds only: lists the variants files left in the engine's file system. */
  | { type: 'listFiles' };
export type FromEngine =
  | { type: 'ready' }
  | { type: 'line'; line: string }
  | { type: 'error'; message: string }
  | { type: 'files'; paths: string[] };
