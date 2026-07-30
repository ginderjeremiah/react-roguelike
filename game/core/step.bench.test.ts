import { describe, expect, it } from 'vitest';
import { atTheStairs } from '@/tests/unit/support/run-script';
import { LAST_FLOOR } from '../content';
import { generateFloor } from '../map';
import { type Command } from './command';
import { createInitialState, floorNumberOf, type GameState } from './state';
import { step } from './step';

/**
 * `step()` against ARCHITECTURE.md's **2ms per turn** budget, now that it is the whole simulation.
 *
 * `light.bench.test.ts` measures a turn on a floor; this measures the two things that only exist at
 * this layer and that the turn benchmark therefore cannot see:
 *
 *   - **a descent**, which is by far the most expensive command in the game — it generates a whole
 *     floor (`generate.bench.test.ts` measures that at ~0.3ms) and *then* runs all six phases on the
 *     result. It is the only command that can plausibly approach the budget, and it is the one a
 *     player issues at the most dramatic moment of a floor;
 *   - **a refusal**, which must cost approximately nothing. §2's whole argument for refusing a
 *     fat-fingered tap rests on it being cheap enough that the input layer can call `step` as a
 *     backstop; a refusal that generated a floor and threw it away would be both a determinism bug
 *     and a visible stutter, and only one of those has a test elsewhere.
 *
 * ## Reading a failure here
 *
 * This is a timing test and can fail for reasons that are not about the code — a loaded CI machine,
 * a cold JIT. It warms up and takes a median of batches. If it fails intermittently near the
 * threshold, say so in the journal rather than quietly raising the number: the budget is a design
 * constraint from ADR-0004, not a knob.
 */

/**
 * **The descent is measured as a ratio, not against a millisecond figure, and that is a correction.**
 *
 * It was first written as "half of ARCHITECTURE's 2ms", which passed here at 0.45ms and failed on a
 * GitHub runner at **1.72ms** — a ~4x slower machine, not a regression. Raising the number until the
 * runner passed would have set the threshold by whichever machine happened to be slowest, and at
 * 1.72ms against a 2ms budget there is no headroom left to raise it into anyway.
 *
 * So the descent is held to what it *is*: a floor generation plus one turn. Generation already has
 * an absolute budget of its own (`generate.bench.test.ts`, 2ms) and a turn has one
 * (`light.bench.test.ts`, 0.2ms); what only this layer can see is whether descending costs more than
 * the sum of its two halves. Measuring both in the same process divides the machine out, so the
 * assertion means the same thing on a laptop, a runner, and a phone.
 *
 * The measurement itself is the interesting part: a descent costs **1.09x** a bare generation here
 * (0.47ms against 0.43ms), so generating the floor is ~92% of it and the six phases are noise. The
 * threshold is 1.6x, which trips on a **second floor being generated** (that alone would be 2.0x)
 * and on roughly a 5x regression in the turn half. Both absolute figures are printed either way, so
 * a real slowdown is visible in the CI log even on a run where nothing fails.
 *
 * Ordinary commands keep an absolute threshold, because they measure two orders of magnitude below
 * the budget and hardware variance cannot close that gap.
 */
const DESCENT_RATIO_LIMIT = 1.6;
const COMMAND_BUDGET_MS = 0.1;
const WARMUP = 30;
const BATCHES = 5;
const BATCH_SIZE = 60;

/** Median of batched medians. Warms up first, so a cold JIT is not what is being measured. */
function median(once: () => unknown): number {
  for (let i = 0; i < WARMUP; i += 1) once();

  const costs: number[] = [];
  for (let batch = 0; batch < BATCHES; batch += 1) {
    const started = performance.now();
    for (let i = 0; i < BATCH_SIZE; i += 1) once();
    costs.push((performance.now() - started) / BATCH_SIZE);
  }
  return costs.sort((a, b) => a - b)[Math.floor(BATCHES / 2)];
}

function medianCost(state: GameState, command: Command): number {
  return median(() => step(state, command));
}

describe('step() against the 2ms turn budget', () => {
  it('resolves a descent for little more than the floor generation it contains', () => {
    // The deepest floor a run reaches minus one, so the floor being *generated* is the most
    // populated one §8 produces.
    const state = atTheStairs('step-bench', LAST_FLOOR - 1);
    expect(floorNumberOf(state)).toBe(LAST_FLOOR - 1);

    const descent = medianCost(state, { kind: 'descend' });
    // The same floor `step` would generate, generated on its own: the machine's own yardstick,
    // measured in this process with this harness. `LAST_FLOOR` because that is what descending from
    // `LAST_FLOOR - 1` produces.
    const generation = median(() => generateFloor(state.rng, LAST_FLOOR));

    console.log(
      `descend: ${descent.toFixed(4)}ms = ${(descent / generation).toFixed(2)}x a bare floor ` +
        `generation (${generation.toFixed(4)}ms), limit ${DESCENT_RATIO_LIMIT}x`,
    );
    expect(descent / generation).toBeLessThan(DESCENT_RATIO_LIMIT);
  });

  it('resolves an ordinary lit turn inside a tenth of the budget', () => {
    const state = createInitialState('step-bench');
    const cost = medianCost(state, { kind: 'wait' });
    console.log(`wait (lit): ${cost.toFixed(4)}ms (budget ${COMMAND_BUDGET_MS}ms)`);
    expect(cost).toBeLessThan(COMMAND_BUDGET_MS);
  });

  it('refuses a command for almost nothing, and in particular without generating a floor', () => {
    // §2 leans on refusals being cheap: the input layer refuses first and `step` is the backstop, so
    // a refused tap is on the interaction path. It is also the place a stray `generateFloor` would
    // hide — a descent refused *after* generating would be ~0.3ms and a replay-breaking draw.
    const state = createInitialState('step-bench');
    const refused = step(state, { kind: 'descend' });
    expect(refused).toBe(state);

    const cost = medianCost(state, { kind: 'descend' });
    console.log(`refused descend: ${cost.toFixed(4)}ms`);
    expect(cost).toBeLessThan(COMMAND_BUDGET_MS / 10);
  });
});
