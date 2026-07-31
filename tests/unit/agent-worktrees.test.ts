import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import {
  AGENT_WORKTREE_PATTERN,
  blockOtherAgentWorktrees,
  isInsideAgentWorktree,
} from '@/scripts/agent-worktrees';
import { planNodeModulesLink } from '@/scripts/ensure-worktree-node-modules.mjs';

/**
 * Guards the two pieces of build tooling that make a git worktree behave like the main checkout
 * (issue #49). Both were broken in the same shape and for the same reason:
 *
 *   1. `build:web` — metro.config.js blocks `.claude/worktrees/` by ABSOLUTE path, so running it
 *      from inside a worktree blocked that worktree's own app/ and expo-router exported no routes.
 *   2. `test:e2e`  — a worktree has no node_modules, and Playwright's tsconfig resolver does not
 *      walk up to the main checkout's, so it failed on `extends: expo/tsconfig.base`.
 *
 * **CI cannot catch a regression in either.** It runs on a clean checkout where
 * `.claude/worktrees/` does not exist and node_modules always does, so both fixes are on the
 * no-op path there and stay green however broken they are. These tests are the whole gate — the
 * same situation as the `expo lint` episode, where a check silently stopped covering what
 * everyone believed it covered.
 */

const ROOT = path.resolve(__dirname, '../..');

// --- The predicate ------------------------------------------------------------------------------

describe('isInsideAgentWorktree', () => {
  // Both separator styles throughout: this repo is developed on Windows and built on Linux, and
  // Metro matches against real filesystem paths in the local style. A POSIX-only predicate would
  // pass CI and leave build:web broken on every dev machine — which is precisely the environment
  // where worktrees exist at all.

  it('is false for a main checkout', () => {
    expect(isInsideAgentWorktree('/home/runner/work/react-roguelike')).toBe(false);
    expect(isInsideAgentWorktree('C:\\Users\\dev\\source\\react-roguelike')).toBe(false);
  });

  it('is true for a worktree root, in either separator style', () => {
    expect(isInsideAgentWorktree('/repo/.claude/worktrees/verify-49')).toBe(true);
    expect(isInsideAgentWorktree('C:\\repo\\.claude\\worktrees\\verify-49')).toBe(true);
    // Windows tools mix them freely — `git rev-parse` prints forward slashes on Windows, and
    // path.join then appends backslashes to the same string.
    expect(isInsideAgentWorktree('C:\\repo/.claude\\worktrees/verify-49')).toBe(true);
  });

  it('is true anywhere below a worktree root', () => {
    // Metro is handed file paths, not project roots, elsewhere in this system; and an agent can
    // run npm from a subdirectory.
    expect(isInsideAgentWorktree('/repo/.claude/worktrees/verify-49/app/_layout.tsx')).toBe(true);
  });

  it('is false for the worktrees container itself', () => {
    // `.claude/worktrees` holds worktrees; it is not one. If this returned true, a hypothetical
    // caller standing there would skip the blockList for no reason.
    expect(isInsideAgentWorktree('/repo/.claude/worktrees')).toBe(false);
    expect(isInsideAgentWorktree('/repo/.claude/worktrees/')).toBe(false);
  });

  it('is false for near-misses that a substring match would accept', () => {
    // The false-positive direction is the dangerous one: it disables the blockList in the MAIN
    // checkout, where Metro then crawls every agent's worktree and any node_modules inside it.
    // Each of these passes a naive `dir.includes('.claude/worktrees')`-style or loosely anchored
    // check.
    expect(isInsideAgentWorktree('/repo/worktrees/verify-49')).toBe(false); // no .claude segment
    expect(isInsideAgentWorktree('/repo/.claude/agents/x')).toBe(false); // .claude, but not worktrees
    expect(isInsideAgentWorktree('/repo/my.claude/worktrees/x')).toBe(false); // suffix of a longer name
    expect(isInsideAgentWorktree('/repo/.claude/worktrees-old/x')).toBe(false); // prefix of a longer name
    expect(isInsideAgentWorktree('/repo/.claudex/worktrees/x')).toBe(false);
    expect(isInsideAgentWorktree('C:\\repo\\my.claude\\worktrees\\x')).toBe(false);
  });

  it('is false for junk input rather than throwing', () => {
    // Called with __dirname in production, so this is belt and braces — but a config file that
    // throws while loading fails the build with a stack trace instead of a message.
    expect(isInsideAgentWorktree('')).toBe(false);
    expect(isInsideAgentWorktree(undefined as unknown as string)).toBe(false);
  });
});

