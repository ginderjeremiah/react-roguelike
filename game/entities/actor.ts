/**
 * The actor model: who is on the floor, what it has committed to, and whether it is asleep.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * COMMIT ONE TURN AHEAD — the reason `Intent` is stored on the actor at all
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * GDD §2: "On its turn an awake creature *resolves the action it declared last turn*, then declares
 * its next action from the state at that moment. It cannot react to what you do in between."
 *
 * That is Pillar 2 in its strongest form, and it is a *data* decision before it is a code decision:
 * the declared action is a field of the creature, written one turn before it is read. A behaviour
 * function that looked at the world and returned an action would be reactive by construction, and
 * no amount of care at the call site would fix it. Storing the intent means the only way to make a
 * creature react within a turn is to overwrite a field, which is a visible, reviewable act.
 *
 * The corollaries are the interesting part of the design:
 *
 *   - **An attack marks a tile, not an actor** (§2: "a declared attack marks its target tile"). If
 *     it named its victim, stepping aside would not work, and "step off the marked tile" is the
 *     defensive move §2 says movement exists to be.
 *   - **A declared move can be blocked.** The creature committed to a destination, not to a
 *     journey; if something is standing there when the turn comes, the move fails and the turn is
 *     spent. Baiting is explicitly accepted as skill expression (§2).
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## Shape rules
 *
 * Plain JSON-shaped data, like everything destined for `GameState`: no `Map`, no `Set`, no class
 * instances, no `undefined` fields (`game/core/divergence.ts` throws on the first three and
 * mis-renders the fourth). Dormancy is a **union rather than a boolean plus optional fields**, so
 * reading a creature's intent requires first establishing that it is awake — a dormant creature has
 * no intent, and there is no `intent?: Intent` for a bug to leave stale across a nap.
 *
 * The same rule is why `Mind` carries no memory of the player any more. It used to hold an
 * `Awareness` — the last tile the player's light was seen from — and #83 deleted the two behaviour
 * cases that read it. A field written every turn and read by nothing is a field `GameState` has to
 * reproduce on every replay and a future session has to reverse-engineer a meaning for, so it went
 * with them. `behaviour.ts`'s header keeps the reason it existed.
 *
 * **`turnsSinceContact` went the same way in #123** — the eight-turn re-dormancy clock is deleted,
 * so the awake variant is now one field. `behaviour.ts`'s second `SUPERSEDED` block is where that
 * field's meaning survives; the rule is that a dead field is easier to re-add than a forgotten
 * reason.
 */

import { assertNever } from '../core/assert';
import type { CreatureKind } from '../content';
import { manhattanDistance, type Position } from '../map';
import type { ActorId } from '../systems/schedule';

/**
 * The player's id. **Zero, and that is load-bearing:** `schedule.ts` breaks ties by ascending
 * `actorId`, so the player holding the lowest id is what makes "the player acts first at each
 * instant" fall out of the ordering instead of out of a special case in the turn loop.
 */
export const PLAYER_ID: ActorId = 0;

/** The id of the `n`-th creature on the floor, indexed from the floor's row-major spawn list. */
export function creatureIdAt(spawnIndex: number): ActorId {
  return PLAYER_ID + 1 + spawnIndex;
}

/**
 * One committed action. Declared on a creature's turn, resolved on the next one.
 *
 * Both positioned variants carry the tile they mark, because §2 renders a telegraph from exactly
 * this: "a declared attack marks its target tile; a declared move marks its destination tile."
 * `render/` needs no second copy of the rules to draw it.
 */
export type Intent =
  | { readonly kind: 'wait' }
  | { readonly kind: 'move'; readonly to: Position }
  | { readonly kind: 'attack'; readonly at: Position };

/** Shared by every creature that has committed to nothing. Immutable; never written through. */
export const WAIT: Intent = { kind: 'wait' };

/**
 * Awake, and therefore committed to something.
 *
 * Named separately from `Mind` because it is what `nextMind` returns since #123: a declaration is
 * always an awake mind, and saying so in the type is what makes *"a woken Cinder never returns to
 * dormant"* a fact the compiler checks rather than a rule a reviewer has to notice. Re-introducing
 * the clock means widening this back, which is a visible edit rather than an extra branch.
 */
