import { describe, expect, it } from 'vitest';
import { findFieldDivergence, formatFieldDivergence } from '../core';
import { createRng, int, shuffle, type Rng } from '../rng';
import {
  ACTION_COST,
  addActor,
  advanceToNextActor,
  chargeActor,
  compareScheduleEntries,
  createSchedule,
  dueActors,
  hasActor,
  nextActAtOf,
  peek,
  removeActor,
  reschedule,
  type ActorId,
  type Schedule,
  type ScheduleEntry,
} from './schedule';

/**
 * The scheduler's ordering, and the properties that make it safe to replay.
 *
 * The tests that matter here are the ones about **order**, because ADR-0004 names iteration-order
 * dependence as the determinism bug that lint and the type checker cannot see: it produces code
 * that looks correct, passes every example test, and diverges on replay days later. So the ordering
 * is checked three ways that fail for different mutations:
 *
 *   1. Against an **independently written** comparator in this file, so a change to
 *      `compareScheduleEntries` cannot quietly redefine what "correct" means.
 *   2. Across **shuffled insertion orders** of the same actors, so any leak of spawn order into the
 *      queue fails regardless of which direction it leaks.
 *   3. By an **independent minimum scan** during a long drain, so `peek` reading `entries[0]` is
 *      cross-checked against something that does not assume the array is sorted at all.
 */

// --- Instruments ---------------------------------------------------------------------------------

type Pair = { readonly actorId: ActorId; readonly nextActAt: number };
type Mutable = Record<string, unknown>;

/**
 * The ordering GDD §2 specifies, written out here rather than imported.
 *
 * This is the point of the file. If the test used `compareScheduleEntries` as its own yardstick,
 * flipping the tie-break to descending id would change the implementation and the expectation
 * together and every assertion would still pass.
 */
function specOrder(pairs: readonly Pair[]): Pair[] {
  return pairs
    .slice()
    .sort((a, b) => a.nextActAt - b.nextActAt || a.actorId - b.actorId);
}

/** Build a schedule by inserting `pairs` one at a time, in the order given. */
function build(pairs: readonly Pair[], now = 0): Schedule {
  let schedule = createSchedule([], now);
  for (const pair of pairs) schedule = addActor(schedule, pair.actorId, pair.nextActAt);
  return schedule;
}

/**
 * Pop `count` actors the way a turn loop does: advance the clock to the head, act, charge.
 *
 * Also asserts the two invariants that must hold at *every* step, not just at the end — the clock
 * never passes an actor who is owed a turn, and the actor that acts is genuinely the minimum under
 * the spec order, found by a scan that does not trust `entries` to be sorted.
 */
function drain(start: Schedule, count: number): { order: ActorId[]; schedule: Schedule } {
  let schedule = start;
  const order: ActorId[] = [];

  for (let i = 0; i < count; i += 1) {
    const head = peek(schedule);
    if (head === null) break;

    const earliest = specOrder(schedule.entries.map((e) => ({ ...e })))[0];
    expect(head).toEqual(earliest);

    schedule = advanceToNextActor(schedule);
    expect(head.nextActAt).toBe(schedule.now);

    order.push(head.actorId);
    schedule = chargeActor(schedule, head.actorId);

    // Nobody has been left behind in the past: if this ever holds, some actor's turn was skipped.
    for (const entry of schedule.entries) {
      expect(entry.nextActAt).toBeGreaterThanOrEqual(schedule.now);
    }
  }

  return { order, schedule };
}

/** `count` actors at random tick offsets, with a span small enough to guarantee ties. */
function randomPairs(rng: Rng, count: number, spanInActions: number): { pairs: Pair[]; rng: Rng } {
  let current = rng;
  const pairs: Pair[] = [];
  for (let actorId = 0; actorId < count; actorId += 1) {
    const drawn = int(current, 0, spanInActions);
    current = drawn.rng;
    pairs.push({ actorId, nextActAt: drawn.value * ACTION_COST });
  }
  return { pairs, rng: current };
}

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

// --- The ordering --------------------------------------------------------------------------------

