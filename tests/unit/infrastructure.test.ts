import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Proves the Vitest harness works, and guards the two structural contracts the rest of the
 * testing strategy depends on (docs/ARCHITECTURE.md, ADR-0004):
 *
 *   1. game/ is deterministic  — no ambient randomness, no clock
 *   2. dependencies point down — no layer imports from a layer above it
 *
 * ESLint enforces both, but lint can be disabled inline and a CI job can be renamed or skipped.
 * A failing test is harder to wave away, and this invariant is load-bearing enough to deserve
 * belt and braces.
 *
 * IMPORTANT: the scanner is itself tested against fixtures containing known violations. Without
 * that, these tests would pass vacuously whenever the scanned directories happen to be empty —
 * which is exactly the state the project starts in, and exactly when a broken scanner would go
 * unnoticed.
 */

const ROOT = path.resolve(__dirname, '../..');
const FIXTURES = path.join(ROOT, 'tests/unit/fixtures/contract-violations');

// --- The scanner ------------------------------------------------------------------------------

/**
 * Strip comments and string literals so the scanner reads code rather than prose.
 *
 * Without this the scanner flags its own documentation. A legitimate `game/rng/pcg32.ts` whose
 * docstring says "replaces Math.random(), which cannot be seeded" would fail CI — and the natural
 * response to a spurious failure is to reword the comment or loosen the scanner, both worse than
 * the false positive. Import specifiers are extracted before this runs, so quoted module paths
 * survive where they matter.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

function stripNonCode(source: string): string {
  return (
    stripComments(source)
      // string and template literals — emptied, not removed, so syntax stays intact
      .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
      .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
      .replace(/`(?:[^`\\]|\\.)*`/g, '``')
  );
}

/** Sources of nondeterminism. Forbidden anywhere in game/. */
const NONDETERMINISM = [
  { name: 'Math.random', pattern: /\bMath\s*\.\s*random\b/ },
  { name: 'Date.now', pattern: /\bDate\s*\.\s*now\b/ },
  { name: 'new Date', pattern: /\bnew\s+Date\b/ },
  { name: 'performance.now', pattern: /\bperformance\s*\.\s*now\b/ },
  // The natural substitute for someone told "no Math.random()", and just as unseedable.
  { name: 'crypto entropy', pattern: /\bcrypto\s*\.\s*(randomUUID|getRandomValues)\b/ },
];

/**
 * Every module specifier in a source file — static imports, re-exports, dynamic import(), and
 * require(). Extracting specifiers first and matching them separately is what lets the layer
 * check handle relative paths at arbitrary depth; a single regex over raw source reliably misses
 * `../../../render/model` while appearing to work on `../render/model`.
 */
function moduleSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g, // import x from 'y' / export * from 'y'
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // dynamic import('y')
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // require('y')
    /\bimport\s*['"]([^'"]+)['"]/g, // bare side-effect import 'y'
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

/** Does this specifier resolve into one of the given repo-root layer directories? */
function importsLayer(specifier: string, layers: string[]): string | null {
  for (const dir of layers) {
    // Matches `../dir/x`, `../../../dir/x`, `./dir/x`, `@/dir/x`, and the bare directory.
    if (new RegExp(`^(\\.{1,2}/)*(@/)?${dir}(/|$)`).test(specifier)) return dir;
  }
  return null;
}

/** Is this a package the layer is forbidden from depending on? */
function importsForbiddenPackage(specifier: string, packages: RegExp[]): boolean {
  return packages.some((p) => p.test(specifier));
}

const FRAMEWORK_PACKAGES = [
  /^react(-dom)?(\/|$)/,
  // `react-native(\/|$)` misses `react-native-reanimated` — the hyphen fails the alternation.
  // These are the same packages the lint groups cover; the two gates must agree.
  /^react-native([-/]|$)/,
  /^@react-navigation\//,
  /^expo([-/]|$)/,
  /^@expo\//,
];

/**
 * What each pure layer sits underneath. Dependencies point strictly downward:
 *
 *   app/ -> components/ -> session/ -> render/ -> game/
 *
 * Named rather than inlined at each call site because the fixture test below has to be handed the
 * *same* list as the contract test it stands in for. Two hand-copied arrays is how you get a
 * scanner proven against `['app', 'components', 'render', 'platform']` while the real check runs
 * against a shorter list nobody noticed was short.
 *
 * `session` is on the first two lists and not the third: it owns the run, so it calls into `game/`
 * and `render/` and neither may call back (ADR-0010). `platform/` is deliberately absent from the
 * upper two — it is a sibling of the pure layers, not a layer above them, and the same is true here
 * as it has always been for `render/`.
 */
