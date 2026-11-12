import { defineConfig, devices } from '@playwright/test';

// Checks the app under `yarn dev`, where Vite serves source files unbundled (workers included).
// The main suite (playwright.config.ts) tests the built site instead.
const PORT = 5174;

export default defineConfig({
  testDir: 'e2e-dev',
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `yarn dev --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
