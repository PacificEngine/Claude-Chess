import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Globs are relative to --dir. '*.search.ts' matches nothing at the root, so only `yarn tutorial:search`
    // (--dir scripts) runs scripts/find-puzzles.search.ts.
    include: ['src/**/*.test.ts', 'build/**/*.test.ts', '*.search.ts'],
    passWithNoTests: true,
    // Many tests run the real rules library (WASM) over every variant or lesson, on purpose: no mocks of
    // first-party code. They take 1–3 s on a dev machine with the suite running in parallel, and GitHub's
    // smaller runners pushed two past Vitest's 5 s default (2026-11-17). 30 s leaves room on a slow machine
    // while still failing a test that truly hangs.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