const ABOVE_GAME = ['app', 'components', 'render', 'platform', 'session'];
const ABOVE_RENDER = ['app', 'components', 'session'];
const ABOVE_SESSION = ['app', 'components'];

type Violation = { file: string; detail: string };

function scanDeterminism(source: string, label: string): Violation[] {
  const code = stripNonCode(source);
  return NONDETERMINISM.filter(({ pattern }) => pattern.test(code)).map(({ name }) => ({
    file: label,
    detail: `uses ${name}`,
  }));
}

/**
 * @param forbiddenLayers repo-root layer directories this file must not import from
 * @param forbidFrameworks whether React/React Native/Expo are also banned. True for the pure
 *   layers (`game/`, `render/`); false for `components/`/`app/`, which exist to use them.
 */
function scanLayering(
  source: string,
  label: string,
  forbiddenLayers: string[],
  forbidFrameworks = true,
): Violation[] {
  const violations: Violation[] = [];
  // Specifiers are extracted from the raw source — they live inside quotes by definition, so
  // stripping strings first would erase exactly what we need to inspect. Comments are stripped
  // so a commented-out or documented import is not reported.
  for (const specifier of moduleSpecifiers(stripComments(source))) {
    const layer = importsLayer(specifier, forbiddenLayers);
    if (layer) violations.push({ file: label, detail: `imports ${layer}/ via '${specifier}'` });
    else if (forbidFrameworks && importsForbiddenPackage(specifier, FRAMEWORK_PACKAGES)) {
      violations.push({ file: label, detail: `imports framework package '${specifier}'` });
    }
  }
  return violations;
}

/**
 * Every non-test source file under a repo directory. Empty if the directory does not exist.
 *
 * Deliberately not limited to `.ts`: scoping the contract checks to one extension left a `.tsx`
 * or `.js` file under `game/` invisible to every gate while looking entirely ordinary.
 */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

function sourceFiles(dir: string): { abs: string; label: string }[] {
  const root = path.join(ROOT, dir);
  if (!fs.existsSync(root)) return [];

  const out: { abs: string; label: string }[] = [];
  const walk = (current: string) => {
    const entries = fs
      .readdirSync(current, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name)); // deterministic ordering, per our own rules
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (
        SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext)) &&
        !/\.test\.[cm]?[jt]sx?$/.test(entry.name)
      ) {
        out.push({ abs: full, label: path.relative(ROOT, full).replace(/\\/g, '/') });
      }
    }
  };
  walk(root);
  return out;
}

// --- Harness ----------------------------------------------------------------------------------

describe('test harness', () => {
  it('runs assertions that can fail', () => {
    expect(2 + 2).toBe(4);
    expect(() => expect(2 + 2).toBe(5)).toThrow();
  });

  it('resolves the @/ path alias', async () => {
    // vitest.config.ts maps @/ to the repo root. If this breaks, every game/ test fails with a
    // confusing module-resolution error instead of an obvious one.
    const mod = await import('@/tests/unit/fixtures/alias-probe');
    expect(mod.PROBE).toBe('alias-ok');
  });
});

// --- The scanner must be able to fail ----------------------------------------------------------

