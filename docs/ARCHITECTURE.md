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
│ session/     owns a run: seed -> Run -> Scene│  pure TS, no React
├─────────────────────────────────────────────┤
│ render/      GameState -> presentation model │  pure TS, no React
├─────────────────────────────────────────────┤
│ game/        the simulation                  │  pure TS, deterministic
└─────────────────────────────────────────────┘
   platform/   storage, clock, device APIs     │  interfaces + impls, injected
```

Dependencies point **strictly downward**. `game/` imports nothing from any other layer. An ESLint
`no-restricted-imports` rule enforces this; it is not a convention, it is a build failure.

**What exists today:** `game/`, `render/`, `session/`, `app/`, `components/`, and the game screen
inside them (#20). **`platform/` is not built yet** — its lint rules are already written and will
bite the moment the directory appears.

Five layers is a lot, and each boundary is meant to be load-bearing rather than tidy: `game/` is
determinism, `render/` is ADR-0003's renderer swap, `session/` is the type-level seam that stops
`GameState` being obtainable, `components/` is where React is allowed to exist, `app/` is routing. A
proposal for a sixth has to clear that bar — see ADR-0010's *Consequences*, which is deliberately
honest about the cost.

### `game/` — the simulation

Pure TypeScript. The whole game rules-wise. Contains:

```
game/
  core/        Command, GameState, the step() reducer, replay + divergence
  rng/         seeded PRNG. the ONLY source of randomness in the project
  map/         level generation, tiles, geometry
  fov/         field of view, light propagation, ember-sense, vision state — and two monotone
               per-tile planes, not one: `remembered` (ever perceived) and `revealed` (ever lit —
               GDD §4's cache rule, #31/#41, **and since #149 the kill drop as well: one predicate,
               both payouts**). Read `fov/index.ts` before adding a third
  entities/    actors, stats, behaviour, pathing
  systems/     the rules: turn scheduling, combat, light/fuel, and run.ts (what spans floors)
  content/     data tables — the Cinder, lantern tuning, player stats, run length. data, not logic
```

**`core/` is deliberately thin, and `systems/` is where the rules live.** This is the opposite of
what the directory names suggest, so it is worth stating: `GameState` is `systems/`' `LanternWorld`
— the floor, everyone on it, and the lantern — plus the run-level fields (`status`, `turnsElapsed`,
`commandsResolved`, `kills`, `fuelBurned`, `seed`, `rng`). `core/` owns the command vocabulary, the
generator, and the endings, and delegates every actual rule downward. Nothing in `core/` knows what a
shutter does.

`systems/run.ts` is the newest member and the easiest to miss: it owns the two moments that belong
to neither a floor nor a turn — where a run begins, and what crosses the stairs (GDD §13).

Hard rules. Lint enforces all of them except the last, and the unit suite independently scans
`game/` sources as a second line of defense (lint can be disabled inline; a failing test is
harder to wave away):

- No `Math.random()`. Randomness comes from the `Rng` **value** threaded through state — it is
  four immutable words, not an object with methods, and every draw returns the next one.
- No `Date.now()`, `new Date()`, `performance.now()`. The simulation has no clock; it has turns.
- No imports from `react`, `react-native`, `expo-*`, `app/`, `components/`, `session/`, `render/`,
  `platform/`.
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
colors, and opacity; HUD values; queued animation cues; and — once a run is over — GDD §13's
summary, headline copy and all, so that `components/` never decides which of the two endings is the
win.

Two functions, at two arities, and the split is not cosmetic: a board is a function of **one** state
(`presentScene(state, previous?)`) and a cue is a function of **two** (`cuesFor(before, after)`).
Fusing them would make the opening board — which has no predecessor — unpresentable.

Three properties of the model worth knowing before consuming it, each argued at length in the module
that owns it:

- **Colour is emitted as semantic tokens, never as values.** `'wall'`, not `#c8c8c8`. A hex cannot
  be dark-mode aware and a token can, and §11 requires both themes. The palette is M4's and lives in
  `components/`.
- **Every distinction a player must read survives greyscale.** §10's four cell states are carried by
  opacity and glyph presence; §2's telegraph is carried by a frame shape and a background alpha.
  `render/accessibility.test.ts` asserts this as a property over real runs rather than as a promise —
  if it goes red, no palette can fix it.
- **Cells are referentially stable across turns.** An unchanged cell is the same object, so
  `React.memo` with the default comparator is sufficient in `components/` — which is what makes
  ADR-0003's ~1000-`View` risk tractable without a renderer swap.

