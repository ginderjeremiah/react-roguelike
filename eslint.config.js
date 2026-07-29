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

/**
 * Every extension a source file could plausibly use. Scoping the contract rules to `*.ts` alone
 * left an open door: a `.tsx` or `.js` file under `game/` escaped every rule below while looking
 * completely normal. `game/` and `render/` should contain only `.ts` — a `.tsx` there is itself a
 * violation, and the unit suite asserts that separately — but the rules must still apply if one
 * appears, rather than falling silent on it.
 */
const SOURCE = '{ts,tsx,mts,cts,js,jsx,mjs,cjs}';

/** Framework packages the pure layers must never depend on. */
const FRAMEWORK_GROUPS = [
  {
    group: ['react', 'react-dom', 'react/*', 'react-dom/*'],
    message: 'game/ is pure TypeScript. No React. See docs/ARCHITECTURE.md.',
  },
  {
    // `react-native` alone misses `react-native-reanimated` and friends, which are just as
    // platform-bound and were previously permitted.
    group: ['react-native', 'react-native/*', 'react-native-*', '@react-navigation/*'],
    message: 'game/ is pure TypeScript. No React Native.',
  },
  {
    group: ['expo', 'expo-*', '@expo/*'],
    message: 'game/ is platform-agnostic. Platform access belongs in platform/.',
  },
];

/** Layers game/ is forbidden from importing. Dependencies point strictly downward. */
const FORBIDDEN_FROM_GAME = [
  ...FRAMEWORK_GROUPS,
  {
    group: [...layer('app'), ...layer('components'), ...layer('render'), ...layer('platform')],
    message: 'game/ must not import from layers above it. Dependencies point downward only.',
  },
];

/**
 * `no-restricted-imports` inspects static import declarations only — it ignores `import()` and
 * `require()` entirely, so `await import('@/game/step')` in a component slipped through the
 * layer gate. These selectors close that path.
 *
 * NOTE: `pattern` must not contain a literal `/`. esquery delimits regex attribute values with
 * slashes and does not handle escaping them — a `\/` crashes ESLint with a config-level
 * SyntaxError rather than reporting a lint error. Use the `\x2f` hex escape instead.
 */
const dynamicImportOf = (pattern, message) => [
  {
    selector: `ImportExpression > Literal[value=${pattern}]`,
    message,
  },
  {
    selector: `CallExpression[callee.name='require'] > Literal[value=${pattern}]`,
    message,
  },
];

module.exports = defineConfig([
  expoConfig,

  {
    ignores: ['dist/*', 'node_modules/*', 'playwright-report/*', 'test-results/*', '.expo/*'],
  },

  // --- Determinism + layer rules for the simulation core -------------------------------------
  {
    files: [`game/**/*.${SOURCE}`],
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
        {
          // ARCHITECTURE.md claims "no promises, no I/O" is lint-enforced. Without these it was
          // enforced only for `await`, `async`, and `new Promise` — `Promise.all(...)` and
          // `fetch(...)` passed cleanly, making the doc aspirational.
          selector: "MemberExpression[object.name='Promise']",
          message: 'game/ is synchronous. No promises in the simulation.',
        },
        {
          selector:
            "CallExpression[callee.name=/^(fetch|setTimeout|setInterval|queueMicrotask|structuredClone)$/]",
          message: 'game/ performs no I/O and has no clock. See ADR-0004.',
        },
        {
          selector: "NewExpression[callee.name=/^(XMLHttpRequest|WebSocket|Worker)$/]",
          message: 'game/ performs no I/O. See ADR-0004.',
        },
        ...dynamicImportOf(
          '/^(react|react-dom|react-native|expo)($|[-\\x2f])|^@(expo|react-navigation)\\x2f/',
          'game/ is pure TypeScript and platform-agnostic. See docs/ARCHITECTURE.md.',
        ),
        ...dynamicImportOf(
          '/(^|\\x2f)(app|components|render|platform)(\\x2f|$)/',
          'game/ must not import from layers above it, dynamically or otherwise.',
        ),
      ],
      'no-restricted-imports': ['error', { patterns: FORBIDDEN_FROM_GAME }],
    },
  },

  // --- render/ is pure too, but may depend on game/ ------------------------------------------
  {
    files: [`render/**/*.${SOURCE}`],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...dynamicImportOf(
          '/^(react|react-dom|react-native)($|[-\\x2f])|(^|\\x2f)(app|components)(\\x2f|$)/',
          'render/ is pure TypeScript and must not import from layers above it.',
        ),
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', 'react/*', 'react-dom/*'],
              message: 'render/ is pure TypeScript. React belongs in components/.',
            },
            {
              group: ['react-native', 'react-native/*', 'react-native-*', '@react-navigation/*'],
              message: 'render/ is pure TypeScript.',
            },
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
    files: [`components/**/*.${SOURCE}`, `app/**/*.${SOURCE}`],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...dynamicImportOf(
          '/(^|\\x2f)game(\\x2f|$)/',
          'Components consume the presentation model from render/, never GameState directly — dynamically or otherwise. See ADR-0003.',
        ),
      ],
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
