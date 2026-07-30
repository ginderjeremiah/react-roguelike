/**
 * What a Cinder decides to do, and when it wakes or goes back to sleep. GDD §4 and §6.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * DECLARING IS NOT DOING
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Everything in this file produces an **intent**, which is resolved on the creature's *next* turn
 * (`game/systems/actors.ts`). Nothing here moves anything or deals damage. That split is what makes
 * GDD §2's commit-one-turn-ahead rule structural rather than a convention:
 *
 *     turn N:    resolve the intent declared on turn N-1  →  declare an intent for turn N+1
 *
 * The player acts in phase 1 and creatures in phase 4 of the same turn, so a creature *does* see
 * the player's move before declaring. That is correct and is the whole design — it declares from
 * "the state at that moment" (§2) — and it is harmless precisely because the thing it declares is
 * not resolved until a full player turn later. The property to protect is narrower and sharper than
 * "creatures cannot see the player": **the action a creature resolves this turn was fixed before
 * the player's command this turn**, so your decision alone determined the outcome.
 *
 * The failure this guards against is subtle and would look like a bug fix: making a creature check
 * where the player *is* when its attack resolves, rather than the tile it marked. That single line
 * would delete the defensive move §2 is built around ("step off the marked tile") while making
 * every creature look smarter. `commit.test.ts` exists to kill it.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## The behaviour, from §6
 *
 * > Awake, it paths toward you while your shutter is open or while it is adjacent to you.
 * > Shuttered and non-adjacent, it paths to where it last saw your light, then searches; after 8
 * > turns of no contact it goes dormant again.
 *
 * Which is, in order of precedence:
 *
 *   1. contact + adjacent  → declare an attack on the player's tile
 *   2. contact             → declare a step toward the player, remembering the tile
 *   3. no contact, 8 turns → return to dormant, and leave the schedule
 *   4. no contact, memory  → declare a step toward the remembered tile
 *   5. no contact, arrived → declare a wait
 *
 * **What "then searches" means is the one thing §6 does not spell out**, and case 5 is the smallest
 * honest reading of it: having reached the last place it saw light and found nothing, the creature
 * holds position until re-dormancy. The alternative — wandering — needs a wander model nobody has
 * designed and, worse, needs a random draw on a path taken a variable number of times per turn,
 * which is the fragility `rng/draw.ts` warns about. Flagged for the `game-designer`: if the
 * playtester reports that a searching Cinder is a statue, this is the function to change and case 5
 * is the only case that changes.
 */

import { samePosition, type Position } from '../map';
import { ACTION_COST, addActor, hasActor, removeActor, type ActorId } from '../systems/schedule';
import {
  DORMANT,
  isAdjacent,
  isAlive,
  UNAWARE,
  WAIT,
  type Awareness,
  type CreatureActor,
  type Intent,
  type Mind,
} from './actor';
import { stepToward } from './pathing';
import { hasContact, type LightQuery } from './contact';
import { playerOf, withActor, withSchedule, type ActorWorld } from './world';

/**
 * §4/§6: "after 8 turns (tuning) with no light and no adjacency it returns to dormant." Counted at
 * declaration, so it is 8 of the creature's own turns.
 *
 * **(tuning)**, and flagged in the GDD as the mechanic most likely to degenerate: "if the
 * playtester reports retreating to a cleared room and pressing wait, it is broken. The fix is a
 * distance requirement, not a fuel tax."
 */
export const TURNS_TO_REDORMANCY = 8;

/** A step toward `goal`, or a wait if there is no legal step. */
function moveOrWait(world: ActorWorld, creature: CreatureActor, goal: Position): Intent {
  const step = stepToward(world, creature.id, creature.at, goal);
  return step === null ? WAIT : { kind: 'move', to: step };
}

