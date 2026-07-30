import { describe, expect, it } from 'vitest';
import type { Command } from './command';
import { assertSameState, findFieldDivergence, formatFieldDivergence } from './divergence';
import { recordRun, replay, runCommands } from './replay';
import { createInitialState, type GameState } from './state';
import { step } from './step';

/**
 * `step` must not mutate its input.
 *
 * ## Why both a deep freeze *and* a structural snapshot
 *
 * They fail differently, and the difference is the whole value.
 *
 * **Deep freeze** is the primary check. ES modules are strict mode, so writing to a frozen
 * property throws a `TypeError` *at the offending line*: the stack trace names the mutation. A
 * snapshot comparison can only tell you, afterwards, that something changed — in a simulation with
 * a map and forty actors, that is a bisect.
 *
 * **The structural snapshot** is the backstop, for the two things freezing cannot do. `Object.freeze`
 * does not protect `Map`/`Set` contents (`frozenMap.set(k, v)` succeeds silently), and `GameState`
 * is only plain data by convention — the convention is what this suite exists to catch violations
 * of. It also proves the freeze test is not vacuous: if `deepFreeze` quietly stopped freezing
 * anything, the snapshot test would still fail on a real mutation.
 *
 * ## The aliasing case, which is the one that actually bites
 *
 * Mutating the argument you were just handed is a mistake people make once. The subtle version is a
 * returned state that shares a mutable sub-object with its predecessor, mutated three turns later —
 * at which point an *earlier* state changes retroactively and a replay stops matching. Freezing
 * every state a run produces, not just the first, is what catches that: turn 40 writing through a
 * reference it inherited from turn 12 throws.
 *
 * Sharing immutable sub-values is fine and expected (`wait` hands every state the same `NO_OUTCOME` object by
 * reference); it is writing through them that is forbidden.
 */

type Mutable = Record<string, unknown>;

/** Freeze a value and everything reachable from it. Returns its argument for chaining. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  // Sorted so the traversal order is defined; irrelevant to the result, but this is `game/` and
  // an unsorted key iteration here would be a bad example to copy.
  for (const key of Object.keys(value as Mutable).sort()) {
    deepFreeze((value as Mutable)[key]);
  }
  return value;
}

/** A structural clone, used as the before-snapshot. */
function snapshot<T>(value: T): T {
  return structuredClone(value);
}

const LONG_RUN: Command[] = Array.from({ length: 200 }, (_, i) =>
  i % 3 === 0 ? { kind: 'wait' } : { kind: 'roll', sides: (i % 12) + 1 },
);

describe('deepFreeze (the tool this suite depends on)', () => {
  it('actually prevents nested writes in strict mode', () => {
    // Without this, every test below could pass because nothing was frozen. A test whose
    // instrument is untested measures nothing.
    const target = deepFreeze({ outer: { inner: { value: 1 } } });
    expect(() => {
      (target.outer.inner as Mutable).value = 2;
    }).toThrow(TypeError);
    expect(target.outer.inner.value).toBe(1);
  });
});

describe('step does not mutate its input', () => {
  it('resolves a command against a deep-frozen state', () => {
    for (const command of [{ kind: 'wait' }, { kind: 'roll', sides: 6 }] as Command[]) {
      const before = deepFreeze(createInitialState('purity'));
      // If `step` writes to `state.turn`, `state.rng.s0`, or `state.lastOutcome.kind`, this throws
      // a TypeError pointing at the line that did it.
      expect(() => step(before, command)).not.toThrow();
    }
  });

  it('leaves the input structurally unchanged', () => {
    for (const command of [{ kind: 'wait' }, { kind: 'roll', sides: 20 }] as Command[]) {
      // Deliberately not the initial state: it has `lastOutcome: { kind: 'none' }`, so a `step`
      // that reset that field in place would leave it *structurally identical* and this test
      // would report green on a real mutation. Starting from a state that has already rolled
      // means every field differs from what a mutation would write.
      const before = step(createInitialState('purity'), { kind: 'roll', sides: 20 });
      const expected = snapshot(before);
      step(before, command);

      assertSameState(before, expected, `step mutated its input resolving ${command.kind}`);
    }
  });

  it('never writes through a reference inherited from an earlier state', () => {
    // The aliasing case. Every intermediate state stays frozen for the rest of the run, so a
    // mutation of turn 12's data on turn 40 throws instead of retroactively rewriting history.
    let state: GameState = deepFreeze(createInitialState('aliasing'));
    const history: GameState[] = [state];

    for (const command of LONG_RUN) {
      state = deepFreeze(step(state, command));
      history.push(state);
    }

    expect(state.turn).toBe(LONG_RUN.length);
    // And the record of history is intact: replaying the same prefix reproduces each state that
    // was captured. A retroactive mutation that somehow avoided the freeze shows up here.
    for (let i = 0; i < history.length; i += 1) {
      const rerun = runCommands('aliasing', LONG_RUN.slice(0, i));
      const divergence = findFieldDivergence(rerun, history[i]);
      if (divergence) {
        throw new Error(`state ${i} changed after the fact: ${formatFieldDivergence(divergence)}`);
      }
    }
  });

  it('produces a fresh state object every call', () => {
    // Catches a `step` that returns its input for commands it treats as no-ops. Every command
    // resolves a turn, so a shared identity would mean a shared `turn`.
    const before = createInitialState('identity');
    expect(step(before, { kind: 'wait' })).not.toBe(before);
    expect(step(before, { kind: 'roll', sides: 6 })).not.toBe(before);
  });
});

describe('replay does not mutate its input record', () => {
  it('leaves the record and its commands untouched', () => {
    // `commands` is the array a caller may still hold. A replay that consumed, sorted, or
    // normalized it in place would work exactly once.
    const record = recordRun('record-purity', LONG_RUN);
    const expected = snapshot(record);

    replay(record);
    replay(record);

    const divergence = findFieldDivergence(record, expected);
    if (divergence) throw new Error(`replay mutated its record: ${formatFieldDivergence(divergence)}`);
  });

  it('copies the command array it is given', () => {
    // Catches `commands` being stored by reference: the caller mutating their own array afterwards
    // would silently rewrite a run that had already been recorded.
    const commands: Command[] = [{ kind: 'wait' }];
    const record = recordRun('copy', commands);
    commands.push({ kind: 'roll', sides: 6 });
    expect(record.commands).toHaveLength(1);
  });

  it('replays a deep-frozen record', () => {
    const record = deepFreeze(recordRun('frozen-record', LONG_RUN));
    expect(() => replay(record)).not.toThrow();
  });
});