describe('contract scanner', () => {
  // These are the tests that stop the two suites below from being decorative. game/ and render/
  // are empty at M0, so without these the contract checks would assert [] === [] and report green
  // no matter how broken the scanner was.

  it('detects every form of nondeterminism', () => {
    const source = fs.readFileSync(path.join(FIXTURES, 'nondeterminism.ts.fixture'), 'utf8');
    const found = scanDeterminism(source, 'fixture').map((v) => v.detail);

    expect(found).toEqual(
      expect.arrayContaining([
        'uses Math.random',
        'uses Date.now',
        'uses new Date',
        'uses performance.now',
        'uses crypto entropy',
      ]),
    );
    expect(found).toHaveLength(NONDETERMINISM.length);
  });

  it('detects upward imports at any nesting depth, including relative paths', () => {
    const source = fs.readFileSync(path.join(FIXTURES, 'upward-imports.ts.fixture'), 'utf8');
    const found = scanLayering(source, 'fixture', ABOVE_GAME).map((v) => v.detail);

    // The relative-depth cases are the point: a scanner that only handles `../x` misses these.
    expect(found).toEqual(
      expect.arrayContaining([
        "imports components/ via '../../components/themed-text'",
        "imports render/ via '../../../render/model'",
        "imports platform/ via '../platform/save'",
        "imports app/ via '@/app/index'",
        "imports session/ via '@/session'", // bare directory behind the alias — no subpath
        "imports framework package 'react-native'",
        "imports framework package 'react'",
        "imports framework package 'expo-haptics'",
        "imports components/ via '../../components/themed-view'", // dynamic import()
        "imports render/ via '@/render/presentation'", // require()
      ]),
    );
    // Exact count, not just arrayContaining: a scanner regression that OVER-reports would
    // otherwise pass this test unnoticed.
    //
    // It is also the reason adding `session` to ABOVE_GAME had to come with a new line in the
    // fixture. Widening the forbidden list without widening the fixture leaves this number where it
    // was, which reads as "nothing broke" and actually means "the new layer is never exercised".
    // Was 9 before ADR-0010.
    expect(found).toHaveLength(10);
  });

  it('does not flag legitimate imports', () => {
    const clean = [
      "import { Rng } from '../rng/pcg32';",
      "import type { GameState } from './state';",
      "import { TILES } from '@/game/content/tiles';",
      "export * from './commands';",
      "import { deep } from '../../game/util/deep';",
    ].join('\n');

    expect(scanDeterminism(clean, 'clean')).toEqual([]);
    expect(scanLayering(clean, 'clean', ABOVE_GAME)).toEqual([]);

    // The other direction, and the one a too-eager list would break: session/ is *supposed* to
    // import the two layers under it. If these ever start reporting, the new rule has been written
    // as "session/ imports nothing" and the layer is unimplementable.
    const downward = [
      "import { presentScene } from '../render';",
      "import { step } from '../game/core';",
      "import type { Cue } from '@/render';",
    ].join('\n');

    expect(scanLayering(downward, 'downward', ABOVE_SESSION)).toEqual([]);
  });

  it('ignores comments and string literals', () => {
    // The scanner must read code, not prose. A docstring on the RNG module naming the API it
    // replaces is not a violation — and it is close to inevitable, given the commenting style
    // in this repo. See stripNonCode().
    const documented = [
      '/**',
      ' * PCG32 — the only source of randomness. Replaces Math.random(), which cannot be seeded,',
      " * and Date.now(). Never import from 'react' or '../../components/x' here.",
      ' */',
      "const HINT = 'do not call Date.now() or performance.now()';",
      '// new Date() is banned in game/',
      // Now that the determinism scan covers session/ too, this exact sentence is one somebody is
      // going to write there — ADR-0010 explains at length that beginRun takes a seed because
      // choosing one reads a clock. The doc that explains the rule must not trip the rule.
      '// The seed cannot come from Date.now(): choosing one is platform/ work. See ADR-0010.',
      'export const seedFrom = (s: string) => s.length;',
      'export { HINT };',
    ].join('\n');

    expect(scanDeterminism(documented, 'documented')).toEqual([]);
    expect(scanLayering(documented, 'documented', ABOVE_GAME)).toEqual([]);
  });

  it('still flags real violations that sit next to prose', () => {
    // The counterpart to the test above: stripping comments must not become a way to hide code.
    const mixed = ['// Math.random() is banned', 'export const r = Math.random();'].join('\n');
    expect(scanDeterminism(mixed, 'mixed').map((v) => v.detail)).toEqual(['uses Math.random']);
  });
});

// --- The contracts themselves -------------------------------------------------------------------

