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

/** Sources of nondeterminism. Forbidden anywhere in game/. */
const NONDETERMINISM = [
  { name: 'Math.random', pattern: /\bMath\s*\.\s*random\b/ },
  { name: 'Date.now', pattern: /\bDate\s*\.\s*now\b/ },
  { name: 'new Date', pattern: /\bnew\s+Date\b/ },
  { name: 'performance.now', pattern: /\bperformance\s*\.\s*now\b/ },
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

const FRAMEWORK_PACKAGES = [/^react(-dom)?(\/|$)/, /^react-native(\/|$)/, /^expo(-[\w-]+)?(\/|$)/, /^@expo\//];

type Violation = { file: string; detail: string };

function scanDeterminism(source: string, label: string): Violation[] {
  return NONDETERMINISM.filter(({ pattern }) => pattern.test(source)).map(({ name }) => ({
    file: label,
    detail: `uses ${name}`,
  }));
}

function scanLayering(source: string, label: string, forbiddenLayers: string[]): Violation[] {
  const violations: Violation[] = [];
  for (const specifier of moduleSpecifiers(source)) {
    const layer = importsLayer(specifier, forbiddenLayers);
    if (layer) violations.push({ file: label, detail: `imports ${layer}/ via '${specifier}'` });
    else if (importsForbiddenPackage(specifier, FRAMEWORK_PACKAGES)) {
      violations.push({ file: label, detail: `imports framework package '${specifier}'` });
    }
  }
  return violations;
}

/** Every non-test .ts file under a repo directory. Empty if the directory does not exist. */
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
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
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
      ]),
    );
    expect(found).toHaveLength(NONDETERMINISM.length);
  });

  it('detects upward imports at any nesting depth, including relative paths', () => {
    const source = fs.readFileSync(path.join(FIXTURES, 'upward-imports.ts.fixture'), 'utf8');
    const found = scanLayering(source, 'fixture', ['app', 'components', 'render', 'platform']).map(
      (v) => v.detail,
    );

    // The relative-depth cases are the point: a scanner that only handles `../x` misses these.
    expect(found).toEqual(
      expect.arrayContaining([
        "imports components/ via '../../components/themed-text'",
        "imports render/ via '../../../render/model'",
        "imports platform/ via '../platform/save'",
        "imports app/ via '@/app/index'",
        "imports framework package 'react-native'",
        "imports framework package 'react'",
        "imports framework package 'expo-haptics'",
        "imports components/ via '../../components/themed-view'", // dynamic import()
        "imports render/ via '@/render/presentation'", // require()
      ]),
    );
  });

  it('does not flag legitimate imports', () => {
    const clean = [
      "import { Rng } from '../rng/pcg32';",
      "import type { GameState } from './state';",
      "import { TILES } from '@/game/content/tiles';",
      "export * from './commands';",
    ].join('\n');

    expect(scanDeterminism(clean, 'clean')).toEqual([]);
    expect(scanLayering(clean, 'clean', ['app', 'components', 'render', 'platform'])).toEqual([]);
  });
});

// --- The contracts themselves -------------------------------------------------------------------

describe('determinism contract', () => {
  it('game/ contains no source of nondeterminism', () => {
    const violations = sourceFiles('game').flatMap(({ abs, label }) =>
      scanDeterminism(fs.readFileSync(abs, 'utf8'), label),
    );
    expect(violations.map((v) => `${v.file}: ${v.detail}`)).toEqual([]);
  });
});

describe('layer contract', () => {
  it('game/ does not import from the layers above it', () => {
    const violations = sourceFiles('game').flatMap(({ abs, label }) =>
      scanLayering(fs.readFileSync(abs, 'utf8'), label, ['app', 'components', 'render', 'platform']),
    );
    expect(violations.map((v) => `${v.file}: ${v.detail}`)).toEqual([]);
  });

  it('render/ does not import from the layers above it', () => {
    // render/ had no backstop at all before: unlinted under the old `expo lint` invocation and
    // unscanned here. It is pure TypeScript too, and the seam it forms is what makes the
    // renderer swappable (ADR-0003).
    const violations = sourceFiles('render').flatMap(({ abs, label }) =>
      scanLayering(fs.readFileSync(abs, 'utf8'), label, ['app', 'components']),
    );
    expect(violations.map((v) => `${v.file}: ${v.detail}`)).toEqual([]);
  });
});
