// Shared knowledge about the git worktrees agents work in: `<repo>/.claude/worktrees/<name>`.
//
// Lives here rather than inline in metro.config.js so it can be unit-tested. Issue #49 turned out
// to be TWO independent reasons `npm run build:web` reported `Error: No routes found` from inside a
// worktree, and both are fixed from this file:
//
//   1. The blockList that hides *other* agents' worktrees from Metro was written as an
//      absolute-path match, so from inside a worktree it blocked that worktree's own `app/`.
//      -> blockOtherAgentWorktrees()
//   2. Metro's on-disk cache is per-machine, not per-project, so a build in ANY root could serve a
//      stale answer to a build in another. -> partitionCacheByProjectRoot()
//
// CI cannot catch a regression in either — it runs on a clean checkout where `.claude/worktrees/`
// never exists and the cache is always cold, so any breakage of the worktree path stays green. The
// unit tests in tests/unit/agent-worktrees.test.ts are the only gate.

const crypto = require('node:crypto');

/**
 * The paths Metro must not crawl: any agent worktree under `.claude/worktrees/`.
 *
 * Matches absolute paths with either separator, because Metro tests this against real filesystem
 * paths and this repo is developed on Windows and built on Linux.
 */
const AGENT_WORKTREE_PATTERN = /[\\/]\.claude[\\/]worktrees[\\/].*/;

/**
 * Is `dir` inside an agent worktree — that is, at or below `<repo>/.claude/worktrees/<name>`?
 *
 * Segment-wise rather than a substring match, so that a directory merely *named* `worktrees`, or
 * one whose name merely *ends* in `.claude`, is not mistaken for the real thing. Getting that
 * wrong in the false-positive direction is what breaks the main checkout, which is the path CI
 * depends on.
 *
 * `<repo>/.claude/worktrees` itself is not "inside" a worktree — it is the container. A worktree
 * root has at least one more segment.
 *
 * @param {string} dir absolute or relative directory path, either separator style
 * @returns {boolean}
 */
function isInsideAgentWorktree(dir) {
  if (typeof dir !== 'string' || dir === '') return false;
  const segments = dir.split(/[\\/]+/);
  for (let i = 0; i + 2 < segments.length; i += 1) {
    if (segments[i] === '.claude' && segments[i + 1] === 'worktrees' && segments[i + 2] !== '') {
      return true;
    }
  }
  return false;
}

/**
 * Add the agent-worktree blockList entry to a Metro config — unless the project root *is* an agent
 * worktree, in which case the pattern would match the project's own sources and there is nothing
 * to hide anyway (a worktree contains no worktrees of its own).
 *
 * Mutates and returns `config`, matching how Metro configs are conventionally composed.
 *
 * @template {{ resolver: { blockList?: unknown } }} T
 * @param {T} config
 * @param {string} projectRoot
 * @returns {T}
 */
function blockOtherAgentWorktrees(config, projectRoot) {
  const existing = Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : [config.resolver.blockList].filter(Boolean);

  config.resolver.blockList = isInsideAgentWorktree(projectRoot)
    ? existing
    : [...existing, AGENT_WORKTREE_PATTERN];

  return config;
}

/**
 * A Metro `cacheVersion` that is unique to a project root, appended to whatever Expo already set.
 *
 * Appended, never replaced: `getDefaultConfig` ships `'1.0'`, and whatever invalidation that
 * encodes has to keep working. This value is opaque — the only two properties that matter are that
 * it DIFFERS between roots and is STABLE for one, and both are asserted.
 *
 * @param {string | undefined} baseVersion whatever `getDefaultConfig` set
 * @param {string} projectRoot
 * @returns {string}
 */
function cacheVersionForRoot(baseVersion, projectRoot) {
  // sha256 rather than md5: md5 throws on a FIPS-enforcing Node build, which would fail
  // metro.config.js at load and therefore break every build. Nothing here is a security boundary —
  // this is a cache-key salt — so the stronger hash is simply free.
  const digest = crypto.createHash('sha256').update(String(projectRoot)).digest('hex').slice(0, 12);
  return `${baseVersion ?? ''}:root-${digest}`;
}

/**
 * Give this project root its own partition of Metro's on-disk cache.
 *
 * **This is not superstition, and deleting it silently breaks every worktree on the machine.**
 * Metro's default cache store is one directory in the OS temp dir, shared by every project on the
 * machine, and `cacheVersion` is the only part of the key we control.
 *
 * **A build from another worktree at the same nesting depth poisons this one. The main checkout
 * neither poisons nor is poisoned.** The symptom (issue #49) is a worktree that has never been
 * built, with a provably correct blockList, reporting `Error: No routes found` and continuing to
 * until someone passes `--clear`.
 *
 * Depth is what makes it specific. Routes are discovered through a `require.context` inside
 * `expo-router`, which lives in the main checkout's node_modules and is therefore the same absolute
 * file from every root — but Metro keys its transform cache on the path *relative* to the project
 * root. Every agent worktree sits at exactly `<repo>/.claude/worktrees/<name>`, so that entry has
 * the identical relative path `../../../node_modules/expo-router/entry.js` from all of them and
 * they share the cached expansion. The main checkout (depth 0) and a deeper worktree do not.
 *
 * Established by A/B in a dedicated empty cache: worktree P builds (3 routes), sibling worktree Q
 * then fails, Q with this function restored succeeds in the *same* poisoned cache — and a worktree
 * at a different depth is immune, which is the prediction that identified the mechanism. The
 * relative-path key is inferred black-box from that depth experiment rather than read out of
 * Metro's source; the behaviour is directly observed and deterministic.
 *
 * Applied unconditionally rather than only in worktrees: a rule that fires only in the environment
 * CI never sees is a rule nothing ever exercises.
 *
 * Mutates and returns `config`.
 *
 * @template {{ cacheVersion?: string }} T
 * @param {T} config
 * @param {string} projectRoot
 * @returns {T}
 */
function partitionCacheByProjectRoot(config, projectRoot) {
  config.cacheVersion = cacheVersionForRoot(config.cacheVersion, projectRoot);
  return config;
}

module.exports = {
  AGENT_WORKTREE_PATTERN,
  isInsideAgentWorktree,
  blockOtherAgentWorktrees,
  cacheVersionForRoot,
  partitionCacheByProjectRoot,
};
