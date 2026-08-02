/**
 * Turn scheduling, the light economy, descent, and the order one player command resolves in.
 *
 * ```ts
 * import { beginRun, descendTurn, resolveTurn, lanternPhases, setShutterTurn } from '@/game/systems';
 *
 * let state = beginRun(floor);                                   // §4's start: open, 80 fuel, lit
 * state = setShutterTurn(state, 'shuttered');                    // free: no turn, but the room wakes
 * state = resolveTurn(state, lanternPhases('costsATurn', move)); // one whole turn
 * state = descendTurn(state, nextFloor);                         // §13: the turn is paid below
 * ```
 *
 * Seven files, seven jobs: `schedule.ts` owns the clock and the queue (and the `(nextActAt, actorId)`
 * ordering the whole simulation's determinism rests on), `turn.ts` owns the GDD §2 phase order and
 * the scheduling half of the actor phase, `combat.ts` owns deterministic damage and death,
 * `actors.ts` owns the rules half of phases 3 and 4 — waking, and resolve-then-declare — `lantern.ts`
 * owns fuel and the shutter, `light.ts` joins them (it owns `LightQuery` and answers it out of
 * `game/fov/`'s lit field, and supplies five of the six phases plus every player command), and
 * `run.ts` owns what spans floors: where a run starts and what a descent carries.
 *
 * **`LightQuery` moved here from `game/entities/contact.ts` in #123**, along with the deletion of
 * the re-dormancy clock that was its only reader down there. Nothing in `game/entities/` knows what
 * a shutter is any more; §2 phase 3's `wakeInLight` is the one rule that asks.
 *
 * ## What `game/core/` supplies, and what it must not
 *
 * `game/core/step.ts` holds the `Command` union, the generator, and the run's terminal status. It
 * picks a `TurnCost` and a command phase from this directory and folds them:
 *
 * ```ts
 * resolveTurn(worldOf(state), lanternPhases(cost, commandPhase));
 * ```
 *
 * Every rule it needs is exported here. A rule appearing in `game/core/` is a smell: that is the
 * layer that knows about commands and generators, not about what a shutter does.
 */

export { actOnce, actorPhase, isRunOver, wakeInLight, type TurnCost } from './actors';

export {
  burnFuelPhase,
  chargePlayer,
  collectFuelUnderfoot,
  createLanternWorld,
  darkAdaptationPhase,
  deathsAndCollectionPhase,
  lanternLight,
  lanternPhases,
  lightingAndWakingPhase,
  lightOf,
  moveCommand,
  setShutterCommand,
  setShutterTurn,
  waitCommand,
  type LanternWorld,
  type LightQuery,
} from './light';

export { arriveOnFloor, beginRun, descendCommand, descendTurn, isOnStairs } from './run';

export {
  burn,
  burnRate,
  canOpen,
  createLantern,
  isDry,
  open,
  refuel,
  setLanternShutter,
  shutter,
  toggleShutter,
  type Lantern,
} from './lantern';

export {
  bump,
  canBump,
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
