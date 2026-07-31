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
// project root on the box. That was the second, independent cause of `Error: No routes found` in a
// worktree, and the one that survived the blockList fix — an ordinary `npm run build:web` in the
// main checkout poisons every worktree created after it, because expo-router's route-discovering
// `require.context` lives in the main checkout's node_modules and resolves to the same absolute
// file from every root. The worktree then serves the main checkout's cached answer while its own
// evaluated config is provably correct, which is what made this look like a bad blockList.
//
// A hash of __dirname in a Metro config looks like superstition. It is the entire reason
// `build:web` works from a fresh worktree without `--clear`. See scripts/agent-worktrees.js.
partitionCacheByProjectRoot(config, __dirname);

module.exports = config;
