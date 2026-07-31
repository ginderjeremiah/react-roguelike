#!/usr/bin/env node
// `pretest:e2e` — give a git worktree a node_modules before Playwright looks for one.
//
// Why this exists (issue #49): agents work in worktrees under .claude/worktrees/, which have no
// node_modules of their own. Node, tsc and Vitest all walk *up* the directory tree and find the
// main checkout's, so `npm run verify` works there and the gap is easy to miss. Playwright's
// tsconfig resolver does not walk up — it is rooted at the config's own directory — so
// `npm run test:e2e` died with `Failed to resolve "extends" path "expo/tsconfig.base"` before
// running a single spec. Any other tool with a non-upward resolver hits the same wall next, so the
// fix is a real node_modules at the worktree root rather than something Playwright-specific.
//
// A link into the main checkout, not a second `npm install`: the worktree is the same commit, so
// it wants the same dependency tree, and a second physical tree is what the metro.config.js
// comment warns about.
//
// THE NO-OP PATH IS THE ONE THAT MATTERS. CI and the main checkout already have node_modules, and
// this script must do nothing at all there — a pre-hook that acts on a clean checkout is a
// pre-hook that eventually breaks CI, where `.claude/worktrees/` does not even exist.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Decide whether to create the link and what it should point at. Pure: every fact about the world
 * is passed in, so the interesting cases can be unit-tested without a filesystem or a git repo.
 *
 * Throws — loudly, with the remedy in the message — rather than returning a no-op, whenever a link
 * is needed but cannot be reasoned about. Exiting 0 here would surface as a confusing failure
 * inside Playwright instead of an obvious one here.
 *
 * @param {object} facts
 * @param {string} facts.projectRoot                where `npm run test:e2e` was invoked
 * @param {boolean} facts.projectHasNodeModules     does `<projectRoot>/node_modules` resolve?
 * @param {string | null} facts.gitCommonDir        `git rev-parse --git-common-dir`, absolute; the
 *                                                  MAIN checkout's `.git`, even from a worktree.
 *                                                  null when the command failed (not a repo).
 * @param {(dir: string) => boolean} facts.hasNodeModules  probe for a candidate main checkout
 * @returns {{ action: 'noop' } | { action: 'link', target: string, link: string }}
 */
export function planNodeModulesLink({
  projectRoot,
  projectHasNodeModules,
  gitCommonDir,
  hasNodeModules,
}) {
  // The strict no-op. First, and before anything that could fail: CI never gets past this line.
  if (projectHasNodeModules) return { action: 'noop' };

  if (!gitCommonDir) {
    throw new Error(
      `No node_modules in ${projectRoot}, and this is not a git repository, so there is no main ` +
        `checkout to link to. Run \`npm install\`.`,
    );
  }

  // --git-common-dir yields `<main checkout>/.git`; its parent is the main checkout root.
  const mainRoot = path.dirname(path.resolve(gitCommonDir));
  const target = path.join(mainRoot, 'node_modules');
  const link = path.join(path.resolve(projectRoot), 'node_modules');

  if (target === link) {
    throw new Error(
      `No node_modules in ${projectRoot}, and it is the main checkout — there is nothing to link ` +
        `to. Run \`npm install\`.`,
    );
  }

  if (!hasNodeModules(mainRoot)) {
    throw new Error(
      `No node_modules in ${projectRoot}, and the main checkout (${mainRoot}) has none either. ` +
        `Run \`npm install\` there first.`,
    );
  }

  return { action: 'link', target, link };
}

/** `git rev-parse` for the main checkout's .git, or null if this is not a git repository. */
function readGitCommonDir(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Which kind of link to create, given `process.platform`.
 *
 * A one-line function because the one line is load-bearing and CI cannot see it: CI is Linux, so
 * changing `'junction'` to `'dir'` breaks every Windows dev machine — `fs.symlinkSync(…, 'dir')`
 * needs Developer Mode or elevation, a junction does not — and stays green on every gate we have.
 * That is the exact bug class this whole script exists to eliminate, so it does not get to live in
 * the script's own blind spot.
 *
 * On POSIX the argument is ignored by Node and a plain symlink is created either way; 'dir' is the
 * honest name for what it points at.
 *
 * @param {string} platform
 * @returns {'junction' | 'dir'}
 */
export function linkTypeFor(platform) {
  return platform === 'win32' ? 'junction' : 'dir';
}

/**
 * Everything this script does to the world, in one record so the decisions above it can be
 * exercised without a filesystem, a git repository, or a Windows machine.
 *
 * A default parameter rather than a mocking framework: production reads exactly as it did, and the
 * test supplies a fake. The seam stops here — the members below are one-line adapters, and what
 * they cannot cover (that Node's symlink really works from a worktree) is covered by actually
 * running `npm run test:e2e` in one, which is the DoD.
 */
const REAL = {
  cwd: () => process.cwd(),
  platform: () => process.platform,
  /** Follows links, so an already-linked worktree looks like an ordinary install. */
  exists: (p) => fs.existsSync(p),
  /** Does NOT follow links: true for a dangling one, where `exists` is false. */
  present: (p) => fs.lstatSync(p, { throwIfNoEntry: false }) != null,
  gitCommonDir: (cwd) => readGitCommonDir(cwd),
  symlink: (target, link, type) => fs.symlinkSync(target, link, type),
  log: (message) => console.log(message),
};

/** @param {typeof REAL} io */
export function ensureNodeModulesLink(io = REAL) {
  const projectRoot = io.cwd();

  const plan = planNodeModulesLink({
    projectRoot,
    projectHasNodeModules: io.exists(path.join(projectRoot, 'node_modules')),
    gitCommonDir: io.gitCommonDir(projectRoot),
    hasNodeModules: (dir) => io.exists(path.join(dir, 'node_modules')),
  });

  if (plan.action === 'noop') return; // Silence is the contract: nothing happened.

  // Only reachable when `exists` said no, so anything still present here is a dangling link.
  // Removing it silently would be guessing at what someone else meant.
  if (io.present(plan.link)) {
    throw new Error(`${plan.link} exists but does not resolve — remove it and try again.`);
  }

  io.symlink(plan.target, plan.link, linkTypeFor(io.platform()));
  io.log(`Linked ${plan.link} -> ${plan.target} (git worktree has no node_modules of its own)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    ensureNodeModulesLink();
  } catch (error) {
    console.error(`ensure-worktree-node-modules: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
