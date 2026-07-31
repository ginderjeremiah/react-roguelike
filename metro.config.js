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
// predicate.
//
// A build from another worktree AT THE SAME NESTING DEPTH is what poisons it; the main checkout
// neither poisons nor is poisoned. Every agent worktree sits at `<repo>/.claude/worktrees/<name>`,
// so expo-router's route-discovering entry — one absolute file in the main checkout's node_modules
// — has the same path *relative to the project root* from all of them, and Metro keys on the
// relative path. See scripts/agent-worktrees.js for the evidence and the one inference in it.
//
// A hash of __dirname in a Metro config looks like superstition. It is the entire reason
// `build:web` works from a fresh worktree without `--clear`. See scripts/agent-worktrees.js.
partitionCacheByProjectRoot(config, __dirname);

module.exports = config;
