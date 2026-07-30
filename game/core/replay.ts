/**
 * A run, as a record. `RunRecord` in, final `GameState` out.
 *
 * A run is fully described by its seed and its command log, so this is both the save format and
 * the bug-report format: `{ version, seed, commands }` is a few dozen bytes, and replaying it
 * reconstructs every intermediate state exactly. See ADR-0004 and docs/ARCHITECTURE.md.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * `RunRecord.version` — WHAT IT MEANS AND WHEN TO BUMP IT
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `RULES_VERSION` below is the canonical value; docs/ARCHITECTURE.md ("Determinism, concretely →
 * Versioning") states the policy and points here. There is exactly one number and it lives in one
 * place, because a version scheme with two homes has a wrong one.
 *
 * **The rule.** Bump it when a change would alter the final state produced by an *existing*
 * record. Concretely, any of:
 *
 *   - a change to `step`'s resolution of any command;
 *   - a change to the meaning, shape, or set of `Command` variants;
 *   - a change to `createInitialState`, including any new field in `GameState`;
 *   - a change to how many draws any operation consumes, or in what order;
 *   - a change to the generator or the seed derivation (`game/rng/`) — the pinned-stream tests
 *     there are the tripwire for this one.
 *
 * **Not a bump:** refactoring that provably leaves every replay identical, new tests, comments,
 * anything above `game/`. If you are unsure whether a change is outcome-preserving, replay the
 * stored fixtures. If they still pass, it was; if they do not, it was not, and the fixtures need
 * re-recording under the new version.
 *
 * **Why it is a deliberate act.** A bump invalidates every stored replay fixture and every shared
 * seed. That is normal and expected during development — it is not a failure — but it must be a
 * decision, because the alternative is a fixture that fails mysteriously months later and gets
 * "fixed" by updating the expected values, which silently discards the one signal that would have
 * told us the rules changed by accident.
 *
 * **The procedure** when you bump:
 *
 *   1. Increment `RULES_VERSION` here.
 *   2. Add a line to `RULES_VERSION_LOG` saying what changed and why. Append-only.
 *   3. Re-record any stored replay fixtures, in the same PR.
 *   4. Say so in the journal entry. A version bump nobody wrote down is a version bump nobody can
 *      explain later.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

import { COMMAND_KINDS, type Command } from './command';
import { step } from './step';
import { createInitialState, type GameState } from './state';

/** The rules version this build of the simulation implements. See the header. */
export const RULES_VERSION = 2;

/**
 * Append-only. One line per bump, newest last, so that a fixture pinned at version N can be
 * understood without archaeology through git.
 */
export const RULES_VERSION_LOG: readonly string[] = [
  '1 — initial: `wait` and `roll` scaffolding commands, xoshiro128** generator (#3).',
  '2 — the real game (#18): the scaffolding `wait | roll` union is replaced by ' +
    '`move | wait | setShutter | descend`; `GameState` gains the floor, the actors, the lantern ' +
    'and a run status, and `createInitialState` now generates floor 1 (so a run consumes draws ' +
    'before its first command). Every version-1 record is meaningless under these rules.',
];

/**
 * A complete run: the seed it started from and every command in order.
 *
 * `readonly Command[]` rather than the `Command[]` written in ARCHITECTURE.md — same shape at
 * runtime, but a mutable array on a record that gets replayed twice and compared is an invitation
 * to a bug where the first replay edits the log the second one reads.
 */
export type RunRecord = {
  /** The `RULES_VERSION` this run was recorded under. */
  readonly version: number;
  /** Any string. Human-shareable by design — see `game/rng/seed.ts`. */
  readonly seed: string;
  /**
   * In order. Index `i` is the `i`-th command *issued* — not the `i`-th turn: a free action costs
   * no turn and a refused action costs nothing at all, so the log is longer than the run is
   * (`step.ts`, contract 5).
   */
  readonly commands: readonly Command[];
};

