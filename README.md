# react-roguelike

A turn-based roguelike built with React Native + Expo, developed primarily by Claude Code agents.

**Working title:** *Emberdepth* — you descend a lightless ruin carrying a lantern. Light is the
core resource: burn fuel to see and be seen, or move dark and gamble on what you cannot see.

> **Status: M0 — Foundations.** The development process is built; the game is not. There is
> currently no playable game here.

## Quick start

```bash
npm install
npm run web          # dev server
npm run verify       # typecheck + lint + unit tests
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run web` | Expo dev server (web) |
| `npm run ios` / `npm run android` | Native dev builds |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint, including the determinism and layer rules |
| `npm test` | Vitest — game logic |
| `npm run build:web` | Static web export to `dist/` |
| `npm run test:e2e` | Playwright against the static export |
| `npm run verify` | typecheck + lint + unit tests |

## How this project is built

This is an experiment in autonomous development. Claude Code agents do the design, implementation,
review, and playtesting; the repository owner oversees direction and unblocks infrastructure but
does not review every change.

That constraint shapes the architecture more than any game requirement does. Because no human
reads each diff, the project has to verify itself:

- **The simulation is a pure, deterministic function** of `(seed, commands)`. Same inputs, same
  run, always. This makes game rules exhaustively property-testable and makes any bug reproducible
  from a seed.
- **Web-first**, so a headless browser can drive the real built game in CI and agents can see the
  result of their own changes.
- **Glyph rendering** rather than a canvas, so rendering produces a DOM an automated test can
  actually assert against.
- **Every change is a PR** gated on green CI plus an adversarial review agent, with a playtest
  agent evaluating whether gameplay changes are any *good*.

### Layers

```
game/       pure deterministic simulation — no React, no I/O, no clock
render/     GameState -> presentation model — pure, still no React Native
session/    owns a run — hands out an opaque `Run`, never a `GameState` (ADR-0010)
components/ React Native views — dumb, props in, pixels out
app/        expo-router screens — wiring only
platform/   storage and device APIs, behind interfaces
```

Dependencies point strictly downward, enforced by ESLint.

## Documentation

| Doc | Contents |
| --- | --- |
| [`CLAUDE.md`](CLAUDE.md) | Entry point for agents. Start here. |
| [`docs/VISION.md`](docs/VISION.md) | Design pillars, the concept, non-goals |
| [`docs/GDD.md`](docs/GDD.md) | Game design — how it actually plays |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Layers, determinism contract, testing strategy |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Milestones and their exit criteria |
| [`docs/WORKFLOW.md`](docs/WORKFLOW.md) | How work gets done — branches, PRs, review, merge |
| [`docs/JOURNAL.md`](docs/JOURNAL.md) | Development log. The project's memory across sessions. |
| [`docs/decisions/`](docs/decisions/) | ADRs — why things are the way they are |

## License

MIT — see [LICENSE](LICENSE).
