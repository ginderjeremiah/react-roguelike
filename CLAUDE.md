# react-roguelike

A turn-based roguelike built with React Native + Expo. **This project is developed primarily by
Claude Code agents.** The human owner oversees direction and unblocks infrastructure; he does not
review every change.

Because of that, this file is the contract that keeps autonomous work coherent across sessions.
Read it fully before doing anything.

## Start here, every session

1. Read `docs/JOURNAL.md` — **the last 2-3 entries only**. This is where you left off.
2. Read `docs/ROADMAP.md` — what milestone are we in, what is the current focus.
3. `gh issue list --milestone "<current milestone>"` — the actual work queue.

You do not need to read every doc every time. Pull the rest on demand:

| Doc | Read it when |
| --- | --- |
| `docs/VISION.md` | Deciding *whether* to build something. Pillars and non-goals live here. |
| `docs/GDD.md` | Implementing or balancing any game mechanic. |
| `docs/ARCHITECTURE.md` | Writing code. Layer rules, module map, invariants. |
| `docs/WORKFLOW.md` | Running the dev loop — branches, PRs, CI, when to merge. |
| `docs/decisions/` | Tempted to do something differently than the codebase does it. |

## The prime directive: protect determinism

The simulation is a pure, deterministic function of `(seed, input sequence)`. Same seed and same
inputs must always produce a byte-identical run. This is not an aesthetic preference — it is what
makes this project testable without a human in the loop, and it is what makes replays, daily
challenges, and bug reproduction possible later.

Concretely, inside `game/`:

- Never call `Math.random()`. Use the injected RNG. Ever.
- Never call `Date.now()` or `new Date()`.
- Never import from `react`, `react-native`, `expo-*`, or anything in `app/`, `components/`,
  `session/`, `render/`, or `platform/`.
- Never iterate a `Set`/`Map`/object for anything that affects simulation order — sort explicitly.

**The first three apply to every pure layer, not only `game/`.** `render/` and `session/` are held to
the same no-clock, no-randomness, no-framework rules — they are `.ts`-only, unit-tested in Vitest,
and each may import only downward (`render/` from `game/`; `session/` from `game/` and `render/`).
What `game/` carries *alone* is the fourth rule: iteration order is a determinism concern for the
simulation specifically, because that is what a replay reproduces.

CI enforces the first three two ways, across all three pure layers: ESLint rules scoped to `game/`,
`render/` and `session/`, and a unit test that scans those sources directly. The fourth — iteration
order — cannot be caught mechanically and is on you and the `code-reviewer`.

Note that `npm run lint` runs `eslint .`, **not** `expo lint`. The latter silently lints only
`app/` and `components/`, which meant the determinism rules were dead code for a while. Don't
"simplify" it back.

## Layers

```
game/       pure TypeScript simulation. no React, no I/O, no platform APIs. deterministic.
render/     translates game state -> presentation model. pure, still no React Native.
components/ React Native components. dumb. props in, pixels out.
app/        expo-router screens. wiring only.
platform/   the only place allowed to touch storage, time, or device APIs. behind interfaces.
```

Dependencies point strictly downward: `app` -> `components` -> `render` -> `game`. Nothing in
`game/` knows anything above it exists. A lint rule enforces this.

## Working agreement

- **Every change lands via a pull request.** No direct commits to `main`, including trivial ones.
  Enforced by a branch ruleset, not just convention — the remote rejects a direct push, so don't
  waste a cycle trying.
- **CI must be green** (typecheck, lint, unit tests, web build, E2E) before merge. All three CI
  checks are required by the ruleset; the merge button is blocked until they pass.
- **Squash merge only.** The ruleset permits no other merge method.
- **The `code-reviewer` agent must approve** before you merge. You may merge your own PR once it
  has a green CI run and a passing review — that is the standing authorization.
- **One issue, one PR.** If you discover unrelated work, file an issue; do not widen the PR.
- **Update `docs/JOURNAL.md` in the same PR** as the work it describes. A journal written later is
  a journal that never gets written.

Full details in `docs/WORKFLOW.md`.

## Agents

Specialized agents live in `.claude/agents/`. Use them; don't do everything in the main thread.

> **Standing authorization from the owner:** you may spawn any agent defined in `.claude/agents/`
> as needed, without asking first. This is explicit and permanent — do not stop to request
> permission for a `code-reviewer` pass, a `playtest`, or a design consult. The process assumes
> these agents run, and skipping them because you were being cautious defeats the point of having
> them.
>
> This covers the agents in this repository. Spawning general-purpose agents for unrelated work is
> a separate question.

| Agent | Use for |
| --- | --- |
| `game-designer` | Concepts, mechanics, balance, GDD changes. Design only — writes no code. |
| `gameplay-engineer` | Simulation logic in `game/`. Purity and determinism are its obsession. |
| `ui-engineer` | `render/`, `components/`, `app/`. Feel, responsiveness, touch targets. |
| `test-engineer` | Vitest suites and Playwright specs. Writes tests that can actually fail. |
| `code-reviewer` | Adversarial PR review. Runs before every merge. |
| `playtester` | Actually plays the built game via Playwright and reports on how it *feels*. |
| `archivist` | Keeps docs/journal/roadmap true. Run before closing out a work session. |

## Commands

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # vitest (game logic)
npm run test:e2e     # playwright (requires: npm run build:web)
npm run build:web    # expo export --platform web -> dist/
npm run web          # dev server
npm run verify       # typecheck + lint + test. run before every push.
```

## Things that will burn you

- Expo's `dist/` is a static export; Playwright tests run against `npx serve dist`, not the dev
  server. The dev server has different timing and is not what CI tests.
- `react-native-reanimated` animations do not run in Vitest. Keep animation out of `game/` and
  `render/` entirely.
- The `@/` path alias maps to the repo root, not `src/`.
- This repo has no `src/` directory and no Jest. Don't add either — see `docs/decisions/`.
