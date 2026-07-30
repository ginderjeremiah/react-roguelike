/**
 * Combat resolution. GDD §3.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * DETERMINISTIC, AND THAT IS NOT NEGOTIABLE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * §3: "No to-hit rolls, no damage ranges. Randomness lives in what the level generates and where
 * things are, never in whether your correct decision worked (Pillar 2)."
 *
 * **Nothing in this file takes an `Rng` and nothing in it can.** Damage is `attacker.attack`, times
 * two against a dormant target, and that is the entire calculation. There is no accuracy, no
 * variance, no critical hit. If a later change wants any of those, it is a design change and needs
 * a GDD change-log row, not a parameter — which is why the signatures here have nowhere to put one.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## The two rules that make positioning matter more than stats
 *
 * **One action per turn; attacking is your action.** Nothing here charges the actor — the caller
 * does, exactly once, and `runActorPhase` already charges a creature before its action resolves. A
 * `resolveAttack` that also charged would double-charge a creature and halve the floor's speed, and
 * the bug would look like a tuning problem.
 *
 * **An attack resolves against a tile.** §2 declares an attack by marking a tile, so resolution
 * asks what is standing there *now*. A creature that stepped aside is missed, and that is the point:
 * "step off the marked tile is a real defensive move that costs a turn." See `entities/behaviour.ts`
 * for why targeting an actor id instead would quietly delete Pillar 2.
 *
 * ## Death: removed from the schedule now, removed from the world at phase 5
 *
 * GDD §2 puts deaths at phase 5, and that is right — phase 5 is embers dropping and the corpse
 * leaving the world. But the schedule cannot wait: a creature killed in phase 1 is still due at
 * `now`, so it would take its turn in phase 4 and attack after it died. So `resolveAttack` takes a
 * killed actor out of the queue at the instant of the kill, and `resolveDeaths` does the visible
 * half later. The two halves are asserted against each other — `resolveDeaths` throws if it finds a
 * corpse still holding a place in the queue.
 */

import { DESCENT_HEAL, creatureDefinition } from '../content';
import { assertNever } from '../core/assert';
import {
  actorById,
  isAdjacent,
  isAlive,
  isDormant,
  occupantAt,
  playerOf,
  wakeCreature,
  withActor,
  withHp,
  withoutActor,
  withPosition,
  withSchedule,
  isVacant,
  type Actor,
  type ActorWorld,
  type EmberDrop,
  type Perception,
} from '../entities';
import type { Position } from '../map';
import { hasActor, removeActor, type ActorId } from './schedule';

/**
 * §3: "attacking a dormant creature deals double damage." A **rule**, not tuning — it is the
 * mechanical payoff for playing dark and the answer to "what can I only do in darkness", so it
 * lives with the rules rather than in the content table next to the numbers it multiplies.
 *
 * Its visible consequence at M1's numbers: a dormant Cinder (5 HP) dies to one strike from the
 * player (3 × 2 = 6) and costs 0 HP. An awake one takes two strikes and costs 2-4. §3: "the gap
 * between a stalked kill and a botched one is the entire skill gradient".
 */
export const DORMANT_STRIKE_MULTIPLIER = 2;

/**
 * Damage `attacker` deals to `target`. Total, flat, and the same every time.
 *
 * Small integers on purpose (§3): "so the player can do the arithmetic on a phone without reading a
 * log."
 */
export function damageFrom(attacker: Actor, target: Actor): number {
  return attacker.attack * (isDormant(target) ? DORMANT_STRIKE_MULTIPLIER : 1);
}

/**
 * Is this a fight? The player fights creatures and creatures fight the player; creatures do not
 * fight each other.
 *
 * That last clause is a deliberate refusal to invent design. A declared attack marks a tile, so a
 * creature *can* end up standing on a tile another creature marked — and making that hit would add
 * a real tactic (bait them into each other) that GDD §6 does not describe. Whether Cinders can hurt
 * each other is the `game-designer`'s call; until it is made, the conservative reading is the one
 * that adds nothing.
 */
function isHostile(attacker: Actor, target: Actor): boolean {
  return attacker.kind !== target.kind;
}

/**
 * Take an actor out of the queue because it just died. No-op if it was not in it — a dormant
 * creature killed by a stalked strike never was.
 */
function unschedule(world: ActorWorld, id: ActorId): ActorWorld {
  if (!hasActor(world.schedule, id)) return world;
  return withSchedule(world, removeActor(world.schedule, id));
}

/**
 * Resolve an attack by `attackerId` on the tile `at`.
 *
 * Every "nothing happens" case returns the world unchanged rather than throwing, because each one
 * is a legal, meaningful outcome of a committed action: the target stepped aside, or what moved in
 * is not an enemy. The turn is still spent — the caller charged for it.
 *
 * @param perception needed only because a dormant creature that survives **wakes** (§3), and waking
 *   declares an intent (§2), which is what light is for.
 * @throws if the attacker does not exist, is dead, or is attacking its own tile.
 */
export function resolveAttack(
  world: ActorWorld,
  attackerId: ActorId,
  at: Position,
  perception: Perception,
): ActorWorld {
  const attacker = actorById(world, attackerId);
  if (!isAlive(attacker)) {
    throw new Error(`combat: dead actor ${attackerId} cannot attack`);
  }

  const target = occupantAt(world, at);
  // The dodge, and the reason an intent marks a tile: nobody is there any more.
  if (target === null) return world;
  if (target.id === attackerId) {
    throw new Error(`combat: actor ${attackerId} cannot attack its own tile`);
  }
  if (!isHostile(attacker, target)) return world;

  const damage = damageFrom(attacker, target);
  // Clamped at zero: HP is displayed and compared, and a corpse at -3 HP would make "dead" two
  // different tests in two different places.
  const hp = Math.max(0, target.hp - damage);
  const damaged = withHp(target, hp);
  const afterDamage = withActor(world, damaged);

  if (hp === 0) return unschedule(afterDamage, target.id);

  // §3/§6: "If the target survives, it wakes." A dormant creature that ate a stalked strike and
  // lived is the one thing in the game that turns a free kill into a fight.
  if (damaged.kind === 'creature') return wakeCreature(afterDamage, damaged, perception);
  return afterDamage;
}

