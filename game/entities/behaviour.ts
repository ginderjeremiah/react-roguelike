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
 * ## The behaviour, from §4 and §6
 *
 * > Waking it is what tells it where you are, and it does not forget. A woken Cinder comes for you;
 * > eight turns (tuning) after the last one in which it saw your light or stood next to you, it
 * > sleeps where it stands.
 *
 * Three cases, in order:
 *
 *   1. settle the counter  → `0` on contact, otherwise one more than last turn
 *   2. counter at 8        → return to dormant, and leave the schedule
 *   3. otherwise           → adjacent: attack the player's tile · not adjacent: step toward it
 *
 * **Case 3 does not look at contact**, and that is the whole rule in one line: an awake creature
 * paths toward the player every turn, lit or shuttered, near or far. There is no last-known tile, no
 * search, and no state in which it holds still. `stepToward` returning `null` — walled off, or every
 * improving step occupied — still yields a wait, but that is "no legal step this turn" rather than a
 * hold-still state: the counter keeps running underneath it and the creature sleeps on schedule.
 *
 * The counter is the one thing that still runs on *contact* rather than on pursuit (§4, explicitly).
 * So a creature that catches you starts its eight over, and one you hold at arm's length in the dark
 * falls asleep — wherever the chase left it, as a fresh dormant-strike target.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * SUPERSEDED — the rule this replaced, and why it is recorded rather than deleted (#83)
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Until 2026-08-02 this function had five cases. The two that are gone read:
 *
 *   4. no contact, memory  → declare a step toward the remembered tile
 *   5. no contact, arrived → declare a wait
 *
 * They implemented the previous §6 — *"shuttered and non-adjacent, it paths to where it last saw
 * your light, then searches"* — and they are the reason `Mind` used to carry an `Awareness`, a union
 * of "I never saw it" and "I saw it at (3, 4)". That field is deleted with them; this paragraph is
 * where its meaning survives, because a dead field is easier to re-add than a forgotten reason.
 *
 * Case 5 was the honest reading of an under-specified "then searches": having reached the last place
 * it saw light and found nothing, the creature held position until re-dormancy. Wandering was
 * refused because it needs a wander model nobody had designed and a random draw on a path taken a
 * variable number of times per turn — the fragility `rng/draw.ts` warns about. **That refusal still
 * stands, and nothing here draws from the RNG.** What changed is that pursuit made the question moot:
 * the creature always has a goal, so it never needs one invented for it.
 *
 * This header used to end: *"if the playtester reports that a searching Cinder is a statue, this is
 * the function to change and case 5 is the only case that changes."* The exit playtest reported it in
 * different words, and the measurement was worse than a statue — it was a **procedure**: shutter,
 * step out of adjacency, walk anywhere for eight turns, walk back, one-shot a dormant target. On the
 * same seed a flash that woke a Cinder cost 16 turns of walking and paid 20 fuel, so waking it was
 * net *profitable* after paying for the entire retreat. Re-dormancy was the refund; **case 5 was what
 * made the refund collectable**, which is why the ruling deleted the parking rather than the clock.
 * The prediction was right and its scope was one case too narrow. See GDD §4, which also records the
 * two fixes that were considered and rejected (a distance requirement; cutting re-dormancy outright).
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

import type { Position } from '../map';
import { ACTION_COST, addActor, hasActor, removeActor, type ActorId } from '../systems/schedule';
import {
  DORMANT,
  isAdjacent,
  isAlive,
  WAIT,
  type CreatureActor,
  type Intent,
  type Mind,
  type PlayerActor,
} from './actor';
import { stepToward } from './pathing';
import { hasContact, type LightQuery } from './contact';
import { playerOf, withActor, withSchedule, type ActorWorld } from './world';

/**
 * §4/§6: "after 8 turns (tuning) with no light and no adjacency it returns to dormant." Counted at
 * declaration, so it is 8 of the creature's own turns.
 *
 * **(tuning)**, and now the game's single most important number — it is the entire length of the
 * consequence of a flash. §4 holds it at 8 and names the measurement that would move it: *the
 * fraction of woken creatures that reach adjacency at least once before re-dormanting.* Near 1 and
 * the 8 is too long.
 *
 * **It is a dial for one arm of the watch only.** If pursuit turns out to be too weak — a pursuer
 * that starts four tiles off and never closes, because the player and a creature share
 * `ACTION_COST` — raising this number lengthens the chase instead of tightening it, and buys
 * adjacency only in walking turns. §4 says the fix there is something not yet named (cadence, or
 * geometry-aware pathing) and needs its own ruling.
 *
 * The watch this docblock used to quote — *"the fix is a distance requirement, not a fuel tax"* —
 * **has fired and its prescription was rejected** (§4, and the superseded block in this file's
 * header): the measured degenerate case was already at distance, so requiring more of it would only
 * have lengthened the retreat it was meant to stop.
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
 * intent (see `Mind`). A creature woken by light or by a strike therefore always has contact, so it
 * starts its clock at zero and declares against the player like any other awake creature.
 *
 * **A dead player is the one case §4's ruling does not name.** `hasContact` already answers `false`
 * for one, deliberately, so that "creatures must not spend the intervening turns attacking a corpse"
 * (`contact.ts`) — but unconditional pursuit would have them *walk to* it instead, which routes
 * around that guard rather than honouring it. `turn.ts` halts the actor sweep on the killing blow, so
 * this is close to unreachable; "close to" is not a rule, so the declaration is gated and the
 * creature waits out its clock over the body.
 */
export function nextMind(
  world: ActorWorld,
  creature: CreatureActor,
  light: LightQuery,
): Mind {
  const player = playerOf(world);

  const turnsSinceContact = hasContact(world, creature, light)
    ? 0
    : (creature.mind.kind === 'awake' ? creature.mind.turnsSinceContact : 0) + 1;

  if (turnsSinceContact >= TURNS_TO_REDORMANCY) return DORMANT;

  return { kind: 'awake', intent: pursue(world, creature, player), turnsSinceContact };
}

/**
 * §4: adjacent, it swings; otherwise it closes. Contact does not enter into it — a corpse is the
 * only thing that stops it, and only because `contact.ts` already refuses to see one.
 */
function pursue(world: ActorWorld, creature: CreatureActor, player: PlayerActor): Intent {
  if (!isAlive(player)) return WAIT;
  if (isAdjacent(creature.at, player.at)) return { kind: 'attack', at: player.at };
  return moveOrWait(world, creature, player.at);
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