This layer exists specifically so the renderer can be swapped. `components/` consumes the
presentation model, never `GameState` directly. When we eventually want a Skia canvas or sprite
tiles, only `components/` changes — that is the whole point of ADR-0003.

**Its caller is `session/`.** Both functions take a `GameState`, so nothing that cannot legally hold
one can call them — which is not a limitation of this layer but the reason the one above it exists.

### `session/` — who owns the run

Pure TypeScript, still no React, still Vitest-tested. It holds a run and advances it, so that nothing
above it needs a `GameState` to do either. **ADR-0010** is the decision and `session/run.ts`'s header
is the argument; the short version is that `render/` could not be the home, because its public API
necessarily names `GameState` and one module cannot both expose and hide the same type.

```ts
beginRun(seed) -> Run      move(run, dir) / wait(run) / setShutter(run, to) / descend(run) -> Run
sceneOf(run) -> Scene      cuesOf(run) -> readonly Cue[]
```

Two properties, both structural rather than documented, because a guarantee nothing checks decays:

- **`Run` is opaque:** nothing above the layer can reach a `GameState` **through a `Run`** without an
  explicit, visible cast. The `GameState` *type* is still nameable above the seam through `render/`'s
  barrel (`Parameters<typeof presentScene>[0]`), which is pre-existing from #19/#42, tracked
  separately, and is the same fact that decided ADR-0010 — `render/`'s API necessarily names
  `GameState`, which is why the run could not live there. It hands out a shape and never a value;
  the live state is what `Run` guards. Three mechanisms, all structural — the state sits behind a
  module-private `unique symbol` that is never exported; `Run` is declared as an `interface`, which
  has no implicit index signature; and its property type is `never`, so `Run[keyof Run]` projects
  nothing. The import ban above the seam is a *proxy* for "nothing up there inspects a `GameState`";
  this makes the property itself true and demotes the lint rule and the scanner to a second line of
  defence. **The last two mechanisms were added after review of PR #51 found a component-legal
  exploit** that used `Run[keyof Run]['state']` and a type alias's implicit index signature to reach
  `GameState` with no cast and full autocomplete. The generalisable lesson is in ADR-0010 §1 and is
  worth reading before relying on any "private because unspellable" argument: **unspellable is not
  unreachable** — `keyof`, indexed access, implicit index signatures and `infer` all construct
  references to things no source file can write. The residual is a deliberate double cast
  (`as unknown as`), which is loud and reviewable; each mechanism is asserted separately, and the
  exploit is kept verbatim as a regression test.
- **`Command` never crosses the seam.** Four intent functions rather than `apply(run, command)`, so
  `components/` never needs `game/core/command.ts` to build one. What crosses is a verb plus plain
  data — a `Direction`, a `ShutterState` — and those two are re-exported so a component can name what
  it passes. It is also what makes ADR-0009 cheap: `travel(run, to)` in M2 is one more function.

`session/` is where the previous scene lives, which is what keeps `render/`'s cell reuse — and
therefore `React.memo` — actually working. A refused intent returns a **new** `Run` (§2 requires
feedback for an illegal tap) whose `Scene` is the **previous object by reference** (so the board does
not repaint). Both halves are tested; each is one token away from being wrong.

