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

The property, stated exactly. This is the **third** attempt at the sentence: the first was false, and
the second — written to correct the first — overreached in a different direction. Both failures are
recorded below, because a document whose subject is "we asserted a property we had not tested" earns
no credit for hiding its own.

> **Nothing above `session/` can reach a `GameState` *through a `Run`* without an explicit, visible
> cast.**

**The `GameState` *type* remains nameable above the seam, and that is not what this property is
about.** `@/render` is legal from `components/` — that is ADR-0003's seam working as designed — and
its public API necessarily names `GameState`, so a component can write:

```ts
import { presentScene } from '@/render';          // no @/game import, no cast, no @ts-expect-error
type GameState = Parameters<typeof presentScene>[0];
```

and get the real type, with autocomplete, and the identical `Property 'turn' does not exist on type
'GameState'` message this ADR quotes as the exploit it closed. The same route runs through `cuesFor`,
`perceivedCreatures`, and `glyphForCreature` (which yields a `CreatureActor`).

**That is the same fact that decided this ADR in the first place**, and the irony is worth stating
rather than blushing at: *`render/`'s public API necessarily names `GameState`* is precisely the
argument in *Alternatives* for why the run could not live in `render/`, and `render/index.ts` already
says so. The second draft of this section overreached past a limit this very document states
correctly two screens down. It is a pre-existing consequence of #19/#42, it is **being tracked as its
own issue**, and it is deliberately not fixed here.

**Why the narrower property is still worth having.** A *type* you cannot obtain a *value* of buys
nothing: `Parameters<typeof presentScene>[0]` gives a component the shape of a `GameState` and no
`GameState`. Nothing in `render/`'s surface *returns* one. The thing a component could actually
inspect — the live state of the run it is holding — is exactly what a `Run` guards, and that is what
"nothing above the seam inspects a `GameState`" was always about in practice. Closing the type route
too would mean `render/` stopped naming `GameState` in its signatures, which is a different and much
larger change.

Three mechanisms carry it, and all three are load-bearing:

- **`RUN_STATE` is a module-private `unique symbol`.** Not exported from `run.ts`, not re-exported by
  `session/index.ts`, present in no exported signature. `unique symbol` is nominal, so a consumer's
  own symbol with an identical description is a different key.
- **`Run` is declared as an `interface`, not a `type` alias.** A type alias with only a symbol key
  gets an *implicit index signature*; an interface does not.
- **The declared property type is `never`,** not the real internals type, so `Run[keyof Run]`
  projects nothing. The implementation reaches the truth through one private accessor pair that
  casts.

**The second and third were added after this ADR was first accepted, and the reason is the most
useful thing in this document.** The original shape was
`export type Run = { readonly [RUN_STATE]: RunInternals }`, justified on the grounds that the key
could not be written. Review of PR #51 produced a working exploit that named `GameState` from a
`components/`-legal file with **no cast, no `any`, no `@ts-expect-error`, and no `game/` import** —
all three gates green, full autocomplete, and `tsc` reporting
`Property 'turn' does not exist on type 'GameState'` from inside `components/`. Two independent
mechanisms, each sufficient alone:

1. **A key that cannot be written can still be computed.** `keyof Run` *is* the symbol, so
   `Run[keyof Run]` resolved to the internals and `Run[keyof Run]['state']` resolved to `GameState`,
   by name.
2. **A `type` alias's implicit index signature.** `const record: Record<symbol, T> = run` was a plain
   assignment, after which the symbol reflected off the object indexed it.

The generalisable lesson, which is why it is recorded here rather than only in a commit message:
**unspellable is not unreachable.** TypeScript's structural machinery — `keyof`, indexed access,
implicit index signatures, `infer` — can construct references to things no source file can spell.
Any future "this is private because you cannot write its name" argument in this repo should be
tested against those four before it is believed.

**The residual, stated rather than discovered:** an explicit
`(run as unknown as Record<symbol, ...>)[Object.getOwnPropertySymbols(run)[0]]` still reaches the
state. The state really is a
property of a real object, and no type system prevents a cast. This is accepted deliberately, and
the argument is about review rather than about types: the path that had to be closed was the one
that *looked like ordinary code*, because that is the path that gets taken by accident and survives
a reading eye. A double cast beside `getOwnPropertySymbols` in a component is loud, greppable, and
the
kind of line review stops on. Closing even that would need a `WeakMap` or a `#private` class field,
both rejected below.

