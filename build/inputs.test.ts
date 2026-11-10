import { describe, expect, it } from 'vitest';
import { buildInputs } from './inputs';

describe('buildInputs', () => {
  it('ships only the app in production', () => {
    expect(Object.keys(buildInputs('production', '/root'))).toEqual(['main']);
  });

  it('adds the spike and engine harness pages in test mode, for the e2e suite', () => {
    expect(Object.keys(buildInputs('test', '/root')).sort()).toEqual(['engineHarness', 'main', 'spike']);
  });
});
