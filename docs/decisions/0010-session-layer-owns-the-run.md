# ADR-0010: A `session/` layer owns the run

**Status:** Accepted
**Date:** 2026-07-30

Decided on issue #45, found during review of #42 (#19). It amends a layer rule that ADR-0003 and
`ARCHITECTURE.md` both rest on, which is why it is an ADR and not a journal line.

## Context

`render/` landed in #19 and immediately exposed a hole nobody had noticed, because until then
nothing above `game/` existed to fall into it.

`presentScene(state)` needs a `state`. `step(state, command)` produces the next one. Both live in
`game/`, and **no layer above `render/` may import `game/`** — enforced twice and deliberately:
`eslint.config.js` has a `files: ['components/**', 'app/**']` block banning it, and
`tests/unit/infrastructure.test.ts` scans the sources independently (it also catches
`await import('@/game/step')`, which `no-restricted-imports` does not inspect). Both gates are
correct. `components/` consuming a `GameState` is precisely what ADR-0003's swappable-renderer seam
exists to prevent.

The consequence is that **nothing in the repository could legally call `createInitialState()` or
`step()` from above the seam.** `render/` was a pure function with no caller and no legal place to
put one. #20 — the real UI, the whole of M1's remaining work — had nowhere to stand: nowhere to
begin a run, nowhere to advance it on a tap, and nowhere to keep the previous state that
`cuesFor(before, after)` needs or the previous scene that `presentScene(next, previous)` needs for
cell reuse.

Three homes were available, and the choice is not obvious in either direction, which is what makes
it a decision rather than an oversight.

There is a second force, and it is the one that ended up deciding the *shape* rather than the
location. **The import ban is a proxy.** The property anybody actually cares about is *nothing above
the seam inspects a `GameState`*. An import rule is a cheap, mechanical approximation of that
property — and like every proxy it can be satisfied while the property is violated. A layer that
hands `components/` a `{ state: GameState }` passes both gates, because structural typing does not
require the consumer to import the type in order to read `run.state.world.actors[0].hp`. So wherever
the run ended up living, the answer had to make the *property* structural, not merely re-satisfy the
proxy.

## Decision

**A new top-level `session/` layer. Pure TypeScript, above `render/` and below `components/`. Not
`platform/`, and no exemption anywhere.**

```
app/         expo-router screens, wiring                    React lives here and only here
components/  React Native views
session/     owns the run: seed -> Run -> intents -> Scene   pure TS
render/      GameState -> presentation model                 pure TS
game/        the simulation                                  pure TS, deterministic
```

`session/` may import `game/` and `render/`. It may never import `react`, `react-native`, `expo-*`,
`app/`, or `components/`, and contains only `.ts` files — the same rules `render/` lives under, for
the same reason: everything in it is testable in Vitest with no DOM and no Reanimated.

Its public surface is seven functions and one opaque type:

```ts
beginRun(seed: string): Run
move(run: Run, dir: Direction): Run
wait(run: Run): Run
setShutter(run: Run, to: ShutterState): Run
descend(run: Run): Run
sceneOf(run: Run): Scene
cuesOf(run: Run): readonly Cue[]
```

Two properties carry the design, and **both are structural rather than documented.** A layer whose
guarantees are written down rather than enforced is one hurried PR away from not having them.

### 1. `Run` is opaque by construction

The `GameState` sits behind a **module-private `unique symbol`** that is not exported from `run.ts`,
not re-exported by `session/index.ts`, and appears in no exported signature. `Run` therefore has no
member a consumer can name: `run.state` does not type-check, a hand-declared symbol with an
identical description is a different key (`unique symbol` is nominal), and a `symbol` reflected out
with `Object.getOwnPropertySymbols` cannot be used to index the type. A consumer can hold a `Run`
and pass it back. That is the whole vocabulary.

This is what turns the proxy back into the property. The lint rule and the scanner become the second
line of defence rather than the only one, and they now guard something that is already true.

The tests prove it with `@ts-expect-error`, which fails the build **in both directions**: if the
state ever becomes reachable, TypeScript reports the directive as unused and `npm run typecheck`
goes red. A property nothing checks is a property that decays.

### 2. `Command` never crosses the seam

