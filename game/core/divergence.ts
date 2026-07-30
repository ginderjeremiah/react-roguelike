/**
 * Locating divergence between two runs.
 *
 * ## Why this is production code and not a test helper
 *
 * The replay-determinism test is the tripwire the whole project rests on, and a tripwire that
 * reports only "the states differ" is a tripwire that costs a day. When it goes red — possibly
 * months from now, on a seed nobody chose, inside a simulation with a map and forty actors — the
 * first two questions are always *which command* and *which field*. Answering them by hand means
 * bisecting a replay in a debugger.
 *
 * So the answer is computed. `findRunDivergence` resolves both runs, finds the first command whose
 * result differs, then walks the two states to the first differing leaf and reports the path to it.
 * The same machinery serves the stored-fixture tests, and a future "this save doesn't reproduce"
 * diagnostic in a dev overlay.
 *
 * ## Two things this gets right on purpose
 *
 * **The generator is compared like any other field.** `rng` is part of `GameState`, so it falls out
 * of a structural walk for free — and it must, because a replay that produces the same *visible*
 * state from a different generator position has already diverged; it just has not surfaced yet.
 * Every subsequent draw in that run will differ. Comparing only the interesting-looking fields
 * would report green on a run that is already wrong.
 *
 * **Object keys are sorted before iteration.** Which divergence is reported "first" would otherwise
 * depend on property insertion order, so the same failure could name a different field on a
 * different engine, or after an unrelated refactor moved a field in an object literal. A diagnostic
 * that is itself nondeterministic is worse than none, because it will be trusted.
 */

import type { Command } from './command';
import { step } from './step';
import { createInitialState, type GameState } from './state';
import type { RunRecord } from './replay';

/**
 * Guards against a cyclic or absurdly nested state. `GameState` is plain acyclic data by contract
 * (see `state.ts`), so hitting this means the contract is already broken — and an explicit throw
 * is a better report of that than a stack overflow.
 */
const MAX_DEPTH = 64;

/** The first place two values differ, as a path and two rendered values. */
export type FieldDivergence = {
  /** Dotted/indexed path from the compared root: `rng.s2`, `commands[3].kind`, `<root>`. */
  readonly path: string;
  /** The left value at `path`, rendered. `<missing>` if the key is absent on that side. */
  readonly left: string;
  /** The right value at `path`, rendered. */
  readonly right: string;
};

/** Where two runs first produced different states. */
export type RunDivergence = {
  /**
   * Index into the command log of the command whose resolution first differed. `-1` means the
   * initial states already differed, i.e. the seeds are not equivalent and no command is at fault.
   */
  readonly commandIndex: number;
  /** The command at `commandIndex`, or `null` when `commandIndex` is `-1`. */
  readonly command: Command | null;
  /** Turn number after that command — a cross-check that the two runs were at the same point. */
  readonly turn: number;
  /** Where inside the two states the difference is. */
  readonly field: FieldDivergence;
};

type ValueKind =
  | 'array'
  | 'bigint'
  | 'boolean'
  | 'function'
  | 'null'
  | 'number'
  | 'object'
  | 'string'
  | 'symbol'
  | 'undefined';

