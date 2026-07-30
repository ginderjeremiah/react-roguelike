/**
 * The turn scheduler: **one integer clock and a priority queue on `(nextActAt, actorId)`.**
 *
 * GDD §2. The actor with the lowest `nextActAt` acts; ties are broken by **ascending `actorId`**.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE TIE-BREAK IS THE WHOLE POINT OF THIS FILE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Two actors due at the same instant is not an edge case — in M1 it is the *normal* case, because
 * every action costs the same and the whole floor therefore acts on a shared cadence. Something
 * has to decide who goes first, and the only acceptable answer is a property of the actors
 * themselves.
 *
 * `compareScheduleEntries` never returns 0 for two distinct entries: `actorId` is unique within a
 * schedule, so `(nextActAt, actorId)` is a **strict total order**. That matters more than it
 * looks. A comparator that returns 0 on a tie hands the decision to `Array.prototype.sort`, whose
 * behaviour is then *stable* — i.e. the answer becomes "whoever was inserted first", which is
 * spawn order, which is level-generation order, which is a hidden input. It would look correct in
 * every test written against a single generated level and diverge on replay days later, in
 * whatever system happened to be drawing next. ADR-0004 names this failure mode explicitly and
 * says it is invisible to lint and to the type checker. It is not invisible to a property test,
 * and `schedule.test.ts` inserts the same actors in shuffled orders and demands one answer.
 *
 * Sort stability is therefore irrelevant here *by construction* rather than by luck, which is the
 * only form of "irrelevant" worth relying on.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## Variable cost: the mechanism exists, nothing uses it
 *
 * `nextActAt` is an arbitrary integer, so an action costing 60 or 250 ticks needs no new
 * machinery. That generality is why this file is built now: retrofitting a scheduler into a game
 * that assumes alternation is expensive, and this is ~100 lines.
 *
 * **Variable speed is not designed** (GDD §2: "Open"). Every action in M1 goes through
 * `chargeActor`, which charges `ACTION_COST` and nothing else, so observable behaviour is strict
 * alternation. Do not add speed values, per-action costs, or a haste effect until a design
 * document asks for one — building the mechanism is not the same as designing with it.
 *
 * ## Shape
 *
 * Plain arrays and objects, per `game/core/state.ts`. A priority queue is the obvious place to
 * reach for a class or a `Map`; both are refused by the divergence comparator
 * (`game/core/divergence.ts`), which throws rather than silently reporting two different queues as
 * identical. A sorted array is entirely adequate for the ~7 actors a floor holds, and it is
 * comparable, serializable, and inspectable in a bug report.
 */

/** Ticks consumed by one action. GDD §2: **every** M1 action costs this. A rule, not tuning. */
export const ACTION_COST = 100;

/**
 * An actor's identity. Assigned by the entity layer (#16); this module only ever compares them,
 * so it needs no more than "a unique integer per actor".
 */
export type ActorId = number;

/** One actor's place in the queue. */
export type ScheduleEntry = {
  readonly actorId: ActorId;
  /** The instant on the clock at which this actor next acts. Never in the past. */
  readonly nextActAt: number;
};

/**
 * The clock and the queue.
 *
 * `entries` is held in canonical order — ascending `(nextActAt, actorId)` — as an invariant of
 * every function here, which is what makes `peek` a constant-time array read rather than a scan
 * with its own tie-break logic to get wrong a second time.
 */
export type Schedule = {
  /** The single integer clock. Monotonically non-decreasing. */
  readonly now: number;
  /** Canonically ordered; `actorId`s are unique. */
  readonly entries: readonly ScheduleEntry[];
};

/**
 * The strict total order the queue is defined by: earliest first, lowest `actorId` first on a tie.
 *
 * Returns 0 only for entries with the same actor, which cannot both be in one schedule. Exported
 * because the ordering is the specification — tests assert its totality directly, and anything
 * that needs to sort actors for a deterministic loop should use it rather than inventing a second,
 * subtly different comparator.
 */
