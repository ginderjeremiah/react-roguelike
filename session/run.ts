/**
 * A run, owned. `seed` in, a `Scene` out, four intents to move it forward.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * `Run` IS OPAQUE BY CONSTRUCTION, NOT BY RULE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The whole reason this layer exists is to be the place `GameState` stops being *nameable*. A lint
 * rule that forbids `components/` from importing `game/` is a good rule and this repo has two
 * independent copies of it, but both are gates on the import graph — they say what a file may
 * mention, not what a value may contain. Hand a component a `{ state: GameState }` and the gates
 * stay green while `run.state.world.actors[0].hp` compiles, because structural typing does not need
 * the import to reach the field. So the type has to refuse first and the lint rule has to be the
 * second line of defence rather than the only one.
 *
 * `RUN_STATE` below is a **module-private `unique symbol`**, and every one of those three words is
 * carrying weight:
 *
 *   - **`unique symbol`** makes the key nominal. A consumer cannot declare their own symbol and have
 *     it be the same key; `unique symbol` types are identical only to themselves.
 *   - **module-private** — it is not exported, not re-exported by `index.ts`, and appears in no
 *     exported signature. There is no expression in any other file that evaluates to it.
 *   - **symbol**, not a string key like `__state`, because a string key is guessable and
 *     `run['__state']` type-checks against an index signature the moment anyone adds one.
 *
 * The consequence is that `Run` has **no publicly reachable member at all**. `keyof Run` is a symbol
 * nobody upstairs can write down, so the only things a consumer can do with a `Run` are hold it and
 * pass it back to one of the six functions here that take one. `run.test.ts` proves that with
 * `@ts-expect-error` rather than asserting it in prose, because a property nothing checks is a
 * property that decays.
 *
 * **A `WeakMap<Run, RunInternals>` was the alternative** and it is stronger by exactly one notch —
 * the state would not even be an own property at runtime, so `Object.getOwnPropertySymbols` would
 * find nothing to reflect on. It loses on everything else. It is module-level mutable state in a
 * layer whose value is that it has none; it makes a `Run` meaningless outside the module instance
 * that created it, so a `Run` could not survive a `structuredClone`, a `postMessage`, or a hot
 * reload that re-evaluates this file; and it turns a lifetime question ("when is this run
 * collectable") into something the garbage collector answers instead of the reference graph. The
 * symbol buys ~95% of the property for none of that, and the residual — a determined component
 * doing runtime reflection on a value it was told is opaque — is not a failure mode a type can
 * prevent and is loud enough to be caught in review.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * `Command` NEVER CROSSES THE SEAM, WHICH IS WHY THERE ARE FOUR INTENTS AND NOT ONE `apply`
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The obvious API is `apply(run, command)`. It is one function instead of four and it needs no edit
 * when a fifth command lands. It is also wrong here, for a reason that is structural rather than
 * aesthetic: `components/` would have to **build** a `Command`, and `Command` lives in
 * `game/core/command.ts`. Either the component imports `game/` — the thing this layer exists to make
 * unnecessary — or `session/` re-exports the type, at which point `game/`'s vocabulary is in scope
 * upstairs and the seam is decorative.
 *
 * So the command literals below are the **only** four `Command` expressions above `game/` in the
 * whole repository, and they are four lines long. What crosses the seam is a verb and a plain-data
 * argument: a `Direction`, a `ShutterState`. Both are string unions that carry no reference to
 * anything in the simulation, so re-exporting them costs nothing the ban was protecting.
 *
 * ADR-0009's constraint falls out of this shape for free and is the reason it was chosen over the
 * runner-up rather than merely instead of it: **adding `travel(run, to: Position)` in M2 is one more
 * function here.** It is not a change to how commands are addressed, not a new parameter on an
 * existing call, and not a restructuring of `Run`. Do not build it now — ADR-0009 defers it to M2 on
 * purpose, gated on a playtest signal.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT A `Run` HOLDS, AND THE ONE THING IT DELIBERATELY DOES NOT
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Three fields: the current `GameState`, the `Scene` presented from it, and the `Cue`s of the
 * transition that produced it. The scene and the cues are computed **eagerly**, in the intent that
 * caused them, and that is load-bearing twice:
 *
 *   - `presentScene(next, previousScene)` needs the previous *`Scene`* — not the previous state — to
 *     reuse unchanged cell objects (see `render/scene.ts`). That reuse is what makes `React.memo`
 *     with the default comparator sufficient for #20's ~165 `View`s, so a `sceneOf` that recomputed
 *     from scratch on every call would allocate a fresh object for every cell on every render and
 *     silently delete the optimisation the presentation model was shaped around.
 *   - A lazy `cuesOf` would return a **new array every call**, so a component effect keyed on the
 *     cue list would re-fire on every render rather than once per turn — a shake animation replaying
 *     itself for as long as the component re-renders.
 *
 * **The previous `GameState` is not a field.** It is held as a local inside `advance`, for exactly
 * as long as it takes to call `cuesFor(before, after)`, and then it is gone. Storing it was the
 * obvious shape and was rejected: with cues computed eagerly there is no reader for it, and this
 * repo's standing objection is to values with no consumer (`game/fov/light.ts`'s deleted export,
 * journal 2026-08-06). A retained predecessor state is also not free — it pins a whole `Floor`, its
 * grid, its actors and its `TileSet`s — and a field nothing reads is a field that can drift from the
 * one thing that does. If a future consumer genuinely needs a second state (a diff view, a
 * bug-report dump), it goes back in with that consumer, not before it.
 *
 * **There is no command log.** `RunRecord` is the eventual save format and `game/core/replay.ts`
 * already builds one, but nothing in M1 reads it: there is no save, no resume, and no bug-report
 * export. Appending every command to an array here would be a growing field with no reader, which is
 * the same objection as above with a worse memory profile. It goes in when **save/resume lands in
 * M4** — at which point `Run` gains a `readonly commands: readonly Command[]` inside the private
 * internals and `beginRun` gains a sibling that rebuilds a `Run` from a `RunRecord`. That is an
 * addition to this file, not a change to its shape, which is why it is safe to leave out.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## `Run` is a value, not a controller
 *
 * Every intent returns a **new** `Run` and mutates nothing, so `session/` is as pure as the two
 * layers under it: no clock, no randomness, no async, no module-level mutable state. The mutable
 * alternative — a `RunController` object with `move()` methods that update in place — was not
 * considered seriously for two reasons. React re-renders on identity change, so an in-place update
 * is invisible to `useState` and every call site would need a manual bump; and a class instance is
 * not plain data, which closes off the M4 save path above and makes a `Run` untestable by
 * comparison. `const [run, setRun] = useState(() => beginRun(seed))` and
 * `setRun(move(run, 'north'))` is the whole integration.
 *
 * ## Where the seed comes from is not this layer's question
 *
 * `beginRun` takes one. Choosing one — a timestamp, a daily challenge, a resumed save — reads the
 * clock or the disk and therefore belongs to `platform/`, which does not exist yet. M1 passes a
 * constant. Filed separately, deliberately.
 *
 * ## A name collision worth knowing about
 *
 * `game/systems/run.ts` also exports a `beginRun`, and it means something narrower: the
 * `LanternWorld` a floor-1 run starts on (GDD §4). It is not re-exported by `game/core`, nothing
 * here imports it, and the two never meet — but a grep for `beginRun` finds both, so this note
 * exists to save the next reader the thirty seconds.
 */

