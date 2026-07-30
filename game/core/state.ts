/**
 * `GameState` — everything the simulation knows.
 *
 * ## What is here, and where it comes from
 *
 * Almost nothing is defined in this file. `GameState` is `game/systems/`' `LanternWorld` — the
 * floor, everyone on it, and the lantern lighting it — plus the four things that belong to the
 * *run* rather than to the floor: the generator, the two counters, and whether the run is over.
 * Every rule that reads or writes any of it lives in `game/systems/`. This layer knows about
 * commands, generators and endings; it does not know what a shutter does.
 *
 * ## Shape rules this type is held to
 *
 * - **Plain, JSON-round-trippable data.** No class instances, no `Map`/`Set`, no `undefined`
 *   values, no `NaN`, no `-0`. A save file is `(seed, commands)`, but state is compared
 *   field-by-field by the replay tests and serialized by the debug tooling, and every one of those
 *   exclusions is a value that survives neither `JSON.stringify` nor a structural comparison
 *   intact. `game/core/divergence.ts` **throws** on a non-plain object rather than reporting two
 *   different ones as identical, so this is enforced rather than aspirational.
 * - **Discriminated unions, not optional fields.** `status` is a three-variant union rather than
 *   `over: boolean` plus an optional cause, so reading why a run ended requires establishing that
 *   it did. Optional fields multiply: six of them describe 64 states, of which perhaps four are
 *   reachable, and nothing tells you which four.
 * - **One source of truth.** In particular there is **no `floorNumber` field**: the floor already
 *   carries its own number (`state.world.floor.floorNumber`), and a second copy is a field that can
 *   disagree with the map the player is standing on. `floorNumberOf` reads the one that exists.
 * - **`readonly` everywhere.** It does not make the object immutable at runtime — the tests
 *   deep-freeze for that — but it makes an accidental in-place update a type error at the point it
 *   is written rather than a replay divergence a fortnight later.
 *
 * ## Why `Floor` lives *inside* the state
 *
 * It looks like generator output that could be held beside the run, and it was, until collecting an
 * ember cache started rewriting the grid tile and dropping the entry from `floor.caches`. A `Floor`
 * held outside `GameState` would let a replay that takes a cache diverge without the comparison
 * noticing — the one failure the replay tripwire exists to catch, arriving through the one door
 * nobody was watching. So it is in, and it is compared.
 */

import { FIRST_FLOOR } from '../content';
import { isAlive, playerOf, type ActorWorld } from '../entities';
import { generateFloor } from '../map';
import { createRng, type Rng } from '../rng';
import { beginRun, type Lantern, type LanternWorld } from '../systems';

/**
 * How a run ended, or that it has not. GDD §13: **a run ends in exactly two ways.**
 *
 * A union rather than `over: boolean`, because the two endings are different states that a summary
 * screen, a stored record, and a future statistics table all have to tell apart — and because
 * `{ over: true }` with no cause is a state that would compile.
 *
 * **0 fuel is deliberately not here.** §4 and §13 are both explicit: it is a desperate state and not
 * a loss state, it is recoverable from a kill or a cache, and "it is the first thing anyone
 * assumes". A third variant is what someone will reach for; there is nowhere to put it.
 */
export type RunStatus =
  /** Still playing. Commands resolve. */
  | { readonly kind: 'running' }
  /** §13: the player's HP reached 0. Permanent — there is no continue and no rewind. */
  | { readonly kind: 'died' }
  /** §13: the stairs on floor `LAST_FLOOR` were taken. A win; there is no floor 9. */
  | { readonly kind: 'reachedBottom' };

/** Shared by every state of a run in progress. Immutable; never written through. */
export const RUNNING: RunStatus = { kind: 'running' };

