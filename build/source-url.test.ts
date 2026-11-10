import { describe, expect, it } from 'vitest';
import { checkDeploySourceUrl } from './source-url';

describe('checkDeploySourceUrl', () => {
  const ci = { GITHUB_ACTIONS: 'true' };

  it('fails a CI production build whose Source link would be the dead placeholder', () => {
    expect(() => checkDeploySourceUrl('production', ci)).toThrow(/SOURCE_URL/);
    expect(() => checkDeploySourceUrl('production', { ...ci, VITE_SOURCE_URL: '' })).toThrow(/SOURCE_URL/);
    expect(() => checkDeploySourceUrl('production', { ...ci, VITE_SOURCE_URL: 'javascript:alert(1)' })).toThrow();
    expect(() => checkDeploySourceUrl('production', { ...ci, VITE_SOURCE_URL: 'https://github.com/OWNER/claude-chess' })).toThrow();
  });

  it('passes a CI production build with a real repository URL', () => {
    expect(() => checkDeploySourceUrl('production', { ...ci, VITE_SOURCE_URL: 'https://github.com/me/claude-chess' })).not.toThrow();
  });

  it('leaves local and test-mode builds alone, so they can exercise the fallback', () => {
    expect(() => checkDeploySourceUrl('production', {})).not.toThrow();
    expect(() => checkDeploySourceUrl('test', ci)).not.toThrow();
  });
});