function kindOf(value: unknown): ValueKind {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Render a value for a failure message. Short — the path says where you are, the value only has
 * to be recognisable.
 *
 * The cases that look pedantic are the ones that matter: `-0`, `NaN`, and `undefined` all render
 * as something misleading (`0`, `null`, nothing at all) under `JSON.stringify`, and those are
 * exactly the values that produce a divergence you would otherwise stare at reading "expected 0,
 * got 0".
 */
export function renderValue(value: unknown): string {
  switch (kindOf(value)) {
    case 'undefined':
      return 'undefined';
    case 'null':
      return 'null';
    case 'number': {
      const n = value as number;
      if (Number.isNaN(n)) return 'NaN';
      if (Object.is(n, -0)) return '-0';
      return String(n);
    }
    case 'bigint':
      return `${String(value)}n`;
    case 'string':
      return JSON.stringify(value);
    case 'symbol':
      return String(value);
    case 'function':
      return `function ${(value as { name?: string }).name ?? '(anonymous)'}`;
    case 'array':
      return `array(length ${(value as unknown[]).length})`;
    case 'object':
      return `object{${Object.keys(value as object).sort().join(',')}}`;
    case 'boolean':
      return String(value);
  }
}

function label(path: string): string {
  return path === '' ? '<root>' : path;
}

function leaf(path: string, left: unknown, right: unknown): FieldDivergence {
  const leftKind = kindOf(left);
  const rightKind = kindOf(right);
  // Type is appended only when the two sides disagree about it, because `"1"` and `1` render
  // identically enough to waste ten minutes.
  const suffix = (kind: ValueKind) => (leftKind === rightKind ? '' : ` (${kind})`);
  return {
    path: label(path),
    left: renderValue(left) + suffix(leftKind),
    right: renderValue(right) + suffix(rightKind),
  };
}

function missing(path: string, left: unknown, right: unknown, leftHas: boolean): FieldDivergence {
  return {
    path: label(path),
    left: leftHas ? renderValue(left) : '<missing>',
    right: leftHas ? '<missing>' : renderValue(right),
  };
}

/**
 * Throw unless `value` is a plain object — one whose prototype is `Object.prototype` or `null`.
 *
 * Comparing a `Map`, `Set`, `Date`, or class instance by its own enumerable keys silently reports
 * two different values as identical. Failing loudly here turns a false green into an accurate
 * error naming the offending field, and makes `state.ts`'s "plain JSON-shaped data" rule
 * mechanically enforced rather than aspirational.
 */
function assertPlainObject(value: unknown, path: string): void {
  const proto = Object.getPrototypeOf(value);
  if (proto === Object.prototype || proto === null) return;

  const name = (value as object).constructor?.name ?? 'unknown';
  throw new TypeError(
    `divergence: ${label(path)} is a ${name}, not a plain object. GameState must be plain ` +
      `JSON-shaped data (see game/core/state.ts) — a ${name} would be compared as vacuously ` +
      `identical, which would make the replay tripwire report a false pass.`,
  );
}

function walk(left: unknown, right: unknown, path: string, depth: number): FieldDivergence | null {
  if (depth > MAX_DEPTH) {
    throw new Error(
      `divergence: comparison exceeded ${MAX_DEPTH} levels at ${label(path)}. State is cyclic or ` +
        `pathologically nested, which violates the plain-data contract in state.ts.`,
    );
  }

  // `Object.is`, not `===`: `NaN` must equal itself (otherwise every comparison of a state
  // containing one reports a phantom divergence) and `0` must NOT equal `-0` (they are genuinely
  // different states — `-0` does not survive JSON, so a run producing it is a real problem).
  if (Object.is(left, right)) return null;

  const leftKind = kindOf(left);
  if (leftKind !== kindOf(right)) return leaf(path, left, right);

  if (leftKind === 'array') {
    const a = left as unknown[];
    const b = right as unknown[];
    const shared = Math.min(a.length, b.length);
    // Elements before the length mismatch, so a differing element is reported in preference to a
    // differing length — "commands[3].sides" localizes the problem, "length 40 vs 41" does not.
    for (let i = 0; i < shared; i += 1) {
      const found = walk(a[i], b[i], `${path}[${i}]`, depth + 1);
      if (found) return found;
    }
    if (a.length !== b.length) {
      return { path: `${label(path)}.length`, left: String(a.length), right: String(b.length) };
    }
    return null;
  }

  if (leftKind === 'object') {
    // Refuse anything that is not a plain object. `Map`, `Set`, and `Date` have no own enumerable
    // keys, so the key walk below would compare their *contents* as vacuously identical:
    // `new Set([1])` vs `new Set([2, 3])` would report no divergence at all.
    //
    // That is a false green in the one artifact this module exists to make trustworthy, and it is
    // not hypothetical — `ARCHITECTURE.md`'s module map has `fov/` and `entities/` next, which is
    // exactly where `readonly seen: Set<TileIndex>` or `Map<EntityId, Actor>` would appear in
    // GameState. The JSON round-trip property could not catch it either, since `JSON.stringify`
    // renders a Map as `{}` and the comparison then finds `{}` equal to `{}`.
    //
    // `state.ts` already says GameState is plain JSON-shaped data. This is what enforces it.
    assertPlainObject(left, path);
    assertPlainObject(right, path);

    const a = left as Record<string, unknown>;
    const b = right as Record<string, unknown>;
    // Sorted union of both sides' keys. Sorted for determinism (see the header); union so that a
    // key present on only one side is found rather than skipped.
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const key of keys) {
      const childPath = path === '' ? key : `${path}.${key}`;
      const inLeft = Object.prototype.hasOwnProperty.call(a, key);
      const inRight = Object.prototype.hasOwnProperty.call(b, key);
      if (inLeft !== inRight) return missing(childPath, a[key], b[key], inLeft);
      const found = walk(a[key], b[key], childPath, depth + 1);
      if (found) return found;
    }
    return null;
  }

  // A primitive that failed Object.is, or a function/symbol, neither of which belongs in state.
  return leaf(path, left, right);
}

/**
 * The first structural difference between two values, in a deterministic order, or `null` if they
 * are structurally identical.
 *
 * Generic over `unknown` rather than typed to `GameState` on purpose: it is used on states,
 * records, and command arrays, and the point of a structural walk is that it does not need to know
 * the shape. It compares *own enumerable* properties — plain data, which is what `state.ts`
 * requires state to be.
 *
 * @throws if the values are cyclic (see `MAX_DEPTH`).
 */
