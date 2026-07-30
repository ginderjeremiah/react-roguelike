import { describe, expect, it } from 'vitest';
import { next } from '../rng';
import type { Command } from './command';
import {
  assertSameState,
  findFieldDivergence,
  findRunDivergence,
  findStateSequenceDivergence,
  formatFieldDivergence,
  formatRunDivergence,
  renderValue,
  runStates,
} from './divergence';
import { recordRun } from './replay';
import { createInitialState } from './state';

/**
 * Tests for the divergence reporter.
 *
 * This module is the instrument the replay suite reads. Every property there is phrased as
 * "findRunDivergence returned null", so a reporter that under-reports makes the most important
 * test in the repo silently vacuous, and one whose answer depends on property insertion order
 * produces a diagnostic that names a different field on a different day.
 *
 * Both failure modes are quiet. Hence this file.
 */

describe('findFieldDivergence — agreement', () => {
  it('returns null for structurally identical values', () => {
    expect(findFieldDivergence(createInitialState('a'), createInitialState('a'))).toBeNull();
    expect(findFieldDivergence({ a: [1, { b: 'c' }] }, { a: [1, { b: 'c' }] })).toBeNull();
    expect(findFieldDivergence(null, null)).toBeNull();
    expect(findFieldDivergence([], [])).toBeNull();
  });

  it('ignores property insertion order', () => {
    // Two states built by different code paths are the same state. A comparator that folded
    // objects to a string (`JSON.stringify`) would report a phantom divergence here, and the
    // natural response — "just always build state in the same order" — is a rule nobody can keep.
    expect(findFieldDivergence({ b: 1, a: 2 }, { a: 2, b: 1 })).toBeNull();
  });

  it('treats NaN as equal to itself', () => {
    // `===` says NaN differs from NaN. If the walk used it, any state containing one would report
    // a divergence on every comparison, and the reflex fix would be to special-case it away.
    expect(findFieldDivergence({ x: Number.NaN }, { x: Number.NaN })).toBeNull();
  });
});

describe('findFieldDivergence — disagreement', () => {
  it('reports the path to a nested leaf', () => {
    // The single most important behaviour: `rng.s2`, not "states differ".
    const left = { turn: 3, rng: { s0: 1, s1: 2, s2: 3, s3: 4 } };
    const right = { turn: 3, rng: { s0: 1, s1: 2, s2: 99, s3: 4 } };
    expect(findFieldDivergence(left, right)).toEqual({ path: 'rng.s2', left: '3', right: '99' });
  });

  it('reports array positions with an index', () => {
    const found = findFieldDivergence({ commands: [{ kind: 'wait' }, { kind: 'roll', sides: 6 }] }, { commands: [{ kind: 'wait' }, { kind: 'roll', sides: 8 }] });
    expect(found?.path).toBe('commands[1].sides');
    expect(found?.left).toBe('6');
    expect(found?.right).toBe('8');
  });

  it('reports the root when the compared values are themselves primitives', () => {
    expect(findFieldDivergence(1, 2)).toEqual({ path: '<root>', left: '1', right: '2' });
  });

  it('distinguishes a value from a same-looking value of another type', () => {
    // `1` and `"1"` render identically. Without the type annotation this failure costs ten minutes
    // of staring at "expected 1, got 1".
    const found = findFieldDivergence({ n: 1 }, { n: '1' });
    expect(found?.path).toBe('n');
    expect(found?.left).toBe('1 (number)');
    expect(found?.right).toBe('"1" (string)');
  });

  it('distinguishes 0 from -0', () => {
    // A real difference, not pedantry: `-0` does not survive JSON, so a state containing one
    // cannot be stored as a fixture. `===` would call these equal and hide it.
    expect(findFieldDivergence({ x: 0 }, { x: -0 })).toEqual({ path: 'x', left: '0', right: '-0' });
  });

  it('reports a key present on only one side, in either direction', () => {
    expect(findFieldDivergence({ a: 1, b: 2 }, { a: 1 })).toEqual({
      path: 'b',
      left: '2',
      right: '<missing>',
    });
    expect(findFieldDivergence({ a: 1 }, { a: 1, b: 2 })).toEqual({
      path: 'b',
      left: '<missing>',
      right: '2',
    });
  });

  it('distinguishes an explicitly undefined property from an absent one', () => {
    // They differ under JSON: `{a: undefined}` serializes to `{}`. A state that relies on the
    // distinction cannot be round-tripped, which is why `state.ts` forbids `undefined` values.
    const found = findFieldDivergence({ a: undefined }, {});
    expect(found?.path).toBe('a');
    expect(found?.left).toBe('undefined');
    expect(found?.right).toBe('<missing>');
  });

  it('distinguishes null from an object and from undefined', () => {
    expect(findFieldDivergence({ a: null }, { a: {} })?.path).toBe('a');
    expect(findFieldDivergence({ a: null }, { a: undefined })?.path).toBe('a');
  });

  it('reports a differing element in preference to a differing length', () => {
    // "commands[0].kind" localizes the problem; "length 1 vs 2" makes you go looking.
    const found = findFieldDivergence([{ kind: 'roll' }], [{ kind: 'wait' }, { kind: 'wait' }]);
    expect(found?.path).toBe('[0].kind');
  });

  it('reports a length mismatch when every shared element agrees', () => {
    expect(findFieldDivergence({ xs: [1, 2] }, { xs: [1, 2, 3] })).toEqual({
      path: 'xs.length',
      left: '2',
      right: '3',
    });
  });

  it('does not confuse an array with an object that has the same indices', () => {
    expect(findFieldDivergence([1, 2], { 0: 1, 1: 2 })?.path).toBe('<root>');
  });
});

