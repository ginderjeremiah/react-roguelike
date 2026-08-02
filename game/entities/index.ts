/**
 * Actors, what they have committed to, and how a Cinder makes up its mind. GDD §3 and §6.
 *
 * ```ts
 * import { createActorWorld, PLAYER_ID, type LightQuery } from '@/game/entities';
 *
 * const world = createActorWorld(floor);          // spawn plans become actors; all dormant
 * const shuttered: LightQuery = { isPlayerLightVisibleFrom: () => false };
 * ```
 *
 * Three things worth knowing before reading further:
 *
 *   - **Declaring is not doing.** This layer produces intents; `game/systems/` resolves them. That
 *     is GDD §2's commit-one-turn-ahead rule, made structural — see `behaviour.ts`.
 *   - **Light is injected.** `LightQuery` is one boolean question, answered by the lighting system
 *     (#14/#17). There is no lighting model in here and no default query to fall back on.
 *   - **No randomness.** Nothing in this directory draws from the RNG; every tie is broken by a
 *     fixed order. See the header of `pathing.ts` for why that is a determinism decision, not a
 *     simplification.
 */

export {
  creatureIdAt,
  declaredIntent,
  DORMANT,
  isAdjacent,
  isAlive,
  isAwake,
  isDormant,
  PLAYER_ID,
  WAIT,
  withHp,
  withPosition,
  type Actor,
  type CreatureActor,
  type Intent,
  type Mind,
  type PlayerActor,
} from './actor';

export { commitNextIntent, nextMind, TURNS_TO_REDORMANCY, wakeCreature } from './behaviour';

export { hasContact, type LightQuery } from './contact';

export { stepDistanceField, stepToward, UNREACHABLE } from './pathing';

export {
  actorById,
  createActorWorld,
  creatureById,
  findActor,
  findWorldProblems,
  isVacant,
  occupantAt,
  playerOf,
  scheduleLens,
  withActor,
  withoutActor,
  withSchedule,
  type ActorWorld,
  type EmberDrop,
} from './world';
