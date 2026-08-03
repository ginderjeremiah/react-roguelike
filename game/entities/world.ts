/**
 * `ActorWorld` — the floor, everything standing on it, and the queue they act in.
 *
 * ## Why this is not `GameState`
 *
 * `GameState` has no `Floor` yet and wiring it is #18's job. This type is the slice the entity and
 * combat rules need, and it is deliberately the *whole* slice: an actor's position is meaningless
 * without the grid it stands on, and a kill is meaningless without the schedule it leaves. Passing
 * three arguments everywhere instead would produce a rules layer that could be called with a
 * schedule from a different floor.
 *
 * #18 embeds this; nothing here needs to change when it does.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE SCHEDULING INVARIANT — asserted by `findWorldProblems`, relied on everywhere
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 *     an actor is in the schedule  ⟺  it is alive AND (it is the player OR it is awake)
 *
 * Both directions do real work.
 *
 *   - **Dormant creatures are not in the queue.** They take no turns, so a phase that walked the
 *     actor list would have to skip them; leaving them out means `runActorPhase` needs no notion of
 *     dormancy at all. It is also what makes GDD §2 phase 3 come out right: a creature woken by
 *     light joins the queue at **the instant the player is next due to act**, so exactly one *paid*
 *     command stands between the wake and its first resolution — never two, and never zero.
 *
 *     **Never zero is the half this invariant is about, and it is not the same as "never at
 *     `now`".** On a command the player was charged for, phase 1 has already moved the player to
 *     `now + ACTION_COST`, so the creature inherits a strictly future instant and cannot act in
 *     phase 4 of the very turn it woke — the reactive behaviour §2 exists to forbid. On a command
 *     the player was *not* charged for — a free action, or `beginRun` — the player is still due at
 *     `now`, so the creature joins **at `now`**, and that is correct rather than a violation:
 *     such a command has no phase 4, so there is nothing for it to be reactive in, and it resolves
 *     on the next command the player pays a turn for. This paragraph used to name
 *     `now + ACTION_COST` as the rule; that read the *consequence on a paid command* as the rule
 *     itself, which is #125 in one sentence (ADR-0014).
 *   - **Dead actors leave the queue at kill time.** GDD §2 puts deaths at phase 5, and that order
 *     is right — phase 5 is embers dropping and the corpse leaving the world. But a creature killed
 *     in phase 1 is still due at `now`, so it would take its turn in phase 4 and attack from beyond
 *     the grave unless it leaves the queue the moment it dies. `resolveAttack` does exactly that.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## Ordering
 *
 * `actors` is held in **ascending id order** by every function here, and ids are assigned from the
 * floor's `creatures` array, which the generator has already sorted row-major. So every loop over
 * actors is a loop over a defined sequence — never over insertion order, never over RNG draw order
 * (ADR-0004). Nothing in this layer re-sorts by position, distance, or anything else derived from
 * the run.
 */

import { creatureDefinition, PLAYER_ATTACK, PLAYER_MAX_HP } from '../content';
import {
  blocksMovement,
  inBounds,
  samePosition,
  tileAt,
  type Floor,
  type Position,
} from '../map';
import { createSchedule, hasActor, type ActorId, type Schedule } from '../systems/schedule';
import type { ScheduleLens } from '../systems/turn';
import {
  creatureIdAt,
  isAlive,
  isAwake,
  PLAYER_ID,
  type Actor,
  type CreatureActor,
  type PlayerActor,
} from './actor';

/**
 * Ember left behind by a kill (§4: "fuel comes from kills"), waiting on the tile it dropped on.
 *
 * Dropping is phase 5 and belongs here. **Collecting is not implemented** — §2 says embers "are
 * collected by walking over them", which adds fuel, and fuel does not exist until #17. The drop is
 * the half that is knowable now; a collection rule that had nowhere to put the fuel would be
 * inventing #17's design.
 */
export type EmberDrop = {
  readonly at: Position;
  readonly amount: number;
};

/** One floor, mid-run. Plain data all the way down. */
export type ActorWorld = {
  readonly floor: Floor;
  /** Ascending by id. The player is always index 0 while it exists. */
  readonly actors: readonly Actor[];
  readonly schedule: Schedule;
  /** In drop order, which is kill order, which is ascending by the dead actor's id within a turn. */
  readonly embers: readonly EmberDrop[];
};

