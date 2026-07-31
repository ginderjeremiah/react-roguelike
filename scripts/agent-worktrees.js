// Shared knowledge about the git worktrees agents work in: `<repo>/.claude/worktrees/<name>`.
//
// Lives here rather than inline in metro.config.js so it can be unit-tested. The regression this
// exists to catch is issue #49: the blockList that hides *other* agents' worktrees from Metro was
// written as an absolute-path match, so running `npm run build:web` from *inside* a worktree
// blocked that worktree's own `app/` directory and expo-router exported zero routes.
//
// CI cannot catch a regression here — it runs on a clean checkout where `.claude/worktrees/`
// never exists, so any breakage of the worktree path stays green. The unit tests in
// tests/unit/agent-worktrees.test.ts are the only gate.

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

module.exports = { AGENT_WORKTREE_PATTERN, isInsideAgentWorktree, blockOtherAgentWorktrees };
