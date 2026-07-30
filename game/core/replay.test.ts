import { describe, expect, it } from 'vitest';
import { diveToTheBottom, headingTo, standUntilDead, stepTowardOnGrid } from '@/tests/unit/support/run-script';
import { playerOf } from '../entities';
import { expectedDrawCount, samePosition } from '../map';
import { createRng, int, next, pick, type Draw, type Rng } from '../rng';
import { DIRECTIONS, SHUTTER_STATES, type Command } from './command';
import {
  findFieldDivergence,
  findRunDivergence,
  formatFieldDivergence,
  formatRunDivergence,
  runStates,
} from './divergence';
import {
  recordRun,
  replay,
  runCommands,
  RULES_VERSION,
  RULES_VERSION_LOG,
  type RunRecord,
} from './replay';
import { createInitialState, floorNumberOf, type GameState } from './state';
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
 * Every field of the final `GameState` is compared structurally, **including `rng` and including
 * the `Floor`**. Neither is incidental thoroughness:
 *
 *   - A replay that reproduces the visible state from a different generator position has already
 *     diverged; it simply has not surfaced yet, because the two runs will produce different values
 *     from the very next draw.
 *   - The `Floor` is *mutated* mid-run — collecting an ember cache rewrites the tile and drops the
 *     entry from `floor.caches` — so a floor held outside the compared state would let a replay
 *     that takes a cache diverge invisibly. That is why it lives inside `GameState`.
 *
 * ## What the corpus has to contain to mean anything
 *
 * **A log of random moves never descends.** The stairs are one tile in 165, so a generator that
 * emitted uniformly random commands would produce a `descend` arm that is *always* refused — and
 * `descend` is the only command in the game that draws from the generator. The draw-budget property
 * below would then be asserting that nothing ever drew anything. So the generator steers: it plays
 * a real run, mixing random commands with steps along a route to the stairs, and the corpus test
 * measures that descents, refusals, free actions and endings all actually occur.
 *
 * ## What could actually fail
 *
 * `step` is pure by construction, so "replay it twice, get the same answer" is nearly tautological
 * *while it stays pure* — which is exactly the point: this test is the alarm for the day someone
 * reaches for a clock, a `Math.random`, a module-level cache, or a `Set` iteration. It is paired
 * with properties that are not tautological at all:
 *
 *   - the **draw budget**, computed from the sequence of floors the run visited and checked against
 *     raw generator advances. This is what catches a conditional draw — a change that is perfectly
 *     deterministic and still poisons every seed.
 *   - the **refusal accounting**: a refusal must leave the state byte-identical, and
 *     `commandsResolved` must count exactly the commands that were not refused. Those two together
 *     are what make "identical to its predecessor" mean "refused" rather than "silently did
 *     something".
 *   - **seed sensitivity** and **command sensitivity**, which catch the degenerate implementations
 *     that would make every determinism property pass vacuously.
 *   - **JSON round-tripping**, because a state that cannot survive serialization cannot be saved,
 *     shared, or pinned as a fixture.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

/** How many generated (seed, commands) cases each property runs over. */
const CASES = 120;

/** Upper bound on generated command-log length. Long enough to reach the stairs more than once. */
const MAX_COMMANDS = 60;

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

/**
 * The next command a generated run issues, chosen from the state.
 *
 * Half chaos, half purpose. The chaotic half produces the refusals, the wasted flashes and the
 * walks into walls that a real player's log contains; the purposeful half is what gets the run to
 * the stairs so that `descend` is ever anything but a refusal. Neither half is a model of good
 * play and neither is trying to be — the property under test is that a log replays, not that it
 * plays well.
 */