/**
 * The mind this creature should hold after declaring — the whole of §6's behaviour, as a pure
 * function of the world, the creature, and what it can perceive.
 *
 * Pure and returning a `Mind` rather than a world, so that the decision can be tested directly
 * against a hand-built situation without a schedule, and so that the scheduling consequences of
 * falling asleep live in exactly one place (`setMind`).
 *
 * Called on a dormant creature too — that is what waking *is*, since an awake creature must hold an
 * intent (see `Mind`). A creature woken by light or by a strike therefore always has contact, and
 * takes case 1 or 2.
 */
export function nextMind(
  world: ActorWorld,
  creature: CreatureActor,
  light: LightQuery,
): Mind {
  const player = playerOf(world);

  if (hasContact(world, creature, light)) {
    const awareness: Awareness = { kind: 'lastSeen', at: player.at };
    const intent: Intent = isAdjacent(creature.at, player.at)
      ? { kind: 'attack', at: player.at }
      : moveOrWait(world, creature, player.at);
    return { kind: 'awake', intent, awareness, turnsSinceContact: 0 };
  }

  const remembered: Awareness = creature.mind.kind === 'awake' ? creature.mind.awareness : UNAWARE;
  const turnsSinceContact =
    (creature.mind.kind === 'awake' ? creature.mind.turnsSinceContact : 0) + 1;

  if (turnsSinceContact >= TURNS_TO_REDORMANCY) return DORMANT;

  const intent: Intent =
    remembered.kind === 'lastSeen' && !samePosition(creature.at, remembered.at)
      ? moveOrWait(world, creature, remembered.at)
      : WAIT;

  return { kind: 'awake', intent, awareness: remembered, turnsSinceContact };
}

/**
 * Write a creature's new mind into the world and reconcile the schedule to it.
 *
 * The reconciliation is the invariant from `world.ts` — *scheduled ⟺ alive and (player or awake)* —
 * enforced in one place rather than remembered at each of the three call sites that change a mind.
 * Waking joins the queue at `now + ACTION_COST`, which is what makes §2 phase 3 true: a creature
 * woken by the light you just opened **declares this turn and acts next turn**, never in phase 4 of
 * the turn it woke.
 */
function setMind(world: ActorWorld, creature: CreatureActor, mind: Mind): ActorWorld {
  const updated = withActor(world, { ...creature, mind });
  const scheduled = hasActor(updated.schedule, creature.id);

  if (mind.kind === 'awake' && !scheduled) {
    return withSchedule(
      updated,
      addActor(updated.schedule, creature.id, updated.schedule.now + ACTION_COST),
    );
  }
  if (mind.kind === 'dormant' && scheduled) {
    return withSchedule(updated, removeActor(updated.schedule, creature.id));
  }
  return updated;
}

/**
 * Wake a dormant creature: it declares immediately and joins the schedule for next turn.
 *
 * The two callers are GDD §2 phase 3 ("any dormant creature now inside the lit radius wakes and
 * immediately declares") and §3's dormant strike ("if the target survives, it wakes"). Already
 * awake, or dead, and nothing happens — waking an awake creature must not reset its declared
 * intent, or standing in the light next to one would re-declare its plan every turn and quietly
 * make it reactive.
 */
export function wakeCreature(
  world: ActorWorld,
  creature: CreatureActor,
  light: LightQuery,
): ActorWorld {
  if (!isAlive(creature) || creature.mind.kind === 'awake') return world;
  return setMind(world, creature, nextMind(world, creature, light));
}

/**
 * Declare this creature's next action — the second half of its turn, after its previous intent has
 * resolved.
 *
 * Takes an id rather than an actor because the creature has usually just moved: reading it back out
 * of the world is what guarantees the declaration is made from the state *after* resolution, which
 * is what §2 says ("then declares its next action from the state at that moment").
 */
export function commitNextIntent(
  world: ActorWorld,
  id: ActorId,
  light: LightQuery,
): ActorWorld {
  const creature = world.actors.find((actor) => actor.id === id);
  if (creature === undefined || creature.kind !== 'creature' || !isAlive(creature)) return world;
  return setMind(world, creature, nextMind(world, creature, light));
}
