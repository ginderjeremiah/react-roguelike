import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Unit/property tests for the pure-TypeScript layers only (game/, render/).
// Anything importing React Native belongs in the Playwright suite instead — see ADR-0005.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    include: ['game/**/*.test.ts', 'render/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    environment: 'node',
    // The unit suite is run constantly during development; keep it fast enough that
    // nobody is tempted to skip it.
    testTimeout: 5_000,
  },
});
