// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

// The rules below are not style preferences — they mechanically enforce the two contracts the
// project's testing strategy depends on (see docs/ARCHITECTURE.md and ADR-0004):
//
//   1. game/ is deterministic     — no ambient randomness, no clock
//   2. dependencies point down    — game/ knows nothing about the layers above it
//
// A violation is a build failure, not a warning. Determinism is all-or-nothing: one stray
// Math.random() silently invalidates every replay test in the repo.

/** Globals that make the simulation nondeterministic. */
const NONDETERMINISTIC_PROPERTIES = [
  {
    object: 'Math',
    property: 'random',
    message:
      'game/ must be deterministic. Use the seeded Rng threaded through GameState instead. See ADR-0004.',
  },
  {
    object: 'Date',
    property: 'now',
    message: 'game/ has turns, not time. Nothing in the simulation may read the clock. See ADR-0004.',
  },
  {
    object: 'performance',
    property: 'now',
    message: 'game/ has turns, not time. Nothing in the simulation may read the clock. See ADR-0004.',
  },
];

/**
 * Build the glob set matching a repo-root layer directory from ANY importing depth.
 *
 * `../components/*` only matches an importer sitting one level below the repo root. Real files
 * live at `game/systems/foo.ts` and import `../../components/x`, which that pattern misses
 * entirely — so the guard would protect only the depth where no code actually lives.
 *
 * The `**` prefix matches any number of leading segments, including `..` and the `@` of the
 * `@/` alias, so one entry covers `../x`, `../../../x`, and `@/x` alike. Verified empirically
 * against ESLint rather than reasoned about — the matcher is not minimatch.
 */
const layer = (dir) => [`**/${dir}`, `**/${dir}/*`, `**/${dir}/**`];

/** Layers game/ is forbidden from importing. Dependencies point strictly downward. */
const FORBIDDEN_FROM_GAME = [
  {
    group: ['react', 'react-dom'],
    message: 'game/ is pure TypeScript. No React. See docs/ARCHITECTURE.md.',
  },
  { group: ['react-native', 'react-native/*'], message: 'game/ is pure TypeScript. No React Native.' },
  {
    group: ['expo', 'expo-*', '@expo/*'],
    message: 'game/ is platform-agnostic. Platform access belongs in platform/.',
  },
  {
    group: [...layer('app'), ...layer('components'), ...layer('render'), ...layer('platform')],
    message: 'game/ must not import from layers above it. Dependencies point downward only.',
  },
];

module.exports = defineConfig([
  expoConfig,

  {
    ignores: ['dist/*', 'node_modules/*', 'playwright-report/*', 'test-results/*', '.expo/*'],
  },

  // --- Determinism + layer rules for the simulation core -------------------------------------
  {
    files: ['game/**/*.ts'],
    rules: {
      'no-restricted-properties': ['error', ...NONDETERMINISTIC_PROPERTIES],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'game/ is platform-agnostic.' },
        { name: 'document', message: 'game/ is platform-agnostic.' },
        { name: 'localStorage', message: 'Persistence belongs in platform/. See ADR-0006.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message:
            'game/ has turns, not time. Nothing in the simulation may read the clock. See ADR-0004.',
        },
        {
          selector: 'AwaitExpression',
          message: 'game/ is synchronous. step() is a pure function, not an async process.',
        },
        {
          // `await` alone is not enough: an async function that returns a promise without
          // awaiting, or a bare `new Promise(...)`, is equally forbidden and equally invisible
          // to the AwaitExpression selector.
          selector: ':function[async=true]',
          message: 'game/ is synchronous. step() is a pure function, not an async process.',
        },
        {
          selector: "NewExpression[callee.name='Promise']",
          message: 'game/ is synchronous. No promises in the simulation.',
        },
      ],
      'no-restricted-imports': ['error', { patterns: FORBIDDEN_FROM_GAME }],
    },
  },

  // --- render/ is pure too, but may depend on game/ ------------------------------------------
  {
    files: ['render/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom'],
              message: 'render/ is pure TypeScript. React belongs in components/.',
            },
            { group: ['react-native', 'react-native/*'], message: 'render/ is pure TypeScript.' },
            {
              group: [...layer('app'), ...layer('components')],
              message: 'render/ must not import from layers above it.',
            },
          ],
        },
      ],
    },
  },

  // --- components/ and app/ consume the presentation model, never GameState ------------------
  {
    files: ['components/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: layer('game'),
              message:
                'Components consume the presentation model from render/, never GameState directly. That seam is what keeps the renderer swappable — see ADR-0003.',
            },
          ],
        },
      ],
    },
  },

  // --- Tests may reach anywhere ---------------------------------------------------------------
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'e2e/**/*.ts', 'tests/**/*.ts'],
    rules: {
      'no-restricted-properties': 'off',
      'no-restricted-imports': 'off',
      'no-restricted-syntax': 'off',
      'no-restricted-globals': 'off',
    },
  },
]);
