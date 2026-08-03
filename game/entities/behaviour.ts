/**
 * What a Cinder decides to do, and when it wakes. GDD §4 and §6.
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
 * > Waking it is what tells it where you are, and it does not forget. A woken Cinder comes for you,
 * > and it does not stop. You kill it or you take the stairs.
 *
 * Two cases:
 *
 *   1. adjacent      → attack the player's tile
 *   2. not adjacent  → step toward it
 *
 * **Neither case looks at light**, and that is the whole rule in one line: an awake creature paths
 * toward the player every turn, lit or shuttered, near or far, for the rest of the floor. There is
 * no last-known tile, no search, no clock, and no state in which it holds still. `stepToward`
 * returning `null` — walled off, or every improving step occupied — still yields a wait, but that is
 * "no legal step this turn" rather than a hold-still state, and the creature is still awake and
 * still coming the moment a step opens up.
 *
 * The one thing this function still refuses to do is walk to a corpse; see `pursue`.
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
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * SUPERSEDED (2) — the clock this file used to run, and why #83 kept it and #121 deleted it
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The block above is #83's and describes the *parking*. This one is #121's and describes the
 * *clock*. Both are kept; the file carries two layers of superseded reasoning because the rule was
 * corrected twice, and the second correction is a reversal of a decision the first one made
 * deliberately.
 *
 * Until 2026-08-02 this function had a third case in front of the two that remain:
 *
 *   1. settle the counter  → `0` on contact, otherwise one more than last turn
 *   2. counter at 8        → return to dormant, and leave the schedule
 *
 * `TURNS_TO_REDORMANCY = 8` (tuning) was the constant, `Mind.turnsSinceContact` the field that
 * carried it, and *contact* — adjacency **or** the player's light, in the deleted `contact.ts` —
 * was what reset it. **`LightQuery` existed for that one question**, which is why deleting the
 * clock deletes the entity layer's whole notion of light along with it: nothing left in
 * `game/entities/` asks whether a tile is lit. §2 phase 3's waking still does, and it always did it
 * from the lit radius rather than from `hasContact` (`systems/actors.ts` says why: adjacency waking
 * a sleeper would delete the dormant strike), so the query moved to `game/systems/light.ts`, which
 * is where the real one was always built.
 *
 * **#83 kept the clock on purpose and its reason was good.** Cutting it outright was #83's runner-up
 * and lost on one sentence: *"a permanently-awake parked Cinder is furniture you route around; the
 * decision rate does not move"*, plus the cost that darkness stops being restorative. #83 then
 * deleted parking, which falsified the first half of its own argument — a permanently-awake
 * *pursuing* Cinder is the opposite of furniture — and the exit playtest measured the second half as
 * a refund of a price that had never been charged.
 *
 * **What #121 measured, and why the deletion is upstream of behaviour.** The post-#83 playtest found
 * 0 damage across ~30 turns of active flight, and the ruling is that this can never be fixed by
 * making the creature better: under §2 a creature's action is fixed before the player's command and
 * resolved after it, and an attack names a *tile*, so from adjacency a creature can name its own
 * four neighbours while the player chooses their own four — and those sets intersect only in the
 * tile the player is standing on and leaving. Cadence, geometry-aware pathing and attacks of
 * opportunity are all rejected in GDD §4's *Why a pursuer will never hit a moving player*, two of
 * them on Pillar 2. The defect was never the chase: **fleeing was also *doing something*.** Eight
 * turns of walking converted a hunter back into a sleeper and pursuit delivered it to the player's
 * feet, so declining a fight was a profitable strategy rather than a delay.
 *
 * So the clock is gone and a woken creature is awake for the rest of the floor. The consequences are
 * recorded in §4 rather than here, but two belong next to the code: **darkness is no longer
 * restorative** — the dark gives you sleepers you never woke and nothing else — and **the dormant
 * strike is now the reward for never having lit something**, because a creature you woke can only
 * ever be killed awake.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

import type { Position } from '../map';
import { addActor, hasActor, nextActAtOf, type ActorId } from '../systems/schedule';
import {
  isAdjacent,
  isAlive,
  PLAYER_ID,
  WAIT,
  type AwakeMind,
  type CreatureActor,
  type Intent,
  type PlayerActor,
} from './actor';
import { stepToward } from './pathing';
import { playerOf, withActor, withSchedule, type ActorWorld } from './world';

/** A step toward `goal`, or a wait if there is no legal step. */
function moveOrWait(world: ActorWorld, creature: CreatureActor, goal: Position): Intent {
  const step = stepToward(world, creature.id, creature.at, goal);
  return step === null ? WAIT : { kind: 'move', to: step };
}

