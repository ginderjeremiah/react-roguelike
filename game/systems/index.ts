/**
 * Turn scheduling, the light economy, and the order one player command resolves in.
 *
 * ```ts
 * import { createLanternWorld, lanternPhases, resolveTurn, toggleShutterTurn } from '@/game/systems';
 *
 * let state = createLanternWorld(floor, 'shuttered');            // full lantern, floor asleep
 * state = toggleShutterTurn(state);                              // free: no turn, but the room wakes
 * state = resolveTurn(state, lanternPhases('costsATurn', move)); // one whole turn
 * ```
 *
 * Six files, six jobs: `schedule.ts` owns the clock and the queue (and the `(nextActAt, actorId)`
 * ordering the whole simulation's determinism rests on), `turn.ts` owns the GDD §2 phase order and
 * the scheduling half of the actor phase, `combat.ts` owns deterministic damage and death,
 * `actors.ts` owns the rules half of phases 3 and 4 — waking, and resolve-then-declare — `lantern.ts`
 * owns fuel and the shutter, and `light.ts` joins them: it answers `game/entities/`'s injected light
 * query out of `game/fov/`'s lit field, and supplies five of the six phases.
 *
 * ## What is left for #18
 *
 * Exactly the command phase. `GameState` has no `Floor` and the `Command` union is still
 * scaffolding, so the player's half of phase 1 belongs there; everything else is here:
 *
 * ```ts
 * // The cost is stated, never inferred — `TurnCost` has no default anywhere in this directory.
 * const cost: TurnCost = command.kind === 'toggleShutter' ? 'free' : 'costsATurn';
 *
 * resolveTurn(state, lanternPhases(cost, (s) => resolvePlayerCommand(s, command)));
 * ```
 *
 * For the shutter itself there is not even that: `toggleShutterTurn(state)` is the whole turn, and
 * it takes no `TurnCost` for a caller to get wrong.
 */

export { actOnce, actorPhase, wakeInLight, type TurnCost } from './actors';

export {
  burnFuelPhase,
  collectFuelUnderfoot,
  createLanternWorld,
  darkAdaptationPhase,
  deathsAndCollectionPhase,
  lanternLight,
  lanternPhases,
  lightingAndWakingPhase,
  lightOf,
  toggleShutterCommand,
  toggleShutterTurn,
  type LanternWorld,
} from './light';

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
