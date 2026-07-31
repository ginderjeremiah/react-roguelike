// Learn more: https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const { blockOtherAgentWorktrees } = require('./scripts/agent-worktrees');

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

module.exports = config;