Four intent functions, not one `apply(run, command)`. `apply` is one function instead of four and
needs no edit when a fifth command lands — and it is wrong here, because `components/` would have to
*build* a `Command`, and `Command` lives in `game/core/command.ts`. Either the component imports
`game/`, or `session/` re-exports the type and `game/`'s vocabulary is in scope upstairs anyway. The
seam would be decorative.

What crosses instead is a verb plus plain data: a `Direction`, a `ShutterState`. Both are closed
string unions that reference nothing in the simulation, survive JSON intact, and are already visible
upstairs through `render/`'s own types (`Cue`'s `shutterChanged` names `ShutterState`). `session/`
re-exports those two so a component can *name* what it passes without reaching for
`Parameters<typeof move>[1]`.

`setShutter` takes the **setting**, not a boolean and not a toggle, mirroring
`game/core/command.ts` exactly: a toggle's meaning depends on prior state, so one dropped or
duplicated call silently inverts the lantern for the rest of the run instead of failing.

This shape is also what keeps ADR-0009 cheap. **Adding `travel(run, to: Position)` in M2 is one more
function**, not a change to how commands are addressed and not a restructuring of `Run`.

### What is deliberately not in it

- **No command log.** `RunRecord` is the eventual save format, but nothing in M1 reads one — there is
  no save, no resume, no bug-report export. It lands with save/resume in **M4**. This repo has a
  standing objection to values with no consumer (`game/fov/light.ts`'s deleted export, journal
  2026-08-06), and a growing array nobody reads is that objection with a worse memory profile.
- **No stored predecessor `GameState`.** The cues are computed eagerly, in the intent that caused
  them, so the previous state is a local inside the private `advance` and nothing else. Keeping it
  would pin a whole `Floor`, its grid, its actors and its tile sets for a field with no reader.
- **No seed selection.** `beginRun` takes a seed. Choosing one reads a clock or a save file and is
  therefore `platform/`'s question, filed separately. M1 passes a constant.

## Alternatives considered

### A run controller exported from `render/`

The runner-up, and the option the issue listed first. `render/` already imports `game/` legally, so
it needs no new layer and no new lint block; `components/` would hold an opaque handle and get
presentation models back, and the import ban would stay absolute.

The issue's stated objection was that it "costs `render/` a stateful surface in a layer that is
currently a pure function". **That objection does not survive contact with the design**, and saying
so is worth more than the conclusion: a `Run` written as a value-reducer — every intent returning a
new `Run`, nothing mutated — is perfectly pure, and is in fact exactly what `session/` implements.
Purity does not settle this.

What settles it is sharper and, once seen, decisive:

> `render/` must export `presentScene(state: GameState)`, so **its public API necessarily names
> `GameState`.** Anything importing `render/` has that type in scope.

The session layer's entire job is to be the place `GameState` stops being nameable. **One module
cannot both expose and hide the same type.** A `render/` that exported both `presentScene` and an
opaque `Run` would be handing `components/` the key and the lock in the same import, and the very
next reasonable-looking PR — a component that wants "just the HUD for this state" — walks through it
without breaking a single gate.

There is a lesser argument on top, which would not have decided it alone: `render/`'s stated job is
`GameState -> presentation model`, a stateless translation testable at two arities. Making it also
the run's owner gives it two jobs and no name that covers both.

### An `app/`-only exemption

`ARCHITECTURE.md` describes `app/` as "wiring only", and wiring is where a run would naturally be
owned. It costs nothing to build: delete `app/**` from one ESLint block and one scanner list.

It loses on the force named in *Context*. **The import ban is a proxy for "nothing above the seam
inspects a `GameState`", and an exemption breaks the proxy and the property together.** An exempted
`app/` can read `state.player.hp`, compute `if (enemy.hp <= 0)` in a screen, or pass a raw state to
a component as a prop, and no gate anywhere objects. ADR-0003's renderer swap stops being checkable:
the seam's value is that you can enumerate what crosses it, and an exemption makes the answer
"whatever `app/` felt like".

