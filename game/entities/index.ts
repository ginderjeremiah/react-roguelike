/**
 * Actors, what they have committed to, and how a Cinder makes up its mind. GDD §3 and §6.
 *
 * ```ts
 * import { createActorWorld, PLAYER_ID } from '@/game/entities';
 *
 * const world = createActorWorld(floor);          // spawn plans become actors; all dormant
 * ```
 *
 * Three things worth knowing before reading further:
 *
 *   - **Declaring is not doing.** This layer produces intents; `game/systems/` resolves them. That
 *     is GDD §2's commit-one-turn-ahead rule, made structural — see `behaviour.ts`.
 *   - **Light does not exist in here.** It used to: `contact.ts` injected a `LightQuery` so that the
 *     re-dormancy clock could ask whether a creature could see the lantern. #123 deleted the clock
 *     and the question with it, so this directory now knows nothing about the shutter at all.
 *     Waking is `game/systems/`'s, out of §2 phase 3's lit radius.
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
  type AwakeMind,
  type CreatureActor,
  type Intent,
  type Mind,
  type PlayerActor,
} from './actor';

export { commitNextIntent, nextMind, wakeCreature } from './behaviour';

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
