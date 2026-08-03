import { describe, expect, it } from 'vitest';
import { diveToTheBottom, headingTo, standUntilDead, stepTowardOnGrid } from '@/tests/unit/support/run-script';
import {
  CACHE_FUEL,
  CINDER,
  FUEL_BURN_LIT,
  FUEL_BURN_SHUTTERED,
  LAST_FLOOR,
  PLAYER_MAX_HP,
  STARTING_FUEL,
} from '../content';
import { isAdjacent, isAlive, playerOf } from '../entities';
import { hasBeenLit, hasTile, tileSetContains, tileSetsEqual } from '../fov';
import { expectedDrawCount, samePosition, tileAt } from '../map';
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

/**
 * Creatures that stopped living between two states, counted **by id**.
 *
 * The independent statement of what `GameState.kills` must equal. `killsBetween` in `state.ts`
 * subtracts living-creature *populations*, which is only equal to the number that died because
 * nothing spawns mid-floor, nothing resurrects, and nothing leaves a floor alive. This makes no such
 * assumption, so the two agreeing is evidence for those assumptions rather than a restatement.
 */
function killsByIdentity(before: GameState, after: GameState): number {
  if (floorNumberOf(before) !== floorNumberOf(after)) return 0;
  let count = 0;
  for (const actor of before.world.actors) {
    if (actor.kind !== 'creature' || !isAlive(actor)) continue;
    const survivor = after.world.actors.find((other) => other.id === actor.id);
    if (survivor === undefined || !isAlive(survivor)) count += 1;
  }
  return count;
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
    //
    // **Every tally accumulated here is asserted below.** A counter that is only printed is a
    // counter that can be set to zero without a single test going red, which is precisely the false
    // green this test exists to prevent.
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
    let woke = 0;
    let wounded = 0;
    let embers = 0;
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

      // The combat half of the simulation, measured per *run* rather than per state: how many of
      // the generated runs saw a creature awake, took a hit, and left an ember on the ground.
      let sawAwake = false;
      let sawEmber = false;
      let tookAHit = false;
      for (let i = 1; i < states.length; i += 1) {
        if (floorNumberOf(states[i]) !== floorNumberOf(states[i - 1])) descents += 1;
        const world = states[i].world;
        if (world.actors.some((actor) => actor.kind === 'creature' && actor.mind.kind === 'awake')) {
          sawAwake = true;
        }
        if (world.embers.length > 0) sawEmber = true;
        if (playerOf(world).hp < playerOf(states[i - 1].world).hp) tookAHit = true;
      }
      if (sawAwake) woke += 1;
      if (sawEmber) embers += 1;
      if (tookAHit) wounded += 1;
      if (final.status.kind === 'died') deaths += 1;
      if (final.status.kind === 'reachedBottom') wins += 1;
    });

    // Diagnostic only — vitest's default reporter hides console output on a green run, and
    // `--reporter=verbose` shows it. It is here to answer "by how much?" when one of the
    // assertions below starts to look marginal; it is not, and must never become, the assertion.
    console.log(
      `corpus: ${totalCommands} commands, ${descents} descents (deepest floor ${deepest}), ` +
        `${refusals} refusals, ${freeActions} free actions, ${woke} runs woke something, ` +
        `${wounded} took a hit, ${embers} saw an ember, ${deaths} deaths, ${wins} wins`,
    );

    expect([...kinds].sort()).toEqual(['descend', 'move', 'setShutter', 'wait']);
    expect(seeds.size).toBeGreaterThan(CASES / 2);
    expect(longest).toBeGreaterThanOrEqual(MAX_COMMANDS - 4);
    expect(empty).toBeGreaterThan(0); // the boundary case must appear
    expect(totalCommands).toBeGreaterThan(CASES * 8); // logs are not all trivially short
    // The things the properties below would otherwise assert about nothing.
    expect(descents).toBeGreaterThan(CASES / 4); // `descend` is the only command that draws
    expect(deepest).toBeGreaterThan(2); // and it happens more than once in a run
    expect(refusals).toBeGreaterThan(CASES); // refusals are exercised, not merely described
    expect(freeActions).toBeGreaterThan(CASES / 2);

    // The other half of the simulation (#16/#29). Without these, every property in this file could
    // be replaying runs in which nothing ever woke up — a corpus of a *lit* game and a corpus of a
    // game with the creature rules deleted would be indistinguishable.
    expect(woke).toBeGreaterThan(CASES / 2); // 90/120 at the time of writing
    expect(wounded).toBeGreaterThan(CASES / 4); // 57/120: creatures reach the player and land hits
    expect(embers).toBeGreaterThan(CASES / 5); // 47/120: things die and drop fuel

    // The thin one, kept deliberately: 3 in 120. A death needs a floor that spawned a creature
    // within reach of the entrance *and* a log that leaves the shutter open long enough for it to
    // arrive before the lantern runs dry — and the first half is a property of **generation**, not
    // of the command log. Steering the generator the way it is steered toward the stairs therefore
    // cannot make deaths reliable without curating the seeds, which would stop the corpus being
    // arbitrary and would quietly narrow every property above. So this stays a 1-in-40 assertion,
    // backed by the two pinned whole-run fixtures below that reach §13's ending on purpose.
    expect(deaths).toBeGreaterThan(0);

    // ...and a win is structurally out of reach: 60 commands cannot cross eight floors. This is
    // asserted rather than dropped because it is the boundary of what the corpus covers — the
    // `reachedBottom` ending, and the descent that draws nothing because there is no floor below,
    // are covered *only* by `whole runs replay` below. If this line ever fails, the corpus has
    // grown into that territory and this assertion should be deleted along with the sentence
    // pointing at the other test — not raised.
    expect(wins).toBe(0);
    expect(deepest).toBeLessThan(LAST_FLOOR);
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
    // §2: a refused action produces "no change to any field of the state". `commandsResolved` must
    // therefore equal the number of states that differ from their predecessor.
    //
    // **What this catches, precisely:** a resolved command that forgets to increment the counter,
    // and a counter incremented by something other than a resolution. What it does *not* catch is
    // a refusal that increments the counter and returns `{ ...state, commandsResolved: +1 }`: that
    // state is no longer identical to its predecessor, so `resolvedCount` counts it too and both
    // sides of this assertion move together. That mutant is killed by reference identity — `step`
    // must return *the input object* on a refusal — which is asserted in `step.test.ts`'s
    // `refusals` block, and by fifteen other tests besides. The two assertions are a pair, and this
    // one is only the second half of it.
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

  it('carries the seed it was started from, unchanged, for every seed a text field can produce', () => {
    // §13's summary shows the seed and Pillar 4 wants it shareable, so the one thing that must not
    // happen is a seed that comes back *nearly* right. The corpus includes the empty string and
    // non-ASCII seeds (asserted above), which is exactly what a trim, a lowercase, a `?? 'default'`
    // or a normalize would mangle — and every one of those would leave a run perfectly reproducible
    // while making the number printed on the screen unable to reproduce it.
    forEachRecord('seed', (record, index) => {
      const states = runStates(record.seed, record.commands);
      for (const state of states) {
        expect(state.seed, describeCase(record, index)).toBe(record.seed);
      }
      expect(replay(record).seed).toBe(record.seed);
    });
  });

  it('accumulates a tally that only ever grows, and never faster than a turn allows', () => {
    // §13's two summary numbers, as invariants rather than as values. Each bound is one a plausible
    // wrong implementation violates:
    //
    //   - **monotonic**: a `fuelBurned` computed as the turn's *net* fuel change goes backwards the
    //     turn an ember is collected, and a `kills` that diffed the creature list across a descent
    //     goes backwards on any floor that spawns more creatures than the one above.
    //   - **at most one burn per resolved command**: a burn metered on the wrong phase, or metered
    //     twice, exceeds this. `FUEL_BURN_LIT` is the maximum rate, and a refusal burns nothing.
    //   - **kills never exceed the creatures that have existed**: a `kills` that counted the sweep
    //     *and* the blow would double, and one that counted a descent's population change would run
    //     away entirely.
    forEachRecord('tally', (record, index) => {
      const states = runStates(record.seed, record.commands);
      const where = describeCase(record, index);

      expect(states[0].kills, where).toBe(0);
      expect(states[0].fuelBurned, where).toBe(0);

      let spawned = states[0].world.floor.creatures.length;
      for (let i = 1; i < states.length; i += 1) {
        const before = states[i - 1];
        const after = states[i];
        if (floorNumberOf(after) !== floorNumberOf(before)) {
          spawned += after.world.floor.creatures.length;
        }
        expect(after.kills - before.kills, `${where} at command ${i - 1}`).toBeGreaterThanOrEqual(0);
        expect(after.fuelBurned - before.fuelBurned, `${where} at command ${i - 1}`)
          .toBeGreaterThanOrEqual(0);
        expect(after.fuelBurned - before.fuelBurned, `${where} at command ${i - 1}`)
          .toBeLessThanOrEqual(FUEL_BURN_LIT);
        expect(after.kills, `${where} at command ${i - 1}`).toBeLessThanOrEqual(spawned);
      }

      const final = states[states.length - 1];
      expect(final.fuelBurned, where).toBeLessThanOrEqual(final.commandsResolved * FUEL_BURN_LIT);
    });
  });

  it('books fuel as burned, never as net of what was gathered', () => {
    // §4 gives fuel exactly two verbs — `burn` in phase 2, `refuel` in phase 5 — and a descent
    // carries the reserve across untouched. So for every state of every run:
    //
    //     lantern.fuel === STARTING_FUEL - fuelBurned + gathered,     gathered >= 0
    //
    // which makes `gathered` derivable (`state.ts` uses that to argue against storing it) and makes
    // this the sharpest available statement of what `fuelBurned` means. **The `>= 0` is the
    // assertion**: an implementation that netted the ember off the burn would produce a negative
    // `gathered` on exactly the turns a pickup happened, which is the failure this is aimed at.
    //
    // It is paired with a positive control, because on a run that never finds fuel the identity is
    // satisfied by `gathered === 0` everywhere and could not distinguish gross from net.
    let everGathered = 0;
    let biggestGather = 0;
    forEachRecord('gross-burn', (record, index) => {
      const states = runStates(record.seed, record.commands);
      let previous = 0;
      for (let i = 0; i < states.length; i += 1) {
        const where = `${describeCase(record, index)} at state ${i}`;
        const gathered = states[i].fuelBurned + states[i].lantern.fuel - STARTING_FUEL;
        expect(gathered, where).toBeGreaterThanOrEqual(0);
        // Income is never given back, either — nothing in the game removes fuel except the burn.
        expect(gathered, where).toBeGreaterThanOrEqual(previous);
        if (gathered > previous) {
          everGathered += 1;
          // ...and income arrives only when something was picked up off the floor. This is the
          // assertion that catches a meter reading `burnRate(shutter)` instead of what the lantern
          // actually lost: `burn` clamps at 0, so on the turn a run goes dry the rate over-states
          // the burn by whatever was not there — which shows up here as fuel appearing from nowhere
          // on a turn when no ember and no cache left the world.
          const took =
            states[i].world.embers.length < states[i - 1].world.embers.length ||
            states[i].world.floor.caches.length < states[i - 1].world.floor.caches.length;
          expect(took, `${where}: fuel appeared without anything being collected`).toBe(true);
        }
        biggestGather = Math.max(biggestGather, gathered - previous);
        previous = gathered;
      }
    });

    // The positive control. Without it, `gathered >= 0` above holds vacuously on a corpus in which
    // nothing was ever picked up — and a net-of-gathered implementation would pass the whole test.
    expect(everGathered, 'no run in the corpus ever collected any fuel').toBeGreaterThan(CASES / 5);
    // And what was collected arrived in ember- or cache-sized lumps rather than in dribbles, which
    // is what a meter that had confused income with the burn would produce. Stated as a floor, not
    // an equality: one turn can legally take several embers and a cache off the same tile.
    expect(biggestGather).toBeGreaterThanOrEqual(Math.min(CINDER.emberDrop, CACHE_FUEL));
  });

  it('counts the same kills whether you count populations or identities', () => {
    // A second, independent implementation of the same question. `killsBetween` subtracts *living
    // creature counts* and is correct only because nothing spawns, resurrects, or leaves a floor
    // alive; this counts *ids that stopped living*, which does not depend on any of that. The two
    // agree over the whole corpus, or one of those assumptions is false.
    //
    // The floor guard is shared and therefore not independently tested here — a descent is covered
    // by its own boundary test in `step.test.ts`.
    forEachRecord('kill-recount', (record, index) => {
      const states = runStates(record.seed, record.commands);
      let recounted = 0;
      for (let i = 1; i < states.length; i += 1) {
        recounted += killsByIdentity(states[i - 1], states[i]);
        expect(states[i].kills, `${describeCase(record, index)} at command ${i - 1}`).toBe(recounted);
      }
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

/**
 * A stored replay fixture, pinned at `RULES_VERSION` 6.
 *
 * Everything above proves the simulation reproduces *itself*. Nothing above notices if what it
 * reproduces silently changes — a different fuel burn, a reordered phase, a different seed
 * derivation, a generator that places stairs one tile over — because both sides of every comparison
 * move together. This is the tripwire for that, and it is the reason `RULES_VERSION` exists.
 *
 * **A digest rather than a whole state**, because a `GameState` is a floor: 165 tiles, six rooms,
 * seven doorways and a tile set, none of which is readable in a diff. It is nonetheless as wide as
 * a digest can be while staying readable — a narrow digest pins a narrow slice of the rules, and
 * the first version of this one held a single `creaturesAlive` count, which meant a fixture could
 * not have noticed a creature standing still all run, forgetting an intent, or never waking. So the
 * creatures go in whole: position, HP, and the entire `Mind` including the declared intent. Four
 * creatures is forty lines; 165 tiles is not.
 *
 * **`Mind` has shrunk twice and the digest shrank with it** — `awareness` in #83, `turnsSinceContact`
 * in #123 — which is the version policy working as intended rather than a loss of coverage: a field
 * these rules do not produce is a field a version-5 record carries and this build cannot match, and
 * that is exactly what the bump is for.
 *
 * These numbers are ground truth by definition: they were generated from this implementation. They
 * cannot prove the rules are *right*, only that they have not *changed*. If one of these fails, the
 * question is "did I mean to change the rules", not "how do I update the constants". If the answer
 * is yes: re-pin, bump `RULES_VERSION`, add a `RULES_VERSION_LOG` line, and say so in the journal.
 *
 * ## This projection is the one comparison in the file that does NOT widen by itself
 *
 * Every other property here goes through `findFieldDivergence`, which walks the **sorted union of
 * both sides' keys** — so a field added to `GameState` is compared from the moment it exists, with
 * no test edit. This digest is a hand-written subset and is therefore the exact shape the brief
 * warns about: a new run counter would be reproduced by the identity properties and pinned by
 * nothing, and `RULES_VERSION` would stop meaning what it says for that field.
 *
 * So **a new field on `GameState` belongs in this type**, and #21's two go in below with the
 * arithmetic that produces them written out beside them.
 *
 * `seed` deliberately does *not*: it would be `record.seed` copied into the expectation, which is a
 * constant restating its own input. It is pinned instead by `carries the seed it was started from`
 * over the 120-seed corpus, which is a stronger statement and a cheaper line.
 */
type Digest = {
  readonly status: string;
  readonly floorNumber: number;
  readonly turnsElapsed: number;
  readonly commandsResolved: number;
  /** §13's summary numbers, and the reason the header paragraph above exists. */
  readonly kills: number;
  readonly fuelBurned: number;
  readonly now: number;
  readonly fuel: number;
  readonly shutter: string;
  readonly senseRadius: number;
  readonly remembered: number;
  /**
   * §4's cache rule (#31/#41): tiles the **lantern** has lit, which is what makes a cache takeable.
   * Pinned separately from `remembered` because the two are equal on a run that never shutters and
   * on a run that never opens — so a digest holding only one of them would be blind to a bug that
   * grew the wrong plane on exactly the mixed runs the rule is about.
   */
  readonly revealed: number;
  readonly player: { readonly x: number; readonly y: number };
  readonly hp: number;
  /**
   * In `world.actors` order, not sorted. The order is itself part of the simulation — every phase
   * that sweeps the actors walks this array — so a change to it is a change worth failing on.
   */
  readonly creatures: readonly unknown[];
  readonly embers: readonly unknown[];
  readonly rng: { readonly s0: number; readonly s1: number; readonly s2: number; readonly s3: number };
};

function digest(state: GameState): Digest {
  return {
    status: state.status.kind,
    floorNumber: floorNumberOf(state),
    turnsElapsed: state.turnsElapsed,
    commandsResolved: state.commandsResolved,
    kills: state.kills,
    fuelBurned: state.fuelBurned,
    now: state.world.schedule.now,
    fuel: state.lantern.fuel,
    shutter: state.lantern.vision.shutter,
    senseRadius: state.lantern.vision.senseRadius,
    remembered: state.lantern.vision.remembered.flags.filter(Boolean).length,
    revealed: state.lantern.vision.revealed.flags.filter(Boolean).length,
    player: playerOf(state.world).at,
    hp: playerOf(state.world).hp,
    creatures: state.world.actors
      .filter((actor) => actor.kind === 'creature')
      .map((actor) => ({
        at: actor.at,
        hp: actor.hp,
        mind: actor.kind === 'creature' ? actor.mind : null,
      })),
    embers: state.world.embers,
    rng: state.rng,
  };
}

function expectPinned(record: RunRecord, pinned: Digest): void {
  const divergence = findFieldDivergence(digest(replay(record)), pinned);
  if (divergence) {
    throw new Error(
      `the pinned run no longer reproduces — the RULES did this, not the test\n` +
        formatFieldDivergence(divergence),
    );
  }
}

describe('pinned run — a descent in the dark', () => {
  const PINNED_RECORD: RunRecord = {
    version: 6,
    seed: 'emberdepth',
    // A dark crawl across floor 1 to its stairs, a descent, and three commands on the floor below —
    // one of which (the move north) is refused by the new floor's geometry, which is why the two
    // counters below disagree with the log length by different amounts.
    //
    // Nothing wakes on this run, and that is the *reason* for the second fixture below rather than
    // a defect in this one: shuttered play is exactly the half of the game this log covers.
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

  const PINNED_DIGEST: Digest = {
    status: 'running',
    floorNumber: 2,
    turnsElapsed: 14,
    commandsResolved: 16,
    // Nothing was ever fought on this log, so the whole 19 came out of the reserve and none of it
    // went back in: 80 - 19 == the 61 below, which is §4's conservation identity with `gathered`
    // at 0. 16 resolved commands, 15 of them shuttered at 1 fuel and the last one lit at 4.
    kills: 0,
    fuelBurned: 19,
    now: 200,
    fuel: 61,
    shutter: 'open',
    senseRadius: 5,
    remembered: 38,
    // Equal to `remembered`, and that is a fact about this log rather than a tautology: the last
    // command opens the shutter, and floor 2's touch tiles from the two commands before it are all
    // inside the lit field that follows. The third fixture below is the one where they differ.
    revealed: 38,
    player: { x: 6, y: 5 },
    hp: 12,
    // Floor 2's spawn, undisturbed: four Cinders, where the generator put them, all still asleep.
    creatures: [
      { at: { x: 1, y: 1 }, hp: 5, mind: { kind: 'dormant' } },
      { at: { x: 6, y: 1 }, hp: 5, mind: { kind: 'dormant' } },
      { at: { x: 1, y: 7 }, hp: 5, mind: { kind: 'dormant' } },
      { at: { x: 4, y: 14 }, hp: 5, mind: { kind: 'dormant' } },
    ],
    embers: [],
    rng: { s0: 997592408, s1: 1040665852, s2: 4214618089, s3: 90954535 },
  };

  it('reproduces the stored final state exactly', () => {
    expectPinned(PINNED_RECORD, PINNED_DIGEST);
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
    // §4's conservation identity with nothing gathered — this log never touched an ember or a
    // cache, so the burn accounts for the whole reserve. A `fuelBurned` pinned at the wrong number
    // fails here as well as against the digest, which is what stops this pair being re-pinned
    // together to whatever the implementation happens to say.
    expect(PINNED_DIGEST.fuelBurned).toBe(STARTING_FUEL - PINNED_DIGEST.fuel);
    expect(PINNED_DIGEST.kills).toBe(0);
  });
});

describe('pinned run — the whole combat loop, ending in a death', () => {
  /**
   * The second fixture, and the one that pins #16's and #29's half of the simulation.
   *
   * The record above is a shuttered crawl: no creature ever wakes in it, no ember is ever on the
   * ground, and the player's HP never moves. So `RULES_VERSION` was pinning generation, movement,
   * fuel, the shutter and descent — and *nothing at all* about waking, declaration, creature
   * movement, damage, the dormant-strike multiplier, ember drops or the ending. A rules change to
   * any of those could have shipped without a single fixture noticing.
   *
   * This log is one run of the whole loop, in order. Floor 1 of `ember-z` holds three Cinders — at
   * (6, 0), (10, 6) and (8, 8) — and the opening perception (§4: the entrance room is already on
   * screen) lights the last of them awake before the first command is issued, so the run starts
   * with something already coming. It is a lap of the floor's loop, anticlockwise, one step ahead of
   * a hunter that never stops.
   *
   *   1. **command 1** — shutter. Free (§2), and it drops ember-sense to the adaptation floor,
   *      which then climbs back to 5 over the four turns that follow (§4).
   *   2. **commands 2-10** — nine turns of retreat: north out of the entrance room, then west the
   *      whole length of the corridor at y=11. **The Cinder follows the whole way** — (8, 8)
   *      through the doorway at (9, 10) and along the corridor to (5, 11), eight tiles, **three
   *      behind the player at every frame** and never adjacent — which is §4's too-weak arm in
   *      miniature: same `ACTION_COST`, so a pursuer never closes on someone who keeps stepping
   *      away, and the gap is constant rather than shrinking. **Under version 5 it went dormant on
   *      command 10.** It does not any more, and everything from here on is the difference.
   *   3. **commands 11-22** — round the loop the long way: north through the doorway at (2, 10),
   *      east along y=9 through (5, 9), and up into the eastern room to (10, 7). Twelve more turns
   *      of being followed in the dark, and the reason the chase is 27 creature-steps rather than
   *      the eight the version-5 log could produce before its clock ran out.
   *   4. **command 23** — bump the sleeper at (10, 6). §3's dormant strike: 3 x 2 against 5 HP kills
   *      it outright, and phase 5 drops its ember where it stood. **At single damage the Cinder
   *      survives**, wakes, and every number below changes — which is what makes this fixture a pin
   *      on the multiplier and not just on "a fight happened". It is also the ruling's other half:
   *      the free kill is the one creature on this floor the run **never lit**.
   *   5. **command 24** — step onto the corpse's tile and collect the ember. Fuel goes *up*, from
   *      57 to 76, which is the one moment in the game where it does.
   *   6. **commands 25-31** — keep walking, north and west through the doorway at (7, 4) to (6, 3),
   *      still dark and still followed. **Seven turns of contact without a scratch, and command 26
   *      is the one to read**: the player steps from (10, 5) to (9, 5), which is *into* adjacency
   *      with the hunter at (9, 6), so it declares `attack at (9, 5)` — and command 27 steps to
   *      (8, 5) and the blow lands on an empty tile. That is §4's *movement is safety* and §2's
   *      *step off the marked tile* in one pair of commands, and it is a sharper demonstration than
   *      never being adjacent at all would have been. An earlier draft of this line claimed exactly
   *      that ("seven turns adjacent to nothing") and was simply false of the log.
   *   7. **command 32** — open. Free, and it wakes the third Cinder at (6, 0), three tiles up a
   *      clear column. This is the flash's price with nothing left to pay it with.
   *   8. **commands 33-37** — stand still, and be killed by the pair. Four landed turns out of five:
   *      two at 2 damage from the original hunter alone, then two at **4** once the newly-woken one
   *      arrives — 12 HP gone in four blows-worth of turns rather than six, which is §6's *"the
   *      second Cinder no longer times out behind the first"* as a number. `turnsElapsed` is 35
   *      while `now` is 3400 because §13 stops the turn where the killing blow lands and the clock
   *      never advances past it.
   *
   * ## Re-recorded for `RULES_VERSION` 6 (#121, #123), and the property that could not be preserved
   *
   * **This fixture has now been re-recorded twice, for the two halves of the same ruling.** The
   * version-4 → 5 re-record is described below; this one is version 5 → 6.
   *
   * **One of the six things this fixture existed for is gone and cannot come back: *a creature
   * returned to dormant*.** Under #123 nothing does, ever, so the assertion `nothing ever returned
   * to dormant (§6)` in the sibling test below is not rewritten into something that passes — it is
   * **inverted**, to `wentDormant === 0`, and it is now one of the strongest statements of the
   * ruling in the repo because this log contains 27 creature-steps taken entirely out of contact.
   * That is the honest disposal of a property whose subject was deleted: say what replaced it, and
   * do not pretend the count still means what it meant.
   *
   * Everything else the fixture pinned is pinned again, and three things are new. The **HP arithmetic
   * of the ruling** is visible in the last five commands (§4: a woken Cinder costs 2 HP, and two of
   * them cost 4 a turn). The **dead-player gate** is now visible in the final frame twice over: the
   * creature that struck the killing blow declared a `wait` over the body, while the one that had
   * already acted this turn still holds the `attack` it declared before the player fell — two
   * creatures, two different minds, and the difference is exactly where the sweep stopped (§13). And
   * **every creature killed in its sleep is one that was never woken**, asserted as an identity
   * between two counts reached from opposite directions; that is §1's *free kills exist only in the
   * dark* with the loophole re-dormancy left in it closed. It is an identity **by construction**
   * rather than a discriminator — an earlier draft claimed the clock returning separates the two
   * counts, and review measured that it does not. `wentDormant === 0` is what catches the clock.
   *
   * The version-5 log — retreat west nine, walk back east eight, flash, step north twice, wait —
   * cannot be re-pinned onto these rules, and this was **measured rather than assumed**. Replayed
   * under version 6 it ends `status: running`, with the player **alive at 10 HP**, `kills: 1`, and
   * both surviving creatures still dormant: the retreat never produces a sleeper, so the walk back
   * east meets the creature that has been following and fights it **awake** for 2 HP; the flash at
   * command 19 happens somewhere else entirely and wakes nothing; and nothing ever kills the player.
   * Re-pinning the digest onto that would have deleted **the dormant strike, the second wake and the
   * death** — three more of the things this fixture exists for, on top of the re-dormancy that the
   * rules deleted outright. That is precisely the "update the expected values" failure the version
   * policy in `replay.ts` is written against. So the *intent* was re-recorded — a retreat, a free
   * kill on something never lit, an ember hauled home, a flash that costs, a death — as a different
   * route around the same floor.
   *
   * ## Re-recorded for `RULES_VERSION` 5 (#83), not merely re-pinned
   *
   * The version-4 log did step 2 as two steps south and then eight turns alternating west and east
   * in the corner of the entrance room, because under the old rules breaking contact was enough and
   * standing anywhere would do. Under pursuit that shuffle is not a retreat: the Cinder walked
   * straight up to the player and the run became a stand-up fight with **no re-dormancy, no sleeper
   * to strike and no death** — replayed under those rules it ended with the player alive at 2 HP and
   * `status: running`. Re-pinning the digest onto that would have deleted three of the six things
   * this fixture exists for.
   *
   * **It would not have been *silent*, and the distinction is worth keeping** — an earlier draft of
   * this comment said it would. The digest is a `toEqual` on one final frame, so it would have gone
   * green; the sibling test below is what fails, on four separate assertions including `nothing ever
   * returned to dormant (§6)`. So the guard that caught this was the **trajectory** test, not the
   * pin. Read that as an argument for what a fixture should carry: a digest tells you a run changed,
   * and only a property assertion tells you *what stopped happening*. The temptation a version bump
   * creates is to refresh the digest and move on, and the digest is exactly the half that cannot
   * object. **It caught the version-6 change too**, and on the same assertion.
   *
   * Recorded by scripting exactly the sequence above against `step()` and storing the resulting
   * command log verbatim. It is stored, not regenerated: a fixture computed by a script at test
   * time changes silently whenever the script does, which is the one thing a fixture must not do.
   */
  const PINNED_RECORD: RunRecord = {
    version: 6,
    seed: 'ember-z',
    commands: [
      { kind: 'setShutter', to: 'shuttered' },
      { kind: 'move', dir: 'north' },
      { kind: 'move', dir: 'west' },
      { kind: 'move', dir: 'west' },
      { kind: 'move', dir: 'west' },
      { kind: 'move', dir: 'west' },
      { kind: 'move', dir: 'west' },
      { kind: 'move', dir: 'west' },
      { kind: 'move', dir: 'west' },
      { kind: 'move', dir: 'west' },
      { kind: 'move', dir: 'north' },
      { kind: 'move', dir: 'north' },
      { kind: 'move', dir: 'east' },
      { kind: 'move', dir: 'east' },
      { kind: 'move', dir: 'east' },
      { kind: 'move', dir: 'east' },
      { kind: 'move', dir: 'north' },
      { kind: 'move', dir: 'north' },
      { kind: 'move', dir: 'east' },
      { kind: 'move', dir: 'east' },
      { kind: 'move', dir: 'east' },
      { kind: 'move', dir: 'east' },
      { kind: 'move', dir: 'north' },
      { kind: 'move', dir: 'north' },
      { kind: 'move', dir: 'north' },
      { kind: 'move', dir: 'west' },
      { kind: 'move', dir: 'west' },
      { kind: 'move', dir: 'west' },
      { kind: 'move', dir: 'north' },
      { kind: 'move', dir: 'north' },
      { kind: 'move', dir: 'west' },
      { kind: 'setShutter', to: 'open' },
      { kind: 'wait' },
      { kind: 'wait' },
      { kind: 'wait' },
      { kind: 'wait' },
      { kind: 'wait' },
    ],
  };

  const PINNED_DIGEST: Digest = {
    status: 'died',
    floorNumber: 1,
    // 37 commands, 2 of them free (§2), so 35 turns...
    turnsElapsed: 35,
    commandsResolved: 37,
    // The Cinder felled in its sleep on command 23. **One, not zero**, and the difference is the
    // whole reason `kills` is not counted at phase 5: that kill's body *was* swept here (the player
    // survived that turn), but a losing run's last kill often is not, and the two must count alike.
    kills: 1,
    // 37 resolved commands, so 37 burns: 31 shuttered at 1 and 6 lit at 4 == 55. It is the *gross*
    // burn — the 20 collected off the corpse on command 24 does not come off it, which is what makes
    // 80 - 55 + 20 == the 45 below rather than 80 - 35. That identity is what pins this as fuel
    // *spent* rather than fuel *lost*.
    fuelBurned: 55,
    // ...and 34 actions on the clock, not 35: the killing blow stopped the turn before phase 4
    // advanced it (§13). The gap between these two numbers *is* the assertion.
    now: 3400,
    // 80 to start, minus the 55 above, plus the 20 off the corpse.
    fuel: 45,
    shutter: 'open',
    senseRadius: 5,
    remembered: 101,
    // **Not** equal to `remembered`, and that is the whole lap showing up in the fuel planes: 31 of
    // the 37 commands are taken with the lantern shut, so 38 tiles are remembered by touch alone
    // and were never revealed. Only the last flash, from (6, 3), adds anything to `revealed`.
    revealed: 63,
    player: { x: 6, y: 3 },
    hp: 0,
    creatures: [
      // **The two minds in this list are different, and the difference is §13's halt.** Both
      // creatures are adjacent to the corpse; ids sweep in ascending order, so on the last landed
      // turn — the fourth of four — this one resolved its attack first, taking the player **4 -> 2**,
      // declared another against a player who was still alive, and then the *next* creature's blow
      // ended the run at 2 -> 0. So it is frozen holding an `attack`. It is the one woken by command
      // 32's flash, three tiles up a clear column from (6, 0), and it only reached adjacency after
      // command 35 — which is why the last two turns cost 4 and the first two cost 2.
      {
        at: { x: 6, y: 2 },
        hp: 5,
        mind: { kind: 'awake', intent: { kind: 'attack', at: { x: 6, y: 3 } } },
      },
      // ...and this is the hunter that has been following since before command 1. It struck the
      // killing blow, then declared from a world with a dead player in it — which is the dead-player
      // gate in `nextMind` (#83, unchanged by #123): pursuit is refused rather than routed at a
      // corpse, so it holds a **wait**. Without the gate this reads `attack at (6, 3)`. The third
      // Cinder is absent from this list because the dormant strike on command 23 killed it.
      { at: { x: 7, y: 3 }, hp: 5, mind: { kind: 'awake', intent: { kind: 'wait' } } },
    ],
    // Dropped on command 23 and collected on command 24 — empty here because it was *taken*, which
    // the fuel above is what proves.
    embers: [],
    rng: { s0: 2164386907, s1: 420554115, s2: 1594873920, s3: 3421735554 },
  };

  it('reproduces the stored final state exactly', () => {
    expectPinned(PINNED_RECORD, PINNED_DIGEST);
  });

  it('is a run in which the whole combat loop actually happened', () => {
    // The digest above is one frame. These are the events *along* the way, which is what makes the
    // frame worth pinning — a fixture whose final state happens to match while nothing woke, fought
    // or died on the way to it would be pinning a coincidence. Asserted from the trajectory rather
    // than from stored constants on purpose: the claim is about the shape of the run, and a shape
    // does not need re-pinning when a tuning number moves.
    const states = runStates(PINNED_RECORD.seed, PINNED_RECORD.commands);
    const start = states[0];
    const final = states[states.length - 1];

    const awake = (state: GameState): number =>
      state.world.actors.filter((actor) => actor.kind === 'creature' && actor.mind.kind === 'awake').length;
    const alive = (state: GameState): number =>
      state.world.actors.filter((actor) => actor.kind === 'creature' && isAlive(actor)).length;

    let woke = 0;
    let wentDormant = 0;
    let declaredAnAttack = 0;
    let creatureMoved = 0;
    let hitsTaken = 0;
    let damageTaken = 0;
    let doubleTeamed = 0;
    let emberDrops = 0;
    let embersCollected = 0;
    let felledInOneBlowWhileAsleep = 0;
    let felledWithoutEverWaking = 0;
    let pursuedInTheDark = 0;
    const everAwake = new Set<number>();

    for (let i = 1; i < states.length; i += 1) {
      const before = states[i - 1].world;
      const after = states[i].world;
      const shuttered = states[i].lantern.vision.shutter === 'shuttered';
      woke += Math.max(0, awake(states[i]) - awake(states[i - 1]));
      const damage = playerOf(before).hp - playerOf(after).hp;
      if (damage > 0) {
        hitsTaken += 1;
        damageTaken += damage;
        if (damage > CINDER.attack) doubleTeamed += 1;
      }
      if (after.embers.length > before.embers.length) emberDrops += 1;
      if (after.embers.length < before.embers.length) embersCollected += 1;
      for (const actor of before.actors) {
        if (actor.kind !== 'creature') continue;
        if (actor.mind.kind === 'awake') everAwake.add(actor.id);
        const now = after.actors.find((other) => other.id === actor.id);
        if (now === undefined) {
          // §3: "a strike against a dormant creature deals double damage." Full HP one command ago,
          // gone the next — 3 x 2 against a 5 HP Cinder, in one blow, while it slept.
          if (actor.mind.kind === 'dormant' && actor.hp === CINDER.maxHp) felledInOneBlowWhileAsleep += 1;
          if (!everAwake.has(actor.id)) felledWithoutEverWaking += 1;
          continue;
        }
        if (now.kind !== 'creature') continue;
        if (actor.mind.kind === 'awake' && now.mind.kind === 'dormant') wentDormant += 1;
        if (now.mind.kind === 'awake' && now.mind.intent.kind === 'attack') declaredAnAttack += 1;
        if (!samePosition(actor.at, now.at)) creatureMoved += 1;
        if (shuttered && !samePosition(actor.at, now.at) && !isAdjacent(now.at, playerOf(after).at)) {
          pursuedInTheDark += 1;
        }
      }
    }

    expect(woke, 'nothing ever woke up').toBe(1);
    // §4 (#83): a woken Cinder pursues. Twenty-seven steps taken with the lantern shut and without
    // ever reaching the player — through two doorways and most of a lap of the floor — which is the
    // one thing in this log the rules that preceded version 5 could not produce: they walked a
    // creature to the player's last-known tile, at most two steps here, and then parked it. Counted
    // rather than pinned as a position because the body is gone by the final frame, so the digest
    // cannot see it.
    expect(pursuedInTheDark, 'nothing chased the player in the dark (§4)').toBe(27);
    expect(declaredAnAttack, 'nothing ever declared an attack').toBeGreaterThan(0);
    expect(creatureMoved, 'no creature ever moved').toBeGreaterThan(0);

    // ═══ #123: THE PROPERTY THIS FIXTURE USED TO PIN, INVERTED ═══
    //
    // This assertion used to read `expect(wentDormant, 'nothing ever returned to dormant (§6)')
    // .toBeGreaterThan(0)` — one of the six things the fixture existed for. #121 ruled the behaviour
    // out of the game, so the count is now **zero by rule** and the assertion is the opposite claim.
    // It is not a weaker test: the 27 out-of-contact pursuit steps above are what would have driven
    // the old eight-turn clock to expiry three times over, so restoring `TURNS_TO_REDORMANCY` fails
    // this line, and the digest, and `nothing ever woke up` — because the version-5 rules put a
    // creature to sleep in this log at command 10.
    expect(wentDormant, 'a woken Cinder returned to dormant (§4, #123)').toBe(0);

    // §3's dormant strike, and phase 5 dropping the ember where the body fell. At single damage the
    // Cinder survives the blow and none of these four hold.
    expect(alive(start) - alive(final), 'nothing died').toBe(1);
    expect(felledInOneBlowWhileAsleep, 'nothing was killed in its sleep (§3)').toBe(1);

    // ═══ #123's other half, and it is the EQUALITY that is the property, not either count ═══
    //
    // §4: a creature you woke can only ever be killed awake, so **every creature killed in its sleep
    // is one that was never woken**. Asserted as an identity between two counts arrived at from
    // opposite directions — one reads the mind and the HP at the moment of death, the other watches
    // whether the id was ever in `everAwake` across the whole run.
    //
    // **Named honestly: "never woken", not "never lit."** Nothing in the state says whether a
    // creature was ever inside the lit radius — a creature woken by a *surviving strike* was never
    // lit and would still count as woken here — so the counter measures wakefulness and the name
    // says so. An earlier draft called it `felledWithoutEverBeingLit` and claimed it as a second,
    // distinct property; it is neither, on its own. **The equality is.**
    //
    // **An earlier draft claimed "restoring the clock breaks it". Review measured that and it is
    // false**: replaying *this* log under `c422315`, with the clock present, gives
    // `felledInOneBlowWhileAsleep 1`, `felledWithoutEverWaking 1` — equal. The creature that goes
    // dormant under the clock is never struck, because this log's route never returns to y=11.
    //
    // So be exact about what this line is. Under the current rules the two counts are equal **by
    // construction** — a woken creature can never be dormant, and a dormant creature is always at
    // full HP because a survived strike wakes it — and no rules mutant tried here separates them. It is
    // an **identity, not a discriminator**, and it is kept as a statement of §1's *free kills exist
    // only in the dark* with re-dormancy's loophole closed, not as a guard.
    //
    // **The assertion that actually kills the clock mutant on this log is `wentDormant === 0`, two
    // lines above** — measured at 1 with the clock restored. That is the one to protect.
    expect(felledWithoutEverWaking, 'a creature was killed asleep after having been awake')
      .toBe(felledInOneBlowWhileAsleep);
    expect(emberDrops, 'no ember was ever dropped').toBe(1);
    expect(embersCollected, 'the dropped ember was never collected').toBe(1);

    // §13's death, and §4's HP arithmetic underneath it. The whole 12 HP goes, but over **four**
    // landed turns rather than six: the last two are 4 damage because the flash on command 32 woke
    // a second hunter and it arrived while the first was still swinging. That is §6's *"the second
    // Cinder no longer times out behind the first"* — under version 5 it had eight turns in which to
    // fall asleep, and here it has none. Both halves asserted, because `damageTaken` alone is
    // satisfied by six ordinary blows and `hitsTaken` alone by four of any size.
    expect(damageTaken).toBe(PLAYER_MAX_HP);
    expect(hitsTaken).toBe(4);
    expect(doubleTeamed, 'no turn was fought against two hunters at once').toBe(2);
    expect(final.status).toEqual({ kind: 'died' });
    expect(playerOf(final.world).hp).toBe(0);

    // §13's summary numbers, cross-checked against the trajectory rather than against the stored
    // digest — two independent counts of the same events. `kills` is accumulated one turn at a time
    // inside `step`; `alive(start) - alive(final)` is read off the two ends of the run, and
    // `felledInOneBlowWhileAsleep` is counted by watching creatures leave `world.actors`. All three
    // must agree, and a `kills` wired to the wrong phase agrees with none of them.
    expect(final.kills).toBe(alive(start) - alive(final));
    expect(final.kills).toBe(felledInOneBlowWhileAsleep);
    // The gross-burn identity, with a gather in it this time: the 20 off the corpse is *income*, and
    // it is what makes this run's `fuelBurned` exceed `STARTING_FUEL - fuel` by exactly one ember.
    expect(final.fuelBurned).toBe(STARTING_FUEL - final.lantern.fuel + CINDER.emberDrop);
    expect(final.fuelBurned).toBeGreaterThan(STARTING_FUEL - final.lantern.fuel);
  });
});

describe('pinned run — a cache the lantern found, hauled home in the dark', () => {
  /**
   * The third fixture, and the one #31/#41 owes the tripwire: **no stored run took a cache.**
   *
   * The two above pin generation, movement, fuel, the shutter, descent and the whole combat loop,
   * and neither of them ever picks a cache up — so §4's cache rule could have been written, or
   * un-written, without a single fixture noticing. This log is the rule end to end, and it is the
   * only fixture in the repo where `remembered` and `revealed` differ **on the tile that is paid
   * for**. (The combat fixture's two planes also differ since its retreat was re-recorded for #83,
   * but nothing there ever stands on a cache, so it says nothing about the rule.)
   *
   * `cache-haul`'s floor 1 holds two caches, at (7, 6) and (9, 9).
   *
   *   1. **command 1** — shutter. The run opens lit (§4) and the entrance room is already revealed;
   *      this is where the crawl starts.
   *   2. **commands 2-13** — twelve turns of dark crawl to the tile above the cache at (7, 6). The
   *      cache is felt as ordinary floor the whole way and pays nothing, which is #41's half of the
   *      ruling. Nothing wakes: §4 says nothing wakes in the dark.
   *   3. **command 14** — `setShutter open`. Free (§2), 4 fuel, and phase 3 folds the lit field into
   *      `revealed`. **It also wakes a Cinder**, which is §4's price of a flash and is why the
   *      creature below is `awake` with a declared move.
   *   4. **command 15** — `setShutter shuttered`, before a single step is taken. This is the
   *      fixture's point: the pickup that follows happens with the lantern **shut**, so it pins
   *      *ever* lit rather than *currently* lit. Under the rejected reading it pays nothing and
   *      every number below changes.
   *   5. **command 16** — step south onto the cache. Phase 5 pays 25, the tile becomes floor, and
   *      (7, 6) leaves `floor.caches`. (9, 9) is still there, untouched and unlit.
   *
   * Recorded by running `takeACacheTheLanternFound('cache-haul')` once and storing the resulting log
   * verbatim — stored, not regenerated, for the reason the fixture above gives.
   */
  const PINNED_RECORD: RunRecord = {
    version: 6,
    seed: 'cache-haul',
    commands: [
      { kind: 'setShutter', to: 'shuttered' },
      { kind: 'move', dir: 'east' },
      { kind: 'move', dir: 'south' },
      { kind: 'move', dir: 'east' },
      { kind: 'move', dir: 'south' },
      { kind: 'move', dir: 'east' },
      { kind: 'move', dir: 'east' },
      { kind: 'move', dir: 'south' },
      { kind: 'move', dir: 'east' },
      { kind: 'move', dir: 'east' },
      { kind: 'move', dir: 'south' },
      { kind: 'move', dir: 'south' },
      { kind: 'move', dir: 'west' },
      { kind: 'setShutter', to: 'open' },
      { kind: 'setShutter', to: 'shuttered' },
      { kind: 'move', dir: 'south' },
    ],
  };

  const PINNED_DIGEST: Digest = {
    status: 'running',
    floorNumber: 1,
    // 16 commands, 2 of them free (§2), so 13 turns.
    turnsElapsed: 13,
    commandsResolved: 16,
    kills: 0,
    // 15 shuttered commands at 1 and the one `open` at 4. The 25 off the cache is income and does
    // not come off it: 80 - 19 + 25 == the 86 below.
    fuelBurned: 19,
    now: 1300,
    fuel: 86,
    // Shut on command 15 and never reopened — so the collection on command 16 happened in the dark.
    shutter: 'shuttered',
    // One turn of §2 phase 6 since the shutter closed: the ramp is at 2, not at 5. A second
    // statement of the same fact, because a fixture that collected while lit would read 'open' here.
    senseRadius: 2,
    // **The two planes disagree, and that is the assertion.** 69 tiles perceived, 61 of them lit by
    // the lantern: the difference is the eight-odd tiles this run only ever felt. On the fixtures
    // above the two numbers are equal, so this is the only place a bug that grew `revealed` from
    // touch — which would hand the dark every cache on the floor again — is visible.
    remembered: 69,
    revealed: 61,
    player: { x: 7, y: 6 },
    hp: 12,
    creatures: [
      // Woken by the flash on command 14 and coming: §4's price, paid in the same breath as the
      // cache was found.
      {
        at: { x: 6, y: 7 },
        hp: 5,
        mind: { kind: 'awake', intent: { kind: 'move', to: { x: 6, y: 6 } } },
      },
      { at: { x: 10, y: 8 }, hp: 5, mind: { kind: 'dormant' } },
      { at: { x: 4, y: 12 }, hp: 5, mind: { kind: 'dormant' } },
    ],
    embers: [],
    rng: { s0: 1846781296, s1: 3875458717, s2: 4216625777, s3: 1218200354 },
  };

  it('reproduces the stored final state exactly', () => {
    expectPinned(PINNED_RECORD, PINNED_DIGEST);
  });

  it('took the cache in the dark, and only the one the lantern had lit', () => {
    // The digest above is one frame; this is the trajectory that makes the frame worth pinning, and
    // it is where the ruling's three clauses are checked as events rather than as a fuel total.
    const states = runStates(PINNED_RECORD.seed, PINNED_RECORD.commands);
    const start = states[0];
    const final = states[states.length - 1];
    const taken = { x: 7, y: 6 };

    // The setup this whole fixture rests on: the cache was there at the start, and the player's
    // route ends on its tile. Without this the assertions below are about an empty tile.
    expect(start.world.floor.caches).toContainEqual(taken);
    expect(playerOf(final.world).at).toEqual(taken);

    // #41: the crawl felt the ground around the cache without the lantern ever showing it. So at
    // the moment before the flash, the tile the player is about to stand on has been *perceived*
    // and has **not** been lit — which is the exact state the rejected "skip the tile" reading
    // could not represent.
    const beforeTheFlash = states[13];
    expect(beforeTheFlash.lantern.vision.shutter).toBe('shuttered');
    expect(hasTile(beforeTheFlash.lantern.vision.remembered, taken.x, taken.y)).toBe(true);
    expect(hasBeenLit(beforeTheFlash.lantern.vision, taken.x, taken.y)).toBe(false);
    // ...and it was still a cache: nothing was collected or consumed by walking past it.
    expect(tileAt(beforeTheFlash.world.floor.grid, taken.x, taken.y).kind).toBe('cache');
    expect(beforeTheFlash.lantern.fuel).toBe(STARTING_FUEL - 13);

    // #31: the flash reveals it, the shutter closes again, and the payout lands on a turn with the
    // lantern shut. `fuel` going *up* while `shutter` is `shuttered` is the ruling in one line.
    const flashed = states[14];
    expect(hasBeenLit(flashed.lantern.vision, taken.x, taken.y)).toBe(true);
    const shut = states[15];
    expect(shut.lantern.vision.shutter).toBe('shuttered');
    expect(final.lantern.fuel).toBe(shut.lantern.fuel - FUEL_BURN_SHUTTERED + CACHE_FUEL);
    expect(tileAt(final.world.floor.grid, taken.x, taken.y).kind).toBe('floor');

    // And exactly one cache moved. The floor's other cache at (9, 9) is inside the same flash, so
    // it is *revealed* and still sitting there — which is the third thing worth pinning here:
    // **lighting a cache does not take it.** Phase 3 reveals, phase 5 pays, and only for the tile
    // the player is standing on. A revealing phase that also collected would empty this list.
    expect(start.world.floor.caches).toHaveLength(2);
    expect(final.world.floor.caches).toEqual([{ x: 9, y: 9 }]);
    expect(hasBeenLit(final.lantern.vision, 9, 9)).toBe(true);
    expect(tileAt(final.world.floor.grid, 9, 9).kind).toBe('cache');

    // The other half of the plane's shape: `revealed` is a strict subset of `remembered`, over every
    // state of the run. Equality would mean touch was growing it; a tile in `revealed` and not in
    // `remembered` would mean the lantern lit ground the player never perceived.
    let sawADifference = false;
    for (const state of states) {
      const vision = state.lantern.vision;
      expect(tileSetContains(vision.remembered, vision.revealed)).toBe(true);
      if (!tileSetsEqual(vision.remembered, vision.revealed)) sawADifference = true;
    }
    expect(sawADifference, 'the two planes were identical all run').toBe(true);
  });
});
