// Learn more: https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const {
  blockOtherAgentWorktrees,
  partitionCacheByProjectRoot,
} = require('./scripts/agent-worktrees');

const config = getDefaultConfig(__dirname);

// Agents run in git worktrees under .claude/worktrees/ — full copies of the repo inside the
// watched project root. Metro's default blockList does not exclude them, and `watchFolders`
// defaults to the root, so from the main checkout the bundler would crawl every agent's tree,
// including any node_modules an agent installed there.
//
// The entry is conditional because the pattern matches ABSOLUTE paths: applied from *inside* a
// worktree it matched that worktree's own app/ directory, expo-router found no routes, and
// `npm run build:web` failed there and only there (issue #49). A worktree has no worktrees of its
// own, so there is nothing for it to block. See scripts/agent-worktrees.js — the condition lives
// there, tested, rather than inline here where nothing could assert on it.
blockOtherAgentWorktrees(config, __dirname);

// Metro's cache is per-MACHINE, not per-project: one directory in the OS temp dir, shared by every
// project root on the box, and the resolver's blockList is not part of its key. That was the
// second, independent cause of `Error: No routes found` in a worktree, and the one that survived
// the blockList fix — a brand-new worktree is served a cached answer computed for another root,
// while its own evaluated config is provably correct, which is what made this masquerade as a bad
// predicate. The suspected route is expo-router's route-discovering `require.context`, which lives
// in the main checkout's node_modules and so resolves to the same absolute file from every root.
//
// SUSPECTED, not established, and the distinction is load-bearing: poisoning an *empty* TMPDIR
// with a single main-checkout build does NOT reproduce it. Something about the accumulated cache
// of a machine that has built this project from several roots is required, and what exactly is
// unknown. Two people have now over-narrowed this mechanism — do not go hunting for one poisoning
// command. The remedy does not depend on the answer. See docs/JOURNAL.md 2026-07-31.
//
// A hash of __dirname in a Metro config looks like superstition. It is the entire reason
// `build:web` works from a fresh worktree without `--clear`. See scripts/agent-worktrees.js.
partitionCacheByProjectRoot(config, __dirname);

module.exports = config;