/**
 * Turn a floor's spawn *plans* into actors.
 *
 * `CreatureSpawn` is deliberately not an actor (see `map/floor.ts`) — it has no id, no HP and no
 * schedule. This is where it becomes one, and the two decisions it makes are both determinism
 * decisions:
 *
 *   - **Ids come from the array index**, and the generator sorted that array row-major. So ids are
 *     a function of *where* the creatures are, never of the order the generator happened to draw
 *     them in. A generator change that shuffled draw order without moving a creature must not
 *     renumber anything.
 *   - **Every creature starts dormant and unscheduled** (§5 step 7: "Creatures: dormant"), so the
 *     opening schedule holds the player alone. The floor wakes up because the player lights it, not
 *     because it started awake.
 */
export function createActorWorld(floor: Floor): ActorWorld {
  const player: PlayerActor = {
    kind: 'player',
    id: PLAYER_ID,
    at: floor.entrance,
    hp: PLAYER_MAX_HP,
    maxHp: PLAYER_MAX_HP,
    attack: PLAYER_ATTACK,
  };

  const creatures: CreatureActor[] = floor.creatures.map((spawn, index) => {
    const definition = creatureDefinition(spawn.kind);
    return {
      kind: 'creature',
      id: creatureIdAt(index),
      species: spawn.kind,
      at: spawn.at,
      hp: definition.maxHp,
      maxHp: definition.maxHp,
      attack: definition.attack,
      mind: { kind: 'dormant' },
    };
  });

  return {
    floor,
    actors: [player, ...creatures],
    schedule: createSchedule([PLAYER_ID]),
    embers: [],
  };
}

/** The actor with this id, or `null`. Linear scan: a floor holds at most seven actors. */
export function findActor(world: ActorWorld, id: ActorId): Actor | null {
  for (const actor of world.actors) {
    if (actor.id === id) return actor;
  }
  return null;
}

/**
 * @throws if there is no such actor. Every caller in this layer holds an id that came out of the
 *   schedule or out of `world.actors`, so a miss means the two have already drifted apart.
 */
export function actorById(world: ActorWorld, id: ActorId): Actor {
  const actor = findActor(world, id);
  if (actor === null) throw new Error(`entities: no actor ${id} in this world`);
  return actor;
}

/** @throws if the actor exists but is not a creature. */
export function creatureById(world: ActorWorld, id: ActorId): CreatureActor {
  const actor = actorById(world, id);
  if (actor.kind !== 'creature') throw new Error(`entities: actor ${id} is not a creature`);
  return actor;
}

/** @throws if the player is missing. The player is never removed from `actors`, even at 0 HP. */
export function playerOf(world: ActorWorld): PlayerActor {
  for (const actor of world.actors) {
    if (actor.kind === 'player') return actor;
  }
  throw new Error('entities: this world has no player');
}

/**
 * Who is standing here, or `null`.
 *
 * **Only living actors occupy space.** A corpse at 0 HP is still in `actors` until phase 5, but it
 * is not an obstacle and not a target: phase 5 is bookkeeping — dropping embers and removing the
 * body — not the instant the thing stops being in the way. The alternative would put a phantom
 * blocker on one tile for the remainder of the turn something died on it, and make an attack
 * declared at that tile "hit" a corpse instead of missing.
 *
 * Scans in ascending id order and returns the first match. Two *living* actors on one tile is a
 * state `findWorldProblems` forbids and the movement rules never produce, so "first" and "last"
 * cannot currently differ — a mutation returning the last match survives the whole suite. It is
 * still written as first-wins rather than left to chance, so that the day something does stack
 * (a shove, a swap, a summon) the answer is already decided by id and not by array position.
 */
export function occupantAt(world: ActorWorld, at: Position): Actor | null {
  for (const actor of world.actors) {
    if (isAlive(actor) && samePosition(actor.at, at)) return actor;
  }
  return null;
}

/**
 * Can an actor stand on this tile — is it in bounds, passable terrain, and unoccupied?
 *
 * `ignoreId` is the actor asking, so its own tile does not count against it.
 */
