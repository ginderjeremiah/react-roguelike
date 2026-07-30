import { describe, expect, it } from 'vitest';
import { createRng, int, next, pick, type Draw, type Rng } from '../rng';
import { assertNever } from './assert';
import type { Command } from './command';
import { findFieldDivergence, findRunDivergence, formatFieldDivergence, formatRunDivergence } from './divergence';
import {
  recordRun,
  replay,
  runCommands,
  RULES_VERSION,
  RULES_VERSION_LOG,
  type RunRecord,
} from './replay';
import { createInitialState, type GameState } from './state';
import { step } from './step';

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE REPLAY-DETERMINISM PROPERTY TEST
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The single most important test in this repository. If it goes red, everything else stops until
 * it is fixed — a divergence here means every other test in the project is asserting against a
 * simulation that does not reproduce, and the whole agent-driven verification strategy is
 * unfounded (docs/ARCHITECTURE.md, ADR-0004).
 *
 * ## What "identical" means here, and why it is stricter than it looks
 *
 * Every field of the final `GameState` is compared structurally, **including `rng`**. That is not
 * incidental thoroughness. A replay that reproduces the visible state from a different generator
 * position has already diverged; it simply has not surfaced yet, because the two runs will produce
 * different values from the very next draw. Comparing only the interesting-looking fields reports
 * green on a run that is already wrong, and the report arrives later, somewhere else, looking like
 * a bug in whatever system drew next.
 *
 * ## What a failure tells you
 *
 * Not "states differ". `findRunDivergence` steps both runs in lockstep and stops at the first
 * command whose result differed, so the message names the command index, the command, the turn,
 * the field path, and both values. See `divergence.ts`.
 *
 * ## What could actually fail
 *
 * `step` is pure by construction, so "replay it twice, get the same answer" is nearly tautological
 * *while it stays pure* — which is exactly the point: this test is the alarm for the day someone
 * reaches for a clock, a `Math.random`, a module-level cache, or a `Set` iteration. It is paired
 * with properties that are not tautological at all:
 *
 *   - the **draw budget** anchor, computed from the command list alone and checked against raw
 *     generator advances. This is what catches a conditional draw — a change that is perfectly
 *     deterministic and still poisons every seed.
 *   - **seed sensitivity** and **command sensitivity**, which catch the degenerate implementations
 *     that would make every determinism property pass vacuously.
 *   - **JSON round-tripping**, because a state that cannot survive serialization cannot be saved,
 *     shared, or pinned as a fixture.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

/** How many generated (seed, commands) cases each property runs over. */
const CASES = 400;

/** Upper bound on generated command-log length. */
const MAX_COMMANDS = 32;

// --- Generation --------------------------------------------------------------------------------
//
// The generator is our own seeded RNG, not `Math.random`. A property test whose inputs are
// nondeterministic reports a different failing case every run and cannot be re-run to confirm a
// fix — and would itself violate the rule this file exists to protect.

const SEED_ALPHABET = [...'abcdefghijklmnopqrstuvwxyzABCZ0123456789 -_.éø☃'];

function arbitrarySeed(rng: Rng): Draw<string> {
  const length = int(rng, 0, 12);
  let current = length.rng;
  let text = '';
  for (let i = 0; i < length.value; i += 1) {
    const character = pick(current, SEED_ALPHABET);
    text += character.value;
    current = character.rng;
  }
  return { value: text, rng: current };
}

function arbitraryCommand(rng: Rng): Draw<Command> {
  const choice = int(rng, 0, 2);
  if (choice.value === 0) return { value: { kind: 'wait' }, rng: choice.rng };
  const sides = int(choice.rng, 1, 20);
  return { value: { kind: 'roll', sides: sides.value }, rng: sides.rng };
}

function arbitraryCommands(rng: Rng): Draw<Command[]> {
  const length = int(rng, 0, MAX_COMMANDS);
  let current = length.rng;
  const commands: Command[] = [];
  for (let i = 0; i < length.value; i += 1) {
    const command = arbitraryCommand(current);
    commands.push(command.value);
    current = command.rng;
  }
  return { value: commands, rng: current };
}

