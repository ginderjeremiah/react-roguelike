import { describe, expect, it } from 'vitest';
import { atTheStairs } from '@/tests/unit/support/run-script';
import { LAST_FLOOR } from '../content';
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
 * Half of ARCHITECTURE's 2ms for the descent, because a descent legitimately does ~60 draws of level
 * generation on top of a turn and there is no point pretending otherwise. The ordinary commands are
 * held to a tenth of that. Both leave room for a large regression to be caught before a player
 * could feel it, which a threshold set at the full budget would not.
 */
const DESCENT_BUDGET_MS = 1;
const COMMAND_BUDGET_MS = 0.1;
const WARMUP = 30;
const BATCHES = 5;
const BATCH_SIZE = 60;

function medianCost(state: GameState, command: Command): number {
  for (let i = 0; i < WARMUP; i += 1) step(state, command);

  const costs: number[] = [];
  for (let batch = 0; batch < BATCHES; batch += 1) {
    const started = performance.now();
    for (let i = 0; i < BATCH_SIZE; i += 1) step(state, command);
    costs.push((performance.now() - started) / BATCH_SIZE);
  }
  return costs.sort((a, b) => a - b)[Math.floor(BATCHES / 2)];
}

describe('step() against the 2ms turn budget', () => {
  it('resolves a descent — floor generation plus a whole turn — inside the budget', () => {
    // The deepest floor a run reaches minus one, so the floor being *generated* is the most
    // populated one §8 produces.
    const state = atTheStairs('step-bench', LAST_FLOOR - 1);
    expect(floorNumberOf(state)).toBe(LAST_FLOOR - 1);

    const cost = medianCost(state, { kind: 'descend' });
    console.log(`descend: ${cost.toFixed(4)}ms (budget ${DESCENT_BUDGET_MS}ms of ARCHITECTURE's 2ms)`);
    expect(cost).toBeLessThan(DESCENT_BUDGET_MS);
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
