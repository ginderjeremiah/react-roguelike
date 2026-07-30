/**
 * The two GDD §2 phases that belong to creatures: waking (phase 3) and acting (phase 4).
 *
 * This is the rules half of the actor phase. `runActorPhase` in `turn.ts` is the scheduling half —
 * who is owed a turn and in what order — and the two are separate because the scheduling half can
 * be tested exhaustively without any of this and the rules half changes far more often.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * RESOLVE, THEN DECLARE. NEVER THE OTHER WAY ROUND
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * GDD §2 phase 4: "resolve declared action, then declare the next." `actOnce` is those two lines in
 * that order, and the order is the rule:
 *
 *   - Resolve first, so the action being resolved is the one committed a turn ago, before the
 *     player moved.
 *   - Declare second, and from the world *after* resolution — §2: "declares its next action from
 *     the state at that moment" — so a creature that just stepped into a doorway plans from the
 *     doorway.
 *
 * Swapping the two lines produces a creature that declares and immediately acts on the declaration,
 * which is a creature that reacts to the player's move within the same turn. It would look better
 * in play and it would delete Pillar 2. `commit.test.ts` fails on that swap.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## The free action
 *
 * GDD §2: "Toggling the shutter is a free action — it does not consume a turn." `runActorPhase`
 * charges and runs **every** actor due at `now`, and the player is due at `now` when a turn begins.
 * So a command that merely declines to charge itself still gets charged by phase 4 *and* hands every
 * creature on the floor a free turn — the exact opposite of the design, on Pillar 1's central verb.
 *
 * A free action must therefore skip the actor phase entirely. `actorPhase` takes that as a required
 * argument rather than leaving it to the call site: `TurnCost` has no default, so #17's shutter
 * toggle cannot be wired without stating which it is. `turn.test.ts`'s `a free action` pins both the
 * right and the wrong behaviour; `actors.test.ts` pins this function against both.
 */

import {
  actorById,
  commitNextIntent,
  declaredIntent,
  isAlive,
  isAwake,
  scheduleLens,
  wakeCreature,
  type ActorWorld,
  type Perception,
} from '../entities';
import { assertNever } from '../core/assert';
import { resolveAttack, resolveMove } from './combat';
import type { ActorId } from './schedule';
import { runActorPhase, type TurnPhase } from './turn';

/**
 * Whether the command being resolved costs the player a turn. No default, on purpose — see the
 * free-action note above.
 */
export type TurnCost = 'costsATurn' | 'free';

/**
 * Resolve the action this creature committed to last turn.
 *
 * Every case ends the turn: a wait does nothing, a blocked move does nothing, an attack on a tile
 * the player left hits nothing. All three cost the same turn, which is what makes baiting worth
 * doing (§2).
 */
function resolveDeclaredAction(
  world: ActorWorld,
  id: ActorId,
  perception: Perception,
): ActorWorld {
  const creature = actorById(world, id);
  if (creature.kind !== 'creature') {
    throw new Error(`systems: actor ${id} is not a creature`);
  }
  const intent = declaredIntent(creature);

  switch (intent.kind) {
    case 'wait':
      return world;
    case 'move':
      return resolveMove(world, id, intent.to);
    case 'attack':
      return resolveAttack(world, id, intent.at, perception);
    default:
      return assertNever(intent, 'resolveDeclaredAction');
  }
}

/**
 * One actor's turn in phase 4: resolve, then declare.
 *
 * @throws if handed the player. The player's action is the *command*, resolved in phase 1, and
 *   phase 1 charges the player so it is no longer due when phase 4 runs. Reaching here with the
 *   player means a command forgot to charge — which would otherwise show up as the player silently
 *   acting twice per turn, or as a free action costing one.
 * @throws if handed a dead or dormant actor. Neither is ever in the schedule (see `world.ts`), so
 *   this is the tripwire for that invariant having broken somewhere upstream.
 */
export function actOnce(world: ActorWorld, id: ActorId, perception: Perception): ActorWorld {
  const actor = actorById(world, id);

  if (actor.kind === 'player') {
    throw new Error(
      `systems: the player was due in phase 4 — the player's action resolves in phase 1, and ` +
        `phase 1 must charge the player unless the command is free`,
    );
  }
  if (!isAlive(actor)) {
    throw new Error(`systems: dead actor ${id} was given a turn`);
  }
  if (!isAwake(actor)) {
    throw new Error(`systems: dormant creature ${id} was given a turn`);
  }

  const resolved = resolveDeclaredAction(world, id, perception);
  return commitNextIntent(resolved, id, perception);
}

/**
 * GDD §2 phase 4, whole: every actor owed a turn acts, or nothing at all if the command was free.
 *
 * The `free` branch is `identity` — not "run the phase but skip charging", which is the mistake
 * this signature exists to make unavailable.
 */
export function actorPhase(cost: TurnCost, perception: Perception): TurnPhase<ActorWorld> {
  switch (cost) {
    case 'free':
      return (world) => world;
    case 'costsATurn':
      return (world) =>
        runActorPhase(world, scheduleLens, (current, id) => actOnce(current, id, perception));
    default:
      return assertNever(cost, 'actorPhase');
  }
}

/**
 * The creature half of GDD §2 phase 3: "Any dormant creature now inside the lit radius **wakes** and
 * immediately declares."
 *
 * **Light wakes things; proximity does not.** §4's table is explicit — lit: "every dormant creature
 * in the radius wakes"; dark: "nothing wakes". So this asks the injected light query and nothing
 * else, and in particular it does *not* ask `hasContact`, which also counts adjacency. Adjacency
 * waking a sleeper would delete the dormant strike, which is the only free kill in the game and the
 * entire reason to play dark (§1).
 *
 * Iterates `world.actors`, which is held in ascending id order, so two creatures woken by the same
 * flash join the schedule in id order rather than in whatever order they were found.
 *
 * **That last sentence currently has no test behind it, and cannot have one.** Mutation testing
 * confirmed it: reversing this loop leaves the whole suite green, because waking a creature changes
 * only its own mind, the resulting queue is re-canonicalised by `(nextActAt, actorId)` anyway, and
 * no declaration reads another creature's mind. The order is written down regardless, because the
 * first change that makes waking touch anything shared — a creature that shoves, an intent that
 * considers what its neighbours declared — makes it observable, and at that point the loop being
 * already correct is worth more than a test that was passing for the wrong reason. ADR-0004 names
 * iteration order as the failure lint cannot catch; this is the shape it takes before it bites.
 */
export function wakeInLight(world: ActorWorld, perception: Perception): ActorWorld {
  let current = world;
  for (const listed of world.actors) {
    // Re-read from `current` rather than trusting the snapshot: waking one creature rewrites the
    // world, and writing a stale copy of a later one back would silently undo it.
    const actor = actorById(current, listed.id);
    if (actor.kind !== 'creature' || !isAlive(actor) || isAwake(actor)) continue;
    if (!perception.isPlayerLightVisibleFrom(actor.at)) continue;
    current = wakeCreature(current, actor, perception);
  }
  return current;
}