And this repository has specific history here. CLAUDE.md records that `npm run lint` was
`expo lint` for a while, which silently linted only `app/` and `components/` — so the determinism
rules were dead code and nobody noticed until they were needed. The lesson written down at the time
is that **a contract rule with a hole in it is a rule that quietly stops being enforced**, because
the hole is where the next person puts the thing that did not fit. An exemption is a hole with a
justification attached, which is the most durable kind.

A narrower version — exempt `app/`, but only for `createInitialState` and `step` — was considered
and is worse than either end: it is a rule with a whitelist, so it needs maintaining, and it still
puts a live `GameState` in a file that also imports `expo-router`.

### `platform/`

The issue's third option, and the closest to what was chosen — it differs only in which directory
the code lands in. Rejected on meaning. `platform/` is specified as **the impurity boundary**:
storage, clock, haptics, device APIs, defined as interfaces and injected, with fakes for tests. A
run controller is pure, synchronous and deterministic and has no interface to inject. Putting it
there would widen `platform/` from "the place impurity is quarantined" to "the place things go when
they do not fit elsewhere", and the quarantine is the only thing that directory's name is doing.

### A React hook in `components/`, with the state passed in

Briefly attractive because it needs no new layer: `useRun()` holds the state and `app/` passes it
in from... somewhere. There is no somewhere. The hook still has to call `step`, and it is in
`components/`. It also puts the run's ownership inside the React tree, where a remount loses it and
where testing it requires the component test runner ADR-0005 declined to have.

## Consequences

**Makes easy:**

- #20 has a home. Beginning a run, advancing it, and drawing it are three function calls, and none
  of them requires a decision the UI is not allowed to make.
- The previous-scene threading that `React.memo` depends on happens in one place, once, and is unit
  tested — rather than being re-derived in a hook where a dropped argument fails nothing.
- Refusal feedback is structurally correct: a refused intent returns a **new** `Run` (so §2's
  required feedback fires) whose `Scene` is the **previous object by reference** (so the board does
  not repaint). Both halves are tested, and each is a one-token edit away from being wrong.
- Save/resume in M4 and `travel` in M2 are both additions to one file.
- The layer is Vitest-testable end to end. The DoD's spike — `beginRun()` to a rendered `Scene`
  importing only `@/session` and `@/render` — lives in `tests/unit/session-consumer.test.ts` and is
  a permanent test rather than a one-off.

**Makes hard, and this is the honest cost:**

- **This is a fifth layer, and layers are not free.** Every one of them is a boundary somebody has to
  learn, a set of import rules to keep in two gates that must be updated together, a directory that
  shows up in every glob, and one more hop between a tap and the thing it does. Five layers for a
  turn-based roguelike on a phone is a lot, and the honest defence is not that the count is small but
  that each boundary is load-bearing: `game/` is determinism, `render/` is ADR-0003's swap,
  `session/` is the type-level seam, `components/` is React, `app/` is routing. If a sixth is ever
  proposed, the bar it has to clear is this paragraph.
- **The indirection is real when debugging.** A wrong glyph is now four files away from the rule that
  produced it, and a `Run` in a debugger shows `{}` — which is the property working as designed and
  is still annoying at 1am. `sceneOf(run)` is the intended window; there is deliberately no
  `debugStateOf`, because an escape hatch with a warning comment is an escape hatch.
- **Two gates must move together, forever.** `eslint.config.js` and
  `tests/unit/infrastructure.test.ts` now describe five layers instead of four. If a future change
  updates one and not the other they disagree and one silently stops mattering — which is the failure
  the scanner exists to catch and is equally capable of suffering.
- **An eager `Scene` per intent is computed whether or not anything renders it.** That is the right
  trade (a lazy one breaks referential stability, which is the entire point) but it means a headless
  consumer — a future replay tool, a balance harness — pays for presentation it does not want. If one
  appears, it should use `game/core`'s `runStates` directly rather than `session/`.

**Revisit if:** `components/` ever legitimately needs something from a `GameState` that neither
`render/` nor `session/` exposes. That is evidence the presentation model is missing something, and
the fix is to add it to `render/` — but if it keeps happening, the seam is in the wrong place and
this ADR is what should be argued with. Also revisit if `session/` acquires a second responsibility:
one run, owned, is a clear charter, and "the layer above render" is not.
