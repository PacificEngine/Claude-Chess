// Messages between the engine adapter (page) and engine-worker.ts. Types only, so the worker stays import-free at runtime.
export interface EngineUrls {
  js: string;
  wasm: string;
  pthread: string;
}

export type ToEngine =
  | { type: 'init'; urls: EngineUrls }
  | { type: 'cmd'; line: string }
  | { type: 'writeFile'; path: string; text: string };
export type FromEngine = { type: 'ready' } | { type: 'line'; line: string } | { type: 'error'; message: string };