function arbitraryRecord(rng: Rng): Draw<RunRecord> {
  const seed = arbitrarySeed(rng);
  const commands = arbitraryCommands(seed.rng);
  return { value: recordRun(seed.value, commands.value), rng: commands.rng };
}

/** Run `body` over `CASES` generated records, from a fixed seed so failures are reproducible. */
function forEachRecord(label: string, body: (record: RunRecord, index: number) => void): void {
  let rng = createRng(`replay-property/${label}`);
  for (let i = 0; i < CASES; i += 1) {
    const generated = arbitraryRecord(rng);
    rng = generated.rng;
    body(generated.value, i);
  }
}

function describeCase(record: RunRecord, index: number): string {
  return `case ${index}: seed ${JSON.stringify(record.seed)}, ${record.commands.length} commands`;
}

// --- The draw budget ---------------------------------------------------------------------------

/**
 * How many generator draws a command is *specified* to consume.
 *
 * Deliberately a second, independent statement of the draw-count contract rather than something
 * `step` shares — it is the specification, and a specification that reads its answer from the
 * implementation asserts nothing. The exhaustive switch means a new `Command` variant fails to
 * compile until its draw cost is declared, which forces the question "how much entropy does this
 * consume" to be answered deliberately rather than discovered later.
 */
function drawCost(command: Command): number {
  switch (command.kind) {
    case 'wait':
      return 0;
    case 'roll':
      return 1;
    default:
      return assertNever(command, 'drawCost');
  }
}

function drawBudget(commands: readonly Command[]): number {
  return commands.reduce((total, command) => total + drawCost(command), 0);
}

function advance(rng: Rng, count: number): Rng {
  let current = rng;
  for (let i = 0; i < count; i += 1) current = next(current).rng;
  return current;
}

// --- The corpus itself --------------------------------------------------------------------------

describe('the generated corpus', () => {
  it('actually covers what the properties below assume it covers', () => {
    // Every property in this file is only as strong as its inputs. A generator that quietly
    // degenerated — always emitting `wait`, always emitting an empty log, always the same seed —
    // would leave the entire suite green and testing nothing, and there would be no other signal
    // that it had happened. So the corpus is measured.
    const seeds = new Set<string>();
    const kinds = new Set<string>();
    let longest = 0;
    let empty = 0;
    let totalCommands = 0;

    forEachRecord('identity', (record) => {
      seeds.add(record.seed);
      longest = Math.max(longest, record.commands.length);
      if (record.commands.length === 0) empty += 1;
      totalCommands += record.commands.length;
      for (const command of record.commands) kinds.add(command.kind);
    });

    expect([...kinds].sort()).toEqual(['roll', 'wait']);
    expect(seeds.size).toBeGreaterThan(CASES / 2);
    expect(longest).toBeGreaterThanOrEqual(MAX_COMMANDS - 4);
    expect(empty).toBeGreaterThan(0); // the boundary case must appear
    expect(totalCommands).toBeGreaterThan(CASES * 8); // logs are not all trivially short
  });

  it('generates seeds that exercise the awkward cases', () => {
    // The empty seed and non-ASCII seeds are exactly what a text field will produce and exactly
    // what a naive implementation mishandles.
    const seeds = new Set<string>();
    forEachRecord('identity', (record) => void seeds.add(record.seed));
    expect(seeds.has('')).toBe(true);
    expect([...seeds].some((s) => /[^\x20-\x7e]/.test(s))).toBe(true);
  });
});

// --- Properties --------------------------------------------------------------------------------