export function compareScheduleEntries(a: ScheduleEntry, b: ScheduleEntry): number {
  // Comparison rather than subtraction: the difference of two safe integers can exceed 2^53 and
  // lose precision. The sign would survive that, but only accidentally, and a comparator is not a
  // place to be accidentally right.
  if (a.nextActAt !== b.nextActAt) return a.nextActAt < b.nextActAt ? -1 : 1;
  if (a.actorId !== b.actorId) return a.actorId < b.actorId ? -1 : 1;
  return 0;
}

/** A copy in canonical order. The single place the queue's order is established. */
function canonical(entries: readonly ScheduleEntry[]): ScheduleEntry[] {
  return entries.slice().sort(compareScheduleEntries);
}

function assertActorId(actorId: ActorId): void {
  if (!Number.isSafeInteger(actorId)) {
    throw new Error(`schedule: actorId must be a safe integer, got ${String(actorId)}`);
  }
}

function assertTime(time: number, label: string): void {
  if (!Number.isSafeInteger(time)) {
    throw new Error(`schedule: ${label} must be a safe integer tick, got ${String(time)}`);
  }
}

/**
 * Scheduling into the past would mean an actor is owed a turn that already happened, which the
 * drain loop cannot honour and which no caller means. Failing loudly beats a silent clamp: a
 * clamp turns an arithmetic bug into an actor that quietly acts twice.
 */
function assertNotInThePast(schedule: Schedule, nextActAt: number): void {
  if (nextActAt < schedule.now) {
    throw new Error(
      `schedule: cannot schedule an actor at ${nextActAt}, which is before the clock (${schedule.now})`,
    );
  }
}

function indexOfActor(entries: readonly ScheduleEntry[], actorId: ActorId): number {
  return entries.findIndex((entry) => entry.actorId === actorId);
}

/**
 * A schedule in which every listed actor is due immediately, at `now`.
 *
 * They are all tied, so the order in which they first act is decided entirely by the `actorId`
 * tie-break — which is deliberate. The player being an actor like any other, with the lowest id,
 * is what makes "the player moves first" fall out of the ordering rather than out of a special
 * case somewhere in turn resolution.
 *
 * @throws on a duplicate or non-integer id. A duplicate would give one actor two turns per round
 *   and break the uniqueness the tie-break relies on.
 */
export function createSchedule(actorIds: readonly ActorId[], now = 0): Schedule {
  assertTime(now, 'now');

  const seen: ActorId[] = [];
  for (const actorId of actorIds) {
    assertActorId(actorId);
    // Linear scan rather than a Set: a handful of actors, and it keeps this module free of the
    // structures the state contract bans, so nobody has to ask whether this one is "just local".
    if (seen.includes(actorId)) {
      throw new Error(`schedule: duplicate actorId ${actorId}`);
    }
    seen.push(actorId);
  }

  return {
    now,
    entries: canonical(actorIds.map((actorId) => ({ actorId, nextActAt: now }))),
  };
}

/** Is this actor in the queue? */
export function hasActor(schedule: Schedule, actorId: ActorId): boolean {
  return indexOfActor(schedule.entries, actorId) >= 0;
}

/**
 * When this actor next acts.
 *
 * @throws if the actor is not scheduled. Returning a sentinel would let a typo'd id read as "acts
 *   at 0", i.e. immediately, forever.
 */
export function nextActAtOf(schedule: Schedule, actorId: ActorId): number {
  const index = indexOfActor(schedule.entries, actorId);
  if (index < 0) throw new Error(`schedule: no actor ${actorId} is scheduled`);
  return schedule.entries[index].nextActAt;
}

/**
 * Put a new actor in the queue — a spawn, or the initial population when times differ.
 *
 * @throws if the actor is already scheduled (that is a bug, not an update — use `reschedule`), or
 *   if `nextActAt` is in the past.
 */
export function addActor(schedule: Schedule, actorId: ActorId, nextActAt: number): Schedule {
  assertActorId(actorId);
  assertTime(nextActAt, 'nextActAt');
  assertNotInThePast(schedule, nextActAt);
  if (hasActor(schedule, actorId)) {
    throw new Error(`schedule: actor ${actorId} is already scheduled`);
  }
  return {
    now: schedule.now,
    entries: canonical([...schedule.entries, { actorId, nextActAt }]),
  };
}

