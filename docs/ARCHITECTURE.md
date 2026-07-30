# Architecture

How the code is organized and the rules that keep it that way. If you are about to write code,
read this first. If you want to break a rule here, write an ADR.

## The one idea

**The game is a pure function. Everything else is a shell around it.**

```
nextState = step(currentState, command)
```

`step` is deterministic, synchronous, side-effect free, and knows nothing about React, the
platform, or the passage of real time. Given the same starting seed and the same command
sequence, it always produces the same run.

Everything hard about testing a game — nondeterminism, async, framework coupling — is avoided by
keeping the interesting logic on the pure side of that line. This is what lets agents verify their
own work without a human playing the game.

## Layers

```
┌─────────────────────────────────────────────┐
│ app/         expo-router screens, wiring     │
│ components/  React Native views              │  React lives here and only here
├─────────────────────────────────────────────┤
│ render/      GameState -> presentation model │  pure TS, no React
├─────────────────────────────────────────────┤
│ game/        the simulation                  │  pure TS, deterministic
└─────────────────────────────────────────────┘
   platform/   storage, clock, device APIs     │  interfaces + impls, injected
```

Dependencies point **strictly downward**. `game/` imports nothing from any other layer. An ESLint
`no-restricted-imports` rule enforces this; it is not a convention, it is a build failure.

### `game/` — the simulation

Pure TypeScript. The whole game rules-wise. Contains:

```
game/
  core/        types, GameState, the step() reducer, command definitions
  rng/         seeded PRNG. the ONLY source of randomness in the project
  map/         level generation, tiles, geometry
  fov/         field of view + light propagation
  entities/    actors, stats, behavior
  systems/     turn scheduling, combat, light/fuel, status effects
  content/     data tables — enemies, items, level themes. data, not logic
```

Hard rules. Lint enforces all of them except the last, and the unit suite independently scans
`game/` sources as a second line of defense (lint can be disabled inline; a failing test is
harder to wave away):

- No `Math.random()`. Randomness comes from the `Rng` **value** threaded through state — it is
  four immutable words, not an object with methods, and every draw returns the next one.
- No `Date.now()`, `new Date()`, `performance.now()`. The simulation has no clock; it has turns.
- No imports from `react`, `react-native`, `expo-*`, `app/`, `components/`, `render/`, `platform/`.
- No `async`, no promises, no I/O.
- **No iteration-order dependence.** Iterating a `Set`, `Map`, or object's keys and letting that
  order affect the simulation is a determinism bug that lint cannot catch. Sort by a stable key
  (usually entity id) before any loop whose order matters.

Two known limits of the mechanical enforcement, so you are not surprised by them:

- The layer rules match import *specifiers* by path segment, not resolved file paths. A directory
  named `components`, `render`, `app`, or `platform` **inside** `game/` would therefore be reported
  as an upward violation. Relevant if we ever adopt ECS (`game/ecs/components/`) — rename or switch
  the rule to `import/no-restricted-paths` at that point.
- Template-literal specifiers (`import(\`../../components/${name}\`)`) evade both gates. Don't.
- **ESLint is the authority; the unit-test scanner is a regex heuristic and is strictly weaker.**
  It reads text, not an AST, so it cannot see destructured access (`const { random } = Math`) and
  a string containing `/*` will blind it until the next `*/`. It exists to catch a suppressed or
  bypassed lint rule, not to replace one. Never treat a green scanner as evidence that lint would
  have passed.

### `render/` — the translation layer

Turns a `GameState` into a flat, dumb description of what should be on screen: cells with glyphs,
colors, and opacity; HUD values; queued animation cues. Still pure TypeScript, still unit-tested.

This layer exists specifically so the renderer can be swapped. `components/` consumes the
presentation model, never `GameState` directly. When we eventually want a Skia canvas or sprite
tiles, only `components/` changes — that is the whole point of ADR-0003.