describe('replay determinism', () => {
  it('reproduces a byte-identical final state, at every command, over many generated runs', () => {
    // The tripwire itself. Two independent folds over the same record, compared after every single
    // command rather than only at the end, so a failure names the command that caused it.
    forEachRecord('identity', (record, index) => {
      const divergence = findRunDivergence(record, record);
      if (divergence) {
        throw new Error(`${describeCase(record, index)}\n${formatRunDivergence(divergence)}`);
      }
    });
  });

  it('produces the same final state through replay(), runCommands(), and manual stepping', () => {
    // Catches a divergence between the entry points — a `replay` that normalized the seed, or a
    // `runCommands` that started from something other than `createInitialState`.
    forEachRecord('entry-points', (record, index) => {
      const viaReplay = replay(record);
      const viaRunCommands = runCommands(record.seed, record.commands);
      const viaManualStepping = record.commands.reduce(step, createInitialState(record.seed));

      for (const [label, other] of [
        ['runCommands', viaRunCommands],
        ['manual stepping', viaManualStepping],
      ] as const) {
        const divergence = findFieldDivergence(viaReplay, other);
        if (divergence) {
          throw new Error(
            `${describeCase(record, index)}: replay() and ${label} disagree\n` +
              formatFieldDivergence(divergence),
          );
        }
      }
    });
  });

  it('survives a round trip through JSON, as a stored record must', () => {
    // A record is a save file and a bug report. If it does not survive serialization it is neither.
    // Catches a Command carrying something JSON cannot represent — `undefined`, `NaN`, a `Map`.
    forEachRecord('record-json', (record, index) => {
      const rehydrated = JSON.parse(JSON.stringify(record)) as RunRecord;

      const recordDivergence = findFieldDivergence(rehydrated, record);
      if (recordDivergence) {
        throw new Error(
          `${describeCase(record, index)}: record changed under JSON\n` +
            formatFieldDivergence(recordDivergence),
        );
      }

      const divergence = findFieldDivergence(replay(rehydrated), replay(record));
      if (divergence) {
        throw new Error(
          `${describeCase(record, index)}: rehydrated record replays differently\n` +
            formatFieldDivergence(divergence),
        );
      }
    });
  });

  it('produces states that survive a round trip through JSON', () => {
    // The same requirement one level down. `NaN` and `-0` in state are the specific hazards:
    // both serialize to something else and would make a stored fixture unrepresentable, while
    // being entirely invisible to a `toEqual` between two live states.
    forEachRecord('state-json', (record, index) => {
      const state = replay(record);
      const divergence = findFieldDivergence(JSON.parse(JSON.stringify(state)), state);
      if (divergence) {
        throw new Error(
          `${describeCase(record, index)}: state does not round-trip\n` +
            formatFieldDivergence(divergence),
        );
      }
    });
  });

  it('advances the generator by exactly the draw budget of its command log', () => {
    // The property that is NOT tautological, and the one that earns this file its length.
    //
    // A conditional draw — "and one more if the roll came up maximum" — is perfectly
    // deterministic. Every replay-identity property above passes. It nonetheless shifts the entire
    // downstream stream for that run, which is the failure mode that surfaces a fortnight later in
    // an unrelated system. Anchoring the final generator position against a budget computed from
    // the command list alone, using raw `next()` advances, is what detects it.
    forEachRecord('draw-budget', (record, index) => {
      const state = replay(record);
      const expected = advance(createRng(record.seed), drawBudget(record.commands));
      const divergence = findFieldDivergence(state.rng, expected);
      if (divergence) {
        throw new Error(
          `${describeCase(record, index)}: consumed the wrong number of draws ` +
            `(budget ${drawBudget(record.commands)})\n${formatFieldDivergence(divergence)}`,
        );
      }
    });
  });

  it('resolves exactly one turn per command', () => {
    forEachRecord('turns', (record, index) => {
      expect(replay(record).turn, describeCase(record, index)).toBe(record.commands.length);
    });
  });

  it('is composable: replaying a prefix then continuing equals replaying the whole', () => {
    // Catches state that is not self-contained. If any part of a run lived outside `GameState` —
    // a module-level cache, a lazily-initialized table, anything — resuming from a stored
    // intermediate state would diverge from running straight through, while both would still be
    // individually reproducible and pass every identity property above.
    let rng = createRng('replay-property/composition');
    for (let i = 0; i < CASES; i += 1) {
      const generated = arbitraryRecord(rng);
      const split = int(generated.rng, 0, generated.value.commands.length);
      rng = split.rng;

      const record = generated.value;
      const prefix = record.commands.slice(0, split.value);
      const suffix = record.commands.slice(split.value);
      const resumed = suffix.reduce(step, runCommands(record.seed, prefix));

      const divergence = findFieldDivergence(resumed, replay(record));
      if (divergence) {
        throw new Error(
          `${describeCase(record, i)}: resuming after ${split.value} commands diverges\n` +
            formatFieldDivergence(divergence),
        );
      }
    }
  });
});

