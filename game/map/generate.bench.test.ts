import { describe, expect, it } from 'vitest';
import { createRng } from '@/game/rng';
import { generateFloor } from '@/game/map';

/**
 * Level generation is one of the two places ARCHITECTURE.md says performance historically blows up,
 * which is why it says to add a benchmark when you touch it. This one earned its place on the day
 * it was written: the first working generator took **2.7ms per floor** on a desktop, against a 2ms
 * budget for an entire turn on a mid-range phone.
 *
 * The cause was `isSound` being `findSoundnessProblems(grid).length === 0`, which allocates a
 * position object and several arrays per call — and the generator calls it once per candidate tile
 * per pillar, around 240 times per floor. Rewriting it as a short-circuiting, allocation-free pass
 * brought it to ~0.3ms. Nothing else was optimized, because nothing else showed up.
 *
 * ## Reading a failure here
 *
 * This is a *timing* test, so it is the one test in the repo that can fail for reasons that are not
 * about the code — a loaded CI machine, a cold JIT. It is written to minimise that: warm up first,
 * then take the median of several batches rather than one measurement. If it fails intermittently
 * at close to the threshold, say so in the journal rather than quietly raising the number; the
 * budget is a design constraint from ADR-0004, not a knob.
 */

/** ADR-0004 / ARCHITECTURE.md: a whole turn must resolve in under 2ms. Descending generates a floor. */
const BUDGET_MS = 2;

const WARMUP = 100;
const BATCHES = 5;
const BATCH_SIZE = 200;

function medianBatchCost(floorNumber: number): number {
  for (let i = 0; i < WARMUP; i += 1) generateFloor(createRng(`warmup-${i}`), floorNumber);

  const costs: number[] = [];
  for (let batch = 0; batch < BATCHES; batch += 1) {
    const started = performance.now();
    for (let i = 0; i < BATCH_SIZE; i += 1) {
      generateFloor(createRng(`bench-${batch}-${i}`), floorNumber);
    }
    costs.push((performance.now() - started) / BATCH_SIZE);
  }
  return costs.sort((a, b) => a - b)[Math.floor(BATCHES / 2)];
}

describe('level generation performance', () => {
  it('generates a floor well inside the 2ms turn budget', () => {
    const cost = medianBatchCost(1);
    // Printed so a run that is merely close to the limit is visible before it starts failing.
    console.log(`level generation: ${cost.toFixed(3)}ms per floor (budget ${BUDGET_MS}ms)`);
    expect(cost).toBeLessThan(BUDGET_MS);
  });

  it('costs about the same on the deepest floor as on the first', () => {
    // The deepest floor places twice as many creatures. If that ever becomes the dominant cost,
    // something has gone quadratic in the candidate scan.
    const first = medianBatchCost(1);
    const last = medianBatchCost(8);
    expect(last).toBeLessThan(Math.max(first * 2, BUDGET_MS));
  });
});