describe('findFieldDivergence — determinism of the report itself', () => {
  it('reports the alphabetically first differing key regardless of insertion order', () => {
    // THE test for the sorted-key rule. Both objects differ at `alpha` and at `zeta`. Which one a
    // key-order-dependent walk reports depends on how the literals happen to be written — so the
    // same failure would name a different field after an unrelated refactor moved a line, and a
    // diagnostic that changes its story is worse than none because it gets trusted.
    const left = { zeta: 1, alpha: 1 };
    const right = { alpha: 2, zeta: 2 };
    expect(findFieldDivergence(left, right)?.path).toBe('alpha');
    expect(findFieldDivergence(right, left)?.path).toBe('alpha');
  });

  it('reports the same path for the same inputs every time', () => {
    const left = { c: 1, a: 1, b: 1 };
    const right = { b: 2, c: 2, a: 2 };
    const paths = new Set(Array.from({ length: 20 }, () => findFieldDivergence(left, right)?.path));
    expect([...paths]).toEqual(['a']);
  });

  it('throws a diagnosable error on cyclic input rather than overflowing the stack', () => {
    // `GameState` is acyclic by contract. Hitting this means the contract is already broken, and
    // "comparison exceeded 64 levels at a.a.a…" says that, where a RangeError does not.
    const left: Record<string, unknown> = {};
    left.self = left;
    const right: Record<string, unknown> = {};
    right.self = right;
    expect(() => findFieldDivergence(left, right)).toThrow(/exceeded 64 levels/);
  });
});

describe('renderValue', () => {
  it.each([
    [undefined, 'undefined'],
    [null, 'null'],
    [Number.NaN, 'NaN'],
    [-0, '-0'],
    [0, '0'],
    [Number.POSITIVE_INFINITY, 'Infinity'],
    ['x', '"x"'],
    [true, 'true'],
    [[1, 2, 3], 'array(length 3)'],
    [{ b: 1, a: 2 }, 'object{a,b}'],
  ])('renders %s', (value, expected) => {
    expect(renderValue(value)).toBe(expected);
  });
});

describe('findRunDivergence', () => {
  const seed = 'divergence';

  it('returns null when two records describe the same run', () => {
    const record = recordRun(seed, [{ kind: 'wait' }, { kind: 'roll', sides: 6 }]);
    expect(findRunDivergence(record, record)).toBeNull();
    expect(findRunDivergence(record, recordRun(seed, [...record.commands]))).toBeNull();
  });

  it('names the index of the first command whose result differed', () => {
    // The number that turns an afternoon into five minutes. Commands 0 and 1 agree; 2 does not.
    const shared: Command[] = [{ kind: 'wait' }, { kind: 'roll', sides: 6 }];
    const left = recordRun(seed, [...shared, { kind: 'wait' }, { kind: 'wait' }]);
    const right = recordRun(seed, [...shared, { kind: 'roll', sides: 6 }, { kind: 'wait' }]);

    const found = findRunDivergence(left, right);
    expect(found?.commandIndex).toBe(2);
    expect(found?.command).toEqual({ kind: 'wait' });
    expect(found?.turn).toBe(3);
    // The difference is in the generator, and nowhere else — exactly the case a visible-state-only
    // comparison would miss.
    expect(found?.field.path).toMatch(/^(lastOutcome|rng)\b/);
  });

  it('reports index -1 when the seeds already disagree', () => {
    const found = findRunDivergence(recordRun('one', []), recordRun('two', []));
    expect(found?.commandIndex).toBe(-1);
    expect(found?.command).toBeNull();
    expect(found?.field.path).toMatch(/^rng\./);
  });

  it('reports a command-log length mismatch, and where', () => {
    const left = recordRun(seed, [{ kind: 'wait' }, { kind: 'wait' }]);
    const right = recordRun(seed, [{ kind: 'wait' }]);
    const found = findRunDivergence(left, right);
    expect(found?.commandIndex).toBe(1);
    expect(found?.field).toEqual({ path: 'commands.length', left: '2', right: '1' });
  });

  it('detects a divergence on the very last command', () => {
    // An off-by-one in the loop bound would let the final command escape comparison entirely,
    // which is the one place a real bug is most likely to be noticed last.
    const left = recordRun(seed, [{ kind: 'wait' }, { kind: 'wait' }]);
    const right = recordRun(seed, [{ kind: 'wait' }, { kind: 'roll', sides: 6 }]);
    expect(findRunDivergence(left, right)?.commandIndex).toBe(1);
  });
});