// --- The composed blockList ---------------------------------------------------------------------

/** Would Metro refuse to resolve this file, given a blockList? */
function blocks(blockList: unknown, filePath: string): boolean {
  const patterns = Array.isArray(blockList) ? blockList : [blockList].filter(Boolean);
  return patterns.some(
    (pattern) =>
      pattern instanceof RegExp &&
      // A fresh RegExp so a /g pattern's lastIndex cannot make this depend on call order.
      new RegExp(pattern.source, pattern.flags.replace('g', '')).test(filePath),
  );
}

describe('blockOtherAgentWorktrees', () => {
  // Testing the predicate alone would still pass if somebody stopped calling it — which is the
  // exact regression #49 was: the pattern was there, correct, and applied unconditionally.
  const base = () => ({ resolver: { blockList: [/[\\/]\.expo[\\/]types/] } });

  const MAIN = 'C:\\Users\\dev\\source\\react-roguelike';
  const WORKTREE = `${MAIN}\\.claude\\worktrees\\verify-49`;

  it('blocks other worktrees when the project root is the main checkout', () => {
    const { resolver } = blockOtherAgentWorktrees(base(), MAIN);

    expect(blocks(resolver.blockList, `${MAIN}\\.claude\\worktrees\\agent-a1\\app\\_layout.tsx`))
      .toBe(true);
    expect(blocks(resolver.blockList, `${MAIN}\\app\\_layout.tsx`)).toBe(false);
  });

  it('blocks nothing extra when the project root IS a worktree', () => {
    // The bug, stated directly: with the entry applied unconditionally this was `true`, Metro
    // refused to resolve the worktree's own routes, and `expo export` died with "No routes found".
    const { resolver } = blockOtherAgentWorktrees(base(), WORKTREE);

    expect(blocks(resolver.blockList, `${WORKTREE}\\app\\_layout.tsx`)).toBe(false);
    expect(blocks(resolver.blockList, `${WORKTREE}\\game\\core.ts`)).toBe(false);
    expect(resolver.blockList).not.toContain(AGENT_WORKTREE_PATTERN);
  });

  it('does the same for POSIX roots', () => {
    // CI is Linux. A predicate that only understood Windows paths would disable the blockList
    // there — silently, since the only symptom is a slower crawl.
    const posixMain = '/home/runner/work/react-roguelike';
    const fromMain = blockOtherAgentWorktrees(base(), posixMain).resolver.blockList;
    const fromWorktree = blockOtherAgentWorktrees(
      base(),
      `${posixMain}/.claude/worktrees/verify-49`,
    ).resolver.blockList;

    expect(blocks(fromMain, `${posixMain}/.claude/worktrees/agent-a1/app/_layout.tsx`)).toBe(true);
    expect(blocks(fromWorktree, `${posixMain}/.claude/worktrees/verify-49/app/_layout.tsx`))
      .toBe(false);
  });

  it('keeps the entries Metro shipped with', () => {
    // Replacing the default blockList instead of appending to it silently re-enables crawling of
    // .expo/types and __tests__ — invisible until something resolves that should not.
    for (const root of [MAIN, WORKTREE]) {
      const { resolver } = blockOtherAgentWorktrees(base(), root);
      expect(blocks(resolver.blockList, `${root}\\.expo\\types\\router.d.ts`), root).toBe(true);
    }
  });

  it('accepts a bare regex blockList, not only an array', () => {
    // getDefaultConfig has returned both shapes across Metro versions; the original code carried
    // this normalisation and dropping it would throw at config load.
    const { resolver } = blockOtherAgentWorktrees(
      { resolver: { blockList: /[\\/]\.expo[\\/]types/ } },
      MAIN,
    );
    expect(Array.isArray(resolver.blockList)).toBe(true);
    expect(blocks(resolver.blockList, `${MAIN}\\.expo\\types\\router.d.ts`)).toBe(true);
    expect(blocks(resolver.blockList, `${MAIN}\\.claude\\worktrees\\a1\\app\\_layout.tsx`))
      .toBe(true);
  });
});

// --- The real metro.config.js --------------------------------------------------------------------