### `components/` and `app/`

React Native. Deliberately dumb: take a presentation model, render it, emit user intents upward as
commands. No game rules here. If you find yourself writing `if (enemy.hp <= 0)` in a component,
that logic belongs in `game/`.

Animation (Reanimated) lives here and only here. Animations are cosmetic; the simulation never
waits on them.

### `platform/` — the impurity boundary

Storage, clock, haptics, anything device-shaped. Defined as interfaces and injected, with real
implementations for the app and fakes for tests.

```ts
interface SaveStore {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}
```

Saves are local-only (ADR-0006). Because a run is `seed + command log`, a save file is tiny and a
replay is free.

## Determinism, concretely

A run is fully described by:

```ts
type RunRecord = { version: number; seed: string; commands: readonly Command[] };
```

Replaying that record must reproduce the exact final state. There is a property test asserting
this (`game/core/replay.test.ts`), and it is the single most important test in the repo — if it
goes red, stop and fix it before anything else. It is the tripwire for the entire testing strategy.

Two things about how it is built, because they are the difference between a tripwire and an alarm
that says only "something happened":

- **A failure names where.** `findRunDivergence` in `game/core/divergence.ts` steps both runs and
  reports the first command index, the command, the turn, and the field path — `rng.s2`, not
  "states differ".
- **The generator is part of what is compared.** A replay that reproduces the visible state from a
  different generator position has already diverged; it just has not surfaced yet.

This also gives us, nearly for free: crash reproduction from a bug report, replay sharing, daily
challenge seeds, and detecting unintended balance changes (a stored replay that diverges tells you
a rules change happened, whether or not you meant it).

### Versioning

`RunRecord.version` bumps whenever a rules change would alter the outcome of an existing replay.
Stored replay fixtures are pinned to the version they were recorded under. Bumping the version is
a normal, expected part of development — it is not a failure, it just needs to be deliberate.

**The canonical value is `RULES_VERSION` in `game/core/replay.ts`**, and the full policy — what
counts as an outcome-changing change, what does not, and the four-step procedure for bumping —
lives in that file's header, next to the constant. One number, one home. `replay()` refuses a
record recorded under a different version rather than producing a plausible state that is not the
run that was recorded; `runCommands()` is the deliberate escape hatch for a cross-version
inspection.

Every bump gets a line in `RULES_VERSION_LOG` beside it, so a fixture pinned at version N can be
understood without archaeology. A test asserts the log has an entry for the current version, since
a bump nobody wrote down is a bump nobody can explain later — and the failure mode of an
unexplained bump is that a diverging fixture gets "fixed" by updating its expected values, which
discards the one signal that would have said the rules changed by accident.

## Testing strategy

Three tiers, each catching what the tier below cannot:

| Tier | Tool | Covers |
| --- | --- | --- |
| Unit / property | Vitest | `game/` and `render/`. The bulk of the tests. Fast, no DOM. |
| Replay | Vitest | Recorded runs reproduce byte-identically. The determinism tripwire. |
| End-to-end | Playwright | The real built web app in a real browser. Input, rendering, persistence. |

There is no Jest and no React Native component test runner (ADR-0005). The UI is verified by
driving the actual application in a browser, which is both more honest and less brittle than
shallow-rendering components.

E2E runs against the static export (`npm run build:web` -> `dist/`, served by `serve`), not the
dev server. That is what CI does and therefore what "it works" means.

## Performance budget

Not a concern yet, but stated so we notice when we cross it:

- `step()` for one turn: **< 2ms** on a mid-range phone. Turn resolution must feel instant.
- Frame budget for grid render: **16ms**. A ~40x24 glyph grid is ~1000 `View`s, which is enough to
  matter. If we hit this wall, the presentation-model seam is what makes fixing it tractable.

Do not optimize before there is a measurement. Do add a benchmark when you touch level generation
or FOV, since those are the two places that historically blow up.