describe('findStateSequenceDivergence — the generator is part of the comparison', () => {
  it('reports a divergence that exists ONLY in the generator position', () => {
    // The most important test in this file, and the one that was missing.
    //
    // Two runs that agree on everything visible but sit at different generator positions have
    // already diverged — every draw from that point on differs. A comparison that looked at a
    // subset of fields would call them identical, and since the entire replay suite is phrased as
    // "this returned null", the tripwire would be disarmed with no other symptom.
    //
    // Found by mutation testing: projecting the per-command comparison down to
    // `{ turn, lastOutcome }` survived the whole suite. It could not be caught through the record
    // API, because no pair of `wait`/`roll` logs can differ in the generator alone — anything that
    // changes the draw count also changes `lastOutcome`. Hence the sequence-level entry point.
    const commands: Command[] = [{ kind: 'wait' }, { kind: 'wait' }, { kind: 'wait' }];
    const left = runStates('rng-only', commands);
    // Identical turn, identical lastOutcome, generator nudged one draw forward from index 2 on.
    const right = left.map((state, i) => (i >= 2 ? { ...state, rng: next(state.rng).rng } : state));

    for (let i = 0; i < left.length; i += 1) {
      expect(right[i].turn).toBe(left[i].turn);
      expect(right[i].lastOutcome).toEqual(left[i].lastOutcome);
    }

    const found = findStateSequenceDivergence(left, right, commands);
    expect(found?.commandIndex).toBe(1);
    expect(found?.turn).toBe(2);
    expect(found?.field.path).toMatch(/^rng\./);
  });

  it('reports agreement for two identical sequences', () => {
    const commands: Command[] = [{ kind: 'roll', sides: 6 }, { kind: 'wait' }];
    expect(
      findStateSequenceDivergence(runStates('same', commands), runStates('same', commands), commands),
    ).toBeNull();
  });

  it('names the command from the log it was given', () => {
    const commands: Command[] = [{ kind: 'wait' }, { kind: 'roll', sides: 6 }];
    const left = runStates('named', commands);
    const right = left.map((state, i) => (i >= 2 ? { ...state, turn: state.turn + 1 } : state));
    const found = findStateSequenceDivergence(left, right, commands);
    expect(found?.command).toEqual({ kind: 'roll', sides: 6 });
    // Pinned explicitly: the reported turn must come from the LEFT sequence. Right's turn is
    // deliberately +1 here, so `turn: right[i].turn` would survive without this assertion — and
    // would misreport which turn to look at, in the one message meant to localize the bug.
    expect(found?.turn).toBe(left[2].turn);
  });
});

describe('runStates', () => {
  it('returns the initial state plus one state per command', () => {
    const commands: Command[] = [{ kind: 'wait' }, { kind: 'roll', sides: 6 }];
    const states = runStates('trajectory', commands);
    expect(states).toHaveLength(3);
    expect(states.map((s) => s.turn)).toEqual([0, 1, 2]);
    expect(findFieldDivergence(states[0], createInitialState('trajectory'))).toBeNull();
  });

  it('returns just the initial state for an empty log', () => {
    expect(runStates('empty', [])).toHaveLength(1);
  });
});

