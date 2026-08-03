import { describe, expect, it } from 'vitest';
import { generateFloor } from '../map';
import { createRng } from '../rng';
import { PLAYER_ID } from '../entities';
import { tileSetSize } from '../fov';
import { wakeInLight } from './actors';
import { createLanternWorld, lanternPhases, setShutterTurn, type LanternWorld } from './light';
import { ACTION_COST, chargeActor, hasActor, nextActAtOf } from './schedule';
import { resolveTurn } from './turn';

/**
 * ARCHITECTURE.md gives one turn a **2ms** budget and says to add a benchmark when touching field of
 * view, "since those are where it historically goes wrong". This module does not change FOV — it
 * *consumes* it, twice per command, which is the same exposure from the other side:
 *
 *   - phase 3 computes the perceived field once, to fold into terrain memory;
 *   - phase 3 then builds the light query, which is a second lit field.
 *
 * Recomputing rather than threading one field through is a deliberate correctness choice (each phase
 * must see the lighting as it stands *at that phase*), so the thing to watch is the price of that
 * choice — with, on a busy floor, six creatures flooding the grid in phase 4 on top of it.
 *
 * ## Two commands, because they run different phases and go wrong differently
 *
 * `resolveTurn` is the same six-phase fold either way, but a **paid** command and a **free** one run
 * different subsets of it, so each gets its own fixture and its own worst case:
 *
 *   - **a lit turn**, on a floor where every creature is awake and due: six declarations and six
 *     resolutions in phase 4, on top of phase 3's two casts;
 *   - **a flash**, the shutter opening on a dark floor of sleepers: phase 3 casts and then asks the
 *     light query once per sleeper, waking whoever the light reached — and phase 4 is skipped
 *     entirely, which is what "free" means (§2, and `actors.ts` on why it is skipped rather than
 *     merely uncharged).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE FIXTURE IS THE MEASUREMENT, AND BOTH FIXTURES HAD STOPPED BEING ONE (#125, #133)
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Each test below opens with assertions about what the measured command *does*, and that half is
 * more important than the timing half. Both benchmarks here were measuring almost nothing, for
 * months, while a guard sat above them saying they were fine:
 *
 *   - **The lit turn measured a turn in which no creature acted.** `busyLitFloor` force-wakes six
 *     creatures on an *uncharged* world — the player is due at 0 — and under the pre-ADR-0014 rule a
 *     woken creature joined at `now + ACTION_COST`, i.e. 100. Phase 4 of the measured turn therefore
 *     found nothing due at 0 and merely advanced the clock. The guard read
 *     `actors.some(a => a.mind.kind === 'awake')`, under the comment *"a benchmark of a floor of
 *     sleepers measures the wrong turn entirely"* — and awake-but-not-due is exactly the state it
 *     could not distinguish from awake-and-acting. Under the ruling the six join at `now` and act in
 *     the measured turn, and the price of the difference is **~8x**: with that one line reverted the
 *     same fixture measures 0.0125-0.0130ms, and with it in place 0.1002-0.1050ms. (The review that
 *     found this measured 0.0119-0.0136 and 0.1019-0.1041 on another machine, which is the same 8.)
 *   - **The flash measured the shutter *shutting*.** It ran `setShutterTurn(state, 'shuttered')` on
 *     an already-open floor, so phase 3 took the dark path: `perceive` felt 9 tiles by touch,
 *     `lanternLight` returned `DARK` without casting anything, and `wakeInLight` skipped all six
 *     creatures at `isAwake` without asking the query once. It measured **0.0024-0.0033ms**, which is
 *     *less than one lit field* (`fov.bench.test.ts`: ~0.0036ms), under a comment claiming it ran
 *     "the lighting recompute that wakes the room". The direction that does run it measures
 *     **0.0347-0.0373ms** — **~13x** more, and it is the direction a player pays for.
 *
 * The clock is no help in telling these apart and neither is `awake`: phase 4 advances `now` by
 * `ACTION_COST` whether or not anything was due, and a creature is awake whether or not it is owed a
 * turn. So the guards below observe the *work*: who was charged for an action, who is standing
 * somewhere new, and whether any terrain was lit. See `creatureWorkIn`.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## Reading a failure here
 *
 * This is a timing test and can fail for reasons that are not about the code — a loaded CI machine,
 * a cold JIT. It warms up and takes a median of batches, and each batch is sized to **~10ms of work
 * in both tests**, which is a correction: the old flash batch was 100 calls of a 0.0026ms command,
 * i.e. 0.26ms, and a batch that short is mostly measuring whatever else the box did during it.
 * Measured, over three whole-suite runs on two pinned cores, the 0.26ms batch spanned **1.7x**
 * between its cheapest and dearest reading while the turn's 10ms batch spanned **1.07x** in the same
 * three runs; on the runner the flash read 9.6x its quiet figure against the turn's 4.5x.
 * `step.bench.test.ts` records the extreme version — a 0.035ms batch producing a 250x distortion.
 * Equal batch duration does not make the two subjects equally steady — the cheaper one is still the
 * noisier, and `FLASH_BUDGET_MS` carries the measurement — but it takes the worst of it out.
 *
 * **Calibrate against `npm test`, never against this file alone**, for the same reason that file
 * says it: 62 files running in parallel workers is the only condition these numbers are ever taken
 * under, and it is far noisier than a single-file run. Both figures below are given both ways.
 *
 * If it fails intermittently near a threshold, say so in the journal rather than quietly raising the
 * number: the budget is a design constraint from ADR-0004, not a knob. **The change below is not
 * that case** — the workload changed, because both fixtures started exercising the phases they claim
 * to, so the old figures and the argument built on them moved with them.
 */