/**
 * The mind this creature should hold after declaring — the whole of §6's behaviour, as a pure
 * function of the world and the creature.
 *
 * Pure and returning a mind rather than a world, so that the decision can be tested directly against
 * a hand-built situation without a schedule, and so that the scheduling consequence of a declaration
 * lives in exactly one place (`setMind`).
 *
 * **It returns an `AwakeMind`, not a `Mind`, and that narrowing is the whole of #123.** There is no
 * longer any path from awake back to dormant: a creature woken on a floor stays awake until it dies
 * or the player takes the stairs. Widening this return type is what re-introducing the clock would
 * look like, and it is a change nobody can make by accident.
 *
 * Called on a dormant creature too — that is what waking *is*, since an awake creature must hold an
 * intent (see `Mind`). A creature woken by light or by a strike declares against the player like any
 * other awake creature.
 *
 * **A dead player is the one case §4's ruling does not name**, and it is the reason `pursue` has a
 * gate rather than two lines. `turn.ts` halts the actor sweep on the killing blow, so this is close
 * to unreachable; "close to" is not a rule, so the declaration is gated and the creature stands over
 * the body instead of swinging at it or walking to it.
 */
export function nextMind(world: ActorWorld, creature: CreatureActor): AwakeMind {
  return { kind: 'awake', intent: pursue(world, creature, playerOf(world)) };
}

/**
 * §4: adjacent, it swings; otherwise it closes. Nothing else enters into it — not light, not
 * distance, not how long it has been awake. A corpse is the only thing that stops it.
 *
 * The dead-player gate was #83's and survives #123 unchanged. Without it, "creatures must not spend
 * the intervening turns attacking a corpse" would be honoured by the attack branch and routed around
 * by the movement branch, which is worse than not having the rule.
 */
function pursue(world: ActorWorld, creature: CreatureActor, player: PlayerActor): Intent {
  if (!isAlive(player)) return WAIT;
  if (isAdjacent(creature.at, player.at)) return { kind: 'attack', at: player.at };
  return moveOrWait(world, creature, player.at);
}

/**
 * Write a creature's newly declared mind into the world and put it in the schedule if it is not
 * already there.
 *
 * This is one half of the invariant from `world.ts` — *scheduled ⟺ alive and (player or awake)* —
 * and since #123 it is the only half that can fire: nothing takes a creature from awake to dormant,
 * so nothing ever has to remove one from the queue for falling asleep. The other direction lives
 * where it always did, in `resolveAttack`'s kill-time unschedule.
 *
 * **Waking joins the queue at the instant the player is next due to act** (ADR-0014, §2 phase 3).
 * Not `now + ACTION_COST`: that is the *player's* due instant only on a command that charged the
 * player, and two commands do not — a free action (phase 4 is `identity`) and `beginRun` (phase 3
 * alone). On those the player is still due at `now`, so the creature is too, and it resolves in
 * phase 4 of the next command the player pays a turn for. The observable rule either way: **exactly
 * one paid command stands between the wake and the creature's first resolution — never two, never
 * zero.** Never zero holds by construction, because phase 1 charges the player before phase 3 runs.
 *
 * **The read lives inside this branch and must stay there.** `resolveAttack` unschedules a dead
 * actor *including the player*, and `actOnce` still calls `commitNextIntent` → `setMind` after a
 * killing blow — at which point the creature is already scheduled and returns above, but the player
 * is not, so a read hoisted over the early return throws on every run that ends in a death.
 */
function setMind(world: ActorWorld, creature: CreatureActor, mind: AwakeMind): ActorWorld {
  const updated = withActor(world, { ...creature, mind });
  if (hasActor(updated.schedule, creature.id)) return updated;
  return withSchedule(
    updated,
    addActor(updated.schedule, creature.id, nextActAtOf(updated.schedule, PLAYER_ID)),
  );
}

/**
 * Wake a dormant creature: it declares immediately and joins the schedule at the instant the player
 * is next due to act, which is one *paid* command away however this was reached (see `setMind`).
 *
 * The two callers are GDD §2 phase 3 ("any dormant creature now inside the lit radius wakes and
 * immediately declares") and §3's dormant strike ("if the target survives, it wakes"). Already
 * awake, or dead, and nothing happens — waking an awake creature must not reset its declared
 * intent, or standing in the light next to one would re-declare its plan every turn and quietly
 * make it reactive.
 */
export function wakeCreature(world: ActorWorld, creature: CreatureActor): ActorWorld {
  if (!isAlive(creature) || creature.mind.kind === 'awake') return world;
  return setMind(world, creature, nextMind(world, creature));
}

/**
 * Declare this creature's next action — the second half of its turn, after its previous intent has
 * resolved.
 *
 * Takes an id rather than an actor because the creature has usually just moved: reading it back out
 * of the world is what guarantees the declaration is made from the state *after* resolution, which
 * is what §2 says ("then declares its next action from the state at that moment").
 */
export function commitNextIntent(world: ActorWorld, id: ActorId): ActorWorld {
  const creature = world.actors.find((actor) => actor.id === id);
  if (creature === undefined || creature.kind !== 'creature' || !isAlive(creature)) return world;
  return setMind(world, creature, nextMind(world, creature));
}
