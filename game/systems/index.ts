/**
 * Turn scheduling, and the order one player command resolves in.
 *
 * ```ts
 * import { chargeActor, createSchedule, resolveTurn, runActorPhase } from '@/game/systems';
 *
 * const schedule = createSchedule([PLAYER, cinderA, cinderB]); // everyone due at tick 0
 * ```
 *
 * Four files, four jobs: `schedule.ts` owns the clock and the queue (and the `(nextActAt, actorId)`
 * ordering the whole simulation's determinism rests on), `turn.ts` owns the GDD §2 phase order and
 * the scheduling half of the actor phase, `combat.ts` owns deterministic damage and death, and
 * `actors.ts` owns the rules half of phases 3 and 4 — waking, and resolve-then-declare.
 *
 * Nothing here is wired into `game/core/step.ts` yet — `GameState` has no `Floor` until #18, and
 * lighting and fuel do not exist until #14 and #17. The seam is `resolveTurn`, whose phases are
 * injected; see the header of `turn.ts`. Three of the six can be supplied today:
 *
 * ```ts
 * const cost: TurnCost = command.kind === 'toggleShutter' ? 'free' : 'costsATurn';
 *
 * resolveTurn(world, {
 *   command:           (w) => resolvePlayerCommand(w, command),   // #18
 *   fuelBurn:          burnFuel,                                  // #17
 *   lightingAndWaking: (w) => wakeInLight(recomputeLighting(w), perception),
 *   actors:            actorPhase(cost, perception),
 *   deaths:            resolveDeaths,
 *   darkAdaptation:    tickDarkAdaptation,                        // #14
 * });
 * ```
 */

export { actOnce, actorPhase, wakeInLight, type TurnCost } from './actors';

export {
  bump,
  canMove,
  damageFrom,
  DORMANT_STRIKE_MULTIPLIER,
  resolveAttack,
  resolveDeaths,
  resolveMove,
  restoreOnDescent,
} from './combat';

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