/** The complete state of a run. Immutable; `step` returns a new one. */
export type GameState = {
  /** The floor, everyone standing on it, and the queue they act in. */
  readonly world: ActorWorld;
  /** Fuel, the shutter, the adaptation ramp, and everything ever perceived on this floor. */
  readonly lantern: Lantern;
  /** Running, or how it ended. See `RunStatus`. */
  readonly status: RunStatus;

  /**
   * **Turns the player has spent** — what a player retells, and what §13's summary screen puts on
   * the board.
   *
   * Increases by one per resolved command that costs a turn (§2: `move`, `wait`, `descend`), and
   * *not* for a free action or a refusal. It is therefore **not** a count of `step` calls, which is
   * the assumption the M0 `turn` field encoded and which three separate rules now falsify.
   *
   * The winning descent from the last floor is counted, even though §13 pays its turn on a floor
   * that does not exist: the player took the stairs, and that is a turn's worth of decision.
   */
  readonly turnsElapsed: number;

  /**
   * **Commands that actually resolved** — the replay's cross-check on its own position.
   *
   * Increases by one on every `step` call that is not a refusal, free actions included. A refusal
   * increments nothing, because §2 says a refused action produces "no change to any field of the
   * state" and a counter is a field.
   *
   * That makes this the observable that distinguishes a *resolved* free action from a *refused*
   * one in the one case where nothing else does: `setShutter('open')` on a dry lantern resolves
   * (§4 — the player pressed the control and it had nothing to give), burns its 1 fuel against a
   * reserve that is already 0, and changes nothing else at all. Without this counter that command
   * would be byte-identical to a refusal, and "byte-identical to its predecessor means refused"
   * — which the replay suite asserts — would be false.
   */
  readonly commandsResolved: number;

  /**
   * The generator. Lives in state, per ADR-0004, so that a run is a pure function of its seed and
   * its command log — a generator held outside state is a hidden input, and hidden inputs are
   * exactly what makes replays diverge.
   *
   * Only two things in the whole simulation draw from it: `createInitialState` (floor 1) and a
   * resolved `descend` (the floor below). Everything else is deterministic by design (§3: "no
   * to-hit rolls, no damage ranges").
   */
  readonly rng: Rng;
};

/**
 * The state a run begins in, derived entirely from the seed.
 *
 * Pure and total: any string is a valid seed, including the empty string. This is the only place a
 * run's starting state is constructed, which is what makes `replay` able to rebuild it from a
 * `RunRecord` containing nothing but a seed.
 *
 * **It draws.** Generating floor 1 consumes `expectedDrawCount(1)` draws before the first command
 * is ever issued, so a replay's draw budget starts from there and not from zero.
 *
 * What the starting state *is* — open shutter, 80 fuel, sense radius at the adaptation floor, the
 * entrance room already perceived — is GDD §4's, and is stated once, in `game/systems/run.ts`.
 */
export function createInitialState(seed: string): GameState {
  const floor = generateFloor(createRng(seed), FIRST_FLOOR);
  return {
    ...beginRun(floor.value),
    status: RUNNING,
    turnsElapsed: 0,
    commandsResolved: 0,
    rng: floor.rng,
  };
}

/**
 * Which floor the player is on. **Derived, never stored** — see the shape rules above.
 *
 * 1-based, and equal to `LAST_FLOOR` on the floor whose stairs win the run.
 */
export function floorNumberOf(state: GameState): number {
  return state.world.floor.floorNumber;
}

/**
 * The `LanternWorld` view of a state — the slice `game/systems/` resolves a turn against.
 *
 * A projection rather than a nested field, so that reading the state is `state.world.floor.grid`
 * rather than `state.floor.world.floor.grid`, and so that a systems phase cannot reach the run's
 * counters or its generator. It is the pair, and nothing else, by construction.
 */
export function worldOf(state: GameState): LanternWorld {
  return { world: state.world, lantern: state.lantern };
}

/** The same run, with the floor advanced to `resolved`. The inverse of `worldOf`. */
export function withWorld(state: GameState, resolved: LanternWorld): GameState {
  return { ...state, world: resolved.world, lantern: resolved.lantern };
}

/**
 * Is the run still accepting commands? GDD §13: once it has ended, every command is refused.
 *
 * Asked of `status` rather than recomputed from HP, because the two endings have nothing in common
 * to recompute from: one is a dead player, the other is a live player standing on floor 8's stairs.
 */
export function isRunning(state: GameState): boolean {
  return state.status.kind === 'running';
}

/**
 * The status a resolved turn leaves behind: `died` if the player's HP reached 0, else unchanged.
 *
 * The *other* ending never comes through here — taking the last floor's stairs ends the run in
 * phase 1 and runs no phases at all (§13), so `step` sets it directly. Handling only the ending
 * that a resolved turn can produce is what keeps this function from having to know what floor it
 * is on.
 */
export function statusAfterTurn(state: GameState, resolved: LanternWorld): RunStatus {
  if (!isAlive(playerOf(resolved.world))) return { kind: 'died' };
  return state.status;
}
