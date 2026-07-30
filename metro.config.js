// Learn more: https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Agents run in git worktrees under .claude/worktrees/ — full copies of the repo inside the
// watched project root. Metro's default blockList does not exclude them, and `watchFolders`
// defaults to the root, so as soon as an agent runs `npm install` in its worktree (which any
// agent needing `npm run verify` in isolation must do) the bundler starts crawling a second
// node_modules tree. Harmless today only because no worktree has one yet.
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : [config.resolver.blockList].filter(Boolean)),
  /[\\/]\.claude[\\/]worktrees[\\/].*/,
];

module.exports = config;