/**
 * Fold `step` over a command sequence from a fresh start. The unchecked primitive underneath
 * `replay`, for callers that have a seed and commands but no record — notably the property tests,
 * and any future migration that deliberately replays an old record under current rules to see
 * what changed.
 */
export function runCommands(seed: string, commands: readonly Command[]): GameState {
  let state = createInitialState(seed);
  // A command log is an ordered sequence, so index order *is* the defined order. This is the one
  // loop in `game/core/` that must not be sorted.
  for (const command of commands) {
    state = step(state, command);
  }
  return state;
}

/**
 * Replay a record to its final state.
 *
 * @throws if the record was recorded under a different `RULES_VERSION`. Replaying it anyway would
 *   produce a state that looks plausible and is not the run that was recorded — the exact failure
 *   this project's testing strategy exists to make impossible. Callers that genuinely want the
 *   cross-version result (a migration, an investigation) should call `runCommands` and say so.
 * @throws if the record is structurally invalid — see `assertValidRunRecord`.
 */
export function replay(record: RunRecord): GameState {
  assertValidRunRecord(record);
  if (record.version !== RULES_VERSION) {
    throw new Error(
      `replay: record was recorded under rules version ${record.version}, this build implements ` +
        `${RULES_VERSION}. Replaying it would not reproduce the recorded run. Use runCommands() ` +
        `if a cross-version replay is what you actually want.`,
    );
  }
  return runCommands(record.seed, record.commands);
}

/** Build a record at the current rules version. The only way records should be constructed. */
export function recordRun(seed: string, commands: readonly Command[]): RunRecord {
  // Copied, so the record cannot be changed underneath by whoever built the array.
  return { version: RULES_VERSION, seed, commands: commands.slice() };
}

/**
 * Reject a record that could not have come from this build.
 *
 * Records arrive from save files and bug reports, where the declared TypeScript type guarantees
 * nothing. Checking here means a malformed record fails at the boundary with a message naming the
 * problem, instead of somewhere inside turn resolution with a message about `undefined`.
 *
 * Deliberately shallow: it validates the *envelope* and the command discriminants, not command
 * payloads. `step` validates payloads at the point of use and is the single authority on what a
 * well-formed command is; duplicating that here would create two definitions that drift.
 */
export function assertValidRunRecord(record: RunRecord): void {
  if (record === null || typeof record !== 'object') {
    // The first thing `JSON.parse` hands back from a truncated or empty save file. Without this
    // the failure is a `TypeError: Cannot read properties of null`, which says nothing about
    // records.
    throw new Error(`replay: expected a run record, got ${JSON.stringify(record ?? null)}`);
  }
  if (!Number.isSafeInteger(record.version)) {
    throw new Error(`replay: record version must be an integer, got ${JSON.stringify(record.version)}`);
  }
  if (typeof record.seed !== 'string') {
    throw new Error(`replay: record seed must be a string, got ${JSON.stringify(record.seed)}`);
  }
  if (!Array.isArray(record.commands)) {
    throw new Error(`replay: record commands must be an array, got ${JSON.stringify(record.commands)}`);
  }
  for (let i = 0; i < record.commands.length; i += 1) {
    assertKnownCommand(record.commands[i], i);
  }
}

/**
 * Checked against `COMMAND_KINDS` rather than a switch written out here. `COMMAND_KINDS` is
 * exhaustive by construction (see `command.ts`), so a new variant is accepted the moment it is
 * declared — whereas a second hand-written list would be a place for the two to drift, and the
 * drift would present as "records containing a valid new command are rejected as corrupt".
 */
function assertKnownCommand(command: Command, index: number): void {
  const kind: unknown = (command as { kind?: unknown } | null | undefined)?.kind;
  if (typeof kind === 'string' && (COMMAND_KINDS as readonly string[]).includes(kind)) return;
  throw new Error(
    `replay: command ${index} has unknown kind ${JSON.stringify(command)}. A record from a ` +
      `different rules version, or corrupt data.`,
  );
}