Deliberately absent: a command log (M4, with save/resume), a stored predecessor `GameState` (nothing
reads it once cues are computed), and any opinion about where a seed comes from (a clock question,
therefore `platform/`'s).

### `components/` and `app/`

React Native. Deliberately dumb: take a presentation model, render it, emit user intents upward as
`session/` calls. No game rules here. If you find yourself writing `if (enemy.hp <= 0)` in a
component, that logic belongs in `game/`.

```
components/play/   the game screen's parts: board, board-cell, hud-bar, controls, status-line,
                   run-summary, use-game-theme, and seven pure modules — hit-test, cell-style,
                   messages, opening, status-style, summary-style, theme
app/index.tsx      one screen: openRun(SEED) in useState, sceneOf/cuesOf down, intents up, and the
                   one branch that is not wiring a control — `scene.summary` swaps the bottom band
                   for §13's end-of-run panel, whose RUN AGAIN is also `openRun(SEED)`
hooks/             the Expo starter's survivors. use-color-scheme is real: use-game-theme reads it,
constants/theme.ts so the game screen depends on this directory. Not dead code, not yet mapped
                   anywhere else, and easy to delete by mistake for exactly that reason
```

**It is `components/play/`, not `components/game/`,** and the name was chosen by the linter: the
layer rule matches import specifiers by path segment, so `@/components/game/board` is reported as a
component reaching into the simulation. #57 decides whether to narrow the rule or document it; this
paragraph exists so the next person does not spend the attempt.

**`openRun` is not a convenience wrapper and must not be inlined back.** It is `beginRun` plus the
sentence that describes the run it just began, returned as one pair. A fresh run is **not** a blank
slate — §4 opens the lantern and `createInitialState` runs §2's phase 3, so roughly one launch in ten
already owes the player a wake line before a finger touches the screen (§4/#79). `app/index.tsx`
previously called `beginRun` directly and initialised the status line to a literal `null`, which
computed those cues and dropped them on the floor; the bug was invisible because the fixed seed
(#47) is one of the nine in ten that wake nothing. **The one-in-ten here is right and GDD §4's
"one arrival in five" does not apply to it — do not "correct" it.** A run start is always **floor 1**,
which carries `min(2 + floor, 6)` = 3 creatures against 6 from floor 4 down; §4's 20% is the rate
across all arrivals. Measured: **11.2%** over 2000 seeds through `openRun` (≈ 11% across seed families at 20 000; see below), and
pinned loosely in `tests/unit/play-opening.test.ts`. Per depth: floor 1 **11.2%**, then 14.7 / 17.9 / **20.6%**, flat from floor 4 down (the `min` caps spawn at 6, so floors 4-8 are structurally identical and measure bit-identically).
**A run start and a floor-1 arrival are the same event** — `createInitialState` generates floor 1
and calls `beginRun` — so there is one number here, not two to compare.
**Quote it as “about one in nine” and not to three figures:** review measured the same seed family
extended to 20 000 at 10.87% and four families at 10.87 / 11.15 / 11.47 / 11.52%, so the second
decimal is seed-family noise. A fifth family, measured later at **2000** seeds, came back at
**10.6%** — recorded with its sample size because it is *outside* the four-family spread above and
the reason is that it is the noisier measurement, not a new fact about the build. **Do not fold a
2000-seed figure into a 20 000-seed spread**; that is a precision error inside the sentence about
precision, and a draft of GDD's change-log row made it. An earlier draft also carried “11.25% at
20 000” into four documents, which is the over-precision half of the same habit ADR-0013 is about. Stated because the
inference *was* made in the other direction, in three documents at once — see
[ADR-0013](decisions/0013-a-claim-about-the-build-is-established-by-measurement.md). The decision
lives in `components/play/` rather
than in the `.tsx` for a reason that generalises: **`app/index.tsx` imports `react-native`, so Vitest
cannot load it, and anything decided inside it is unreachable from every test tier we have.**

**The seven pure modules are tested from `tests/unit/play-*.test.ts`, not colocated**, and the React
is tested by Playwright — ADR-0005 says there is no component test runner. **Seven modules, six
`play-*` suites**: `status-style.ts` (#94) is tested from `play-theme.test.ts`, because what its ramp
has to satisfy is a claim about the *theme* — that `alarm` and `report` differ in two channels in both
schemes. Do not read the file list as a suite list. `hit-test.ts` is the one
that matters: **every tap on the board goes through it** — the shutter and descend controls are
plain `Pressable`s and do not — because `nativeEvent.locationX` is typed
`number` and is `undefined` on react-native-web (#58), and because `onLayout` on web is a
`ResizeObserver` that never reports a *move*. Both were shipped bugs in #20. Geometry read off a
`nativeEvent`, and any cached origin, are guilty until proven otherwise here.

**`app/` is wiring only, and what it may wire is `session/`, `render/` and `components/` — never
`game/`.** Concretely: begin a run, hold the `Run` in state, hand `sceneOf(run)` and `cuesOf(run)`
to components, and turn a callback into an intent. Anything that needs a `GameState` to express is
not wiring, and the answer is a function in `session/` or a field in `render/`'s model, not an
exemption here. ADR-0010 rejected such an exemption explicitly, and says why at length.

Animation (Reanimated) lives here and only here. Animations are cosmetic; the simulation never
waits on them.

### `platform/` — the impurity boundary *(not built yet)*

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

`Command` is four variants and no more — `move(dir) | wait | setShutter(to) | descend`. There is no
`attack` (GDD §3 settled bump-to-attack) and the shutter command names an absolute **setting**, not
a toggle, because a toggle's meaning depends on prior state and one dropped command would silently
invert the rest of a stored run. Adding a variant is a `RULES_VERSION` bump.

**The full step contract lives in `game/core/step.ts`'s header** — seven numbered points, and it is
the authority. Three of them surprise people, so they are named here:

- **A refusal returns the input state itself, by reference.** Not a copy. An illegal-but-well-formed
  action (walking into a wall, descending off the stairs, commanding a finished run) runs no phases
  and changes nothing. Code that assumes `step` always allocates is wrong.
- **Malformed commands throw; illegal actions do not.** An unknown `kind` is corrupt data and fails
  loudly. A tap that lands a frame after the killing blow is ordinary phone behaviour and is refused.
- **No counter counts `step` calls.** `commandsResolved` counts non-refusals; `turnsElapsed`
  counts resolved commands that cost a turn. `turnsElapsed` is *not* in correspondence with
  `schedule.now` and must never be asserted against it — a descent restarts the floor's clock.
  §13's two summary counters are pinned to their own moments: `fuelBurned` is what GDD §2 phase 2
  took (gross — phase 5's embers and caches are income, not a discount), and `kills` is read across
  the whole turn, because on the turn the player dies phase 5 never runs to sweep the body.

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
| Unit / property | Vitest | `game/`, `render/` and `session/` — every pure layer. The bulk of the tests. Fast, no DOM. |
| Replay | Vitest | Recorded runs reproduce byte-identically. The determinism tripwire. |
| End-to-end | Playwright | The real built web app in a real browser. Input, rendering, persistence. |

There is no Jest and no React Native component test runner (ADR-0005). The UI is verified by
driving the actual application in a browser, which is both more honest and less brittle than
shallow-rendering components.

E2E runs against the static export (`npm run build:web` -> `dist/`, served by `serve`), not the
dev server. That is what CI does and therefore what "it works" means.

## Performance budget

- `step()` for one turn: **< 2ms** on a mid-range phone. Turn resolution must feel instant.
- Frame budget for grid render: **16ms**. A ~40x24 glyph grid is ~1000 `View`s, which is enough to
  matter. If we hit this wall, the presentation-model seam is what makes fixing it tractable.

**The 2ms budget is no longer comfortable.** A `descend` measures **1.72ms on a GitHub runner** —
essentially the whole budget — and ~92% of that is `generateFloor`, not turn resolution. An ordinary
turn is nowhere near it. Tracked as #34; it becomes real when there is a UI, because a 1.7ms step
plus a full re-render on the same frame is what a visible stutter is made of.

Do not optimize before there is a measurement. Do add a benchmark when you touch level generation
or FOV, since those are the two places that historically blow up.

**Write a whole-`step()` benchmark threshold as a ratio, never as milliseconds.** This was learned
the expensive way in #18: an absolute threshold set on a dev machine failed on a ~4x slower CI runner
with nothing regressed, and against a 2ms budget there was no headroom to raise it into. Every
threshold in `game/core/step.bench.test.ts` is now a ratio against a cheaper quantity measured in the
same process, which divides the machine out. Two corollaries, both paid for:

- **Calibrate against `npm test`, never against the benchmark file alone.** Three thresholds were
  set from in-isolation figures and all three flaked under the full parallel run.
- **Verify a threshold by planting the regression it exists to catch** and watching it go red. A
  benchmark can also go green because its *instrument* failed — #18 produced a physically impossible
  0.69x reading that passed.

**The subsystem benchmarks are still absolute, deliberately, and that is under challenge.** The
sentence above used to read *"never as milliseconds"* flatly, which contradicted the code:
`fov`, `generate`, `light` and `actors` bench files all assert milliseconds.
[ADR-0008](decisions/0008-benchmark-thresholds-as-ratios.md) scopes the rule, and **the scope is
which benchmark owns the anchor, not which operations happen to be composite.** Read the ADR before
writing a benchmark; the short form is:

- **`game/core/step.bench.test.ts` asserts ratios**, because a whole-`step()` operation is where
  hardware spread is worst and where an absolute figure has already been shown to be unsettable.
- **A subsystem benchmark asserts milliseconds, even for an operation that decomposes.** A lit turn
  *is* composite — `step.bench.test.ts` measures exactly that decomposition as
  `A_LIT_TURN_CONTAINS_A_FIELD` — and `light.bench.test.ts` still holds it to an absolute 1ms. That
  is correct and deliberate: a ratio alone cannot notice everything getting slower together, so the
  absolute budgets are the real-time anchor the ratios are interpreted against. **"It is composite,
  therefore it should be a ratio" is the conversion ADR-0008 exists to prevent.**

**#137 argues the leaf side is toothless**:
the same lit turn measures 0.100ms locally and 0.529ms on a runner, so any absolute limit that a
runner cannot trip is one a real 1.4x regression sails under — measured, with the regression planted.
That is an argument to **amend ADR-0008**, not a licence to convert a file; the anchor those absolute
budgets provide is what makes `step.bench.test.ts`'s ratios interpretable. Whoever takes #137 decides
where the anchor lives.