/**
 * Half of ARCHITECTURE's 2ms, for a command that **is** a whole turn.
 *
 * This used to be `0.2`, "a fifth of 2ms", justified by *"a lit turn measures at ~0.014ms here, so
 * this still allows a fourteen-fold regression"*. Both halves of that were built on the turn in
 * which nothing acted (see above), and 0.2 failed on a GitHub runner at **0.4776ms** with nothing
 * wrong with the code, which is the shape of a threshold set from a fake measurement.
 *
 * What is measured now is all six phases on the busiest state floor 8 produces, so the number to
 * take a fraction *of* is the whole-turn budget itself rather than a share of it — and half of it
 * says the busiest turn in the game must fit in half the time a turn is allowed, which is a
 * constraint a player-facing frame has to leave room in anyway.
 *
 * **The multiple, measured rather than hoped for.** Three conditions, worst reading of each:
 *
 * | condition | readings | limit is |
 * | --- | --- | --- |
 * | this file alone, 10 runs | 0.1002-0.1050ms | 9.5x the worst |
 * | the whole suite, 11 runs | 0.1153-0.1982ms | 5.0x the worst |
 * | the whole suite on a GitHub runner | 0.4776ms then 0.5289ms | 1.89x the worse |
 *
 * The runner row started as a single reading, `0.4776ms, once`, and the green run after this rewrite
 * read **0.5289ms** — so the margin is 1.89x and not the 2.1x first written here. Two points, both on
 * the same box, 11% apart: quote the row, not a single figure.
 *
 * The third is the failing run this rewrite comes from, and it is the one that sets the number: a
 * threshold under ~0.5ms is one the machine CI actually uses has already been observed to cross with
 * nothing wrong. Note also the second row against the first — running the other 61 files alongside
 * it costs up to 2x, so a limit calibrated from a single-file run would be wrong by that much before
 * a runner is even involved.
 *
 * That is the trade, stated plainly: an absolute millisecond threshold a shared runner cannot trip
 * has to leave an order of magnitude on a quiet one, so **this catches a ten-fold regression here
 * and roughly a doubling on the slowest box we have measured**. It does not catch a 2x algorithmic
 * regression on a fast machine, and nothing absolute can. `step.bench.test.ts` holds a turn to a
 * *ratio* against a lit field measured in the same process for exactly that reason, and the ratio is
 * what survives a change of machine: this turn against `fov.bench.test.ts`'s lit field measures
 * **25.1, 29.2, 31.4, 32.1 and 34.0x** across five readings on two machine classes — a spread of **at
 * least ~36%** off the minimum, against a machine gap of **4.5x** in the absolute numbers.
 *
 * **State that as a floor and as unstable, not as a figure.** This number has now been quoted three
 * times from the narrowest sample available — 7% from two points, 16% from four, ~36% from five — and
 * widened by the next run every time. Each draft was the honest reading of the data then in hand,
 * which is exactly why the *shape* of the claim has to carry the uncertainty rather than the digits.
 * The argument is unharmed at any of them: 36% against a 4.5x absolute spread is still an order of
 * magnitude better than anything absolute, and this is measured across two files in separate workers,
 * which a paired in-process harness would improve on. That is measured across two files rather than in
 * one process, so the real instrument would be steadier still. Converting this file to it is how these thresholds start to bite; it needs that
 * harness extracted from `step.bench.test.ts` first, which is more than a benchmark fix.
 */
