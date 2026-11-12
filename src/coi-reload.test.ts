import { describe, expect, it } from 'vitest';
import { coiReloadExpected } from './coi-reload';

const env = (over: Partial<Parameters<typeof coiReloadExpected>[0]> = {}) => ({
  crossOriginIsolated: false,
  isSecureContext: true,
  serviceWorker: { controller: null },
  ...over,
});

describe('coiReloadExpected', () => {
  it('expects the one-time reload on a first visit: not isolated, and no service worker controls the page yet', () => {
    expect(coiReloadExpected(env())).toBe(true);
  });

  it('expects none once the page is isolated', () => {
    expect(coiReloadExpected(env({ crossOriginIsolated: true }))).toBe(false);
  });

  it('expects none in a browser with no notion of isolation, where coi-serviceworker gives up', () => {
    expect(coiReloadExpected(env({ crossOriginIsolated: undefined }))).toBe(false);
  });

  it('expects none where a service worker cannot register (insecure context, or no service worker support)', () => {
    expect(coiReloadExpected(env({ isSecureContext: false }))).toBe(false);
    expect(coiReloadExpected(env({ serviceWorker: undefined }))).toBe(false);
  });

  it('expects none when the worker already controls the page but isolation still failed: reloading would not help', () => {
    expect(coiReloadExpected(env({ serviceWorker: { controller: {} } }))).toBe(false);
  });
});
