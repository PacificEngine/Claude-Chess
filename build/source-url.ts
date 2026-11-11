import { DEFAULT_SOURCE_URL, resolveSourceUrl } from '../src/ui/source-link';

/**
 * The Spartan piece art is AGPLv3, so the deployed footer must link to real source. A GitHub Actions production
 * build (the deploy) fails rather than ship the placeholder; local and test-mode builds may use the fallback.
 */
export function checkDeploySourceUrl(mode: string, env: Record<string, string | undefined>): void {
  if (mode !== 'production' || env.GITHUB_ACTIONS !== 'true') return;
  const url = resolveSourceUrl(env.VITE_SOURCE_URL);
  if (url === DEFAULT_SOURCE_URL || url.includes('/OWNER/')) {
    throw new Error(`VITE_SOURCE_URL must be the repository's http(s) URL for a deploy (got "${env.VITE_SOURCE_URL ?? ''}"); set the SOURCE_URL repo variable or let the workflow default to the repository.`);
  }
}