describe('formatting', () => {
  it('names the command, the turn, the path, and both values', () => {
    const left = recordRun('fmt', [{ kind: 'wait' }, { kind: 'wait' }]);
    const right = recordRun('fmt', [{ kind: 'wait' }, { kind: 'roll', sides: 6 }]);
    const message = formatRunDivergence(findRunDivergence(left, right)!);

    expect(message).toContain('command 1');
    expect(message).toContain('{"kind":"wait"}');
    expect(message).toContain('turn 2');
    expect(message).toContain('path:');
    expect(message).toContain('left:');
    expect(message).toContain('right:');
  });

  it('says plainly when the initial states differ', () => {
    const message = formatRunDivergence(findRunDivergence(recordRun('a', []), recordRun('b', []))!);
    expect(message).toContain('before any command ran');
  });

  it('formats a bare state comparison', () => {
    const message = formatFieldDivergence(findFieldDivergence({ turn: 1 }, { turn: 2 })!);
    expect(message).toContain('states differ at turn');
  });
});

describe('assertSameState', () => {
  it('passes for identical states', () => {
    expect(() => assertSameState(createInitialState('s'), createInitialState('s'), 'ctx')).not.toThrow();
  });

  it('throws with the context and the located difference', () => {
    expect(() => assertSameState(createInitialState('s'), createInitialState('t'), 'ctx')).toThrow(
      /ctx: states differ at rng\./,
    );
  });
});

describe('non-plain objects', () => {
  // Regression tests for a false green found in review. `Map`, `Set`, and `Date` have no own
  // enumerable keys, so a key-walk comparison reported two different ones as identical. That is
  // the worst possible failure mode here: the replay tripwire returning null while the run has
  // genuinely diverged. GameState is plain JSON-shaped data by contract (state.ts) — this is what
  // enforces the contract rather than trusting it.

  it('throws rather than silently passing on a Set', () => {
    expect(() => findFieldDivergence({ s: new Set([1]) }, { s: new Set([2, 3]) })).toThrow(
      /\bs is a Set, not a plain object/,
    );
  });

  it('throws rather than silently passing on a Map', () => {
    expect(() =>
      findFieldDivergence({ m: new Map([['a', 1]]) }, { m: new Map([['a', 999]]) }),
    ).toThrow(/\bm is a Map, not a plain object/);
  });

  it('throws rather than silently passing on a Date', () => {
    expect(() => findFieldDivergence({ d: new Date(0) }, { d: new Date(5) })).toThrow(
      /\bd is a Date, not a plain object/,
    );
  });

  it('throws when only one side is exotic', () => {
    // Previously reported null: an empty plain object and an empty-keyed Map both walk to nothing.
    expect(() => findFieldDivergence({ x: new Map([['a', 1]]) }, { x: {} })).toThrow(
      /is a Map, not a plain object/,
    );
    expect(() => findFieldDivergence({ x: {} }, { x: new Map([['a', 1]]) })).toThrow(
      /is a Map, not a plain object/,
    );
  });

  it('throws on a class instance', () => {
    class Actor {
      constructor(readonly hp: number) {}
    }
    expect(() => findFieldDivergence({ a: new Actor(1) }, { a: new Actor(2) })).toThrow(
      /is a Actor, not a plain object/,
    );
  });

  it('still accepts null-prototype objects', () => {
    // Object.create(null) is plain data — no prototype to hide behaviour in.
    const left = Object.create(null) as Record<string, unknown>;
    const right = Object.create(null) as Record<string, unknown>;
    left.v = 1;
    right.v = 2;
    expect(findFieldDivergence({ o: left }, { o: right })).toEqual({
      path: 'o.v',
      left: '1',
      right: '2',
    });
  });

  it('names the field path, so the error says where to look', () => {
    expect(() =>
      findFieldDivergence({ deep: { nested: { s: new Set() } } }, { deep: { nested: { s: new Set() } } }),
    ).toThrow(/deep\.nested\.s is a Set/);
  });
});

describe('formatRunDivergence at command 0', () => {
  it('does not claim the initial states differ', () => {
    // Boundary left untested by the original suite: mutating `commandIndex < 0` to `<= 0` survived
    // it, and under that mutation a divergence at the very first command is misreported as a seed
    // mismatch — exactly the misdirection this module exists to prevent.
    const message = formatRunDivergence({
      commandIndex: 0,
      command: { kind: 'roll', sides: 6 } as Command,
      turn: 1,
      field: { path: 'state.rng.s0', left: '1', right: '2' },
    });
    expect(message).not.toMatch(/before any command ran/);
    expect(message).toMatch(/command 0/);
  });
});