import {
  createInitialState,
  step,
  type Command,
  type Direction,
  type GameState,
} from '../game/core';
import type { ShutterState } from '../game/fov';
import { cuesFor, presentScene, type Cue, type Scene } from '../render';

/**
 * The key the run's insides sit behind. **Never exported, from here or from `index.ts`.**
 *
 * See the header for why this is a `unique symbol` and not a string key, and why the `WeakMap`
 * version was not taken. The description string is for a debugger and for nothing else; nothing
 * reads it, and two symbols with the same description are still different keys.
 */
const RUN_STATE: unique symbol = Symbol('session/run: the private state of a run');

/** Everything a `Run` actually is. Private, and reachable only through the accessors below. */
type RunInternals = {
  /** The simulation, right now. The value nothing above this layer may name. */
  readonly state: GameState;
  /** Presented from `state`, with the previous run's scene handed in for cell reuse. */
  readonly scene: Scene;
  /** What the transition into `state` did. Empty on the opening run — see `NO_CUES`. */
  readonly cues: readonly Cue[];
};

/**
 * A run in progress. **An opaque handle: it has no member you can name or read.**
 *
 * Hold it, pass it to an intent, ask `sceneOf` and `cuesOf` what to draw. That is the entire
 * vocabulary, and the type enforces it rather than documenting it.
 */
