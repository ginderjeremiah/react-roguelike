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
export const RULES_VERSION = 8;

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
  '3 — §13\'s summary numbers (#21): `GameState` gains `kills`, `fuelBurned` and `seed`. ' +
    'No rule changed and no draw moved — a version-2 record replays to the same floor, the same ' +
    'actors, the same lantern and the same generator position, which the re-pinned digests below ' +
    'show field for field. The bump is the policy above applied literally ("any new field in ' +
    '`GameState`"): a version-2 record replayed under these rules produces a state with three ' +
    'fields it did not have, so a stored *state* comparison against one would not hold.',
  '4 — §4\'s cache rule (#31, #41): a cache is terrain the lantern has to have shown you. ' +
    '`Vision` gains `revealed`, a second monotone tile plane holding every tile the lantern has ' +
    'lit, and phase 5 pays a cache only where that plane holds its tile — so a version-3 record ' +
    'that walked over a cache in the dark replays to a different fuel reserve, a different grid ' +
    '(the tile is no longer rewritten to floor) and a different `floor.caches`. Both a new field ' +
    'in `GameState` and a changed rule, which is the one bump that is unambiguous under either ' +
    'clause of the policy above. Perception changed with it — touch reports a cache tile as ' +
    'ordinary floor — but that is `render/`-side and moves no state.',
  '5 — §4\'s awake-creature rule (#83): a woken Cinder pursues. `nextMind` loses the two cases ' +
    'that sent a creature without contact to the tile it last saw the light from and then parked ' +
    'it there, so an awake creature now paths toward the player every turn, lit or shuttered, ' +
    'adjacent or across the floor, and the eight-turn counter is the only thing contact still ' +
    'governs. A version-4 record replays differently from the first turn anything is awake and out ' +
    'of contact — different creature positions, different declared intents, and wherever the ' +
    'pursuit arrives, different HP, different kills and a different ending. Measured on the stored ' +
    'combat log: under version 4 the player shuffled one tile back and forth for ten turns, the ' +
    'Cinder parked, went dormant and was one-shot in its sleep, and the run ended in a death; ' +
    'replayed under these rules that same log is a stand-up fight in which nothing ever sleeps and ' +
    'the player is still alive at the end of it. `Mind` also drops `awareness`, the tile those two ' +
    'deleted cases read, so a version-4 *state* carries a field these rules do not produce. Both ' +
    'clauses of the policy above, again.',
  '6 — §4\'s awake-creature rule again (#121, #123): the eight-turn re-dormancy clock is deleted, ' +
    'so a woken Cinder is awake for the rest of the floor. `nextMind` loses its third case and now ' +
    'returns an awake mind unconditionally; `TURNS_TO_REDORMANCY`, `Mind.turnsSinceContact` and the ' +
    'whole *contact* concept go with it, including the injected `LightQuery` the entity layer used ' +
    'to be handed. A version-5 record diverges from the eighth turn after anything wakes out of ' +
    'contact: where that creature used to leave the schedule and lie down as a fresh double-damage ' +
    'target, it keeps its place in the queue and keeps coming — so every actor position, every ' +
    'declared intent, every kill and the ending itself can differ, and a run that outwaited what it ' +
    'woke replays into a fight it has to finish. Measured, by replaying the version-5 combat fixture ' +
    'under these rules: that log retreated nine turns, watched the Cinder go dormant at command 10, ' +
    'walked back and one-shot it asleep, then flashed and was killed by a second one. Under version ' +
    '6 nothing sleeps — the Cinder follows the player back east and is fought **awake** for 2 HP, ' +
    'the flash lands somewhere else entirely and wakes nothing, and the run ends `running` with the ' +
    'player alive at 10 HP and both surviving creatures still dormant. Same log, same seed: no free ' +
    'kill, no second wake, no death. `Mind` also drops ' +
    '`turnsSinceContact`, so a version-5 *state* carries a field these rules do not produce. Both ' +
    'clauses of the policy above, for the third time — and the second time in two versions that the ' +
    'clause doing the work is a **deletion**.',
  '7 — §2 phase 3\'s scheduling instant (#125, #133, ADR-0014): a creature woken in phase 3 joins ' +
    'the schedule at the instant **the player is next due to act**, rather than at ' +
    '`now + ACTION_COST`. On a command the player was charged for those are the same number, so ' +
    '**no paid command moves, byte for byte** — the negative control on descent is unedited and ' +
    'still green. On a command the player was *not* charged for they are not: a free action ' +
    '(`actorPhase(\'free\')` is `identity`, so phase 4 never runs) and `beginRun` (phase 3 alone) ' +
    'both leave the player due at `now`, and the build used to schedule the creature a command ' +
    'beyond that. So the player got **two** phase-1 actions before it resolved anything, which at ' +
    '§3\'s numbers is two strikes, which is exactly a 5 HP Cinder. Measured: 56 of `STALKER`\'s 386 ' +
    'woken kills cost 0 HP under version 6 and 0 of 387 do under these rules. A version-6 record ' +
    'whose log contains a `setShutter` that woke something, or whose run start woke something, ' +
    'replays differently from that command on — different creature positions, different declared ' +
    'intents, different HP. Measured on the two stored fixtures that wake anything, and the shape ' +
    'is worth recording because it is smaller than it sounds: on the combat log the opening wake ' +
    'gains the hunter one command at the start and **spends it** reaching adjacency early enough ' +
    'to waste an action on a tile the player has left, so the two runs re-converge four commands ' +
    'later with the same 27 creature steps, the same 4 landed blows and the same death on the same ' +
    'turn — what differs in the final frame is **which** of the two hunters struck the killing blow ' +
    'and therefore which one is frozen holding a `wait` over the body. On the cache log the flash ' +
    'is followed by a second free action, so under version 6 the creature it woke saw *three* ' +
    'commands and never moved at all; here it moves once and declares. `GameState` gains and loses ' +
    'no field, so this is the first bump since version 3 that rests on the changed-rule clause ' +
    'alone.',
  '8 — §4\'s *The dark can take nothing* (#144, #149): **a kill\'s ember is takeable only once its ' +
    'tile has been lit, and fuel reaching 0 ends the run.** Two deleted clauses, no new state and no ' +
    'new command. `collectFuelUnderfoot` gates both of its branches on `hasBeenLit` over ' +
    '`Vision.revealed` — the predicate the cache branch already used and which #31/#41 built the ' +
    'plane for — so a version-7 record that struck a sleeper in the dark and walked onto the drop ' +
    'replays to a lower reserve, with the drop still lying in `world.embers`. And `statusAfterTurn` ' +
    'gains one condition beside HP death, evaluated after the whole phase list so §2 phase 5 still ' +
    'runs and the ember collected on the guttering turn still counts; **not** in `isRunOver`, which ' +
    'halts the actor sweep and would forfeit exactly that. So a version-7 record that played on ' +
    'past 0 fuel replays to a run that ended there and refused everything after it. ' +
    'Measured on the three stored fixtures: the dark-descent log and the cache-haul log are ' +
    '**byte-identical** (neither kills anything, and a cache was already light-gated), and the ' +
    'combat log diverges in exactly two fields — `fuel` 45 -> 25 and one uncollected 20-fuel drop ' +
    'left at (10, 6). Every other field, including the **generator state**, is unchanged, which is ' +
    'the shape to expect: nothing here draws, nothing here touches the schedule, and neither branch ' +
    'of phase 5 consumes entropy on either side of its new guard. `GameState` gains and loses no ' +
    'field, so this rests on the changed-rule clause alone, as version 7 did.',
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