export function findFieldDivergence(left: unknown, right: unknown): FieldDivergence | null {
  return walk(left, right, '', 0);
}

/**
 * Every state a run passes through: the initial state, then the state after each command. Length is
 * `commands.length + 1`.
 *
 * Materializing the whole trajectory rather than stepping lazily costs one object per turn, which
 * is nothing at diagnostic scale and buys the thing that matters: the comparison below operates on
 * plain state sequences, so it can be tested against sequences that were not produced by `step` at
 * all. That is not a hypothetical convenience — see `findStateSequenceDivergence`.
 */
export function runStates(seed: string, commands: readonly Command[]): GameState[] {
  const states: GameState[] = [createInitialState(seed)];
  for (const command of commands) {
    states.push(step(states[states.length - 1], command));
  }
  return states;
}

/**
 * The first point at which two state sequences differ.
 *
 * Separate from `findRunDivergence` because it is the part that can be tested honestly. The
 * comparison must consider the **whole** state — a pair of runs that agree on everything visible
 * but sit at different generator positions has already diverged, and every draw from that point on
 * will differ. A comparison that quietly looked at a subset of fields would report those runs as
 * identical, and the replay suite is phrased entirely in terms of this returning `null`.
 *
 * Taking sequences rather than records is what makes that testable: two records built from the
 * `wait`/`roll` commands cannot be made to differ *only* in their generator (any command that
 * changes the draw count also changes `lastOutcome`), so through the record API the omission is
 * invisible. Handed two sequences, a test can construct exactly that case. This restructuring came
 * out of mutation testing — the projection bug survived the entire suite beforehand.
 *
 * @param commands only used to name the command in the report; may be empty.
 */
export function findStateSequenceDivergence(
  left: readonly GameState[],
  right: readonly GameState[],
  commands: readonly Command[] = [],
): RunDivergence | null {
  const initial = findFieldDivergence(left[0], right[0]);
  if (initial) return { commandIndex: -1, command: null, turn: left[0]?.turn ?? 0, field: initial };

  const shared = Math.min(left.length, right.length);
  for (let i = 1; i < shared; i += 1) {
    const field = findFieldDivergence(left[i], right[i]);
    if (field) {
      return { commandIndex: i - 1, command: commands[i - 1] ?? null, turn: left[i].turn, field };
    }
  }

  if (left.length !== right.length) {
    return {
      commandIndex: shared - 1,
      command: commands[shared - 1] ?? null,
      turn: left[shared - 1].turn,
      field: {
        path: 'commands.length',
        left: String(left.length - 1),
        right: String(right.length - 1),
      },
    };
  }

  return null;
}

/**
 * Replay two records and report the first command after which their states differ.
 *
 * Comparing only the final states would tell you a run diverged; comparing after every command
 * tells you *where*, which is the difference between a five-minute fix and an afternoon.
 *
 * Passing the same record twice is the determinism check: two independent folds over identical
 * input must stay identical at every turn.
 *
 * @returns `null` when the two runs are identical at every step.
 */
export function findRunDivergence(left: RunRecord, right: RunRecord): RunDivergence | null {
  return findStateSequenceDivergence(
    runStates(left.seed, left.commands),
    runStates(right.seed, right.commands),
    left.commands,
  );
}

/** A multi-line failure message naming the command, the turn, the field path, and both values. */
export function formatRunDivergence(divergence: RunDivergence): string {
  const where =
    divergence.commandIndex < 0
      ? 'before any command ran — the initial states differ, so the seeds are not equivalent'
      : `after command ${divergence.commandIndex} ` +
        `(${JSON.stringify(divergence.command)}), on turn ${divergence.turn}`;

  return [
    `runs diverged ${where}`,
    `  path:  ${divergence.field.path}`,
    `  left:  ${divergence.field.left}`,
    `  right: ${divergence.field.right}`,
  ].join('\n');
}

/** As `formatRunDivergence`, for a bare state comparison with no command log behind it. */
export function formatFieldDivergence(divergence: FieldDivergence): string {
  return [
    `states differ at ${divergence.path}`,
    `  left:  ${divergence.left}`,
    `  right: ${divergence.right}`,
  ].join('\n');
}

/**
 * Assert two states are structurally identical, failing with a located message.
 *
 * Lives here rather than in a test file because the located message is the whole point, and a
 * helper that produces it should not be something each new test suite reimplements slightly
 * differently.
 *
 * @throws with the path and both values if they differ.
 */
export function assertSameState(left: GameState, right: GameState, context: string): void {
  const field = findFieldDivergence(left, right);
  if (field) throw new Error(`${context}: ${formatFieldDivergence(field)}`);
}