describe('replay determinism — the properties that stop it passing vacuously', () => {
  it('produces different runs from different seeds', () => {
    // Without this, `createInitialState` ignoring its seed would satisfy every property above.
    // A constant generator is perfectly reproducible; it is just not a game.
    let rng = createRng('replay-property/seed-sensitivity');
    for (let i = 0; i < CASES; i += 1) {
      const first = arbitrarySeed(rng);
      const second = arbitrarySeed(first.rng);
      const commands = arbitraryCommands(second.rng);
      rng = commands.rng;

      // Two seed strings can in principle hash to the same state; that is a property of the seed
      // derivation, not of replay, and `seed.ts` tests it. Skip those pairs rather than assert
      // something this file is not about.
      if (findFieldDivergence(createRng(first.value), createRng(second.value)) === null) continue;

      const left = runCommands(first.value, commands.value);
      const right = runCommands(second.value, commands.value);
      expect(
        findFieldDivergence(left, right),
        `seeds ${JSON.stringify(first.value)} and ${JSON.stringify(second.value)} produced ` +
          `identical states after ${commands.value.length} commands`,
      ).not.toBeNull();
    }
  });

  it('produces different runs from different command logs', () => {
    // Without this, a `step` that ignored its command entirely would pass every property above.
    let rng = createRng('replay-property/command-sensitivity');
    for (let i = 0; i < CASES; i += 1) {
      const generated = arbitraryRecord(rng);
      rng = generated.rng;
      const record = generated.value;
      if (record.commands.length === 0) continue;

      const target = int(rng, 0, record.commands.length - 1);
      rng = target.rng;

      // Flip the command's kind. Both directions change the draw budget, so the final generator
      // position must differ no matter where in the log the flip lands.
      const commands = record.commands.slice();
      commands[target.value] =
        commands[target.value].kind === 'wait' ? { kind: 'roll', sides: 6 } : { kind: 'wait' };

      const divergence = findFieldDivergence(
        runCommands(record.seed, commands),
        runCommands(record.seed, record.commands),
      );
      expect(
        divergence,
        `${describeCase(record, i)}: changing command ${target.value} changed nothing`,
      ).not.toBeNull();
    }
  });

  it('detects a divergence when one exists, and names where', () => {
    // The self-check. Every property above is expressed as "findRunDivergence returned null", so a
    // `findRunDivergence` that always returned null would make this entire file green and
    // meaningless. This asserts the instrument reads.
    const left = recordRun('instrument', [{ kind: 'wait' }, { kind: 'wait' }, { kind: 'roll', sides: 6 }]);
    const right = recordRun('instrument', [{ kind: 'wait' }, { kind: 'roll', sides: 6 }, { kind: 'roll', sides: 6 }]);

    const divergence = findRunDivergence(left, right);
    expect(divergence).not.toBeNull();
    expect(divergence?.commandIndex).toBe(1);
    expect(divergence?.turn).toBe(2);
    expect(formatRunDivergence(divergence!)).toContain('command 1');
  });
});

// --- The record format itself -------------------------------------------------------------------