describe('determinism contract', () => {
  // All three pure layers, not just game/. The contract is that a run is a pure function of
  // (seed, inputs), and every layer below components/ is part of one:
  //
  //   - session/ decides what a run begins from. `beginRun(String(Date.now()))` is the most natural
  //     line anyone will ever write in this repo and it makes every run unreproducible, while game/
  //     stays provably pure and the layer gates stay green. This scan is what catches it.
  //   - render/ turns a state into a Scene. A clock read there makes what is on screen depend on
  //     *when* it was asked for, which no seed can reproduce and no replay test can pin.
  //
  // A separate `it` per layer rather than one flat-mapped scan, so the failure names the layer
  // instead of making you read a path out of an array diff.
  for (const dir of ['game', 'render', 'session'] as const) {
    it(`${dir}/ contains no source of nondeterminism`, () => {
      const files = sourceFiles(dir);
      // A vacuous pass is the failure mode this whole file exists to prevent: if the directory is
      // gone or renamed, sourceFiles() returns [] and the assertion below is [] === [].
      expect(files.length, `no source files found under ${dir}/ — did the directory move?`)
        .toBeGreaterThan(0);

      const violations = files.flatMap(({ abs, label }) =>
        scanDeterminism(fs.readFileSync(abs, 'utf8'), label),
      );
      expect(violations.map((v) => `${v.file}: ${v.detail}`)).toEqual([]);
    });
  }
});

