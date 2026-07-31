/**
 * `GameState` — everything the simulation knows.
 *
 * ## What is here, and where it comes from
 *
 * Almost nothing is defined in this file. `GameState` is `game/systems/`' `LanternWorld` — the
 * floor, everyone on it, and the lantern lighting it — plus the things that belong to the *run*
 * rather than to the floor: the generator and the seed it came from, the four counters, and whether
 * the run is over. Every rule that reads or writes any of it lives in `game/systems/`. This layer
 * knows about commands, generators and endings; it does not know what a shutter does.
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
 *   The same rule is why there is no `fuelGathered` beside `fuelBurned`: it is *exactly*
 *   `fuelBurned + lantern.fuel - STARTING_FUEL`, because §4 gives fuel only two verbs (`burn` and
 *   `refuel`) and a descent carries the reserve untouched. See `fuelBurned`.
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
   * **Creatures the player killed**, over the whole run. §13's summary number.
   *
   * *Creatures*, and the word is exact: **nothing else in this game can die.** `combat.ts`'s
   * `isHostile` is `attacker.kind !== target.kind`, so a creature that ends up standing on a tile
   * another creature marked takes no damage at all; and the player reaching 0 HP ends the run (§13)
   * rather than adding to a count of corpses. So every death is a creature, and every creature's
   * death was dealt by the player. The day §6 gives creatures a reason to hurt each other, this
   * field's name becomes a lie and it has to become two fields — which is why the name says *kills*
   * rather than *deaths*.
   *
   * **Counted at the instant HP reaches 0, not when the body is swept.** GDD §2 puts the sweep in
   * phase 5, and §13 skips phases 5 and 6 entirely on the turn the player dies — so a kill made in
   * phase 1 of the turn that kills you leaves a corpse that is never removed and an ember that is
   * never dropped. It was still a kill, and the last thing a player did before dying is the last
   * thing they want the summary to forget. `killsBetween` is what makes that the counted moment.
   *
   * **A descent is not a massacre.** Phase 1 of `descend` replaces the floor and everyone on it, so
   * the creature *population* changes with nobody dying; `killsBetween` guards on the floor number
   * for exactly that. §13's "you forfeit the floor's remaining kills" is a forfeit, not a tally.
   */
  readonly kills: number;

  /**
   * **Fuel the lantern has burned**, over the whole run. §13's "fuel spent".
   *
   * Gross, not net: this is what GDD §2 phase 2 took, and it is never reduced by the ember off a
   * corpse or by a cache. Those are §4's *income*, and a summary that quietly netted them off would
   * report a lit run that looted well as cheaper than a shuttered run that looted nothing — the
   * exact opposite of the arithmetic §4 asks the player to do.
   *
   * **There is deliberately no `fuelGathered` beside it.** Fuel has exactly two verbs (`burn` in
   * phase 2, `refuel` in phase 5) and a descent carries the reserve across untouched, so
   *
   *     lantern.fuel === STARTING_FUEL - fuelBurned + gathered
   *
   * holds for every state of every run, and `gathered` is therefore *derived*:
   * `fuelBurned + lantern.fuel - STARTING_FUEL`. A stored copy would be a second source of truth for
   * a number already implied by two fields, which is the rule three paragraphs up. `replay.test.ts`
   * asserts the identity, so the derivation is pinned rather than asserted in a comment.
   *
   * **Clamped, so it is fuel that existed.** `burn` stops at 0, so the turn that runs the lantern
   * dry adds the 2 that were left rather than the 4 the rate would have charged.
   */
  readonly fuelBurned: number;

  /**
   * The seed this run was started from. §13's summary shows it; Pillar 4 wants it shareable.
   *
   * Kept rather than dropped by `createInitialState` because `render/presentHud` takes a `GameState`
   * and nothing else — a seed held in `session/` would be invisible to the screen that has to print
   * it. It costs one string and it makes `RunRecord.seed` recoverable from any state, which is the
   * half of #47 that does not need a `platform/` to exist.
   *
   * **Nothing in the simulation reads it, and nothing may.** It is carried, never consulted: the
   * generator in `rng` is the run's entropy and re-deriving from `seed` mid-run would be a second
   * source of truth for the stream position. Any rule that branched on this string would make the
   * seed a *gameplay input* rather than a label, which is a design change and not a refactor.
   */
  readonly seed: string;

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
    kills: 0,
    fuelBurned: 0,
    seed,
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

/** Living creatures standing on this floor. Counting, so the loop's order cannot matter. */
function livingCreatures(world: ActorWorld): number {
  let count = 0;
  for (const actor of world.actors) {
    if (actor.kind === 'creature' && isAlive(actor)) count += 1;
  }
  return count;
}

/**
 * How many creatures died between two worlds — the increment behind `GameState.kills`.
 *
 * ## Why the whole turn, and not a phase
 *
 * A kill is not a phase-local event. The blow lands in phase 1 (`bump`), the body leaves the world
 * in phase 5 (`resolveDeaths`), and on the turn the player dies phase 5 **never runs at all**
 * (§13). Counting the sweep would therefore silently drop the last kill of a losing run, which is
 * the one a player is most likely to be looking for on the summary. Counting *living creatures*
 * before and after the turn as a whole is indifferent to when the body is cleared: a corpse still
 * sitting in `world.actors` at 0 HP has already stopped being alive and has already been counted.
 *
 * It is a subtraction rather than an id-by-id comparison because the arithmetic is exact here:
 * within one floor nothing spawns, nothing is removed while alive (`withoutActor` is phase 5's, for
 * the dead only), and nothing heals — `restoreOnDescent` is the only function in the game that
 * raises HP and it raises the *player's*. So the population of living creatures is monotonically
 * non-increasing and its decrease is the number that died. A count is also order-free by
 * construction, which an id set walked in the wrong order would not be.
 *
 * ## The one guard, and why it is not a special case
 *
 * **A descent is not a massacre.** `descendCommand` replaces the floor and everyone on it in phase
 * 1, so the two worlds hold different populations of different creatures that merely reuse the same
 * ids (`createActorWorld` numbers from the spawn array). Nothing died; you left. §13 is explicit
 * that the forfeit is the *price* of the stairs — "you forfeit the floor's remaining kills" — so
 * counting them would credit the player for the thing they gave up.
 *
 * @param before the world the turn started on; `after` the world it ended on.
 */
export function killsBetween(before: ActorWorld, after: ActorWorld): number {
  if (before.floor.floorNumber !== after.floor.floorNumber) return 0;
  return livingCreatures(before) - livingCreatures(after);
}
