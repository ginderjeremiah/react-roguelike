/**
 * Ember-sense: GDD §4's shuttered creature sense. **Positions only, and it goes through stone.**
 *
 * ## This file must never learn about line of sight
 *
 * "Ember-sense ignores walls; light does not" is the asymmetry the whole game is built on
 * (ADR-0007, §4) — it is the entire answer to "why would I ever go dark". The failure mode is not
 * subtle to describe and very easy to commit: somebody notices this is "just an FOV with a bigger
 * radius" and routes it through the shadowcaster, and darkness quietly stops telling you what is in
 * the next room.
 *
 * Two structural defences, because a comment is not one:
 *
 * 1. `senseCreatures` **does not take a grid**. It cannot consult a wall; there is no wall to
 *    consult. The wall-piercing rule is a property of the signature, not of the body.
 * 2. This module does not import `shadowcast.ts`, `light.ts`, or `blocksLight`, and
 *    `embersense.test.ts` reads this file and asserts that it does not.
 *
 * ## Position only
 *
 * Not identity, not health, not intent (§4, cut back deliberately: brightness-encoded health cannot
 * be the sole carrier of meaning — §11). The return type is `Position[]`, so there is nothing else
 * to leak. Whoever calls this knows which creature is which; what comes back does not.
 *
 * ## The metric
 *
 * Chebyshev, the same square as light (issue #25). Sharing the metric is load-bearing rather than
 * tidy: with sense 5 and light 4 under one metric, the lit region is always a subset of the sensed
 * region, so **everything a flash can wake, you can already feel**. `containment.test.ts` is that
 * sentence as a property.
 */

import { blocksEmberSense, chebyshevDistance, comparePositions, inBounds, tileIndex, type Grid, type Position } from '../map';
import { blankFlags, sealTileSet, type TileSet } from './tileset';

/**
 * Which of `creatures` the player can feel from `origin`, row-major.
 *
 * No grid parameter, by design — see the header. The input array's order cannot reach the output:
 * the result is sorted row-major, so a creature list that happens to be built in a different order
 * (spawn order, actor id order, scheduler order) produces the same perception.
 *
 * @param radius the player's **current** ember-sense reach, which during dark adaptation is less
 *   than `EMBER_SENSE_RADIUS`. Callers pass `vision.senseRadius`, never the constant.
 * @throws if the radius is negative or fractional — a fractional radius silently rounds a square
 *   into a slightly different square.
 */
export function senseCreatures(
  origin: Position,
  radius: number,
  creatures: readonly Position[],
): Position[] {
  if (!Number.isInteger(radius) || radius < 0) {
    throw new Error(`fov: ember-sense radius must be a non-negative integer, got ${radius}`);
  }
  return creatures
    .filter((at) => chebyshevDistance(origin, at) <= radius)
    .map((at) => ({ x: at.x, y: at.y }))
    .sort(comparePositions);
}

/**
 * The region ember-sense reaches: the Chebyshev box of `radius` around `origin`, clipped to the
 * grid, ignoring every wall in it.
 *
 * **This is not terrain knowledge.** Ember-sense reveals creatures, never the map — a tile being in
 * this set says nothing about whether the player knows what is on it. It exists so the containment
 * guarantee can be stated and tested as a claim about regions, and so the HUD/debug tooling can
 * show the reach.
 *
 * The loop bounds are the metric; there is no distance predicate. `blocksEmberSense` is consulted
 * per tile even though it is constant `false` today, because that predicate is where the rule
 * lives: if some future tile ever does stop ember-sense, it takes effect here without anyone
 * remembering that it should. No test can kill a mutation that deletes this call — nothing it could
 * change is reachable — so `embersense.test.ts` pins the predicate itself across every tile kind
 * instead, which is the assertion that would actually catch the change.
 */
export function computeSensedField(grid: Grid, origin: Position, radius: number): TileSet {
  if (!inBounds(grid, origin.x, origin.y)) {
    throw new Error(
      `fov: cannot sense from (${origin.x}, ${origin.y}), outside the ${grid.width}x${grid.height} grid`,
    );
  }
  if (!Number.isInteger(radius) || radius < 0) {
    throw new Error(`fov: ember-sense radius must be a non-negative integer, got ${radius}`);
  }

  const flags = blankFlags(grid);
  for (let y = origin.y - radius; y <= origin.y + radius; y += 1) {
    for (let x = origin.x - radius; x <= origin.x + radius; x += 1) {
      if (!inBounds(grid, x, y)) continue;
      const index = tileIndex(grid, x, y);
      if (blocksEmberSense(grid.tiles[index])) continue;
      flags[index] = true;
    }
  }
  return sealTileSet(grid, flags);
}
