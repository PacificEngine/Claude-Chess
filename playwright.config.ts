import { defineConfig, devices } from '@playwright/test';

// e2e runs against the built site on `vite preview`, which, like GitHub Pages,
// sends no COOP/COEP headers. Isolation must come from the service worker.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'yarn build:test && yarn preview',
    // Cleared so the footer test always sees the fallback, whatever the developer's shell exports.
    env: { VITE_SOURCE_URL: '' },
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
