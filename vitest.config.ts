import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Unit/property tests for the pure-TypeScript layers only (game/, render/, session/).
// Anything importing React Native belongs in the Playwright suite instead — see ADR-0005.
//
// `include` is a list rather than one broad glob so that adding a layer is a deliberate act: a
// `session/**` entry that nobody added is a whole layer whose tests never run and whose suite is
// green because it is empty. ADR-0010 added the third entry.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    include: [
      'game/**/*.test.ts',
      'render/**/*.test.ts',
      'session/**/*.test.ts',
      'tests/unit/**/*.test.ts',
    ],
    environment: 'node',
    // The unit suite is run constantly during development; keep it fast enough that
    // nobody is tempted to skip it.
    testTimeout: 5_000,
  },
});