describe('compareScheduleEntries — the ordering IS the specification', () => {
  it('orders by tick before actorId', () => {
    // Catches a comparator that sorts by id first: actor 9 is due first and must act first,
    // however high its id.
    const early: ScheduleEntry = { actorId: 9, nextActAt: 100 };
    const late: ScheduleEntry = { actorId: 0, nextActAt: 200 };
    expect(compareScheduleEntries(early, late)).toBeLessThan(0);
    expect(compareScheduleEntries(late, early)).toBeGreaterThan(0);
  });

  it('breaks ties by ascending actorId', () => {
    // THE assertion of this module. Descending fails here; so does removing the tie-break, which
    // would return 0 and hand the decision to sort stability, i.e. to insertion order.
    const low: ScheduleEntry = { actorId: 3, nextActAt: 100 };
    const high: ScheduleEntry = { actorId: 7, nextActAt: 100 };
    expect(compareScheduleEntries(low, high)).toBeLessThan(0);
    expect(compareScheduleEntries(high, low)).toBeGreaterThan(0);
  });

  it('is a strict total order over every pair and triple it will ever see', () => {
    // Antisymmetry, irreflexivity on distinct actors, and transitivity. The "never 0 for distinct
    // entries" clause is what makes sort stability irrelevant by construction rather than by luck.
    const entries: ScheduleEntry[] = [];
    for (let actorId = 0; actorId < 6; actorId += 1) {
      for (const nextActAt of [0, 100, 200]) entries.push({ actorId, nextActAt });
    }

    for (const a of entries) {
      expect(compareScheduleEntries(a, a)).toBe(0);
      for (const b of entries) {
        const ab = Math.sign(compareScheduleEntries(a, b));
        // `+ 0` normalizes -0, which `toBe` distinguishes from 0.
        expect(ab + Math.sign(compareScheduleEntries(b, a))).toBe(0);
        // Equal only for the same entry. A comparator that returned 0 on a tie would pass every
        // other assertion in this block and hand the tie-break to sort stability.
        expect(ab === 0).toBe(a.actorId === b.actorId && a.nextActAt === b.nextActAt);
        for (const c of entries) {
          const bc = Math.sign(compareScheduleEntries(b, c));
          if (ab < 0 && bc < 0) expect(compareScheduleEntries(a, c)).toBeLessThan(0);
        }
      }
    }
  });
});

describe('the queue never depends on insertion order', () => {
  it('produces one canonical queue however the actors were inserted', () => {
    // The property ADR-0004 is about. Ties are guaranteed by the narrow time span, and the two
    // insertion orders are shuffled independently, so a queue that remembered spawn order would
    // produce two different answers for the same set of actors.
    let rng = createRng('insertion-order');

    for (let seed = 0; seed < 200; seed += 1) {
      const generated = randomPairs(rng, 7, 2);
      rng = generated.rng;

      const first = shuffle(rng, generated.pairs);
      const second = shuffle(first.rng, generated.pairs);
      rng = second.rng;

      const left = build(first.value);
      const right = build(second.value);

      expectSame(left, right, `seed ${seed}: insertion order changed the queue`);
      expectSame(
        left.entries,
        specOrder(generated.pairs),
        `seed ${seed}: queue does not match (nextActAt, actorId) order`,
      );
      expect(drain(left, 30).order).toEqual(drain(right, 30).order);
    }
  });

  it('gives the same queue whether built in one call or assembled operation by operation', () => {
    // Catches order-of-operations leaking into the structure: a queue built by adding, removing and
    // rescheduling must be indistinguishable from one declared up front.
    const direct = createSchedule([0, 1, 2, 3]);

    let assembled = createSchedule([3, 1]);
    assembled = addActor(assembled, 9, ACTION_COST);
    assembled = addActor(assembled, 0, 0);
    assembled = removeActor(assembled, 9);
    assembled = addActor(assembled, 2, ACTION_COST * 3);
    assembled = reschedule(assembled, 2, 0);

    expectSame(assembled, direct, 'assembly order leaked into the queue');
  });
});

// --- Construction --------------------------------------------------------------------------------

describe('createSchedule', () => {
  it('makes every actor due at the clock, ordered by ascending actorId', () => {
    // In M1 this is the normal case rather than an edge case: everyone is tied at tick 0, so the
    // opening order of the whole floor is decided by the tie-break alone. The player holds the
    // lowest id, which is why "the player moves first" needs no special case anywhere.
    const schedule = createSchedule([3, 1, 2]);
    expect(schedule.now).toBe(0);
    expect(schedule.entries).toEqual([
      { actorId: 1, nextActAt: 0 },
      { actorId: 2, nextActAt: 0 },
      { actorId: 3, nextActAt: 0 },
    ]);
  });

  it('starts the clock where it is told', () => {
    const schedule = createSchedule([0, 1], 500);
    expect(schedule.now).toBe(500);
    expect(dueActors(schedule)).toEqual([0, 1]);
  });

  it('accepts an empty roster', () => {
    const schedule = createSchedule([]);
    expect(peek(schedule)).toBeNull();
    expect(dueActors(schedule)).toEqual([]);
  });

  it('rejects a duplicate actorId', () => {
    // A duplicate would hand one actor two turns per round and break the uniqueness the tie-break
    // depends on — after which ties become genuine ties and order becomes insertion order again.
    expect(() => createSchedule([1, 2, 1])).toThrow(/duplicate actorId 1/);
  });

  it.each([
    ['fractional', 1.5],
    ['NaN', Number.NaN],
    ['unsafe', 2 ** 60],
  ])('rejects a %s actorId', (_label, actorId) => {
    expect(() => createSchedule([actorId])).toThrow(/safe integer/);
  });
});