const TURN_BUDGET_MS = 1;

/**
 * A fifth of the 2ms, for a command that costs no turn.
 *
 * A flash runs strictly less than a turn — phases 1, 2, 3 and 5, never 4 or 6 — and costs about a
 * third of one: **0.0347-0.0373ms** over ten runs of this file alone, **0.0397-0.0843ms** over eleven
 * whole-suite runs. That second spread is 2.1x wide against the turn's 1.7x over the same runs — a
 * cheaper subject is a noisier one even at the same batch duration, which is an argument for keeping
 * its margin generous rather than for trusting it further.
 *
 * **A runner has now measured it, and this constant was set before it had.** The first draft reasoned
 * *"no runner has measured this fixture yet"* and inferred ~0.2ms from the turn's machine factor,
 * landing on 0.4. The green run reads **0.1070ms**, which makes 0.4 **3.7x** the runner against the
 * turn's 1.89x — the two constants had drifted into different postures, which is the one thing
 * setting them separately was supposed to prevent. Tightened to **0.3**: about **2.3x** the worse of two runner readings
 * and **4x** the worst reading here, matching the turn. An inference left standing where a
 * measurement exists is [ADR-0013](../../docs/decisions/0013-a-claim-about-the-build-is-established-by-measurement.md)'s
 * subject, and this file is otherwise scrupulous about it.
 *
 * **And then 0.25 was itself set from a one-point sample, which is the same mistake one size down.**
 * The next runner read **0.1414ms** — 1.32x the first reading on the same machine class — putting
 * 0.25 at **1.77x**, the tightest margin of any constant here and tighter than the turn's own posture
 * (1.89x at its worst). Two runner readings, quoted as a row rather than a figure:
 *
 * | run | flash |
 * | --- | --- |
 * | 30831088439 | 0.1070ms |
 * | 30835191393 | 0.1414ms |
 *
 * **0.3** holds the stated ~2.3x-the-worst-runner posture against the worse of the two. It changes
 * nothing about what the guard catches — the 1.4x planted regression below sails under 0.25 and 0.3
 * alike — so the choice is purely flake risk, which argues for the looser of two equally toothless
 * numbers. **Do not tighten this from a single green run**; that is now the third time in this file's
 * history that a constant was set from the narrowest sample available and the next run widened it.
 *
 * It is a separate constant rather than a shared one because a single limit across two workloads
 * that differ threefold is a limit that enforces nothing on the cheaper of them — the file's own
 * standard, from `fov.bench.test.ts`: *a threshold a fifty-fold regression satisfies enforces
 * nothing*. What this one does **not** catch is worth naming too, so nobody assumes more than is
 * there: recomputing the lit field per light query instead of closing over it — the invariant
 * `light.ts`'s header states, and the bug `step.bench.test.ts` says "belongs to
 * `light.bench.test.ts`'s busy floor" — plants six extra casts in this exact fixture and measures
 * 0.0492-0.0515ms, **1.4x**, which sails under 0.3 the same way it sails under the 5x there. This is
 * now the fixture that *asks* the query six times, which it was not before, so a ratio limit here
 * would catch it; an absolute one never will.
 */
const FLASH_BUDGET_MS = 0.3;

const WARMUP = 50;
const BATCHES = 5;
/**
 * Calls per timed batch, per subject: enough that a batch is ~10ms of work in both tests.
 *
 * Equal wall time per batch is the point, not equal call counts — see the header, and
 * `step.bench.test.ts` for the 250x distortion a 0.035ms batch produced on a runner.
 */
