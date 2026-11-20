// `pnpm test` at the root runs these. Snapshots sit beside each test in __snapshots__; after a change to the sim that
// is meant to change how a night plays, `pnpm test -u` rewrites them, and the diff shows what changed.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // A seeded night with scripted guards takes seconds, not milliseconds.
    testTimeout: 120_000,
    // Vitest picks its minimal reporter when it detects a coding agent, and that one drops console output from
    // passing tests, which would hide the floor plan's warnings. Keep the default reporter everywhere.
    reporters: ['default'],
  },
});
