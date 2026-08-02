import { describe, expect, it } from 'vitest';
import { playTurn } from '@/tests/unit/support/scenario';
import { createActorWorld, type ActorWorld } from '../entities';
import { generateFloor } from '../map';
import { createRng } from '../rng';
import type { LightQuery } from './light';

/**
 * ARCHITECTURE.md gives one turn a **2ms** budget on a mid-range phone and says to add a benchmark
 * when touching field of view or level generation, "since those are where it historically goes
 * wrong". The actor phase is now the third: every awake creature runs a breadth-first flood over
 * the whole 11×15 grid when it declares, so the cost is `creatures × tiles` and it is the only
 * thing in a turn that scales with anything.
 *
 * At six creatures that is ~1000 tile visits, which measures at well under a tenth of the budget.
 * It is benchmarked anyway, because the obvious future change — pathing that accounts for other
 * actors, or a look-ahead of more than one step — multiplies exactly this number, and a budget
 * nobody measures is a budget nobody notices crossing.
 *
 * ## Reading a failure here
 *
 * This is a timing test and can fail for reasons that are not about the code — a loaded CI machine,
 * a cold JIT. It warms up first and takes a median of batches to minimise that. If it fails
 * intermittently near the threshold, say so in the journal rather than quietly raising the number:
 * the budget is a design constraint from ADR-0004, not a knob.
 */

const BUDGET_MS = 2;
const WARMUP = 50;
const BATCHES = 5;
const BATCH_SIZE = 100;

/** Everything awake and hunting: the most expensive turn a floor can produce. */
function busyFloor(seed: string): ActorWorld {
  const floor = generateFloor(createRng(seed), 8).value;
  return createActorWorld(floor);
}

const floodlit: LightQuery = { isPlayerLightVisibleFrom: () => true };

function medianTurnCost(world: ActorWorld): number {
  for (let i = 0; i < WARMUP; i += 1) playTurn(world, { kind: 'wait' }, floodlit);

  const costs: number[] = [];
  for (let batch = 0; batch < BATCHES; batch += 1) {
    const started = performance.now();
    for (let i = 0; i < BATCH_SIZE; i += 1) playTurn(world, { kind: 'wait' }, floodlit);
    costs.push((performance.now() - started) / BATCH_SIZE);
  }
  return costs.sort((a, b) => a - b)[Math.floor(BATCHES / 2)];
}

describe('turn resolution performance', () => {
  it('resolves a turn on a fully awake floor of six well inside the 2ms budget', () => {
    // Woken first, so every creature declares — a floor of sleepers costs almost nothing and would
    // make this benchmark measure the wrong turn entirely.
    let world = busyFloor('bench-awake');
    world = playTurn(world, { kind: 'wait' }, floodlit);
    expect(
      world.actors.filter((actor) => actor.kind === 'creature' && actor.mind.kind === 'awake')
        .length,
    ).toBeGreaterThan(0);

    const cost = medianTurnCost(world);
    console.log(`actor phase: ${cost.toFixed(4)}ms per turn (budget ${BUDGET_MS}ms)`);
    expect(cost).toBeLessThan(BUDGET_MS);
  });
});