const TURN_BATCH = 100; // ~0.105ms each  -> ~10.5ms a batch
const FLASH_BATCH = 300; // ~0.035ms each -> ~10.5ms a batch

function wait(state: LanternWorld): LanternWorld {
  return resolveTurn(
    state,
    lanternPhases('costsATurn', (current) => ({
      lantern: current.lantern,
      world: { ...current.world, schedule: chargeActor(current.world.schedule, PLAYER_ID) },
    })),
  );
}

function medianCost(
  state: LanternWorld,
  once: (s: LanternWorld) => LanternWorld,
  batchSize: number,
): number {
  for (let i = 0; i < WARMUP; i += 1) once(state);

  const costs: number[] = [];
  for (let batch = 0; batch < BATCHES; batch += 1) {
    const started = performance.now();
    for (let i = 0; i < batchSize; i += 1) once(state);
    costs.push((performance.now() - started) / batchSize);
  }
  return costs.sort((a, b) => a - b)[Math.floor(BATCHES / 2)];
}

/** What a command did to the creatures on the floor — the evidence that it did any work at all. */
type CreatureWork = {
  readonly creatures: number;
  /**
   * Creatures charged for exactly one action, which is what taking a turn *is*: `runActorPhase`
   * charges an actor and then resolves its declared action, so a slot that moved on by `ACTION_COST`
   * is an action that resolved. A creature that is merely awake, or merely scheduled, moves nothing.
   */
  readonly acted: number;
  /** ...and how many are standing somewhere new because of it. */
  readonly moved: number;
  /** How far the clock moved. Not evidence of anything acting; see the header. */
  readonly elapsed: number;
  /**
   * Tiles `revealed` **grew by** — terrain the lit field reached.
   *
   * A delta and not a size, deliberately. The first draft of the flash guard asserted
   * `tileSetSize(revealed) > 0` on the after-state, which is a **state** assertion: the one class
   * this file exists to remove. It meant the right thing only because the fixture is constructed
   * fresh two lines above it — a fixture that ran any lit command before the measured flash would
   * satisfy it vacuously *while phase 3 took the dark path*, which is exactly the failure it was
   * written to catch. Found in review of #133.
   */
  readonly lit: number;
};

/** Creatures still asleep — the ones §2 phase 3 has to ask the light query about. */
function dormantCreatures(state: LanternWorld): number {
  return state.world.actors.filter(
    (actor) => actor.kind === 'creature' && actor.mind.kind === 'dormant',
  ).length;
}

function creatureWorkIn(before: LanternWorld, after: LanternWorld): CreatureWork {
  let creatures = 0;
  let acted = 0;
  let moved = 0;

  for (const was of before.world.actors) {
    if (was.kind !== 'creature') continue;
    creatures += 1;

    const now = after.world.actors.find((actor) => actor.id === was.id);
    if (now === undefined || now.kind !== 'creature') continue;
    if (now.at.x !== was.at.x || now.at.y !== was.at.y) moved += 1;

    if (!hasActor(before.world.schedule, was.id) || !hasActor(after.world.schedule, was.id)) continue;
    const charged =
      nextActAtOf(after.world.schedule, was.id) - nextActAtOf(before.world.schedule, was.id);
    if (charged === ACTION_COST) acted += 1;
  }

  return {
    creatures,
    acted,
    moved,
    elapsed: after.world.schedule.now - before.world.schedule.now,
    lit: tileSetSize(after.lantern.vision.revealed) - tileSetSize(before.lantern.vision.revealed),
  };
}

