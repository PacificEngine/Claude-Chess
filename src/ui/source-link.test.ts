import { describe, expect, it } from 'vitest';
import { DEFAULT_SOURCE_URL, resolveSourceUrl } from './source-link';

describe('resolveSourceUrl', () => {
  it('uses the configured URL', () => {
    expect(resolveSourceUrl('https://github.com/me/chess')).toBe('https://github.com/me/chess');
  });

  it('falls back to the placeholder when unset or blank', () => {
    expect(resolveSourceUrl(undefined)).toBe(DEFAULT_SOURCE_URL);
    expect(resolveSourceUrl('  ')).toBe(DEFAULT_SOURCE_URL);
  });

  it('rejects non-http(s) URLs so a bad variable cannot inject a javascript: link', () => {
    expect(resolveSourceUrl('javascript:alert(1)')).toBe(DEFAULT_SOURCE_URL);
  });
});