describe('metro.config.js', () => {
  // Everything above tests functions. This tests the artefact Metro actually loads, because a
  // correct helper nobody wires up is worth nothing — and that is the failure mode a unit test on
  // the helper is structurally unable to see.
  //
  // Loaded by absolute path through Node's own require, exactly as Metro loads it — not through
  // the `@/` alias, so no bundler transform stands between this assertion and the real file, and
  // `__dirname` inside it is the real project root, which is the input under test.
  //
  // `expo/metro-config` is stubbed. Not for isolation — because loading it for real took 7.6s on a
  // cold filesystem cache and 0.2s on a warm one, which is a test that passes locally and times out
  // on a fresh CI runner. That is a flaky test, and a flaky test here would teach everyone to
  // re-run the one suite that guards a fix CI cannot see. The stub's shape (an array blockList
  // carrying entries Metro already had) is asserted against the real thing in
  // `blockOtherAgentWorktrees` above.
  const DEFAULT_ENTRY = /[\\/]\.expo[\\/]types/;

  const cjs = createRequire(import.meta.url);
  // `Module._load` is the interception point for every require() in the process, and it is not in
  // @types/node because it is internal. It is also the only way to stand in for a dependency of a
  // file that is loaded by require() rather than imported.
  const loader = Module as unknown as {
    _load: (this: unknown, request: string, ...rest: unknown[]) => unknown;
  };

  /** Load a metro.config.js — the real one, or a copy planted at some other project root. */
  function metroConfigIn(dir: string): { resolver: { blockList: unknown } } {
    const configPath = cjs.resolve(path.join(dir, 'metro.config.js'));
    const load = loader._load;

    loader._load = function (this: unknown, request: string, ...rest: unknown[]) {
      if (request === 'expo/metro-config') {
        return { getDefaultConfig: () => ({ resolver: { blockList: [DEFAULT_ENTRY] } }) };
      }
      return load.call(this, request, ...rest);
    };
    try {
      delete cjs.cache[configPath];
      return cjs(configPath) as { resolver: { blockList: unknown } };
    } finally {
      loader._load = load;
      delete cjs.cache[configPath];
    }
  }

  /**
   * Copy the real metro.config.js and its helper to a project root of our choosing, so the file
   * can be loaded with a `__dirname` we pick.
   *
   * Without this, running in the main checkout can only ever observe the main-checkout answer:
   * inlining the blockList back into metro.config.js unconditionally — the literal #49 bug, and
   * the most likely way it returns — is invisible from here, and CI is *always* here. Planting a
   * copy under a `.claude/worktrees/<name>/` path is the only way to ask the real file the
   * worktree question from the main checkout.
   *
   * Copies, not symlinks: `__dirname` follows the real path of a symlinked file.
   *
   * If metro.config.js grows a dependency on another repo file this throws MODULE_NOT_FOUND, which
   * is a loud "add it here" rather than a silent pass.
   */
  function plantConfigAt(projectRoot: string): void {
    fs.mkdirSync(path.join(projectRoot, 'scripts'), { recursive: true });
    for (const relative of ['metro.config.js', 'scripts/agent-worktrees.js']) {
      fs.copyFileSync(path.join(ROOT, relative), path.join(projectRoot, relative));
    }
  }

  let sandbox: string;
  beforeAll(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'metro-worktree-'));
  });
  afterAll(() => {
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  it('never blocks this project’s own expo-router entry point', () => {
    // The one assertion that is true in BOTH environments, and the literal statement of #49: from
    // a worktree, ROOT is the worktree, and an unconditional blockList entry makes this red.
    const entry = path.join(ROOT, 'app', '_layout.tsx');
    // Not vacuous: if app/ moves, the probe path stops meaning anything and this fails loudly
    // rather than passing on a path nothing resolves.
    expect(fs.existsSync(entry), `${entry} is missing — update this probe`).toBe(true);

    expect(blocks(metroConfigIn(ROOT).resolver.blockList, entry)).toBe(false);
  });

  it('blocks other agents’ worktrees exactly when it is not itself inside one', () => {
    const other = path.join(ROOT, '.claude', 'worktrees', 'some-agent', 'app', '_layout.tsx');

    // Conditional on the environment because the correct answer genuinely differs between them.
    // In CI and the main checkout this asserts `true` — delete the blockList entry and it is red.
    expect(blocks(metroConfigIn(ROOT).resolver.blockList, other)).toBe(!isInsideAgentWorktree(ROOT));
  });

  it('does not block its own sources when loaded from a worktree root', () => {
    // #49 itself, reproduced against the real config file from wherever this suite happens to run.
    // `expo export` reported "No routes found" because Metro would not resolve this exact path.
    const worktree = path.join(sandbox, 'repo', '.claude', 'worktrees', 'agent-a1');
    plantConfigAt(worktree);

    const blockList = metroConfigIn(worktree).resolver.blockList;
    expect(blocks(blockList, path.join(worktree, 'app', '_layout.tsx'))).toBe(false);
    expect(blocks(blockList, path.join(worktree, 'app', 'index.tsx'))).toBe(false);
  });

  it('still blocks worktrees when loaded from a main checkout root', () => {
    // The other half, and the reason the fix cannot just be "delete the blockList": from the main
    // checkout Metro must keep ignoring every agent's tree, or it crawls a copy of the repo per
    // agent plus any node_modules installed inside one.
    const main = path.join(sandbox, 'main-checkout');
    plantConfigAt(main);

    const blockList = metroConfigIn(main).resolver.blockList;
    expect(blocks(blockList, path.join(main, '.claude', 'worktrees', 'agent-a1', 'app', 'index.tsx')))
      .toBe(true);
    expect(blocks(blockList, path.join(main, 'app', 'index.tsx'))).toBe(false);
  });
});

