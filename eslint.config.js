// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

// The rules below are not style preferences — they mechanically enforce the two contracts the
// project's testing strategy depends on (see docs/ARCHITECTURE.md and ADR-0004):
//
//   1. the pure layers are deterministic — no ambient randomness, no clock, in game/, render/
//      and session/ alike
//   2. dependencies point down           — no layer knows the layers above it exist
//
// A violation is a build failure, not a warning. Determinism is all-or-nothing: one stray
// Math.random() silently invalidates every replay test in the repo.
//
// **Contract 1 covers all three pure layers, and that is deliberate rather than defensive.** It used
// to stop at game/, which read as "the simulation is the deterministic part" — but the property that
// actually matters is that a run is a pure function of (seed, inputs), and *every* layer under
// components/ participates in one. session/ owns the run and chooses nothing itself only because a
// `beginRun(String(Date.now()))` is forbidden; render/ turns a state into a Scene, and a clock read
// there makes what is on screen depend on when you looked. Neither is less fatal than a Math.random()
// in game/ — only less likely, and "less likely" is not a thing a gate can be built on.
//
// **The ban stops at determinism sources, and stops there on purpose.** game/'s block additionally
// forbids promises, async, I/O, and window/document/localStorage; those are NOT extended upward.
// game/ is a synchronous reducer, but session/ sits directly under React and the platform/ seam is
// asynchronous by design (`SaveStore` returns promises — ARCHITECTURE.md). Banning promises in
// session/ would be a rule repealed the moment save/resume lands, and a repealed rule teaches
// everyone that the rules are negotiable.

/**
 * Globals that make a run irreproducible. Forbidden in every pure layer — see the header for why
 * this is not game/-only, and `DETERMINISM_RULES` below for the set as it is actually applied.
 */
const NONDETERMINISTIC_PROPERTIES = [
  {
    object: 'Math',
    property: 'random',
    message:
      'The pure layers are deterministic. game/ uses the seeded Rng threaded through GameState; render/ and session/ derive everything from the state they are handed. See ADR-0004.',
  },
  {
    object: 'Date',
    property: 'now',
    message:
      'The pure layers have turns, not time. Nothing below components/ may read the clock — a timestamped seed or a wall-clock frame input is a run nobody can reproduce. See ADR-0004.',
  },
  {
    object: 'performance',
    property: 'now',
    message:
      'The pure layers have turns, not time. Nothing below components/ may read the clock. See ADR-0004.',
  },
  {
    // The obvious thing to reach for when told "no Math.random()", and just as unseedable.
    object: 'crypto',
    property: 'randomUUID',
    message:
      'The pure layers are deterministic. Ids come from state, not from entropy. Use the seeded Rng. See ADR-0004.',
  },
  {
    object: 'crypto',
    property: 'getRandomValues',
    message:
      'The pure layers are deterministic. Use the seeded Rng threaded through GameState instead. See ADR-0004.',
  },
];

/**
 * The determinism ban, as one reusable block: the restricted properties above, the `crypto` global
 * (because `randomUUID()` unqualified is the same call with the object elided), and `new Date()`
 * (which `no-restricted-properties` cannot see — it is a constructor, not a member read).
 *
 * Factored rather than copied into each of the three layer blocks. A hand-copied rule list is
 * exactly how `render/`'s dynamic-import guard came to ban `expo` statically and permit it
 * dynamically: the copies drifted, silently, and nobody chose the difference.
 *
 * Spread into a layer's block; layers with additional rules of their own append to these arrays.
 */
const DETERMINISM_RULES = {
  properties: NONDETERMINISTIC_PROPERTIES,
  globals: [
    {
      name: 'crypto',
      message:
        'The pure layers are deterministic. Use the seeded Rng threaded through GameState. See ADR-0004.',
    },
  ],
  syntax: [
    {
      selector: "NewExpression[callee.name='Date']",
      message:
        'The pure layers have turns, not time. Nothing below components/ may read the clock. See ADR-0004.',
    },
  ],
};

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
    group: [
      ...layer('app'),
      ...layer('components'),
      ...layer('render'),
      ...layer('platform'),
      // session/ owns the run and calls step(); the simulation must not know it exists. ADR-0010.
      ...layer('session'),
    ],
    message: 'game/ must not import from layers above it. Dependencies point downward only.',
  },
];

/**
 * The framework half of every pure layer's dynamic-import guard.
 *
 * Kept as one string rather than retyped per layer because the two copies drifted once already:
 * `render/`'s static rule banned `expo` while its dynamic selector did not, so
 * `await import('expo-haptics')` was legal in `render/` and illegal in `game/` for no reason
 * anybody chose. The scanner in tests/unit/infrastructure.test.ts always treated them alike.
 */
