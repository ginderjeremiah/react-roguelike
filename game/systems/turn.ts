/**
 * The order one player command resolves in, and the actor phase inside it.
 *
 * GDD §2 lists six phases and the list is exact — other systems are specified in terms of it. Two
 * examples of why the order is load-bearing rather than tidy:
 *
 *   - Fuel burns (2) *before* lighting recomputes (3), so the turn you run dry is the turn the
 *     shutter shuts, not the turn after.
 *   - Lighting recomputes (3) *before* actors act (4), so a creature woken by the light you just
 *     opened declares this turn and acts next turn — which is what makes "opening the shutter woke
 *     the room" a thing you can see coming.
 *
 * So the order is encoded once, as data, in `RESOLUTION_PHASES`, and `resolveTurn` folds over that
 * constant. Reordering the constant reorders the turn; there is no second copy to drift from it.
 *
 * ## The seam
 *
 * The phases are *injected*. `TurnPhases<S>` is a `Record` over the phase union, so a caller that
 * forgets one does not compile, and each system supplies its own phase without this file ever
 * learning what fuel is. `game/systems/light.ts` supplies five of the six through
 * `lanternPhases(cost, command)`; `game/core/step.ts` supplies the sixth — the player's command —
 * because the `Command` union is `game/core/`'s.
 *
 * Two rules the callers must keep, both of which have a loud failure rather than a quiet one:
 *
 *   - **A command that costs a turn must charge the player in phase 1.** `runActorPhase` charges
 *     and runs every actor due at `now`, and the player is due at `now` when a turn begins, so a
 *     command that forgets leaves the player due in phase 4 and `actOnce` throws.
 *   - **A free action skips phase 4 entirely** — not "runs it without charging". A free command
 *     that merely declines to charge itself still gets charged by phase 4 *and* hands every
 *     creature on the floor a free turn. `TurnCost` has no default anywhere, for that reason.
 *
 * Injecting functions is not a hole in the determinism contract: the *state* stays plain data, and
 * the phases are supplied at the call site by `game/` code, not from outside the simulation.
 */

import {
  advanceToNextActor,
  chargeActor,
  peek,
  type ActorId,
  type Schedule,
} from './schedule';

/**
 * The six phases of one player command, in the order GDD §2 gives them.
 *
 * Order is the specification. `turn.test.ts` restates this list literally and compares, so a
 * "harmless" reordering fails a test that names the GDD rather than merely failing something.
 */
export const RESOLUTION_PHASES = [
  /** 1. The player's command resolves: move-or-attack, wait, set shutter, descend (§3, §9). */
  'command',
  /** 2. Fuel burns at the current shutter rate. */
  'fuelBurn',
  /** 3. Lighting and vision recompute; anything dormant now inside the lit radius wakes and declares. */
  'lightingAndWaking',
  /** 4. Every actor whose `nextActAt` has arrived resolves its declared action, then declares next. */
  'actors',
  /** 5. Deaths resolve; embers drop. */
  'deaths',
  /** 6. The dark-adaptation counter ticks. */
  'darkAdaptation',
] as const;

export type ResolutionPhase = (typeof RESOLUTION_PHASES)[number];

/** One phase of turn resolution: state in, state out. Pure, like everything in `game/`. */
export type TurnPhase<S> = (state: S) => S;

/**
 * Every phase, supplied by the systems that own them.
 *
 * A `Record` over the union rather than an array or an options bag: a missing phase is a compile
 * error, and a phase invented by a caller is too. That is the property that keeps this seam from
 * quietly losing a step during the three PRs that fill it in.
 */
export type TurnPhases<S> = Readonly<Record<ResolutionPhase, TurnPhase<S>>>;

/**
 * Resolve one player command by running every phase, in order, threading state through.
 *
 * Generic over the state type so that this module depends on nothing — not `GameState`, not the
 * map, not the actor model. It is the order and only the order.
 */
export function resolveTurn<S>(state: S, phases: TurnPhases<S>): S {
  let current = state;
  // Iterating an array literal is iterating a defined sequence, not an insertion-ordered
  // collection. This is the same exception `runCommands` makes for a command log: the order is
  // the data.
  for (const phase of RESOLUTION_PHASES) {
    current = phases[phase](current);
  }
  return current;
}

/**
 * How to read and replace the schedule inside a larger state.
 *
 * A lens rather than a `state.schedule` field requirement, because the actor phase has no business
 * dictating the shape of `GameState`, and because `{ ...state, schedule }` over a generic type
 * needs a cast that would hide a real mistake.
 */
export type ScheduleLens<S> = {
  readonly get: (state: S) => Schedule;
  readonly set: (state: S, schedule: Schedule) => S;
};

/**
 * A livelock tripwire, not a rule. Reachable only if an action schedules its own actor at the
 * current instant over and over; with `ACTION_COST` positive, the real bound is the number of
 * actors on a floor (~7).
 */
const MAX_ACTS_PER_TURN = 1024;

/**
 * Phase 4: every actor owed a turn acts, in `(nextActAt, actorId)` order, then the clock advances
 * to the next instant at which anything happens.
 *
 * `act` is the *rules* half — resolve the action this actor declared last turn, then declare its
 * next. This function is the *scheduling* half, and the two are separated because the scheduling
 * half is where the order-dependence bugs live and it can be tested exhaustively without an actor
 * model existing.
 *
 * **The actor is charged before it acts**, which buys two things:
 *
 *   - `act` may remove the actor from the schedule (it died mid-action) and the removal stands.
 *     Charging afterwards would resurrect a corpse into the queue.
 *   - Progress is guaranteed even if `act` forgets to touch the schedule at all, so a bug in one
 *     creature's behaviour is a wrong move rather than a hung turn.
 *
 * The queue is re-read after every action, so an actor killed by an earlier actor in the same
 * phase never gets its turn, and a creature spawned mid-phase is picked up if it is due.
 *
 * @param halt asked after every action: **should the sweep stop here?** GDD §13's "a terminal
 *   state stops the turn where it happens" — if the player dies to the second of three Cinders,
 *   the third does not act and the clock does not advance, so the final state is the frame of the
 *   killing blow rather than three creatures shuffling around a corpse. It is a required argument
 *   and not a default, because "keep going" is a rules answer and this file has no rules in it;
 *   the caller that owns the rules (`actors.ts`) is the one that must say.
 * @throws if the phase fails to make progress — see `MAX_ACTS_PER_TURN`.
 */
export function runActorPhase<S>(
  state: S,
  lens: ScheduleLens<S>,
  act: (state: S, actorId: ActorId) => S,
  halt: (state: S) => boolean,
): S {
  let current = state;

  for (let acted = 0; acted < MAX_ACTS_PER_TURN; acted += 1) {
    const schedule = lens.get(current);
    const next = peek(schedule);

    if (next === null || next.nextActAt > schedule.now) {
      return lens.set(current, advanceToNextActor(schedule));
    }

    current = lens.set(current, chargeActor(schedule, next.actorId));
    current = act(current, next.actorId);
    // Asked *after* the action, never before: a sweep that halted on entry would leave the clock
    // where it was on a perfectly ordinary turn. The killing blow has to have landed first.
    if (halt(current)) return current;
  }

  throw new Error(
    `turn: the actor phase ran ${MAX_ACTS_PER_TURN} actions without the queue emptying at the ` +
      `current instant. Either an action is rescheduling its actor at the current tick instead ` +
      `of charging it, or an action is spawning a new actor already due at the current tick.`,
  );
}
