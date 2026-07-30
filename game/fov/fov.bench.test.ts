import { describe, expect, it } from 'vitest';
import { blocksLight, generateFloor, isPassable, positionOf, type Floor, type Position } from '@/game/map';
import { createRng } from '@/game/rng';
import { parseScene } from '@/tests/unit/support/ascii-grid';
import { perceive } from './perceive';
import { shadowcast } from './shadowcast';
import { closeShutter, createVision } from './vision';

/**
 * FOV is one of the two places ARCHITECTURE.md says performance historically blows up — the other
 * is level generation, whose benchmark caught a 9x problem on the day it was written. So this one
 * exists before there is a problem rather than after.
 *
 * `perceive` runs at least once per turn (more, once creatures have their own FOV), against a 2ms
 * budget for the **whole** turn. It should be a rounding error in that budget, not a fraction of it.
 *
 * ## Reading a failure here
 *
 * This is a timing test, so it can fail for reasons that are not about the code: a loaded CI
 * machine, a cold JIT. It warms up and takes the median of several batches to limit that. If it
 * starts failing intermittently near the threshold, say so in the journal rather than quietly
 * raising the number — the budget is ADR-0004, not a knob.
 */

/** ADR-0004 / ARCHITECTURE.md: a whole turn resolves in under 2ms. FOV is one part of a turn. */
const TURN_BUDGET_MS = 2;

/**
 * FOV's share of it. Deliberately tight: it is a 165-tile grid and a radius of 4, and it measures
 * at ~0.004ms. A budget of 0.2ms would be satisfied by a fifty-fold regression, which is a
 * benchmark that enforces nothing; 0.05ms still leaves an order of magnitude for a slow CI box.
 */
const FOV_BUDGET_MS = 0.05;

const WARMUP = 200;
const BATCHES = 5;
const BATCH_SIZE = 500;

function medianCost(work: (iteration: number) => void): number {
  for (let i = 0; i < WARMUP; i += 1) work(i);

  const costs: number[] = [];
  for (let batch = 0; batch < BATCHES; batch += 1) {
    const started = performance.now();
    for (let i = 0; i < BATCH_SIZE; i += 1) work(i);
    costs.push((performance.now() - started) / BATCH_SIZE);
  }
  return costs.sort((a, b) => a - b)[Math.floor(BATCHES / 2)];
}

function passablePositions(floor: Floor): Position[] {
  const out: Position[] = [];
  for (let index = 0; index < floor.grid.tiles.length; index += 1) {
    if (isPassable(floor.grid.tiles[index])) out.push(positionOf(floor.grid, index));
  }
  return out;
}

describe('field of view performance', () => {
  const floor = generateFloor(createRng('bench-floor'), 4).value;
  const standable = passablePositions(floor);

  it('computes a lit field well inside the turn budget', () => {
    const cost = medianCost((i) => {
      shadowcast(floor.grid, standable[i % standable.length], 4, blocksLight);
    });
    console.log(`lit field: ${cost.toFixed(4)}ms per cast (budget ${FOV_BUDGET_MS}ms)`);
    expect(cost).toBeLessThan(FOV_BUDGET_MS);
  });

  it('resolves a whole lit perception — terrain and creatures — inside the budget', () => {
    const vision = createVision(floor.grid, 'open');
    const creatures = floor.creatures.map((creature) => creature.at);
    const cost = medianCost((i) => {
      perceive(floor.grid, vision, standable[i % standable.length], creatures);
    });
    console.log(`lit perception: ${cost.toFixed(4)}ms per turn (budget ${FOV_BUDGET_MS}ms)`);
    expect(cost).toBeLessThan(FOV_BUDGET_MS);
  });

  it('resolves a shuttered perception much more cheaply than a lit one', () => {
    // Dark is the state the player spends most turns in. If it ever costs more than light,
    // something has started doing a visibility pass it should not be doing.
    const vision = closeShutter(createVision(floor.grid, 'open'));
    const creatures = floor.creatures.map((creature) => creature.at);
    const cost = medianCost((i) => {
      perceive(floor.grid, vision, standable[i % standable.length], creatures);
    });
    console.log(`dark perception: ${cost.toFixed(4)}ms per turn`);
    expect(cost).toBeLessThan(FOV_BUDGET_MS);
  });

  it('does not blow up when the radius covers the whole floor', () => {
    // The guard against something quadratic in the radius. A radius of 20 on an 11x15 grid means
    // every wedge runs to the edge, which is the worst case the game could ever ask for.
    const cost = medianCost((i) => {
      shadowcast(floor.grid, standable[i % standable.length], 20, blocksLight);
    });
    console.log(`floor-wide cast: ${cost.toFixed(4)}ms (turn budget ${TURN_BUDGET_MS}ms)`);
    expect(cost).toBeLessThan(TURN_BUDGET_MS);
    // And it is not merely inside the turn budget — a floor-wide cast is still FOV-cheap, because
    // the walls terminate the wedges long before the radius does.
    expect(cost).toBeLessThan(FOV_BUDGET_MS);
  });

  it('stays affordable in a wide open room, the worst case for a shadowcaster', () => {
    // Walls terminate scans early, so an empty grid is more expensive than a real floor. This is
    // the number that would move first if the recursion ever went wrong.
    const open = parseScene(Array.from({ length: 21 }, () => '.'.repeat(21)));
    const cost = medianCost(() => {
      shadowcast(open.grid, { x: 10, y: 10 }, 4, blocksLight);
    });
    console.log(`open room cast: ${cost.toFixed(4)}ms`);
    expect(cost).toBeLessThan(FOV_BUDGET_MS);
  });
});