describe('layer contract', () => {
  it('game/ does not import from the layers above it', () => {
    const violations = sourceFiles('game').flatMap(({ abs, label }) =>
      scanLayering(fs.readFileSync(abs, 'utf8'), label, ABOVE_GAME),
    );
    expect(violations.map((v) => `${v.file}: ${v.detail}`)).toEqual([]);
  });

  it('render/ does not import from the layers above it', () => {
    // render/ had no backstop at all before: unlinted under the old `expo lint` invocation and
    // unscanned here. It is pure TypeScript too, and the seam it forms is what makes the
    // renderer swappable (ADR-0003).
    const violations = sourceFiles('render').flatMap(({ abs, label }) =>
      scanLayering(fs.readFileSync(abs, 'utf8'), label, ABOVE_RENDER),
    );
    expect(violations.map((v) => `${v.file}: ${v.detail}`)).toEqual([]);
  });

  it('session/ does not import from the layers above it', () => {
    // session/ is the layer that makes the ban on `components/ -> game/` survivable (ADR-0010): it
    // holds the GameState so nothing above it has to. That only works while session/ is itself
    // pure — a `react-native` import here, or a reach back down into components/ for a theme
    // constant, and the last layer that can be exercised without a browser stops being one.
    //
    // Not a duplicate of the ESLint block: this also sees `await import('@/components/x')` and
    // `require('react-native')`, which `no-restricted-imports` does not inspect at all, and it
    // keeps working if someone adds an inline eslint-disable.
    const violations = sourceFiles('session').flatMap(({ abs, label }) =>
      scanLayering(fs.readFileSync(abs, 'utf8'), label, ABOVE_SESSION),
    );
    expect(violations.map((v) => `${v.file}: ${v.detail}`)).toEqual([]);
  });

  it('components/ and app/ do not reach into game/', () => {
    // ESLint covers the static-import case; this also catches `await import('@/game/step')`,
    // which no-restricted-imports does not inspect at all.
    //
    // ── The third path is a test file, deliberately, and it is the only one in this suite. ──────
    // `tests/unit/session-consumer.test.ts` is ADR-0010's proof that obeying a component's import
    // rules is *sufficient* to build a UI — it gets from `beginRun()` to a rendered `Scene` using
    // only `@/session` and `@/render`. Its own header calls it "the one file in the repo bound by a
    // component's import rules", and until this line that sentence was false: `eslint.config.js`
    // switches `no-restricted-imports` off for `tests/**`, and the scan above walks only
    // `components/` and `app/`. So a future agent could add `import { step } from '@/game/core'` to
    // make a type resolve, all three gates would stay green, and the repo's only
    // proof-of-reachability-from-outside would quietly stop being from outside — while still
    // *reading* as proof, which is the exact failure mode PR #51 was sent back for.
    //
    // `sourceFiles` excludes `*.test.*` by design, so this is named explicitly rather than by
    // widening that helper: it is one file with a specific job, not a new category of scanned file.
    const violations = [
      ...sourceFiles('components'),
      ...sourceFiles('app'),
      {
        abs: path.join(ROOT, 'tests', 'unit', 'session-consumer.test.ts'),
        label: 'tests/unit/session-consumer.test.ts',
      },
    ].flatMap(({ abs, label }) =>
      scanLayering(fs.readFileSync(abs, 'utf8'), label, ['game'], false),
    );
    expect(violations.map((v) => `${v.file}: ${v.detail}`)).toEqual([]);
  });

  it("the journal's format template holds a template and nothing else", () => {
    // Not hypothetical, and not a small mistake: between PR #10 and PR #30, **175 lines of real
    // journal content** accumulated inside this fenced block. Every review addendum went there,
    // because an agent appending after its entry's `**Next:**` line matched the *template's*
    // `**Next:**` first, and each PR appended after the last. The block grew from 9 lines to 184
    // across seven merged PRs with a `code-reviewer` pass on every one of them, because a diff
    // cannot show you that a file's structure is wrong — each individual hunk looked like a
    // plausible addendum near the top of a journal.
    //
    // `CLAUDE.md` sends every session to this file first, so the cost was paid by every cold
    // reader. The `code-reviewer` agent now has an instruction to check where an entry landed,
    // but an instruction is the same class of defence that already failed seven times: it works
    // exactly as long as someone chooses to read. This is the structural version.
    const journal = fs.readFileSync(path.join(ROOT, 'docs/JOURNAL.md'), 'utf8');

    // Scoped to the `## Format` section, not to the first fence in the file. Matching the first
    // ```markdown anywhere was a demonstrated bypass: adding an ordinary example fence to the
    // prose *above* Format made this test pass green with the full 184-line corruption still in
    // the template. A guard someone can walk past by writing documentation is not a guard.
    //
    // The section has to be found by walking lines and tracking fence state, not by searching for
    // the next `## `: the template's own `## YYYY-MM-DD` heading is *inside* the fence, so a naive
    // search ends the section in the middle of the thing being checked.
    const all = journal.split('\n');
    const from = all.findIndex((line) => line.trim() === '## Format');
    expect(from, 'docs/JOURNAL.md has no `## Format` section').toBeGreaterThan(-1);

    const section: string[] = [];
    let inFence = false;
    for (const line of all.slice(from + 1)) {
      if (line.startsWith('```')) inFence = !inFence;
      if (!inFence && line.startsWith('## ')) break;
      section.push(line);
    }

    const fence = /```markdown\n([\s\S]*?)```/.exec(section.join('\n'));
    expect(fence, 'the `## Format` section has no ```markdown template block').not.toBeNull();
    const template = (fence as RegExpExecArray)[1];
    const lines = template.split('\n').filter((line) => line.trim() !== '');

    // The skeleton is one heading plus the five `**Field:**` lines. Ten is roomy enough that
    // adding a field is not a test failure, and far below the 184 lines this reached.
    expect(lines.length, `the template block has ${lines.length} non-blank lines:\n${template}`)
      .toBeLessThanOrEqual(10);

    // The general check, and the one that does the work: **a template is a heading and field
    // labels, and nothing else.** Real entries are wrapped prose, so their *continuation* lines
    // never begin with `**` — which is what makes this catch a leak on its second line no matter
    // what bold label opened it. A list of known labels is the check that rots: a novel one
    // (`**Post-merge note:**`) walked past exactly such a list, and the next leak will not be
    // considerate enough to reuse a name we already know.
    const notTemplateShaped = lines.filter((line) => !/^(## |\*\*)/.test(line));
    expect(
      notTemplateShaped,
      'prose was appended into the format template — move it to the entry it belongs to',
    ).toEqual([]);

    // Kept alongside the general check, not instead of it: when the leak *is* one of the two
    // shapes that actually happened, this names it, and a failure that explains itself gets fixed
    // properly rather than deleted.
    const leaked = lines.filter((line) => /^\*\*(Review addendum|Design rulings)/.test(line));
    expect(leaked, 'journal content was appended into the format template — move it to its entry')
      .toEqual([]);
  });

  it('the pure layers contain only .ts files', () => {
    // A .tsx or .js under game/, render/ or session/ is itself a violation — those layers have no
    // JSX and no untyped code. Asserting this directly is stronger than widening every rule's glob
    // to cover extensions that should never appear.
    //
    // For session/ the .tsx case is the live temptation, not a hypothetical: the layer's whole job
    // is to be called from React, so the shortest path from `beginRun` to a screen is a
    // `useRun.tsx` hook parked next to `run.ts`. That file would be a React component in the last
    // pure layer, and every rule above is scoped by directory, so nothing else would object.
    const stray = [...sourceFiles('game'), ...sourceFiles('render'), ...sourceFiles('session')]
      .filter(({ label }) => !label.endsWith('.ts'))
      .map(({ label }) => label);

    expect(stray).toEqual([]);
  });
});