export function isVacant(world: ActorWorld, at: Position, ignoreId: ActorId): boolean {
  if (!inBounds(world.floor.grid, at.x, at.y)) return false;
  if (blocksMovement(tileAt(world.floor.grid, at.x, at.y))) return false;
  const occupant = occupantAt(world, at);
  return occupant === null || occupant.id === ignoreId;
}

/** Replace an actor by id, keeping the list in ascending id order. */
export function withActor(world: ActorWorld, actor: Actor): ActorWorld {
  let replaced = false;
  const actors = world.actors.map((existing) => {
    if (existing.id !== actor.id) return existing;
    replaced = true;
    return actor;
  });
  if (!replaced) throw new Error(`entities: cannot replace missing actor ${actor.id}`);
  return { ...world, actors };
}

/** Remove an actor entirely. Phase 5 only — see `resolveDeaths`. */
export function withoutActor(world: ActorWorld, id: ActorId): ActorWorld {
  const actors = world.actors.filter((actor) => actor.id !== id);
  if (actors.length === world.actors.length) {
    throw new Error(`entities: cannot remove missing actor ${id}`);
  }
  return { ...world, actors };
}

export function withSchedule(world: ActorWorld, schedule: Schedule): ActorWorld {
  return { ...world, schedule };
}

/** Lets `runActorPhase` drive this world without knowing anything else about it. */
export const scheduleLens: ScheduleLens<ActorWorld> = {
  get: (world) => world.schedule,
  set: withSchedule,
};

/**
 * Everything that must be true of a world between turns, as a list of problems rather than a
 * boolean.
 *
 * Exported as *production* code for the same reason `map/soundness.ts` is: the property tests
 * assert it from the outside, and a failure that says "actor 3 is inside a wall at (4,7)" is worth
 * an order of magnitude more than one that says `false !== true`. It is not called by the
 * simulation itself — nothing here is a rule, only a restatement of what the rules must maintain.
 */
export function findWorldProblems(world: ActorWorld): string[] {
  const problems: string[] = [];
  const grid = world.floor.grid;

  let previousId = -1;
  for (const actor of world.actors) {
    if (actor.id <= previousId) {
      problems.push(`actors are not in ascending id order at actor ${actor.id}`);
    }
    previousId = actor.id;

    if (!inBounds(grid, actor.at.x, actor.at.y)) {
      problems.push(`actor ${actor.id} is outside the grid at (${actor.at.x}, ${actor.at.y})`);
    } else if (blocksMovement(tileAt(grid, actor.at.x, actor.at.y))) {
      problems.push(
        `actor ${actor.id} is inside a ${tileAt(grid, actor.at.x, actor.at.y).kind} at ` +
          `(${actor.at.x}, ${actor.at.y})`,
      );
    }

    if (actor.hp < 0) problems.push(`actor ${actor.id} has negative HP (${actor.hp})`);
    if (actor.hp > actor.maxHp) {
      problems.push(`actor ${actor.id} has ${actor.hp} HP, above its maximum of ${actor.maxHp}`);
    }

    const shouldBeScheduled = isAlive(actor) && (actor.kind === 'player' || isAwake(actor));
    const scheduled = hasActor(world.schedule, actor.id);
    if (shouldBeScheduled && !scheduled) {
      problems.push(`actor ${actor.id} is owed turns but is not in the schedule`);
    }
    if (!shouldBeScheduled && scheduled) {
      problems.push(
        `actor ${actor.id} is in the schedule while ${isAlive(actor) ? 'dormant' : 'dead'}`,
      );
    }
  }

  for (const entry of world.schedule.entries) {
    if (findActor(world, entry.actorId) === null) {
      problems.push(`the schedule holds actor ${entry.actorId}, which is not in this world`);
    }
  }

  for (let i = 0; i < world.actors.length; i += 1) {
    for (let j = i + 1; j < world.actors.length; j += 1) {
      const a = world.actors[i];
      const b = world.actors[j];
      if (isAlive(a) && isAlive(b) && samePosition(a.at, b.at)) {
        problems.push(`actors ${a.id} and ${b.id} are both alive on (${a.at.x}, ${a.at.y})`);
      }
    }
  }

  return problems;
}
