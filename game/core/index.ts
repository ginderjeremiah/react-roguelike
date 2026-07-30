/**
 * The simulation's public surface.
 *
 * ```ts
 * import { createInitialState, recordRun, replay, step } from '@/game/core';
 *
 * let state = createInitialState('emberdepth');       // floor 1, at the entrance, lantern open
 * state = step(state, { kind: 'setShutter', to: 'shuttered' });  // free: no turn, still burns fuel
 * state = step(state, { kind: 'move', dir: 'north' }); // moves, or attacks what is standing there
 *
 * const record = recordRun('emberdepth', [{ kind: 'wait' }, { kind: 'descend' }]);
 * replay(record);                                      // reproduces the run byte-identically
 * ```
 *
 * Everything here is pure, synchronous, and deterministic. `step` is the whole simulation; read the
 * contract at the top of `step.ts` before adding anything that resolves a turn, and the
 * `RULES_VERSION` policy at the top of `replay.ts` before changing anything that does.
 *
 * **This layer is thin on purpose.** The rules live in `game/systems/`; `game/core/` owns the
 * command vocabulary, the generator, the run's two counters and its ending, and the replay
 * machinery around them. Anything here that looks like a game rule is in the wrong directory.
 */

export { assertNever } from './assert';
export {
  COMMAND_KINDS,
  DIRECTIONS,
  neighbourOf,
  SHUTTER_STATES,
  type Command,
  type Direction,
} from './command';
export {
  assertSameState,
  findFieldDivergence,
  findRunDivergence,
  findStateSequenceDivergence,
  formatFieldDivergence,
  formatRunDivergence,
  renderValue,
  runStates,
  type FieldDivergence,
  type RunDivergence,
} from './divergence';
export {
  assertValidRunRecord,
  recordRun,
  replay,
  runCommands,
  RULES_VERSION,
  RULES_VERSION_LOG,
  type RunRecord,
} from './replay';
export {
  createInitialState,
  floorNumberOf,
  isRunning,
  RUNNING,
  statusAfterTurn,
  withWorld,
  worldOf,
  type GameState,
  type RunStatus,
} from './state';
export { step } from './step';
