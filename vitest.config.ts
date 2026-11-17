import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Globs are relative to --dir. '*.search.ts' matches nothing at the root, so only `yarn tutorial:search`
    // (--dir scripts) runs scripts/find-puzzles.search.ts.
    include: ['src/**/*.test.ts', 'build/**/*.test.ts', '*.search.ts'],
    passWithNoTests: true,
  },
});
