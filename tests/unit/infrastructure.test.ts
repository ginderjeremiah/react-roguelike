import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Proves the Vitest harness is wired correctly, and guards the two structural contracts that
 * the rest of the testing strategy depends on (docs/ARCHITECTURE.md, ADR-0004).
 *
 * These are deliberately real assertions rather than a smoke test — a placeholder test that
 * cannot fail is worse than no test, because it makes the suite look like it is protecting
 * something when it is not.
 */

const ROOT = path.resolve(__dirname, '../..');

/** Every .ts file under a directory, recursively. Empty array if the directory does not exist. */
function sourceFiles(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];

  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full);
    }
  };
  walk(abs);
  return out;
}

describe('test harness', () => {
  it('runs assertions that can fail', () => {
    expect(2 + 2).toBe(4);
    expect(() => expect(2 + 2).toBe(5)).toThrow();
  });

  it('resolves the @/ path alias', async () => {
    // vitest.config.ts maps @/ to the repo root. If this breaks, every game/ test breaks with a
    // confusing module-resolution error instead of an obvious one.
    const mod = await import('@/tests/unit/fixtures/alias-probe');
    expect(mod.PROBE).toBe('alias-ok');
  });
});

describe('determinism contract', () => {
  // Lint enforces this too, but lint can be disabled inline and CI jobs can be skipped.
  // A test failure is harder to wave away, and this invariant is load-bearing enough
  // to deserve belt and braces. See ADR-0004.
  const FORBIDDEN: { pattern: RegExp; why: string }[] = [
    { pattern: /\bMath\s*\.\s*random\b/, why: 'use the seeded Rng threaded through GameState' },
    { pattern: /\bDate\s*\.\s*now\b/, why: 'the simulation has turns, not time' },
    { pattern: /\bnew\s+Date\b/, why: 'the simulation has turns, not time' },
    { pattern: /\bperformance\s*\.\s*now\b/, why: 'the simulation has turns, not time' },
  ];

  it('game/ contains no source of nondeterminism', () => {
    const violations: string[] = [];

    for (const file of sourceFiles('game')) {
      const contents = fs.readFileSync(file, 'utf8');
      for (const { pattern, why } of FORBIDDEN) {
        if (pattern.test(contents)) {
          violations.push(`${path.relative(ROOT, file)}: ${pattern.source} — ${why}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('game/ does not import from the layers above it', () => {
    const forbidden = /from\s+['"](react|react-dom|react-native|expo|expo-[\w-]+|@expo\/[\w-]+|@\/(app|components|render|platform)\/)/;
    const violations: string[] = [];

    for (const file of sourceFiles('game')) {
      const contents = fs.readFileSync(file, 'utf8');
      if (forbidden.test(contents)) {
        violations.push(path.relative(ROOT, file));
      }
    }

    expect(violations).toEqual([]);
  });
});
