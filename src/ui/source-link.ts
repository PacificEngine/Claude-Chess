// The footer's "Source" link. Spartan piece art is AGPLv3, so the site must offer its source.
/** Fallback for local and e2e builds. The deploy workflow always supplies the repository URL (see README). */
export const DEFAULT_SOURCE_URL = 'https://github.com/OWNER/claude-chess';

/** The configured source URL, or the placeholder when it is unset, blank or not an http(s) URL. */
export function resolveSourceUrl(configured: string | undefined): string {
  const value = configured?.trim();
  return value && /^https?:\/\//i.test(value) ? value : DEFAULT_SOURCE_URL;
}

export function createSourceLink(host: HTMLElement): void {
  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  const link = document.createElement('a');
  link.dataset.testid = 'source-link';
  link.href = resolveSourceUrl(import.meta.env.VITE_SOURCE_URL);
  link.textContent = 'Source';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  footer.append(link);
  host.append(footer);
}
