import { describe, expect, it } from 'vitest';
import { scenario } from '@/tests/unit/support/scenario';
import { createRng } from '../rng';
import { generateFloor, isPassable, positionOf, tileIndex, type Position } from '../map';
import { PLAYER_ID } from './actor';
import { stepDistanceField, stepToward, UNREACHABLE } from './pathing';
import { createActorWorld, type ActorWorld } from './world';

/**
 * Pathing is where a "nothing is wrong" suite is easiest to fool: a `stepToward` that always
 * returned `null` satisfies every negative invariant in this file — it never walks into a wall, it
 * never oscillates, it is perfectly deterministic — and produces a Cinder that never moves. So the
 * load-bearing test here is the positive one: **from anywhere on a real floor, following these
 * steps arrives, in exactly the number of steps the distance field claims.**
 */

describe('stepDistanceField', () => {
  it('counts orthogonal steps, not diagonals', () => {
    const { world, at } = scenario([
      '#####',
      '#...#',
      '#.@.#',
      '#...#',
      '#####',
    ]);
    const grid = world.floor.grid;
    const distance = stepDistanceField(grid, at('@'));
    const from = (x: number, y: number): number => distance[tileIndex(grid, x, y)];

    expect(from(2, 2)).toBe(0);
    expect(from(1, 2)).toBe(1);
    expect(from(3, 2)).toBe(1);
    // The corner is two steps away, not one — this is the assertion a Chebyshev metric fails.
    expect(from(1, 1)).toBe(2);
    expect(from(3, 3)).toBe(2);
    // Walls have no distance at all.
    expect(from(0, 0)).toBe(UNREACHABLE);
  });

  it('goes around a wall rather than through it', () => {
    // The reason this is a flood and not a "step toward the goal" heuristic: §5's rooms are joined
    // by single-tile doorways, so a creature that cannot route through one never arrives.
    const { world, at } = scenario([
      '#######',
      '#@#...#',
      '#.+..c#',
      '#.#...#',
      '#######',
    ]);
    const grid = world.floor.grid;
    const distance = stepDistanceField(grid, at('@'));
    // (5,2) -> (4,2) -> (3,2) doorway -> (2,2) -> (1,2) -> (1,1): five steps, all around the wall.
    expect(distance[tileIndex(grid, 5, 2)]).toBe(5);
  });

  it('marks everything unreachable when the goal is walled off', () => {
    const { world } = scenario([
      '#####',
      '#@#.#',
      '#####',
    ]);
    const grid = world.floor.grid;
    const distance = stepDistanceField(grid, { x: 3, y: 1 });
    expect(distance[tileIndex(grid, 1, 1)]).toBe(UNREACHABLE);
    expect(distance[tileIndex(grid, 3, 1)]).toBe(0);
  });

  it('marks everything unreachable when the goal is a wall', () => {
    // Not an error: a creature can be sent to a tile it cannot stand on. It must simply not move.
    const { world } = scenario(['#####', '#@..#', '#####']);
    expect(stepDistanceField(world.floor.grid, { x: 0, y: 0 })).toEqual(
      new Array<number>(world.floor.grid.tiles.length).fill(UNREACHABLE),
    );
  });

  it('throws on a goal outside the grid', () => {
    const { world } = scenario(['###', '#@#', '###']);
    expect(() => stepDistanceField(world.floor.grid, { x: 9, y: 0 })).toThrow(/outside the grid/);
  });
});

describe('stepToward', () => {
  it('takes a step that strictly reduces the distance', () => {
    const { world, ids, at } = scenario([
      '#######',
      '#@...c#',
      '#######',
    ]);
    expect(stepToward(world, ids[0], at('c'), at('@'))).toEqual({ x: 4, y: 1 });
  });

  it('breaks a tie by the fixed order north, east, south, west', () => {
    // Two steps reduce the distance equally, which on an open floor is the common case rather than
    // an edge case. The answer must come from a fixed order and never from a draw: a random
    // tie-break would consume entropy a variable number of times per turn, which shifts the whole
    // run's generator stream. Spelled out literally so the order cannot drift.
    const { world, ids, at } = scenario([
      '#####',
      '#@..#',
      '#...#',
      '#..c#',
      '#####',
    ]);
    // From (3,3) toward (1,1): north to (3,2) and west to (2,3) are both improvements. North wins.
    expect(stepToward(world, ids[0], at('c'), at('@'))).toEqual({ x: 3, y: 2 });
  });

  it('returns null when the goal cannot be reached from here', () => {
    const { world, ids, at } = scenario([
      '#####',
      '#@#c#',
      '#####',
    ]);
    expect(stepToward(world, ids[0], at('c'), at('@'))).toBeNull();
  });

  it('returns null when it is already there', () => {
    const { world, ids, at } = scenario(['#####', '#@.c#', '#####']);
    expect(stepToward(world, ids[0], at('c'), at('c'))).toBeNull();
  });

  it('will not step onto a tile another actor is standing on', () => {
    // The path is computed over terrain, so the field says "go west" — but the tile is taken, and
    // no other step improves. The creature waits rather than sharing a tile.
    const { world, ids, at } = scenario([
      '#####',
      '#@cc#',
      '#####',
    ]);
    expect(stepToward(world, ids[1], { x: 3, y: 1 }, at('@'))).toBeNull();
    // The player's own tile is no different: a creature closes to adjacent and stops there.
    expect(stepToward(world, ids[0], { x: 2, y: 1 }, at('@'))).toBeNull();
  });

  it('does not path around another actor', () => {
    // Stated as a test because it is a design choice, not an accident: §2 chose a legible enemy
    // over a smart one. The far creature's route is blocked by its neighbour and it holds, rather
    // than looping through the open row below.
    const { world, ids } = scenario([
      '#####',
      '#@cc#',
      '#...#',
      '#####',
    ]);
    expect(stepToward(world, ids[1], { x: 3, y: 1 }, { x: 1, y: 1 })).toBeNull();
  });
});

describe('following the steps actually arrives', () => {
  /** Walk one actor from `from` to `goal`, one `stepToward` at a time. */
  function walk(world: ActorWorld, from: Position, goal: Position): number | null {
    let at = from;
    for (let steps = 0; steps <= world.floor.grid.tiles.length; steps += 1) {
      if (at.x === goal.x && at.y === goal.y) return steps;
      const next = stepToward(world, PLAYER_ID, at, goal);
      if (next === null) return null;
      at = next;
    }
    return null;
  }

  it('reaches the goal from every passable tile on a generated floor, in the predicted number of steps', () => {
    // The positive assertion the rest of this file cannot make. A `stepToward` that returns null,
    // or one that wanders, or one that gets stuck against a pillar, fails here — and every one of
    // those still satisfies "never walks into a wall".
    //
    // The number of steps is compared against the distance field, so a route that arrives the long
    // way round also fails. That matters in play: the Cinder's whole threat is that it closes.
    for (let seed = 0; seed < 12; seed += 1) {
      const floor = generateFloor(createRng(`walk-${seed}`), 1).value;
      // A world with no creatures in it: this test is about terrain, and a creature standing in a
      // doorway would legitimately block a route.
      const world = createActorWorld({ ...floor, creatures: [] });
      const grid = world.floor.grid;
      const goal = floor.stairs;
      const distance = stepDistanceField(grid, goal);

      for (let index = 0; index < grid.tiles.length; index += 1) {
        if (!isPassable(grid.tiles[index])) continue;
        const from = positionOf(grid, index);
        expect(distance[index]).toBeGreaterThanOrEqual(0);
        expect(walk(world, from, goal)).toBe(distance[index]);
      }
    }
  });
});