function arbitraryCommand(rng: Rng, state: GameState): Draw<Command> {
  const roll = int(rng, 0, 9);
  const at = playerOf(state.world).at;

  if (roll.value === 0) return { value: { kind: 'wait' }, rng: roll.rng };
  if (roll.value === 1) {
    const to = pick(roll.rng, SHUTTER_STATES);
    return { value: { kind: 'setShutter', to: to.value }, rng: to.rng };
  }
  if (roll.value === 2) return { value: { kind: 'descend' }, rng: roll.rng };
  if (roll.value === 3) {
    const dir = pick(roll.rng, DIRECTIONS);
    return { value: { kind: 'move', dir: dir.value }, rng: dir.rng };
  }

  // The steering half: toward the stairs, or onto them.
  if (samePosition(at, state.world.floor.stairs)) return { value: { kind: 'descend' }, rng: roll.rng };
  const onward = stepTowardOnGrid(state.world.floor.grid, at, state.world.floor.stairs, () => false);
  const dir = onward === null ? null : headingTo(at, onward);
  if (dir === null) return { value: { kind: 'wait' }, rng: roll.rng };
  return { value: { kind: 'move', dir }, rng: roll.rng };
}

function arbitraryRecord(rng: Rng): Draw<RunRecord> {
  const seed = arbitrarySeed(rng);
  const length = int(seed.rng, 0, MAX_COMMANDS);
  let current = length.rng;

  const commands: Command[] = [];
  let state = createInitialState(seed.value);
  for (let i = 0; i < length.value; i += 1) {
    const command = arbitraryCommand(current, state);
    current = command.rng;
    commands.push(command.value);
    state = step(state, command.value);
  }

  return { value: recordRun(seed.value, commands), rng: current };
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
 * How many generator draws a run is *specified* to consume.
 *
 * A second, independent statement of the draw-count contract rather than something `step` shares —
 * it is the specification, and a specification that reads its answer from the implementation
 * asserts nothing.
 *
 * It is a function of **which floors the run visited**, not of the command list, and that is the
 * substance of `step.ts`'s contract 4: exactly one command draws (`descend`, through
 * `generateFloor`), `generateFloor`'s count is fixed for a given floor number, and a `descend` that
 * was refused or that won the run draws nothing at all. Reading the floor numbers off the states is
 * not circular — no part of this consults `rng`, so a stray draw anywhere shows up as a mismatch
 * between this number and where the generator actually ended.
 */
function drawBudget(states: readonly GameState[]): number {
  let total = expectedDrawCount(1); // `createInitialState` generates floor 1 before any command.
  for (let i = 1; i < states.length; i += 1) {
    if (floorNumberOf(states[i]) !== floorNumberOf(states[i - 1])) {
      total += expectedDrawCount(floorNumberOf(states[i]));
    }
  }
  return total;
}

function advance(rng: Rng, count: number): Rng {
  let current = rng;
  for (let i = 0; i < count; i += 1) current = next(current).rng;
  return current;
}

/** Commands whose resolution changed the state. A refusal returns its input, by contract. */
function resolvedCount(states: readonly GameState[]): number {
  let resolved = 0;
  for (let i = 1; i < states.length; i += 1) {
    if (findFieldDivergence(states[i], states[i - 1]) !== null) resolved += 1;
  }
  return resolved;
}

// --- The corpus itself --------------------------------------------------------------------------

