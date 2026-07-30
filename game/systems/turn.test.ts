import { describe, expect, it } from 'vitest';
import { findFieldDivergence, formatFieldDivergence } from '../core';
import { createRng, shuffle } from '../rng';
import {
  ACTION_COST,
  addActor,
  chargeActor,
  createSchedule,
  hasActor,
  nextActAtOf,
  removeActor,
  reschedule,
  type ActorId,
  type Schedule,
} from './schedule';
import {
  RESOLUTION_PHASES,
  resolveTurn,
  runActorPhase,
  type ResolutionPhase,
  type ScheduleLens,
  type TurnPhases,
} from './turn';

/**
 * The GDD §2 resolution order, and the scheduling half of the actor phase.
 *
 * The world used here is a fake — a schedule and a log of who acted — because the real actors, map,
 * fuel, and lighting do not exist yet. That is not a limitation of the test: the scheduling half is
 * exactly the half that can be verified without them, and it is the half where order-dependence
 * bugs live. Standing in for #16's `act` with a function that records its actor is what makes "who
 * acted, in what order" directly assertable, which it will never be again once real behaviour is
 * attached.
 */

type World = {
  readonly schedule: Schedule;
  readonly log: readonly string[];
};

const lens: ScheduleLens<World> = {
  get: (world) => world.schedule,
  set: (world, schedule) => ({ ...world, schedule }),
};

/** An `act` that records the actor and does nothing else — the M1 shape: one action, one cost. */
function record(world: World, actorId: ActorId): World {
  return { ...world, log: [...world.log, `actor ${actorId}`] };
}

function world(schedule: Schedule): World {
  return { schedule, log: [] };
}

type Mutable = Record<string, unknown>;

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Mutable).sort()) deepFreeze((value as Mutable)[key]);
  return value;
}

function expectSame(left: unknown, right: unknown, context: string): void {
  const divergence = findFieldDivergence(left, right);
  if (divergence) throw new Error(`${context}: ${formatFieldDivergence(divergence)}`);
}

// --- The order -----------------------------------------------------------------------------------

describe('RESOLUTION_PHASES', () => {
  it('is exactly the order GDD §2 lists', () => {
    // Restated literally rather than derived, because the order is a design decision other issues
    // are specified against: fuel burns before lighting recomputes, and lighting recomputes before
    // actors act (so a creature woken by the light you just opened declares this turn and acts
    // next turn). Reordering the constant is a rules change and needs a GDD change-log row.
    expect(RESOLUTION_PHASES).toEqual([
      'command',
      'fuelBurn',
      'lightingAndWaking',
      'actors',
      'deaths',
      'darkAdaptation',
    ]);
  });
});

describe('resolveTurn', () => {
  /** Every phase records that it ran, so the call order is directly observable. */
  function tracingPhases(trace: string[]): TurnPhases<number> {
    const phases = {} as Record<ResolutionPhase, (n: number) => number>;
    for (const phase of RESOLUTION_PHASES) {
      phases[phase] = (n) => {
        trace.push(phase);
        return n + 1;
      };
    }
    return phases;
  }

  it('runs every phase exactly once, in order', () => {
    // Catches a fold that skips a phase, runs one twice, or reverses the list. A `step` that
    // silently dropped the fuel phase would be invisible in every other test until a playtest
    // noticed the lantern never running dry.
    const trace: string[] = [];
    resolveTurn(0, tracingPhases(trace));
    expect(trace).toEqual([...RESOLUTION_PHASES]);
  });

  it('threads state through the phases in sequence', () => {
    // Catches phases being applied to the *original* state and the last one winning — which looks
    // right for any single phase and loses five sixths of the turn.
    const phases = {} as Record<ResolutionPhase, (s: string) => string>;
    for (const phase of RESOLUTION_PHASES) phases[phase] = (s) => `${s}>${phase}`;

    expect(resolveTurn('start', phases)).toBe(
      `start>command>fuelBurn>lightingAndWaking>actors>deaths>darkAdaptation`,
    );
  });

  it('applies every phase, so state advances once per phase', () => {
    // Catches a fold that returns early, or one that runs the phases for their side effects and
    // returns the state it started with.
    const trace: string[] = [];
    expect(resolveTurn(0, tracingPhases(trace))).toBe(RESOLUTION_PHASES.length);
  });

  // Not testable at runtime, so recorded here: `TurnPhases` is a Record over the phase union, so
  // a caller that forgets a phase — or invents one — fails to compile. That is the property
  // keeping this seam from quietly losing a step across the three PRs that fill it in.
});

// --- The actor phase -----------------------------------------------------------------------------

