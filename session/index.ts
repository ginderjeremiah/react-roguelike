/**
 * The layer that owns a run. A seed goes in; a `Scene`, a cue list, and four intents come out.
 *
 * ```ts
 * import { beginRun, cuesOf, move, sceneOf, setShutter, type Run } from '@/session';
 * import { cellAt, type Cue, type Scene } from '@/render';
 *
 * const [run, setRun] = useState<Run>(() => beginRun('emberdepth'));
 *
 * const scene: Scene = sceneOf(run);              // board + HUD, cells reused where unchanged
 * const cues: readonly Cue[] = cuesOf(run);       // what the last tap did, as facts
 *
 * onPressNorth(() => setRun(move(run, 'north')));
 * onPressShutter(() => setRun(setShutter(run, 'shuttered')));
 * ```
 *
 * ## Why this layer exists at all
 *
 * `render/` turns one `GameState` into one `Scene`. Somebody has to *have* the `GameState`, advance
 * it when the player taps, and keep the previous scene around so the next one can reuse cells — and
 * that somebody could not be `components/` or `app/`, because both are forbidden from importing
 * `game/` by an ESLint rule and by an independent scanner in `tests/unit/infrastructure.test.ts`.
 * The ban is right: `components/` consuming `GameState` is exactly what ADR-0003's swappable-renderer
 * seam exists to prevent. The consequence was that nothing above `render/` could legally call
 * `createInitialState()` or `step()`, so `render/` had a caller-shaped hole above it and #20 had
 * nowhere to stand. **ADR-0010** is the decision; this is the implementation of it.
 *
 * ```
 * app/         screens, wiring                                React lives here and only here
 * components/  React Native views
 * session/     owns the run: seed -> Run -> intents -> Scene   pure TS   <- you are here
 * render/      GameState -> presentation model                 pure TS
 * game/        the simulation                                  pure TS, deterministic
 * ```
 *
 * `session/` may import `game/` and `render/`. It must never import `react`, `react-native`,
 * `expo-*`, `app/`, or `components/`, and it contains only `.ts` files — the same rules `render/`
 * lives under, for the same reason: everything here is testable in Vitest with no DOM.
 *
 * ## The two properties this layer is for
 *
 * Both are **structural**. Neither is a rule anybody has to remember, which is the point — a layer
 * whose guarantees are documented rather than enforced is a layer that is one hurried PR from not
 * having them.
 *
 * 1. **`Run` is opaque:** nothing above this layer can reach a `GameState` **through a `Run`**
 *    without an explicit, visible cast. (The `GameState` *type* is still nameable up here via
 *    `@/render`'s barrel — `Parameters<typeof presentScene>[0]` — which is pre-existing from
 *    #19/#42 and tracked separately. It buys a shape and never a value; the live state of the run
 *    in hand is what this guards.) The state sits behind a module-private `unique symbol`
 *    that is not exported from `run.ts` and therefore not exported from here; `Run` is declared as an
 *    `interface` (no implicit index signature) whose property type is `never` (nothing to project
 *    through `Run[keyof Run]`). All three are load-bearing — the second and third were added after
 *    review of PR #51 found a component-legal exploit that used exactly those two gaps, with no cast
 *    and full autocomplete on `GameState`. The residual is a deliberate double cast, which is loud
 *    and
 *    reviewable; the closed path is the one that looked like ordinary code. `run.test.ts` and
 *    `tests/unit/session-consumer.test.ts` assert each mechanism separately.
 * 2. **`Command` never crosses the seam.** There are four intent functions instead of one
 *    `apply(run, command)`, so `components/` never needs `game/core/command.ts` to build one. What
 *    crosses is a verb plus plain data: a `Direction`, a `ShutterState`.
 *
 * Everything else — which state to diff against, which scene to reuse, when a refusal happened — is
 * decided in `run.ts` and argued at length in its header. Read that before changing anything here.
 *
 * ## What is deliberately absent
 *
 * | Not here | Why, and when it arrives |
 * | --- | --- |
 * | A command log / `RunRecord` | Nothing in M1 reads one. It lands with save/resume in **M4**; see `run.ts` |
 * | `travel(run, to)` | ADR-0009 defers auto-travel to **M2**. It will be one more function here, which is the constraint that ADR shape was chosen to satisfy |
 * | Where the seed comes from | Reading a clock or a save file is `platform/`'s job. `beginRun` takes a seed; M1 passes a constant |
 * | Undo, rewind, checkpoints | GDD §13: no continue and no rewind. A `Run` only ever moves forward |
 */

export {
  beginRun,
  cuesOf,
  descend,
  move,
  sceneOf,
  setShutter,
  wait,
  type Run,
} from './run';

/**
 * The two argument vocabularies, re-exported so that `components/` can *name* what it passes.
 *
 * Without these, a component writing `type DPadProps = { onStep(dir: Direction): void }` has three
 * options: import `game/core` (the thing this layer exists to make unnecessary), spell
 * `Parameters<typeof move>[1]` (the same type, obfuscated), or widen to `string` (and lose the
 * exhaustiveness that makes a four-button pad checkable). Re-exporting is the only one of the three
 * that is not a defeat.
 *
 * It is also not a hole in the seam. The ban exists so that nothing above it can *inspect a
 * `GameState`*; these are two closed string unions that reference nothing in the simulation, survive
 * JSON intact, and are already visible upstairs through `render/`'s own types (`Cue`'s
 * `shutterChanged` names `ShutterState`). Re-exporting them hands `components/` nothing it could not
 * already see and nothing it could ask a question of.
 *
 * `DIRECTIONS` — the sorted runtime list — is **not** re-exported, because nothing needs to iterate
 * the four directions yet. If a d-pad ever wants to build its buttons from the type rather than from
 * four literals, add it then.
 */
export type { Direction } from '../game/core';
export type { ShutterState } from '../game/fov';