/**
 * Take an actor out of the queue. Deaths (GDD §2 step 5) are the caller.
 *
 * @throws if the actor is not scheduled — removing a corpse twice means the death phase ran twice,
 *   which is worth hearing about.
 */
export function removeActor(schedule: Schedule, actorId: ActorId): Schedule {
  const index = indexOfActor(schedule.entries, actorId);
  if (index < 0) throw new Error(`schedule: no actor ${actorId} is scheduled`);
  // `filter` preserves relative order, so the result is still canonical.
  return {
    now: schedule.now,
    entries: schedule.entries.filter((_, i) => i !== index),
  };
}

/**
 * Move an actor to a new instant.
 *
 * **This is the variable-cost mechanism**, and it is the whole of it: any future action that costs
 * something other than `ACTION_COST` calls this with its own time. Nothing in M1 does — every
 * action goes through `chargeActor`. See the header.
 *
 * @throws if the actor is not scheduled, or if `nextActAt` is in the past.
 */
export function reschedule(schedule: Schedule, actorId: ActorId, nextActAt: number): Schedule {
  assertTime(nextActAt, 'nextActAt');
  assertNotInThePast(schedule, nextActAt);
  const index = indexOfActor(schedule.entries, actorId);
  if (index < 0) throw new Error(`schedule: no actor ${actorId} is scheduled`);

  return {
    now: schedule.now,
    entries: canonical(
      schedule.entries.map((entry, i) => (i === index ? { actorId, nextActAt } : entry)),
    ),
  };
}

/**
 * Charge an actor for taking its action: it next acts `ACTION_COST` ticks from now.
 *
 * The one function every action in the game pays through, so that "every M1 action costs 100
 * ticks" is a single call site rather than a convention. The player's command phase must charge
 * the player exactly as the actor phase charges creatures; a free action (GDD §2: toggling the
 * shutter) is precisely one that does *not* call this.
 */
export function chargeActor(schedule: Schedule, actorId: ActorId): Schedule {
  return reschedule(schedule, actorId, schedule.now + ACTION_COST);
}

/** The actor at the head of the queue, or `null` if nothing is scheduled. */
export function peek(schedule: Schedule): ScheduleEntry | null {
  // Valid only because `entries` is canonical by invariant. Every constructor above goes through
  // `canonical`; if one ever stops, this silently returns whoever happens to be first.
  return schedule.entries.length === 0 ? null : schedule.entries[0];
}

/**
 * Every actor owed a turn at the current instant, **in the order they act**.
 *
 * Returned as an ordered array rather than a set of ids for exactly the reason this file exists:
 * the order is the answer, and handing back an unordered collection would push the decision back
 * out to a caller iterating it.
 *
 * **Do not build the actor phase out of this.** It is a snapshot, and an actor killed earlier in
 * the same phase would still be in it. `runActorPhase` in `turn.ts` re-reads the queue after every
 * action for that reason. This is for phases that need to *know* who is acting — the lighting and
 * waking pass, a telegraph renderer — rather than to drive them.
 */
export function dueActors(schedule: Schedule): readonly ActorId[] {
  return schedule.entries
    .filter((entry) => entry.nextActAt <= schedule.now)
    .map((entry) => entry.actorId);
}

/**
 * Move the clock forward to the next instant at which anything happens.
 *
 * Never moves backwards and never skips an actor who is already due: if anything is owed a turn at
 * `now`, or the queue is empty, the clock stands still. Time advancing past an unresolved actor is
 * how starvation would happen, so it is made unrepresentable here rather than guarded at the call
 * site.
 */
export function advanceToNextActor(schedule: Schedule): Schedule {
  const next = peek(schedule);
  if (next === null || next.nextActAt <= schedule.now) return schedule;
  return { now: next.nextActAt, entries: schedule.entries };
}