export type AwakeMind = {
  readonly kind: 'awake';
  /** Declared last turn; resolved on this creature's next turn. */
  readonly intent: Intent;
};

/**
 * Dormant, or awake and committed to something.
 *
 * A union rather than `dormant: boolean` plus an optional field: the awake state carries something
 * a dormant creature must not have, and this makes reading it require establishing wakefulness
 * first. It also makes one design rule unrepresentable-if-violated — **an awake creature always has
 * a declared intent** — which is why waking necessarily declares (§2 phase 3: a creature woken by
 * light "wakes and immediately declares").
 */
export type Mind = { readonly kind: 'dormant' } | AwakeMind;

/** Shared by every sleeping creature. */
export const DORMANT: Mind = { kind: 'dormant' };

export type PlayerActor = {
  readonly kind: 'player';
  readonly id: ActorId;
  readonly at: Position;
  readonly hp: number;
  readonly maxHp: number;
  /** §3: flat, deterministic. Doubled against a dormant target by the combat rules, not here. */
  readonly attack: number;
};

export type CreatureActor = {
  readonly kind: 'creature';
  readonly id: ActorId;
  /** Which row of the content table this came from. */
  readonly species: CreatureKind;
  readonly at: Position;
  readonly hp: number;
  readonly maxHp: number;
  readonly attack: number;
  readonly mind: Mind;
};

/**
 * Anything that takes turns.
 *
 * Discriminated on `player` versus `creature` — **not** on species. A system that switched on
 * `'cinder'` would need editing to add a second creature, which is exactly what `game/content/`
 * exists to prevent; the species is a lookup key, not a variant.
 */
export type Actor = PlayerActor | CreatureActor;

/**
 * Alive means "still acting". Zero HP means dead-but-not-yet-resolved: GDD §2 puts deaths at phase
 * 5, so a creature killed in phase 1 sits at 0 HP for the rest of the turn before its embers drop
 * and it leaves the world. It is *out of the schedule* from the moment it is killed, which is a
 * separate thing and the reason phase 5 can be pure bookkeeping.
 */
export function isAlive(actor: Actor): boolean {
  return actor.hp > 0;
}

/** A dormant creature — the only legal target for a dormant strike (§3), and never scheduled. */
export function isDormant(actor: Actor): boolean {
  return actor.kind === 'creature' && actor.mind.kind === 'dormant';
}

/** An awake creature: it holds a declared intent and is in the schedule while it lives. */
export function isAwake(actor: Actor): boolean {
  return actor.kind === 'creature' && actor.mind.kind === 'awake';
}

/**
 * The intent this creature will resolve on its next turn.
 *
 * @throws if the creature is dormant. A dormant creature has no intent, and a sentinel `wait` here
 *   would silently give a sleeping creature a turn's worth of nothing instead of reporting that
 *   something scheduled an actor that should not be in the queue.
 */
export function declaredIntent(creature: CreatureActor): Intent {
  if (creature.mind.kind !== 'awake') {
    throw new Error(`entities: creature ${creature.id} is dormant and has no declared intent`);
  }
  return creature.mind.intent;
}

/**
 * §3: movement and attacks are 4-directional, so **this** is adjacency — one orthogonal step, which
 * is Manhattan distance 1. A tile is not adjacent to itself.
 *
 * Deliberately expressed in the step metric and nothing else. GDD §4's *vision* radii are measured
 * in a metric that is still open (issue #25); attack range is not, and nothing here may be reused
 * as if it were.
 */
export function isAdjacent(a: Position, b: Position): boolean {
  return manhattanDistance(a, b) === 1;
}

/** The same actor with new HP. Exhaustive over the union so a third kind cannot be forgotten. */
export function withHp(actor: Actor, hp: number): Actor {
  switch (actor.kind) {
    case 'player':
      return { ...actor, hp };
    case 'creature':
      return { ...actor, hp };
    default:
      return assertNever(actor, 'withHp');
  }
}

/** The same actor at a new position. */
export function withPosition(actor: Actor, at: Position): Actor {
  switch (actor.kind) {
    case 'player':
      return { ...actor, at };
    case 'creature':
      return { ...actor, at };
    default:
      return assertNever(actor, 'withPosition');
  }
}
