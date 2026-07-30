import { describe, expect, it } from 'vitest';
import { diveToTheBottom } from '@/tests/unit/support/run-script';
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
 * snapshot comparison can only tell you, afterwards, that something changed — in a state with a
 * map, a lantern and seven actors, that is a bisect.
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
 * Sharing immutable sub-values is fine and expected — a turn that perceives nothing new hands the
 * next state the same `remembered` tile set by reference, and every floor tile is one of seven
 * shared singletons. It is writing *through* them that is forbidden.
 *
 * **The one place this file cannot use a `structuredClone` yardstick** is a refused command, which
 * returns its input by reference on purpose (contract 6). That is not an exception to purity; it is
 * the strongest possible form of it, and it has its own test in `step.test.ts`.
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

/**
 * A real run: three floors of a dark dive, with refusals and free actions salted through it.
 *
 * Real rather than synthetic on purpose. A long list of `wait`s exercises one branch of `step` and
 * never touches the two places a mutation would actually be written — collecting a cache, which
 * rewrites a tile *in the grid*, and descending, which builds a whole new world. Both are in here.
 */
const LONG_RUN: readonly Command[] = diveToTheBottom('purity', 3).commands.flatMap((command, i) =>
  // Every fifth command is preceded by one that will be refused (a descent taken off the stairs),
  // so the aliasing sweep runs over refused commands as well as resolved ones.
  i % 5 === 0 ? [{ kind: 'descend' } as Command, command] : [command],
);

describe('snapshot (the other tool this suite depends on)', () => {
  it('actually copies, so before/after comparisons are meaningful', () => {
    // Mirror of the deepFreeze instrument test below. Without this, replacing
    // `structuredClone(value)` with `return value` leaves the whole suite green — `before` and
    // `expected` would be the same object, so "leaves the input structurally unchanged" could
    // not fail for any mutation of step(). An untested instrument measures nothing.
    const source = { outer: { inner: { value: 1 } } };
    const copy = snapshot(source);

    expect(copy).not.toBe(source);
    expect(copy.outer).not.toBe(source.outer);
    expect(copy.outer.inner).not.toBe(source.outer.inner);

    source.outer.inner.value = 2;
    expect(copy.outer.inner.value).toBe(1);
  });
});

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
  it('resolves every kind of command against a deep-frozen state', () => {
    // If `step` writes to `state.rng.s0`, to a tile in `world.floor.grid.tiles`, or to the
    // `remembered` flags, this throws a TypeError pointing at the line that did it.
    for (const command of [
      { kind: 'wait' },
      { kind: 'move', dir: 'north' },
      { kind: 'setShutter', to: 'shuttered' },
      { kind: 'descend' },
    ] as Command[]) {
      const before = deepFreeze(createInitialState('purity'));
      expect(() => step(before, command), command.kind).not.toThrow();
    }
  });

  it('leaves the input structurally unchanged', () => {
    // Deliberately not the initial state: it has an empty ember list, a full lantern and a pristine
    // grid, so a `step` that reset any of those in place would leave it *structurally identical*
    // and this test would report green on a real mutation. Starting from a state a hundred commands
    // into a run means every field has something in it to be clobbered.
    const midRun = runCommands('purity', LONG_RUN.slice(0, 100));
    for (const command of [
      { kind: 'wait' },
      { kind: 'move', dir: 'east' },
      { kind: 'setShutter', to: 'open' },
    ] as Command[]) {
      const expected = snapshot(midRun);
      step(midRun, command);
      assertSameState(midRun, expected, `step mutated its input resolving ${command.kind}`);
    }
  });

  it('never writes through a reference inherited from an earlier state', () => {
    // The aliasing case, and the reason this run descends: `arriveOnFloor` builds a new world from
    // a new `Floor`, and collecting a cache rewrites a tile *inside* the grid the state is holding.
    // Both are places where an in-place write is the obvious implementation.
    let state: GameState = deepFreeze(createInitialState('purity'));
    const history: GameState[] = [state];

    for (const command of LONG_RUN) {
      state = deepFreeze(step(state, command));
      history.push(state);
    }

    expect(state.commandsResolved).toBeGreaterThan(0);
    // The salted-in descents really are refused, so the sweep above covers both paths rather than
    // only the resolving one. A log whose every command resolved would make the comment a lie.
    const refused = history.filter((current, i) => i > 0 && current === history[i - 1]).length;
    expect(refused).toBeGreaterThan(5);
    // And the record of history is intact: replaying the same prefix reproduces each state that
    // was captured. A retroactive mutation that somehow avoided the freeze shows up here.
    for (let i = 0; i < history.length; i += 1) {
      const rerun = runCommands('purity', LONG_RUN.slice(0, i));
      const divergence = findFieldDivergence(rerun, history[i]);
      if (divergence) {
        throw new Error(`state ${i} changed after the fact: ${formatFieldDivergence(divergence)}`);
      }
    }
  });

  it('produces a fresh state object for every command it resolves', () => {
    // Catches a `step` that returns its input for commands it treats as no-ops. A *resolved*
    // command always changes something — at minimum `commandsResolved` — so a shared identity means
    // a shared counter. (A *refused* command returns its input on purpose; that is contract 6 and
    // is asserted in `step.test.ts`.)
    const before = createInitialState('identity');
    for (const command of [
      { kind: 'wait' },
      { kind: 'move', dir: 'north' },
      { kind: 'setShutter', to: 'shuttered' },
    ] as Command[]) {
      const after = step(before, command);
      if (after === before) continue; // refused by this particular floor's geometry; not this test's case
      expect(after.commandsResolved).toBe(before.commandsResolved + 1);
    }
    expect(step(before, { kind: 'wait' })).not.toBe(before);
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
    commands.push({ kind: 'descend' });
    expect(record.commands).toHaveLength(1);
  });

  it('replays a deep-frozen record', () => {
    const record = deepFreeze(recordRun('frozen-record', LONG_RUN));
    expect(() => replay(record)).not.toThrow();
  });
});