This is what turns the proxy back into the property. The lint rule and the scanner become a second
line of defence rather than the only one.

**How it is asserted.** Each mechanism is tested separately — a single test covering "opacity" is
what allowed two mechanisms to hide behind one that was checked. `@ts-expect-error` fails the build
in both directions (an unused directive is an error), and mechanism 1 additionally needs a
*positive* type assertion, because `Run[keyof Run]['state']` does not error when the property is
`never` — it silently resolves to `never`, so a `@ts-expect-error` there would be reported as unused
and fail for the wrong reason while a real regression passed. The review's exploit is kept verbatim
in `tests/unit/session-consumer.test.ts`, the one file bound by a component's import rules —
enforced, not asserted: `tests/unit/infrastructure.test.ts`'s "components/ and app/ do not reach into
game/" scans that exact path, because ESLint switches `no-restricted-imports` off for `tests/**` and
the sentence was otherwise decorative.

The test that used to stand here is worth naming as a failure mode: its comment claimed "nothing the
compiler accepts can get there" while its body asserted only that one expression errors. It could
not fail when the property it named was violated — and the property *was* violated, by two
mechanisms it never touched. **A check that enforces nothing but reads as proof is worse than no
check**, because it stops the next person looking.

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

The session layer's entire job is to be the place a `GameState` stops being **obtainable**. **One
module cannot both hand out the type and hide the value.** (This is stated as *obtainable* rather
than *nameable* on purpose — §1 records why: `render/` does still hand the type out, and the property
that survives is about getting a value, not saying a name.) A `render/` that exported both `presentScene` and an
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

### A `WeakMap<Run, RunInternals>`, or a `#private` class field

The two shapes that would close the residual cast, considered again when the exploit was found. Both
keep the state off the reachable surface entirely: a `WeakMap` keeps it in a side table, and a
`#private` field is genuinely unreachable by reflection — `getOwnPropertySymbols` finds nothing and
there is no cast that gets there.

Rejected, and the state stays on the object. A `WeakMap` is module-level mutable state in a layer
whose value is that it has none; it makes a `Run` meaningless outside the module instance that
created it; and it turns "when is this run collectable" into a question the garbage collector
answers instead of the reference graph. A `#private` field additionally makes `Run` a class
instance, which stops it being plain data and reintroduces the constructor-and-methods shape this
ADR rejected for `Run` being a value.

**One argument for the symbol that does not hold, recorded so it is not repeated.** It is tempting to
say the symbol also wins on React Native Fast Refresh — that re-evaluating the module would orphan
every live `Run` under a `WeakMap`. The hazard is real and it is **shared**: a fresh `Symbol()`
orphans old runs exactly as a fresh `WeakMap` does, since both identities are module-scoped, and the
private accessor reads `undefined` either way. A `#private` field is marginally worse again — it
throws a brand-check `TypeError` rather than returning `undefined`. The honest asymmetry is
*recoverability*: with the symbol the data is still physically on the object, so it is retrievable in
principle; with a `WeakMap` it is genuinely gone.

**`Symbol.for` would remove the Fast Refresh hazard outright, and is rejected for a reason that is
not a trade-off at all.** A registered symbol is *spellable by any consumer* — `Symbol.for` takes a
plain string, and that string is sitting in `run.ts` where anyone can read it. So a component could
write `Symbol.for('session/run: the private state of a run')`, obtain the genuine key, and index the
object with it. That is **mechanism 1 restored**: the whole point of `unique symbol` is that the key
is nominal and cannot be reconstructed, and `Symbol.for` is precisely the API for reconstructing it.
Adopting it to fix a dev-time reload would delete the property this layer exists for. Recorded at
this length because "just use `Symbol.for`" is what someone annoyed by an orphaned `Run` will reach
for, and the earlier draft of this paragraph — which argued only that a global-registry key is an
untidy trade — reads like a close call to exactly that person. It is not close.

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