export type Run = {
  readonly [RUN_STATE]: RunInternals;
};

/**
 * The opening run's cue list, shared by every `beginRun`.
 *
 * **Empty is the honest answer, and it is not the same as "no cues yet".** A cue is a statement
 * about a transition (`render/cues.ts`), and the opening state has no predecessor — nothing has
 * happened, so there is nothing to say. The two tempting wrong answers are throwing (`cuesOf` on a
 * fresh run is an ordinary thing for a component to do on its first render) and diffing against a
 * fabricated null state, which would emit a made-up story about a turn nobody played.
 *
 * Shared rather than freshly allocated so that the identity is stable across renders, for the same
 * reason `game/core/state.ts` shares `RUNNING`. Immutable; the `readonly` element type is what stops
 * a consumer pushing into it, and there is no runtime `Object.freeze` because that is a cost paid on
 * every run for a mistake the compiler already rejects.
 */
const NO_CUES: readonly Cue[] = [];

/**
 * Start a run on `seed`. GDD §4's opening: floor 1, at the entrance, lantern open, 80 fuel, and the
 * entrance room already on screen.
 *
 * Pure and total — any string is a valid seed, including the empty one, because
 * `createInitialState` is. The board is presented immediately: §4 is explicit that "the opening
 * perception is not something the first command pays for", so there is a `Scene` to draw before the
 * player has touched anything.
 *
 * `presentScene` is called with **no previous scene**, which is the arity that exists for exactly
 * this moment (`render/index.ts`: fusing the two functions would make the opening board
 * unpresentable). Every cell is freshly allocated here, once, and every turn after this one reuses
 * what it can.
 */
export function beginRun(seed: string): Run {
  const state = createInitialState(seed);
  return { [RUN_STATE]: { state, scene: presentScene(state), cues: NO_CUES } };
}

/**
 * §3's one directional command: step there, or attack whatever is standing there. Costs a turn.
 *
 * There is no `attack` intent for the same reason there is no `attack` command — §3 settled
 * bump-to-attack, and what a tap on an adjacent tile does is decided by what is standing there at
 * the moment of the tap. `game/systems/bump` decides; nothing here or above it does.
 */
export function move(run: Run, dir: Direction): Run {
  return advance(run, { kind: 'move', dir });
}

/** §9's self-tap: spend the turn. On the stairs it is a real decision, not a no-op. */
export function wait(run: Run): Run {
  return advance(run, { kind: 'wait' });
}