describe('runActorPhase', () => {
  it('runs every due actor exactly once, in (nextActAt, actorId) order', () => {
    const start = world(
      createSchedule([2, 0, 1]), // inserted 2, 0, 1 — the queue must not care
    );
    expect(runActorPhase(start, lens, record).log).toEqual(['actor 0', 'actor 1', 'actor 2']);
  });

  it('leaves an actor that is not yet due alone', () => {
    // Catches a phase that drains the whole queue rather than the actors owed a turn *now*: with
    // variable costs later, that would let a slow actor act on someone else's turn; in M1 it would
    // let the player's own charged entry act as if it were a creature.
    const start = world(addActor(createSchedule([0]), 1, ACTION_COST));
    const after = runActorPhase(start, lens, record);

    expect(after.log).toEqual(['actor 0']);
    expect(nextActAtOf(after.schedule, 1)).toBe(ACTION_COST);
  });

  it('charges every actor that acts exactly ACTION_COST', () => {
    const after = runActorPhase(world(createSchedule([0, 1])), lens, record);
    expect(nextActAtOf(after.schedule, 0)).toBe(ACTION_COST);
    expect(nextActAtOf(after.schedule, 1)).toBe(ACTION_COST);
  });

  it('advances the clock to the next instant at which anything happens', () => {
    // Without this the clock would never move and the same actors would be due forever. The jump
    // is to the head of the queue, not by a fixed amount, which is the part that generalizes if a
    // cost ever differs.
    const after = runActorPhase(world(createSchedule([0, 1])), lens, record);
    expect(after.schedule.now).toBe(ACTION_COST);
  });

  it('jumps the clock to the next scheduled instant rather than by a fixed amount', () => {
    // A clock that just adds ACTION_COST is indistinguishable in the M1 steady state, where every
    // gap happens to be exactly one action — which is exactly why this needs its own test instead
    // of being assumed from the alternation cases.
    const start = world(addActor(createSchedule([]), 5, 350));
    const after = runActorPhase(start, lens, record);

    expect(after.log).toEqual([]);
    expect(after.schedule.now).toBe(350);
  });

  it('does not move the clock when there is nothing scheduled', () => {
    const after = runActorPhase(world(createSchedule([], 700)), lens, record);
    expect(after.log).toEqual([]);
    expect(after.schedule.now).toBe(700);
  });

  it('does not resurrect an actor that died taking its own action', () => {
    // The reason the actor is charged *before* it acts. Charging afterwards would put the corpse
    // back in the queue with a fresh act time, and it would keep taking turns.
    const dies = (w: World, actorId: ActorId): World => {
      const logged = record(w, actorId);
      return actorId === 0 ? lens.set(logged, removeActor(logged.schedule, 0)) : logged;
    };

    const after = runActorPhase(world(createSchedule([0, 1])), lens, dies);
    expect(after.log).toEqual(['actor 0', 'actor 1']);
    expect(hasActor(after.schedule, 0)).toBe(false);
  });

  it('does not give a turn to an actor killed earlier in the same phase', () => {
    // The queue is re-read after every action rather than snapshotted up front. A snapshot would
    // let a creature that died this phase still take its turn — visible in play as an attack from
    // something that is already gone.
    const killsTheNext = (w: World, actorId: ActorId): World => {
      const logged = record(w, actorId);
      return actorId === 0 ? lens.set(logged, removeActor(logged.schedule, 1)) : logged;
    };

    const after = runActorPhase(world(createSchedule([0, 1, 2])), lens, killsTheNext);
    expect(after.log).toEqual(['actor 0', 'actor 2']);
  });

  it('gives a turn to an actor spawned mid-phase that is already due', () => {
    const spawns = (w: World, actorId: ActorId): World => {
      const logged = record(w, actorId);
      return actorId === 0 ? lens.set(logged, addActor(logged.schedule, 9, w.schedule.now)) : logged;
    };

    const after = runActorPhase(world(createSchedule([0, 1])), lens, spawns);
    expect(after.log).toEqual(['actor 0', 'actor 1', 'actor 9']);
  });

  it('throws rather than hanging when an action fails to charge its actor', () => {
    // A livelock tripwire, not a rule. An action that reschedules its own actor at the current
    // tick would otherwise spin forever inside a pure function, which presents as a frozen app
    // with no stack to look at.
    const neverProgresses = (w: World, actorId: ActorId): World =>
      lens.set(w, reschedule(w.schedule, actorId, w.schedule.now));

    expect(() => runActorPhase(world(createSchedule([0])), lens, neverProgresses)).toThrow(
      /without the queue emptying/,
    );
  });

  it('does not mutate the state it is given', () => {
    const start = deepFreeze(world(createSchedule([0, 1, 2])));
    expect(() => runActorPhase(start, lens, record)).not.toThrow();
    expect(start.log).toEqual([]);
  });

  it('acts in the same order however the actors were inserted', () => {
    // The phase-level form of the ADR-0004 property: spawn order is level-generation order, and it
    // must not reach the turn loop. Ties are the normal case in M1, so this is not an edge case.
    let rng = createRng('actor-phase-insertion');
    const actors = [11, 4, 7, 2, 9];

    for (let seed = 0; seed < 50; seed += 1) {
      const shuffled = shuffle(rng, actors);
      rng = shuffled.rng;

      let schedule = createSchedule([]);
      for (const actorId of shuffled.value) schedule = addActor(schedule, actorId, 0);

      const after = runActorPhase(world(schedule), lens, record);
      expect(after.log).toEqual(['actor 2', 'actor 4', 'actor 7', 'actor 9', 'actor 11']);
    }
  });
});

