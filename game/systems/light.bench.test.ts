import { describe, expect, it } from 'vitest';
import { generateFloor } from '../map';
import { createRng } from '../rng';
import { PLAYER_ID } from '../entities';
import { wakeInLight } from './actors';
import { createLanternWorld, lanternPhases, setShutterTurn, type LanternWorld } from './light';
import { chargeActor } from './schedule';
import { resolveTurn } from './turn';

/**
 * ARCHITECTURE.md gives one turn a **2ms** budget and says to add a benchmark when touching field of
 * view, "since those are where it historically goes wrong". This module does not change FOV — it
 * *consumes* it, two or three times per turn, which is the same exposure from the other side:
 *
 *   - phase 3 computes the perceived field once, to fold into terrain memory;
 *   - phase 3 then builds the light query, which is a second lit field;
 *   - phase 4 builds a third, so creatures declare against the lighting phase 3 just recomputed.
 *
 * Recomputing rather than threading one field through is a deliberate correctness choice (each
 * phase must see the lighting as it stands *at that phase*), so the thing to watch is the price of
 * that choice. `fov.bench.test.ts` measures a single lit field at ~0.004ms; the interesting question
 * here is whether the whole turn is still nowhere near the budget with a floor of six awake
 * creatures on top.
 *
 * ## Reading a failure here
 *
 * This is a timing test and can fail for reasons that are not about the code — a loaded CI machine,
 * a cold JIT. It warms up and takes a median of batches. If it fails intermittently near the
 * threshold, say so in the journal rather than quietly raising the number: the budget is a design
 * constraint from ADR-0004, not a knob.
 */

/**
 * A fifth of ARCHITECTURE's 2ms, not the whole of it. A lit turn measures at ~0.014ms here, so this
 * still allows a fourteen-fold regression before it complains — `fov.bench.test.ts` makes the same
 * argument for the same reason: a threshold a fifty-fold regression satisfies enforces nothing.
 */
const BUDGET_MS = 0.2;
const WARMUP = 50;
const BATCHES = 5;
const BATCH_SIZE = 100;

function wait(state: LanternWorld): LanternWorld {
  return resolveTurn(
    state,
    lanternPhases('costsATurn', (current) => ({
      lantern: current.lantern,
      world: { ...current.world, schedule: chargeActor(current.world.schedule, PLAYER_ID) },
    })),
  );
}

function medianCost(state: LanternWorld, once: (s: LanternWorld) => LanternWorld): number {
  for (let i = 0; i < WARMUP; i += 1) once(state);

  const costs: number[] = [];
  for (let batch = 0; batch < BATCHES; batch += 1) {
    const started = performance.now();
    for (let i = 0; i < BATCH_SIZE; i += 1) once(state);
    costs.push((performance.now() - started) / BATCH_SIZE);
  }
  return costs.sort((a, b) => a - b)[Math.floor(BATCHES / 2)];
}

describe('the light economy inside a turn', () => {
  /** Floor 8: six creatures, all awake and hunting, shutter open — the most expensive turn a floor has. */
  function busyLitFloor(): LanternWorld {
    const floor = generateFloor(createRng('light-bench'), 8).value;
    const arrived = createLanternWorld(floor, 'open');
    // Woken through a floodlit query rather than by playing far enough into the floor to light them
    // all. This is fixture setup, not the thing being measured: §5 keeps creatures out of the
    // entrance room, so an honest first flash wakes nothing and would benchmark a floor of sleepers,
    // which costs almost nothing and is the wrong turn.
    return {
      lantern: arrived.lantern,
      world: wakeInLight(arrived.world, { isPlayerLightVisibleFrom: () => true }),
    };
  }

  it('resolves a lit turn on a busy floor well inside the budget', () => {
    const state = busyLitFloor();
    // A benchmark of a floor of sleepers measures the wrong turn entirely.
    expect(state.world.actors.some((actor) => actor.kind === 'creature' && actor.mind.kind === 'awake')).toBe(
      true,
    );

    const cost = medianCost(state, wait);
    console.log(`lit turn: ${cost.toFixed(4)}ms (budget ${BUDGET_MS}ms of ARCHITECTURE's 2ms)`);
    expect(cost).toBeLessThan(BUDGET_MS);
  });

  it('resolves a shutter toggle well inside the budget', () => {
    // The free action still runs three of the six phases, including the lighting recompute that
    // wakes the room, so it is not automatically cheap just because it costs no turn.
    const state = busyLitFloor();
    const cost = medianCost(state, (current) => setShutterTurn(current, 'shuttered'));
    console.log(`shutter toggle: ${cost.toFixed(4)}ms (budget ${BUDGET_MS}ms)`);
    expect(cost).toBeLessThan(BUDGET_MS);
  });
});