describe('RunRecord', () => {
  it('stamps records with the current rules version', () => {
    expect(recordRun('v', []).version).toBe(RULES_VERSION);
  });

  it('has a log entry for the current version', () => {
    // Catches a version bumped without a note saying what changed — which is a bump nobody can
    // explain in six months, and the reason stored fixtures get "fixed" instead of investigated.
    expect(RULES_VERSION_LOG).toHaveLength(RULES_VERSION);
    expect(RULES_VERSION_LOG[RULES_VERSION - 1]).toMatch(new RegExp(`^${RULES_VERSION} — `));
  });

  it('refuses to replay a record from a different rules version', () => {
    // Replaying it anyway produces a plausible state that is not the recorded run. That is worse
    // than an error, because it is believable.
    const stale: RunRecord = { version: RULES_VERSION + 1, seed: 'x', commands: [{ kind: 'wait' }] };
    expect(() => replay(stale)).toThrow(/rules version/);
    const ancient: RunRecord = { version: 0, seed: 'x', commands: [] };
    expect(() => replay(ancient)).toThrow(/rules version/);
  });

  it('offers runCommands() as the deliberate cross-version escape hatch', () => {
    const stale: RunRecord = { version: 0, seed: 'x', commands: [{ kind: 'wait' }] };
    expect(runCommands(stale.seed, stale.commands).turn).toBe(1);
  });

  it('rejects structurally invalid records with a message naming the problem', () => {
    // Records come from save files and bug reports. The declared type guarantees nothing about
    // what is actually in the JSON.
    const invalid: [string, unknown, RegExp][] = [
      ['null', null, /expected a run record/],
      ['a string', 'not a record', /expected a run record/],
      ['non-integer version', { version: 1.5, seed: 'x', commands: [] }, /version must be an integer/],
      ['non-string seed', { version: RULES_VERSION, seed: 7, commands: [] }, /seed must be a string/],
      ['missing commands', { version: RULES_VERSION, seed: 'x' }, /commands must be an array/],
      [
        'unknown command kind',
        { version: RULES_VERSION, seed: 'x', commands: [{ kind: 'wait' }, { kind: 'fly' }] },
        /command 1 has unknown kind/,
      ],
      [
        'null command',
        { version: RULES_VERSION, seed: 'x', commands: [null] },
        /command 0 has unknown kind/,
      ],
    ];

    for (const [label, record, pattern] of invalid) {
      expect(() => replay(record as RunRecord), label).toThrow(pattern);
    }
  });

  it('replays an empty command log to the initial state', () => {
    const divergence = findFieldDivergence(replay(recordRun('empty', [])), createInitialState('empty'));
    expect(divergence).toBeNull();
  });
});

// --- Pinned run ---------------------------------------------------------------------------------

describe('pinned run', () => {
  /**
   * A stored replay fixture, pinned at `RULES_VERSION` 1.
   *
   * Everything above proves the simulation reproduces *itself*. Nothing above notices if what it
   * reproduces silently changes — a different mapping from draw to roll, a reordered field, a
   * different seed derivation — because both sides of every comparison move together. This is the
   * tripwire for that, and it is the reason `RULES_VERSION` exists.
   *
   * These numbers are ground truth by definition: they were generated from this implementation.
   * They cannot prove the rules are *right*, only that they have not *changed*. If this fails, the
   * question is "did I mean to change the rules", not "how do I update the constants". If the
   * answer is yes: re-pin, bump `RULES_VERSION`, add a `RULES_VERSION_LOG` line, and say so in the
   * journal.
   *
   * `lastOutcome` is not entirely self-referential, as it happens: the run consumes draws 1-4 of seed
   * `emberdepth`, and `draw.test.ts` independently pins those as floats
   * (0.8038, 0.5807, 0.8563, 0.99875). The final d100 is draw 4, and 1 + floor(0.99875 × 100) is
   * 100 — which is what this says. The generator words are pure ground truth.
   */
  const PINNED: { readonly record: RunRecord; readonly final: GameState } = {
    record: {
      version: 1,
      seed: 'emberdepth',
      commands: [
        { kind: 'wait' },
        { kind: 'roll', sides: 6 },
        { kind: 'roll', sides: 20 },
        { kind: 'wait' },
        { kind: 'roll', sides: 2 },
        { kind: 'roll', sides: 100 },
      ],
    },
    final: {
      turn: 6,
      rng: { s0: 37048040, s1: 1506109533, s2: 3657779835, s3: 3644707566 },
      lastOutcome: { kind: 'rolled', value: 100 },
    },
  };

  it('reproduces the stored final state exactly', () => {
    const divergence = findFieldDivergence(replay(PINNED.record), PINNED.final);
    if (divergence) {
      throw new Error(
        `the pinned run no longer reproduces — the RULES did this, not the test\n` +
          formatFieldDivergence(divergence),
      );
    }
  });
});