// --- Queries -------------------------------------------------------------------------------------

describe('peek and dueActors', () => {
  const schedule = build([
    { actorId: 5, nextActAt: 0 },
    { actorId: 2, nextActAt: 0 },
    { actorId: 1, nextActAt: ACTION_COST },
  ]);

  it('peeks the earliest actor, lowest id first on a tie', () => {
    expect(peek(schedule)).toEqual({ actorId: 2, nextActAt: 0 });
  });

  it('reports only the actors owed a turn now, in the order they will act', () => {
    // Catches a `dueActors` that returns everyone (which would let an actor act early) and one
    // that returns them in an arbitrary order (which would push the ordering decision to a caller).
    expect(dueActors(schedule)).toEqual([2, 5]);

    const advanced = advanceToNextActor(removeActor(removeActor(schedule, 2), 5));
    expect(advanced.now).toBe(ACTION_COST);
    expect(dueActors(advanced)).toEqual([1]);
  });

  it('answers membership and act time, and refuses to guess about an unknown actor', () => {
    expect(hasActor(schedule, 5)).toBe(true);
    expect(hasActor(schedule, 4)).toBe(false);
    expect(nextActAtOf(schedule, 1)).toBe(ACTION_COST);
    // A sentinel here would read as "acts at tick 0", i.e. immediately and forever.
    expect(() => nextActAtOf(schedule, 4)).toThrow(/no actor 4 is scheduled/);
  });
});

// --- Costs ---------------------------------------------------------------------------------------

describe('charging an action', () => {
  it('costs exactly ACTION_COST from the clock, not from the actor’s previous time', () => {
    // Pins the semantics that make alternation strict. `nextActAt + ACTION_COST` would look
    // identical for an actor acting exactly on time — which is every actor in M1 — and would drift
    // the moment anything is scheduled ahead of the clock.
    const schedule = build([{ actorId: 0, nextActAt: 300 }]);
    expect(nextActAtOf(chargeActor(schedule, 0), 0)).toBe(ACTION_COST);
  });

  it('is the only cost in the game', () => {
    // GDD §2: every M1 action costs 100 ticks. The variable-cost *mechanism* is `reschedule`, and
    // nothing in the simulation may use it to invent a speed. If this number changes, alternation
    // stops being strict and the GDD change log needs a row.
    expect(ACTION_COST).toBe(100);
  });

  it('reorders the queue when an actor is charged', () => {
    // Catches a charge that updates the time but leaves the entry where it was: `peek` reads
    // `entries[0]`, so a stale position would let the same actor act twice in a row.
    const schedule = createSchedule([0, 1]);
    expect(peek(schedule)?.actorId).toBe(0);
    expect(peek(chargeActor(schedule, 0))?.actorId).toBe(1);
  });
});

describe('adding, removing, and rescheduling', () => {
  const schedule = createSchedule([0, 1]);

  it('adds a spawn in its ordered position', () => {
    expect(addActor(schedule, 7, ACTION_COST).entries).toEqual([
      { actorId: 0, nextActAt: 0 },
      { actorId: 1, nextActAt: 0 },
      { actorId: 7, nextActAt: ACTION_COST },
    ]);
  });

  it('removes an actor and leaves the rest ordered', () => {
    const three = addActor(schedule, 2, 0);
    expect(removeActor(three, 1).entries).toEqual([
      { actorId: 0, nextActAt: 0 },
      { actorId: 2, nextActAt: 0 },
    ]);
  });

  it('refuses to add an actor twice, or to touch one that is not there', () => {
    // Each of these is a bug at the call site, and each has a silent-success failure mode: a
    // duplicate add breaks tie-break uniqueness, a silent no-op remove means a corpse keeps acting.
    expect(() => addActor(schedule, 1, 0)).toThrow(/already scheduled/);
    expect(() => removeActor(schedule, 4)).toThrow(/no actor 4 is scheduled/);
    expect(() => reschedule(schedule, 4, 0)).toThrow(/no actor 4 is scheduled/);
  });

  it('refuses to schedule an actor into the past', () => {
    // A turn that is already over cannot be owed. Clamping instead would turn an arithmetic bug
    // into an actor that quietly acts twice in one instant.
    const later = createSchedule([0], 500);
    expect(() => reschedule(later, 0, 499)).toThrow(/before the clock/);
    expect(() => addActor(later, 1, 0)).toThrow(/before the clock/);
    expect(() => reschedule(later, 0, 500)).not.toThrow();
  });

  it('never mutates the schedule it is given', () => {
    // Deep-frozen input: an in-place write throws a TypeError naming the line that did it. The
    // aliasing version of this bug — writing through `entries` inherited from an earlier turn —
    // would retroactively rewrite a state a replay had already produced.
    const frozen = deepFreeze(createSchedule([0, 1, 2]));
    expect(() => addActor(frozen, 3, ACTION_COST)).not.toThrow();
    expect(() => removeActor(frozen, 1)).not.toThrow();
    expect(() => reschedule(frozen, 1, ACTION_COST)).not.toThrow();
    expect(() => chargeActor(frozen, 1)).not.toThrow();
    expect(() => advanceToNextActor(frozen)).not.toThrow();
    expect(frozen.entries).toHaveLength(3);
  });
});