describe('the light economy inside a turn', () => {
  /** Floor 8: six creatures, all awake, all due — the most expensive turn a floor has. */
  function busyLitFloor(): LanternWorld {
    const floor = generateFloor(createRng('light-bench'), 8).value;
    const arrived = createLanternWorld(floor, 'open');
    // Woken through a floodlit query rather than by playing far enough into the floor to light them
    // all. This is fixture setup, not the thing being measured: an honest first flash wakes *few*
    // creatures — §5 keeps them out of the entrance room, though not out of line of sight through a
    // doorway, and 46 of 200 floor-8 seeds wake at least one — and a floor of sleepers costs almost
    // nothing and is the wrong turn.
    //
    // The world is uncharged, so the player is due at 0 and, under ADR-0014, so is everything this
    // wakes. That is what makes the very next command the busy turn rather than the one after it.
    return {
      lantern: arrived.lantern,
      world: wakeInLight(arrived.world, { isPlayerLightVisibleFrom: () => true }),
    };
  }

  /**
   * Floor 8, shuttered, everything asleep: the state a flash is issued from.
   *
   * A different seed from the fixture above, and chosen rather than found: on `light-bench-1` the lit
   * field cast from the entrance reaches two of the six sleepers, so the measured command runs the
   * whole of phase 3 — cast, remember, ask the query six times, and declare for the two it wakes.
   * On plain `light-bench` the same flash wakes nobody and measures 0.0132-0.0144ms, ~40% of this
   * one, because the two declarations are the bulk of it.
   */
  function darkFloorOfSleepers(): LanternWorld {
    return createLanternWorld(generateFloor(createRng('light-bench-1'), 8).value, 'shuttered');
  }

  it('resolves a lit turn on a busy floor well inside the budget', () => {
    const state = busyLitFloor();
    const work = creatureWorkIn(state, wait(state));

    expect(
      work.creatures,
      'floor 8 is the most populated §8 produces; a fixture with fewer creatures on it is no longer ' +
        'the worst case this benchmark claims to measure',
    ).toBe(6);
    expect(
      work.acted,
      'every creature on this floor is awake and due at the instant the measured turn begins, so ' +
        'every one of them must resolve an action inside it. If this is 0 the benchmark is timing a ' +
        'turn whose phase 4 found nothing due and merely advanced the clock — which is what it timed ' +
        'from the day it was written until ADR-0014, at an eighth of the real cost',
    ).toBe(work.creatures);
    expect(
      work.moved,
      'the six resolutions must be visible in the world, not just in the queue: an awake Cinder ' +
        'that is not adjacent steps toward the player (§4), and a floor where none of them can is a ' +
        'floor whose pathing is not being exercised',
    ).toBeGreaterThan(0);

    const cost = medianCost(state, wait, TURN_BATCH);
    console.log(`lit turn: ${cost.toFixed(4)}ms (budget ${TURN_BUDGET_MS}ms of ARCHITECTURE's 2ms)`);
    expect(cost).toBeLessThan(TURN_BUDGET_MS);
  });

  it('resolves a flash — the shutter opening on a floor of sleepers — well inside the budget', () => {
    const state = darkFloorOfSleepers();
    const flash = (current: LanternWorld): LanternWorld => setShutterTurn(current, 'open');
    const flashed = flash(state);
    const work = creatureWorkIn(state, flashed);

    expect(work.creatures, 'the same six-creature floor 8 the turn above is measured on').toBe(6);
    expect(
      dormantCreatures(state),
      'the light query is asked once per *sleeper*, and `wakeInLight` skips an already-awake ' +
        'creature before it asks. A fixture that starts awake measures the query zero times',
    ).toBe(work.creatures);
    expect(flashed.lantern.vision.shutter).toBe('open');
    expect(
      work.lit,
      'the flash must light terrain: `revealed` grows only under `terrainFrom: light`, so a zero ' +
        'here means phase 3 took the dark path and cast no field at all — which is what this ' +
        'benchmark measured while it toggled the shutter *shut*, at a thirteenth of the cost. ' +
        'A *delta*, not a size: a size is also satisfied by a fixture that was lit before the flash',
    ).toBeGreaterThan(0);
    expect(
      dormantCreatures(flashed),
      'the flash must wake somebody, or the declaration half of phase 3 — a `stepToward` flood per ' +
        'woken creature, which is the bulk of what is being timed — never runs',
    ).toBeLessThan(work.creatures);
    expect(
      work.elapsed,
      'a free action must not hand the floor a turn (§2): if the clock moved, phase 4 ran and this ' +
        'is no longer measuring a free action',
    ).toBe(0);

    const cost = medianCost(state, flash, FLASH_BATCH);
    console.log(`flash: ${cost.toFixed(4)}ms (budget ${FLASH_BUDGET_MS}ms of ARCHITECTURE's 2ms)`);
    expect(cost).toBeLessThan(FLASH_BUDGET_MS);
  });
});