// --- The node_modules link ------------------------------------------------------------------------

describe('planNodeModulesLink', () => {
  const MAIN = path.resolve('/repo/react-roguelike');
  const WORKTREE = path.join(MAIN, '.claude', 'worktrees', 'verify-49');
  const everyoneHasNodeModules = () => true;

  it('does nothing at all when node_modules is already there', () => {
    // THE path CI takes. It must decide before consulting git, before touching a filesystem, and
    // regardless of anything else being wrong — a pre-hook with an opinion about a clean checkout
    // is a pre-hook that breaks the only mandatory gate.
    expect(
      planNodeModulesLink({
        projectRoot: MAIN,
        projectHasNodeModules: true,
        gitCommonDir: null, // not even a git repo
        hasNodeModules: () => {
          throw new Error('probed the filesystem on the no-op path');
        },
      }),
    ).toEqual({ action: 'noop' });
  });

  it('links a worktree at the main checkout’s node_modules', () => {
    // `--git-common-dir` reports the MAIN checkout's .git even from a worktree; its parent is the
    // main checkout root. Using --git-dir instead would yield `<main>/.git/worktrees/<name>`, and
    // the link would point three levels inside .git.
    expect(
      planNodeModulesLink({
        projectRoot: WORKTREE,
        projectHasNodeModules: false,
        gitCommonDir: `${MAIN.replace(/\\/g, '/')}/.git`, // git prints forward slashes on Windows
        hasNodeModules: everyoneHasNodeModules,
      }),
    ).toEqual({
      action: 'link',
      target: path.join(MAIN, 'node_modules'),
      link: path.join(WORKTREE, 'node_modules'),
    });
  });

  it('refuses to link the main checkout to itself', () => {
    // A fresh clone with no node_modules. Linking node_modules to itself would "succeed" and then
    // fail somewhere far away; the useful answer is `npm install`.
    expect(() =>
      planNodeModulesLink({
        projectRoot: MAIN,
        projectHasNodeModules: false,
        gitCommonDir: path.join(MAIN, '.git'),
        hasNodeModules: everyoneHasNodeModules,
      }),
    ).toThrow(/npm install/);
  });

  it('fails loudly when there is no main checkout to link to', () => {
    // Exiting 0 here is the tempting mistake: the run would continue and die inside Playwright
    // with `Failed to resolve "extends" path "expo/tsconfig.base"` — the original #49 symptom,
    // now with a hook that says it handled it.
    expect(() =>
      planNodeModulesLink({
        projectRoot: WORKTREE,
        projectHasNodeModules: false,
        gitCommonDir: null,
        hasNodeModules: everyoneHasNodeModules,
      }),
    ).toThrow(/not a git repository/);

    expect(() =>
      planNodeModulesLink({
        projectRoot: WORKTREE,
        projectHasNodeModules: false,
        gitCommonDir: path.join(MAIN, '.git'),
        hasNodeModules: () => false, // main checkout never had an install run
      }),
    ).toThrow(/main checkout/);
  });
});

// --- The npm wiring --------------------------------------------------------------------------------

describe('package.json', () => {
  it('runs the linker before the E2E suite', () => {
    // `pretest:e2e` is the entire delivery mechanism: the DoD for #49 says the fix must be
    // automatic, because "documented manual step" is a synonym for "skipped step". Renaming
    // test:e2e without renaming its pre-hook silently detaches it, and nothing else would notice.
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['test:e2e']).toBeTruthy();
    expect(pkg.scripts['pretest:e2e']).toContain('ensure-worktree-node-modules');
    expect(fs.existsSync(path.join(ROOT, 'scripts', 'ensure-worktree-node-modules.mjs'))).toBe(true);
  });
});