// --- The clock -----------------------------------------------------------------------------------

describe('the clock', () => {
  it('stands still while anyone is owed a turn', () => {
    // Advancing past a due actor is precisely how starvation would happen, so it is made
    // unrepresentable here rather than guarded at each call site.
    const schedule = createSchedule([0, 1]);
    expect(advanceToNextActor(schedule)).toBe(schedule);
  });

  it('jumps to the next instant at which anything happens', () => {
    const schedule = chargeActor(chargeActor(createSchedule([0, 1]), 0), 1);
    expect(advanceToNextActor(schedule).now).toBe(ACTION_COST);
  });

  it('does nothing with an empty queue', () => {
    const empty = createSchedule([], 400);
    expect(advanceToNextActor(empty).now).toBe(400);
  });

  it('never runs backwards, over a long drive', () => {
    // Catches a clock derived from the head unconditionally: remove an actor that was holding the
    // queue back and `now = peek().nextActAt` would jump forward, but any formulation that takes
    // a minimum over a shrinking set can also jump *back*, which would replay a turn.
    let schedule = createSchedule([0, 1, 2]);
    let previous = schedule.now;
    for (let i = 0; i < 60; i += 1) {
      schedule = advanceToNextActor(schedule);
      expect(schedule.now).toBeGreaterThanOrEqual(previous);
      previous = schedule.now;
      const head = peek(schedule);
      if (head) schedule = chargeActor(schedule, head.actorId);
      if (i === 20) schedule = removeActor(schedule, 1);
    }
  });
});

// --- Starvation ----------------------------------------------------------------------------------

describe('no actor starves', () => {
  it('gives every actor exactly the same number of turns when they share a cadence', () => {
    // The M1 case, and the strongest form of the property: with one cost for every action, a drain
    // of k*n acts is k identical rounds in ascending id order. A tie-break that varied by
    // insertion, or a queue that let an actor act twice, breaks the repeating sequence.
    const actors = [0, 1, 2, 3, 4, 5, 6];
    const { order } = drain(createSchedule(actors), actors.length * 40);

    expect(order).toHaveLength(actors.length * 40);
    for (let round = 0; round < 40; round += 1) {
      expect(order.slice(round * actors.length, (round + 1) * actors.length)).toEqual(actors);
    }
  });

  it('always runs the earliest actor next, whatever the starting times', () => {
    // `drain` asserts, at every single pop, that the actor chosen is the minimum under the
    // independently written spec order and that no actor was left behind in the past. Random start
    // times mean the queue is genuinely reordering rather than rotating.
    let rng = createRng('starvation');
    for (let seed = 0; seed < 100; seed += 1) {
      const generated = randomPairs(rng, 5, 6);
      rng = generated.rng;

      const { order, schedule } = drain(build(generated.pairs), 200);
      expect(order).toHaveLength(200);
      // Every actor got turns, and the spread is bounded by the head start they were given.
      for (const pair of generated.pairs) {
        const count = order.filter((id) => id === pair.actorId).length;
        expect(count).toBeGreaterThanOrEqual(200 / 5 - 6);
      }
      expect(schedule.entries).toHaveLength(5);
    }
  });
});

// --- Shape ---------------------------------------------------------------------------------------

describe('the schedule is plain JSON-shaped data', () => {
  it('survives a JSON round trip unchanged', () => {
    // `findFieldDivergence` throws on a Map, Set, Date, or class instance rather than comparing it
    // as vacuously identical — so this fails loudly if the queue is ever "optimized" into a heap
    // class or a Map keyed by actor. See game/core/divergence.ts.
    const schedule = chargeActor(createSchedule([2, 0, 1]), 0);
    const roundTripped: unknown = JSON.parse(JSON.stringify(schedule));
    expectSame(schedule, roundTripped, 'schedule did not survive serialization');
  });

  it('is built from plain objects and arrays', () => {
    const schedule = createSchedule([0, 1]);
    expect(Object.getPrototypeOf(schedule)).toBe(Object.prototype);
    expect(Array.isArray(schedule.entries)).toBe(true);
    expect(Object.getPrototypeOf(schedule.entries[0])).toBe(Object.prototype);
  });
});