// --- A whole run ---------------------------------------------------------------------------------

describe('a turn loop built out of these pieces', () => {
  /**
   * The shape `step()` is expected to take once the real systems exist (#14, #16, #17): the phases
   * that are not written yet are supplied here as identity, *by the caller*, rather than stubbed
   * inside `turn.ts` where a later session would find them and assume fuel was implemented.
   */
  function phases(playerId: ActorId): TurnPhases<World> {
    const identity = (w: World): World => w;
    return {
      command: (w) => lens.set(record(w, playerId), chargeActor(w.schedule, playerId)),
      fuelBurn: identity,
      lightingAndWaking: identity,
      actors: (w) => runActorPhase(w, lens, record),
      deaths: identity,
      darkAdaptation: identity,
    };
  }

  function play(schedule: Schedule, turns: number): World {
    let current = world(schedule);
    for (let turn = 0; turn < turns; turn += 1) current = resolveTurn(current, phases(0));
    return current;
  }

  it('alternates strictly: the player, then every creature, then the player again', () => {
    // GDD §2's observable behaviour for M1. One cost for every action means the whole floor shares
    // a cadence, and the player acts first at each instant because the tie-break is ascending id
    // and the player holds the lowest one — not because anything special-cases the player.
    const after = play(createSchedule([0, 1, 2]), 4);

    expect(after.log).toEqual([
      'actor 0', 'actor 1', 'actor 2',
      'actor 0', 'actor 1', 'actor 2',
      'actor 0', 'actor 1', 'actor 2',
      'actor 0', 'actor 1', 'actor 2',
    ]);
    // One player command, one tick of ACTION_COST on the clock.
    expect(after.schedule.now).toBe(4 * ACTION_COST);
  });

  it('produces an identical run from identical input', () => {
    // The scheduler's contribution to the replay tripwire. Two independent drives of the same
    // schedule must agree on the whole final state, not just on the visible parts.
    expectSame(
      play(createSchedule([0, 1, 2, 3]), 60),
      play(createSchedule([0, 1, 2, 3]), 60),
      'two identical drives diverged',
    );
  });

  it('produces an identical run whatever order the creatures were spawned in', () => {
    // The one that would surface as "the same seed plays differently on the second load". A level
    // generator that placed creatures in a different order — or a save file that restored them in
    // key order — must not change a single turn.
    let rng = createRng('spawn-order');
    const reference = play(createSchedule([0, 1, 2, 3, 4]), 40);

    for (let seed = 0; seed < 25; seed += 1) {
      const shuffled = shuffle(rng, [0, 1, 2, 3, 4]);
      rng = shuffled.rng;

      let schedule = createSchedule([]);
      for (const actorId of shuffled.value) schedule = addActor(schedule, actorId, 0);

      expectSame(play(schedule, 40), reference, `spawn order ${shuffled.value.join(',')} diverged`);
    }
  });

  it('keeps every creature acting once per turn as the floor is cleared', () => {
    // Deaths shrink the queue mid-run. The survivors must keep their cadence rather than the
    // remaining actors quietly speeding up or the clock skipping an instant.
    const identity = (w: World): World => w;
    let current = world(createSchedule([0, 1, 2, 3]));

    for (let turn = 0; turn < 3; turn += 1) {
      current = resolveTurn(current, {
        ...phases(0),
        // A kill resolves in the deaths phase, after the actors have acted — GDD §2 step 5.
        deaths: turn === 0 ? (w) => lens.set(w, removeActor(w.schedule, 2)) : identity,
      });
    }

    expect(current.log).toEqual([
      'actor 0', 'actor 1', 'actor 2', 'actor 3',
      'actor 0', 'actor 1', 'actor 3',
      'actor 0', 'actor 1', 'actor 3',
    ]);
    expect(current.schedule.now).toBe(3 * ACTION_COST);
  });
});
