/**
 * Turn scheduling, and the order one player command resolves in.
 *
 * ```ts
 * import { chargeActor, createSchedule, resolveTurn, runActorPhase } from '@/game/systems';
 *
 * const schedule = createSchedule([PLAYER, cinderA, cinderB]); // everyone due at tick 0
 * ```
 *
 * Two files, two jobs: `schedule.ts` owns the clock and the queue (and the `(nextActAt, actorId)`
 * ordering the whole simulation's determinism rests on), `turn.ts` owns the GDD §2 phase order and
 * the actor phase inside it.
 *
 * Nothing here is wired into `game/core/step.ts` yet — `GameState` has no actors to schedule until
 * #16 lands, and inventing them here would be inventing game design. The seam is `resolveTurn`;
 * see the header of `turn.ts` for what `step()` is expected to look like once the phases exist.
 */

export {
  ACTION_COST,
  addActor,
  advanceToNextActor,
  chargeActor,
  compareScheduleEntries,
  createSchedule,
  dueActors,
  hasActor,
  nextActAtOf,
  peek,
  removeActor,
  reschedule,
  type ActorId,
  type Schedule,
  type ScheduleEntry,
} from './schedule';

export {
  RESOLUTION_PHASES,
  resolveTurn,
  runActorPhase,
  type ResolutionPhase,
  type ScheduleLens,
  type TurnPhase,
  type TurnPhases,
} from './turn';