describe('the generated corpus', () => {
  it('actually covers what the properties below assume it covers', () => {
    // Every property in this file is only as strong as its inputs. A generator that quietly
    // degenerated — always emitting `wait`, never reaching the stairs, never being refused — would
    // leave the entire suite green and testing nothing, and there would be no other signal that it
    // had happened. So the corpus is measured.
    const seeds = new Set<string>();
    const kinds = new Set<string>();
    let longest = 0;
    let empty = 0;
    let totalCommands = 0;
    let descents = 0;
    let refusals = 0;
    let freeActions = 0;
    let deaths = 0;
    let wins = 0;
    let deepest = 1;

    forEachRecord('identity', (record) => {
      seeds.add(record.seed);
      longest = Math.max(longest, record.commands.length);
      if (record.commands.length === 0) empty += 1;
      totalCommands += record.commands.length;
      for (const command of record.commands) kinds.add(command.kind);

      const states = runStates(record.seed, record.commands);
      const final = states[states.length - 1];
      refusals += record.commands.length - resolvedCount(states);
      freeActions += record.commands.filter((command) => command.kind === 'setShutter').length;
      deepest = Math.max(deepest, floorNumberOf(final));
      for (let i = 1; i < states.length; i += 1) {
        if (floorNumberOf(states[i]) !== floorNumberOf(states[i - 1])) descents += 1;
      }
      if (final.status.kind === 'died') deaths += 1;
      if (final.status.kind === 'reachedBottom') wins += 1;
    });

    console.log(
      `corpus: ${totalCommands} commands, ${descents} descents (deepest floor ${deepest}), ` +
        `${refusals} refusals, ${freeActions} free actions, ${deaths} deaths, ${wins} wins`,
    );

    expect([...kinds].sort()).toEqual(['descend', 'move', 'setShutter', 'wait']);
    expect(seeds.size).toBeGreaterThan(CASES / 2);
    expect(longest).toBeGreaterThanOrEqual(MAX_COMMANDS - 4);
    expect(empty).toBeGreaterThan(0); // the boundary case must appear
    expect(totalCommands).toBeGreaterThan(CASES * 8); // logs are not all trivially short
    // The three things the properties below would otherwise assert about nothing.
    expect(descents).toBeGreaterThan(CASES / 4); // `descend` is the only command that draws
    expect(deepest).toBeGreaterThan(2); // and it happens more than once in a run
    expect(refusals).toBeGreaterThan(CASES); // refusals are exercised, not merely described
    expect(freeActions).toBeGreaterThan(CASES / 2);
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
    // The same requirement one level down. `NaN`, `-0` and `undefined` in state are the specific
    // hazards: all three serialize to something else and would make a stored fixture
    // unrepresentable, while being entirely invisible to a `toEqual` between two live states. So is
    // a `Map` or a `Set` anywhere inside the floor, the schedule or the tile sets.
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

  it('advances the generator by exactly the draw budget of the floors it visited', () => {
    // The property that is NOT tautological, and the one that earns this file its length.
    //
    // A conditional draw — "and one more if the room came out empty" — is perfectly deterministic.
    // Every replay-identity property above passes. It nonetheless shifts the entire downstream
    // stream for that run, which is the failure mode that surfaces a fortnight later in an
    // unrelated system. Anchoring the final generator position against a budget computed from
    // `expectedDrawCount` and the floors visited, using raw `next()` advances, is what detects it.
    forEachRecord('draw-budget', (record, index) => {
      const states = runStates(record.seed, record.commands);
      const budget = drawBudget(states);
      const expected = advance(createRng(record.seed), budget);
      const divergence = findFieldDivergence(states[states.length - 1].rng, expected);
      if (divergence) {
        throw new Error(
          `${describeCase(record, index)}: consumed the wrong number of draws (budget ${budget})\n` +
            formatFieldDivergence(divergence),
        );
      }
    });
  });

  it('changes floor only on a descend, and only by one', () => {
    // The other half of the budget property: the budget is computed from the floors visited, so it
    // would be satisfied by a `wait` that generated a floor as long as the floor number moved too.
    // This pins which command is allowed to move it.
    forEachRecord('floor-changes', (record, index) => {
      const states = runStates(record.seed, record.commands);
      for (let i = 1; i < states.length; i += 1) {
        const from = floorNumberOf(states[i - 1]);
        const to = floorNumberOf(states[i]);
        if (from === to) continue;
        expect(record.commands[i - 1].kind, `${describeCase(record, index)} at command ${i - 1}`).toBe('descend');
        expect(to, `${describeCase(record, index)} at command ${i - 1}`).toBe(from + 1);
      }
    });
  });

  it('counts exactly the commands it resolved, and nothing it refused', () => {
    // §2: a refused action produces "no change to any field of the state". So a state identical to
    // its predecessor is a refusal, and `commandsResolved` must equal the number of commands that
    // *did* change something. Two mutations die here and nowhere else: a refusal that increments a
    // counter (identical would stop meaning refused), and a resolved command that forgets to.
    forEachRecord('counters', (record, index) => {
      const states = runStates(record.seed, record.commands);
      const final = states[states.length - 1];
      expect(final.commandsResolved, describeCase(record, index)).toBe(resolvedCount(states));
      expect(final.commandsResolved).toBeLessThanOrEqual(record.commands.length);
      // And `turnsElapsed` counts a strict subset: every free action resolved is a command that
      // cost no turn, so the two counters differ by exactly the free actions that resolved.
      expect(final.turnsElapsed).toBeLessThanOrEqual(final.commandsResolved);
    });
  });

  it('is composable: replaying a prefix then continuing equals replaying the whole', () => {
    // Catches state that is not self-contained. If any part of a run lived outside `GameState` —
    // a module-level cache, a lazily-initialized table, the `Floor` — resuming from a stored
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
      const commands = arbitraryRecord(second.rng);
      rng = commands.rng;

      // Two seed strings can in principle hash to the same state; that is a property of the seed
      // derivation, not of replay, and `seed.ts` tests it. Skip those pairs rather than assert
      // something this file is not about.
      if (findFieldDivergence(createRng(first.value), createRng(second.value)) === null) continue;

      const left = runCommands(first.value, commands.value.commands);
      const right = runCommands(second.value, commands.value.commands);
      expect(
        findFieldDivergence(left, right),
        `seeds ${JSON.stringify(first.value)} and ${JSON.stringify(second.value)} produced ` +
          `identical states after ${commands.value.commands.length} commands`,
      ).not.toBeNull();
    }
  });

  it('produces a different state from a different command', () => {
    // Without this, a `step` that ignored its command entirely would pass every property above.
    //
    // The flip is applied to a command that **resolved**, and the comparison is made immediately
    // after it. Both details matter: flipping a refused command changes nothing by design, and
    // comparing final states would let a later command wash the difference out (two runs whose
    // lanterns both clamped at 0 fuel can genuinely re-converge).
    let rng = createRng('replay-property/command-sensitivity');
    let checked = 0;
    for (let i = 0; i < CASES; i += 1) {
      const generated = arbitraryRecord(rng);
      rng = generated.rng;
      const record = generated.value;
      const states = runStates(record.seed, record.commands);

      const resolvedIndices: number[] = [];
      for (let j = 1; j < states.length; j += 1) {
        if (findFieldDivergence(states[j], states[j - 1]) !== null) resolvedIndices.push(j - 1);
      }
      if (resolvedIndices.length === 0) continue;

      const choice = int(rng, 0, resolvedIndices.length - 1);
      rng = choice.rng;
      const target = resolvedIndices[choice.value];

      // Ask for the shutter setting it is *not* currently in: always resolves, always changes the
      // lantern, and is legal from any tile — so the flip cannot accidentally be a refusal.
      const commands = record.commands.slice();
      commands[target] = {
        kind: 'setShutter',
        to: states[target].lantern.vision.shutter === 'open' ? 'shuttered' : 'open',
      };
      if (findFieldDivergence(commands[target], record.commands[target]) === null) continue;

      const divergence = findFieldDivergence(
        runCommands(record.seed, commands.slice(0, target + 1)),
        states[target + 1],
      );
      expect(
        divergence,
        `${describeCase(record, i)}: replacing command ${target} changed nothing`,
      ).not.toBeNull();
      checked += 1;
    }
    // The loop is full of `continue`s; without this the property could be checking nothing at all.
    expect(checked).toBeGreaterThan(CASES / 2);
  });

  it('detects a divergence when one exists, and names where', () => {
    // The self-check. Every property above is expressed as "findRunDivergence returned null", so a
    // `findRunDivergence` that always returned null would make this entire file green and
    // meaningless. This asserts the instrument reads.
    const left = recordRun('instrument', [{ kind: 'wait' }, { kind: 'wait' }, { kind: 'wait' }]);
    const right = recordRun('instrument', [
      { kind: 'wait' },
      { kind: 'setShutter', to: 'shuttered' },
      { kind: 'wait' },
    ]);

    const divergence = findRunDivergence(left, right);
    expect(divergence).not.toBeNull();
    expect(divergence?.commandIndex).toBe(1);
    expect(divergence?.turnsElapsed).toBe(2);
    expect(formatRunDivergence(divergence!)).toContain('command 1');
  });
});

// --- Whole runs -----------------------------------------------------------------------------------

describe('whole runs replay', () => {
  it('reproduces an eight-floor winning run byte-identically', () => {
    // The generated corpus above reaches floor three or four. This is the shape of the run the
    // milestone is actually about — every floor, every descent, ending in `reachedBottom` — and it
    // is the case where a stray draw has the most room to accumulate.
    const record = diveToTheBottom('replay-dive');
    expect(replay(record).status).toEqual({ kind: 'reachedBottom' });
    const divergence = findRunDivergence(record, record);
    if (divergence) throw new Error(formatRunDivergence(divergence));

    const states = runStates(record.seed, record.commands);
    const expected = advance(createRng(record.seed), drawBudget(states));
    expect(states[states.length - 1].rng).toEqual(expected);
  });

  it('reproduces a run whose command log continues past the death', () => {
    // §13: "a stored run whose command log runs past the death must still replay." Commands issued
    // after the run ended are refused rather than thrown, so this record is legal — and a `step`
    // that threw on them would make every real bug report from a dying player unreplayable.
    const record = standUntilDead('grave', 5);
    const final = replay(record);
    expect(final.status).toEqual({ kind: 'died' });
    expect(playerOf(final.world).hp).toBe(0);
    expect(findRunDivergence(record, record)).toBeNull();
    expect(final.commandsResolved).toBe(record.commands.length - 5);
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
    expect(runCommands(stale.seed, stale.commands).turnsElapsed).toBe(1);
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
        'a version-1 command',
        { version: RULES_VERSION, seed: 'x', commands: [{ kind: 'roll', sides: 6 }] },
        /command 0 has unknown kind/,
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

  it('leaves a malformed *payload* to step(), which is the single authority on one', () => {
    // `assertValidRunRecord` is deliberately shallow: it validates the envelope and the
    // discriminants, never the payloads, so that there is one definition of a well-formed command
    // rather than two that drift. The consequence is that a bad payload throws from `step` with a
    // message about the command — which is the behaviour, not an oversight.
    const bad: RunRecord = {
      version: RULES_VERSION,
      seed: 'x',
      commands: [{ kind: 'move', dir: 'up' } as unknown as Command],
    };
    expect(() => replay(bad)).toThrow(/move requires a direction/);
  });

  it('replays an empty command log to the initial state', () => {
    const divergence = findFieldDivergence(replay(recordRun('empty', [])), createInitialState('empty'));
    expect(divergence).toBeNull();
  });
});

// --- Pinned run ---------------------------------------------------------------------------------

describe('pinned run', () => {
  /**
   * A stored replay fixture, pinned at `RULES_VERSION` 2.
   *
   * Everything above proves the simulation reproduces *itself*. Nothing above notices if what it
   * reproduces silently changes — a different fuel burn, a reordered phase, a different seed
   * derivation, a generator that places stairs one tile over — because both sides of every
   * comparison move together. This is the tripwire for that, and it is the reason `RULES_VERSION`
   * exists.
   *
   * **A digest rather than a whole state**, because a `GameState` is a floor: 165 tiles, six rooms,
   * seven doorways and a tile set, none of which is readable in a diff. The digest is chosen so
   * that every subsystem in the run has at least one number in it — the generator (which floor was
   * built), the lantern (fuel, shutter, sense radius), the actors (position, HP, creatures alive),
   * turn resolution (both counters, the clock) and the ending. `map/generate.test.ts` pins whole
   * floors tile by tile; this pins that a *run* over them comes out the same.
   *
   * These numbers are ground truth by definition: they were generated from this implementation.
   * They cannot prove the rules are *right*, only that they have not *changed*. If this fails, the
   * question is "did I mean to change the rules", not "how do I update the constants". If the
   * answer is yes: re-pin, bump `RULES_VERSION`, add a `RULES_VERSION_LOG` line, and say so in the
   * journal.
   */
  const PINNED_RECORD: RunRecord = {
    version: 2,
    seed: 'emberdepth',
    // A dark crawl across floor 1 to its stairs, a descent, and three commands on the floor below —
    // one of which (the move north) is refused by the new floor's geometry, which is why the two
    // counters below disagree with the log length by different amounts.
    commands: [
      { kind: 'setShutter', to: 'shuttered' },
      { kind: 'move', dir: 'north' },
      { kind: 'move', dir: 'east' },
      { kind: 'move', dir: 'east' },
      { kind: 'move', dir: 'south' },
      { kind: 'move', dir: 'east' },
      { kind: 'move', dir: 'east' },
      { kind: 'move', dir: 'east' },
      { kind: 'move', dir: 'east' },
      { kind: 'move', dir: 'south' },
      { kind: 'move', dir: 'south' },
      { kind: 'move', dir: 'west' },
      { kind: 'move', dir: 'west' },
      { kind: 'descend' },
      { kind: 'move', dir: 'north' },
      { kind: 'wait' },
      { kind: 'setShutter', to: 'open' },
    ],
  };

  const PINNED_DIGEST = {
    status: 'running',
    floorNumber: 2,
    turnsElapsed: 14,
    commandsResolved: 16,
    now: 200,
    fuel: 61,
    shutter: 'open',
    senseRadius: 5,
    remembered: 38,
    player: { x: 6, y: 5 },
    hp: 12,
    creaturesAlive: 4,
    rng: { s0: 997592408, s1: 1040665852, s2: 4214618089, s3: 90954535 },
  };

  function digest(state: GameState): typeof PINNED_DIGEST {
    return {
      status: state.status.kind,
      floorNumber: floorNumberOf(state),
      turnsElapsed: state.turnsElapsed,
      commandsResolved: state.commandsResolved,
      now: state.world.schedule.now,
      fuel: state.lantern.fuel,
      shutter: state.lantern.vision.shutter,
      senseRadius: state.lantern.vision.senseRadius,
      remembered: state.lantern.vision.remembered.flags.filter(Boolean).length,
      player: playerOf(state.world).at,
      hp: playerOf(state.world).hp,
      creaturesAlive: state.world.actors.filter((actor) => actor.kind === 'creature' && actor.hp > 0).length,
      rng: state.rng,
    };
  }

  it('reproduces the stored final state exactly', () => {
    const divergence = findFieldDivergence(digest(replay(PINNED_RECORD)), PINNED_DIGEST);
    if (divergence) {
      throw new Error(
        `the pinned run no longer reproduces — the RULES did this, not the test\n` +
          formatFieldDivergence(divergence),
      );
    }
  });

  it('is a run in which something actually happened', () => {
    // A digest of a run that was refused from end to end would be perfectly stable and would pin
    // nothing. This says the pinned log is a real run: turns passed, fuel was spent, ground was
    // covered, and a floor was crossed.
    expect(PINNED_DIGEST.turnsElapsed).toBeGreaterThan(0);
    expect(PINNED_DIGEST.commandsResolved).toBeGreaterThan(PINNED_DIGEST.turnsElapsed);
    expect(PINNED_DIGEST.commandsResolved).toBeLessThan(PINNED_RECORD.commands.length);
    expect(PINNED_DIGEST.floorNumber).toBeGreaterThan(1); // it descended, so it drew
    expect(PINNED_DIGEST.remembered).toBeGreaterThan(20);
  });
});