/**
 * §9's shutter control. **`to` is the setting you want, never a toggle**, and the boolean-flavoured
 * `setShutter(run, open: boolean)` was rejected on the same grounds `game/core/command.ts` rejected
 * `toggleShutter`: a toggle's meaning depends on prior state, so one dropped or duplicated call
 * silently inverts the lantern for the rest of the run instead of failing. `ShutterState` is the
 * simulation's own word for this and is mirrored exactly rather than re-spelled — a `boolean` named
 * `open` would also read as `open: false` at the call site, which is a sentence about the shutter
 * being *not open* rather than about it being shut.
 *
 * §9's *control* is still a toggle. What it emits is the setting it is toggling to, which
 * `components/` computes from `sceneOf(run).hud.shutter.state`.
 *
 * Free (§2) — it costs no turn — and still burns its fuel. Setting it to the setting it already
 * holds is refused; see `advance`.
 */
export function setShutter(run: Run, to: ShutterState): Run {
  return advance(run, { kind: 'setShutter', to });
}

/**
 * §13: take the stairs. Legal only while standing on them — `sceneOf(run).hud.onStairs` is what a
 * component shows the control from, and it reads the same predicate `step` refuses on, so the
 * control and the rule cannot disagree.
 */
export function descend(run: Run): Run {
  return advance(run, { kind: 'descend' });
}

/** Everything to draw for this run: the board and the frame around it. */
export function sceneOf(run: Run): Scene {
  return run[RUN_STATE].scene;
}

/**
 * What just happened, as facts. Never a duration, never an easing, never a colour — `render/cues.ts`
 * owns that rule; this only hands the list over.
 *
 * Empty on the opening run, and empty is also a legal answer mid-run (a `wait` in an empty room
 * changes nothing worth animating). A component may ignore the whole list, which is precisely what
 * honouring §11's reduced-motion setting looks like.
 */
export function cuesOf(run: Run): readonly Cue[] {
  return run[RUN_STATE].cues;
}

/**
 * Resolve one command and rebuild the run around the result. **The only place a `Command` value
 * exists outside `game/`.**
 *
 * ## The refusal path, which is the half that is easy to get wrong
 *
 * `step`'s contract point 6: a refused command runs no phases, changes no field, and returns **the
 * input state itself, by reference**. That makes `after === before` the exact test for a refusal,
 * with no heuristic — and it is what `cuesFor` keys the `refused` cue on.
 *
 * Two things follow, and they pull in opposite directions:
 *
 *   - **A refusal must still produce a new `Run`.** GDD §2: "a refused tap must still produce
 *     feedback — a tap that does nothing at all reads on a phone as 'the touch did not register'."
 *     The refusal lives in the *cue list*, so returning `run` unchanged here — the tempting
 *     short-circuit, and the one that looks like an optimisation — would hand `components/` an
 *     identical value, skip the re-render, and delete the feedback §2 requires. The state comes back
 *     by reference; the run does not.
 *   - **A refusal must repaint nothing.** The state is byte-identical, `presentScene` is a pure
 *     function of it, and `previous` is documented as an optimisation that never changes the answer
 *     (`render/scene.ts`). So the previous `Scene` *is* the new scene, and handing back the same
 *     object lets a memo above the whole board skip it. Recomputing would produce a structurally
 *     equal `Scene` in a fresh wrapper — a new `hud` object on every refused tap, and a re-render of
 *     the frame to show nothing new.
 *
 * The two together are the shape a refused tap should have: the cue fires, the board does not blink.
 *
 * Malformed commands still throw (contract point 7) and are deliberately not caught here. Nothing in
 * this file can construct one — the four literals above are checked by the compiler — so a throw
 * from here means the `Command` union changed underneath us, which is a programmer error and should
 * fail loudly rather than be swallowed into a refusal the player cannot distinguish from a wall.
 */
function advance(run: Run, command: Command): Run {
  const before = run[RUN_STATE].state;
  const after = step(before, command);
  const refused = after === before;

  return {
    [RUN_STATE]: {
      state: after,
      scene: refused ? run[RUN_STATE].scene : presentScene(after, run[RUN_STATE].scene),
      cues: cuesFor(before, after),
    },
  };
}
