// coi-serviceworker (loaded by index.html before the app) gives the page cross-origin isolation, which the engine's
// threads need, by registering a service worker and reloading the page once. The app must not start in the page
// that is about to be reloaded: it would load the engine twice, and its startup and pagehide saves could land after
// the reloaded page has read storage, overwriting the saved game that page restores.

/** What coi-serviceworker looks at to decide on its reload. */
export interface CoiEnv {
  /** Undefined in a browser with no notion of isolation, where coi-serviceworker gives up. */
  crossOriginIsolated?: boolean;
  isSecureContext: boolean;
  serviceWorker?: { controller: unknown };
}

/**
 * Whether coi-serviceworker will reload this page: it is not isolated yet, a service worker can register, and none
 * controls the page yet. A page the worker already controls stays as it is, isolated or not.
 */
export function coiReloadExpected(env: CoiEnv): boolean {
  return env.crossOriginIsolated === false && env.isSecureContext && env.serviceWorker !== undefined && !env.serviceWorker.controller;
}

/**
 * How long to wait for the reload before starting the app anyway: the worker can fail to register (storage
 * blocked, an error), and then no reload comes and the app runs without the engine's threads.
 */
export const COI_FALLBACK_MS = 3000;