const DYNAMIC_FRAMEWORK =
  '^(react|react-dom|react-native|expo)($|[-\\x2f])|^@(expo|react-navigation)\\x2f';

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
    ignores: [
      'dist/*',
      'node_modules/*',
      'playwright-report/*',
      'test-results/*',
      '.expo/*',
      // Agents run in git worktrees created under .claude/worktrees/. Those contain a full copy
      // of the repo, so without this `eslint .` lints every agent's working tree as well as your
      // own — reporting failures for code that is not in your branch.
      //
      // CI CANNOT CATCH A REGRESSION HERE: it runs on a clean checkout where the directory never
      // exists, so deleting this line stays green in CI and only breaks on a machine mid-agent-run.
      // The same applies to the matching entries in .gitignore, tsconfig.json, and metro.config.js.
      '.claude/worktrees/**',
    ],
  },

  // --- Determinism + layer rules for the simulation core -------------------------------------
  {
    files: [`game/**/*.${SOURCE}`],
    rules: {
      'no-restricted-properties': ['error', ...DETERMINISM_RULES.properties],
      'no-restricted-globals': [
        'error',
        ...DETERMINISM_RULES.globals,
        // game/-only: the simulation is platform-agnostic as well as deterministic. render/ and
        // session/ are equally forbidden these by the layer rules (nothing to import them from),
        // and the DOM globals are a different contract from determinism — see the header.
        { name: 'window', message: 'game/ is platform-agnostic.' },
        { name: 'document', message: 'game/ is platform-agnostic.' },
        { name: 'localStorage', message: 'Persistence belongs in platform/. See ADR-0006.' },
      ],
      'no-restricted-syntax': [
        'error',
        ...DETERMINISM_RULES.syntax,
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
          // structuredClone is deliberately NOT here — it is synchronous, deterministic, and
          // side-effect free, so it is a legitimate way to copy immutable state.
          selector: "CallExpression[callee.name=/^(fetch|setTimeout|setInterval|queueMicrotask)$/]",
          message: 'game/ performs no I/O and has no clock. See ADR-0004.',
        },
        {
          selector: "NewExpression[callee.name=/^(XMLHttpRequest|WebSocket|Worker)$/]",
          message: 'game/ performs no I/O. See ADR-0004.',
        },
        ...dynamicImportOf(
          `/${DYNAMIC_FRAMEWORK}/`,
          'game/ is pure TypeScript and platform-agnostic. See docs/ARCHITECTURE.md.',
        ),
        ...dynamicImportOf(
          '/(^|\\x2f)(app|components|render|platform|session)(\\x2f|$)/',
          'game/ must not import from layers above it, dynamically or otherwise.',
        ),
      ],
      'no-restricted-imports': ['error', { patterns: FORBIDDEN_FROM_GAME }],
    },
  },

  // --- render/ is pure too, but may depend on game/ ------------------------------------------
  //
  // Deterministic as well as pure. `presentScene` is a function of the state it is handed and of
  // nothing else — a `Date.now()` here would make the Scene depend on when it was asked for, which
  // is the same bug as a clock in game/ wearing a different hat, and it would break
  // `render/accessibility.test.ts`'s properties-over-real-runs in a way no seed could reproduce.
  {
    files: [`render/**/*.${SOURCE}`],
    rules: {
      'no-restricted-properties': ['error', ...DETERMINISM_RULES.properties],
      'no-restricted-globals': ['error', ...DETERMINISM_RULES.globals],
      'no-restricted-syntax': [
        'error',
        ...DETERMINISM_RULES.syntax,
        // Two selectors, not one alternation, so the message names the actual mistake. A single
        // combined pattern reported `await import('expo-haptics')` as "must not import from layers
        // above it", which is both wrong and unactionable.
        ...dynamicImportOf(
          `/${DYNAMIC_FRAMEWORK}/`,
          'render/ is pure TypeScript and platform-agnostic. React belongs in components/.',
        ),
        ...dynamicImportOf(
          '/(^|\\x2f)(app|components|session)(\\x2f|$)/',
          'render/ must not import from layers above it, dynamically or otherwise.',
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
              // The test scanner already treats expo as forbidden in render/; without this the
              // two gates disagreed about what render/ may depend on.
              group: ['expo', 'expo-*', '@expo/*'],
              message: 'render/ is platform-agnostic. Platform access belongs in platform/.',
            },
            {
              // session/ sits above render/ and imports presentScene. The dependency runs one way:
              // render/ turns a GameState into a Scene and has no idea who asked. ADR-0010.
              group: [...layer('app'), ...layer('components'), ...layer('session')],
              message: 'render/ must not import from layers above it.',
            },
          ],
        },
      ],
    },
  },

  // --- session/ owns the run: pure TypeScript, may depend on render/ and game/ -----------------
  //
  // The layer exists so that GameState stops being nameable above it (ADR-0010), which only works
  // if session/ itself stays testable in Vitest with no DOM — the moment a `react-native` import
  // lands here, the layer that is supposed to be the last pure one stops being pure and the run
  // can only be exercised through a component.
  //
  // The determinism ban matters MORE here than anywhere except game/, and it is the reason it was
  // extended past game/ at all. session/ is the layer that decides what a run starts from, so
  // `beginRun(String(Date.now()))` is the single most natural line anyone will ever try to write in
  // this repo, and it would break replay while leaving game/ provably pure and every other gate
  // green. Choosing a seed reads a clock and therefore belongs to platform/; beginRun takes one.
  {
    files: [`session/**/*.${SOURCE}`],
    rules: {
      'no-restricted-properties': ['error', ...DETERMINISM_RULES.properties],
      'no-restricted-globals': ['error', ...DETERMINISM_RULES.globals],
      'no-restricted-syntax': [
        'error',
        ...DETERMINISM_RULES.syntax,
        ...dynamicImportOf(
          `/${DYNAMIC_FRAMEWORK}/`,
          'session/ is pure TypeScript and platform-agnostic. React belongs in components/. See ADR-0010.',
        ),
        ...dynamicImportOf(
          '/(^|\\x2f)(app|components)(\\x2f|$)/',
          'session/ must not import from layers above it, dynamically or otherwise.',
        ),
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', 'react/*', 'react-dom/*'],
              message:
                'session/ is pure TypeScript. A Run is a value, not a hook — React belongs in components/. See ADR-0010.',
            },
            {
              group: ['react-native', 'react-native/*', 'react-native-*', '@react-navigation/*'],
              message: 'session/ is pure TypeScript.',
            },
            {
              group: ['expo', 'expo-*', '@expo/*'],
              message:
                "session/ is platform-agnostic. Reading a clock or a save file is platform/'s job — beginRun() takes a seed.",
            },
            {
              group: [...layer('app'), ...layer('components')],
              message: 'session/ must not import from layers above it.',
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