/**
 * Move `actorId` one orthogonal step to `to`.
 *
 * A blocked move is a **spent turn, not an error**: a creature committed to this destination a turn
 * ago and something has since stepped into it (§2's accepted price — enemies can be baited). Use
 * `canMove` before charging a player command, so a tap on a wall is refused rather than costing a
 * turn.
 *
 * @throws if `to` is not orthogonally adjacent to the actor. Movement is 4-directional (§3); a
 *   two-tile "step" is a bug in the caller, not a blocked move, and silently ignoring it would hide
 *   a teleport.
 */
export function resolveMove(world: ActorWorld, actorId: ActorId, to: Position): ActorWorld {
  const actor = actorById(world, actorId);
  if (!isAdjacent(actor.at, to)) {
    throw new Error(
      `combat: actor ${actorId} at (${actor.at.x}, ${actor.at.y}) cannot step to ` +
        `(${to.x}, ${to.y}) — movement is 4-directional`,
    );
  }
  if (!isVacant(world, to, actorId)) return world;
  return withActor(world, withPosition(actor, to));
}

/** Would `resolveMove` actually move this actor? For a command layer deciding whether to charge. */
export function canMove(world: ActorWorld, actorId: ActorId, to: Position): boolean {
  const actor = actorById(world, actorId);
  return isAdjacent(actor.at, to) && isVacant(world, to, actorId);
}

/**
 * §3/§9: "Tapping an adjacent occupied tile attacks it. One tap, one action."
 *
 * The player's whole action vocabulary in one function, and the reason it is one function is that
 * move-or-attack must be decided by what is on the tile at the moment of the tap — not by a mode,
 * not by a modifier. `to` must be orthogonally adjacent.
 */
export function bump(
  world: ActorWorld,
  actorId: ActorId,
  to: Position,
  perception: Perception,
): ActorWorld {
  const actor = actorById(world, actorId);
  if (!isAdjacent(actor.at, to)) {
    // Enforced here, not only in resolveMove. The adjacency check used to sit on the move branch
    // alone, so a bump onto a distant or diagonal *occupied* tile resolved as an attack and
    // returned cleanly — a ranged, 8-directional strike, which §3 rules out for M1 and lists
    // under Open ("ranged anything"). The loud failure was on the harmless branch and the silent
    // one on the dangerous branch. Found in review.
    //
    // This matters because bump() is the player's whole action vocabulary and #18's tap handler
    // will call it with a raw tap target.
    throw new Error(
      `combat: actor ${actorId} at (${actor.at.x}, ${actor.at.y}) cannot bump ` +
        `(${to.x}, ${to.y}) — movement and attacks are 4-directional`,
    );
  }
  const occupant = occupantAt(world, to);
  if (occupant !== null && occupant.id !== actorId && isHostile(actor, occupant)) {
    return resolveAttack(world, actorId, to, perception);
  }
  return resolveMove(world, actorId, to);
}

/**
 * GDD §2 phase 5: "Deaths resolve; embers drop."
 *
 * Creatures at 0 HP leave the world and drop their ember (§4: "fuel comes from kills"). Processed
 * in ascending id order, so the ember list is a function of who died and not of anything else.
 *
 * **The player is not removed.** A dead player is out of the schedule and takes no more turns, but
 * what a dead player *means* — game over, a score screen, a run record — is #18's decision, and a
 * world with no player in it would make every query here throw before #18 got the chance.
 *
 * @throws if a dead actor is still in the schedule. That is the phase-1 kill-time removal having
 *   failed, and its symptom in play would be a corpse taking a turn — worth a loud failure here
 *   rather than a mystery next turn.
 */
export function resolveDeaths(world: ActorWorld): ActorWorld {
  let current = world;
  const drops: EmberDrop[] = [];

  // A copy, because the loop removes from `current.actors` as it goes.
  for (const actor of [...world.actors]) {
    if (isAlive(actor)) continue;
    if (hasActor(current.schedule, actor.id)) {
      throw new Error(
        `combat: actor ${actor.id} died but is still in the schedule — a kill must leave the ` +
          `queue at the moment it happens, not at phase 5`,
      );
    }
    switch (actor.kind) {
      case 'player':
        continue;
      case 'creature':
        drops.push({ at: actor.at, amount: creatureDefinition(actor.species).emberDrop });
        current = withoutActor(current, actor.id);
        continue;
      default:
        return assertNever(actor, 'resolveDeaths');
    }
  }

  if (drops.length === 0) return current;
  return { ...current, embers: [...current.embers, ...drops] };
}

/**
 * §3: "No healing within a floor. Descending restores 2 HP."
 *
 * The only function in the simulation that raises HP, which is what makes the no-healing rule
 * testable rather than aspirational: a property test asserts the player's HP never rises across a
 * floor, and this is the single exception it has to know about.
 */
export function restoreOnDescent(world: ActorWorld): ActorWorld {
  const player = playerOf(world);
  return withActor(world, withHp(player, Math.min(player.maxHp, player.hp + DESCENT_HEAL)));
}
