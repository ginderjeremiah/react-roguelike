/**
 * The simulation's public surface.
 *
 * ```ts
 * import { createInitialState, replay, recordRun, step } from '@/game/core';
 *
 * const state = createInitialState('emberdepth');
 * const next = step(state, { kind: 'wait' });        // pure; `state` is untouched
 * const record = recordRun('emberdepth', [{ kind: 'wait' }, { kind: 'roll', sides: 6 }]);
 * replay(record);                                     // reproduces the run byte-identically
 * ```
 *
 * Everything here is pure, synchronous, and deterministic. `step` is the whole simulation; see the
 * contract at the top of `step.ts` before adding anything that resolves a turn, and the
 * `RunRecord.version` policy at the top of `replay.ts` before changing anything that does.
 *
 * The `Command` union and `GameState.lastOutcome` are scaffolding: the game's design is
 * still under review (ADR-0007 / #8), and modelling rules before that lands would mean inventing
 * them. The machinery around them — purity, threading the generator, the replay contract, the
 * divergence reporting — is not scaffolding and is meant to survive whatever the design turns out
 * to be.
 */

export { assertNever } from './assert';
export { COMMAND_KINDS, type Command } from './command';
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
export { createInitialState, NO_OUTCOME, type GameState, type LastOutcome } from './state';
export { step } from './step';
