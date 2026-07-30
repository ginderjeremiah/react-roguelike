/**
 * Shuttered terrain: the tiles you can reach out and feel.
 *
 * GDD §4 — "Chebyshev radius 1 only, all 8 tiles you can touch, **no line-of-sight check**". This
 * file therefore contains no visibility pass and must not grow one: at radius 1 there is nothing
 * between you and a neighbour that could occlude it, so an LOS pass here would be a check that
 * cannot ever change the answer, which is worse than no check at all.
 *
 * The consequence that matters is the diagonal. Between two walls meeting at a corner, the diagonal
 * tile is still felt — you can feel a corner, and a shadowcaster would not give you that. §4's
 * metric ruling names this as the evidence that the game had already committed to Chebyshev:
 * "radius 1, the 8 tiles you can touch" is only 8 tiles under Chebyshev.
 *
 * Walls are felt too. Feeling your way along a wall is the point; it is how the dark is navigable.
 */

import { inBounds, tileIndex, type Grid, type Position } from '../map';
import { blankFlags, sealTileSet, type TileSet } from './tileset';
import { DARK_TOUCH_RADIUS } from './vision';

/**
 * The 3x3 block centred on `origin`, clipped to the grid. Nine tiles in open ground, fewer at an
 * edge, and every tile kind included.
 *
 * The loop bounds *are* the Chebyshev metric — every tile they visit satisfies
 * `max(|dx|, |dy|) <= radius` by construction, so there is no distance predicate to get wrong.
 *
 * @throws if the origin is off the grid. You cannot feel around from nowhere.
 */
export function computeTouchField(
  grid: Grid,
  origin: Position,
  radius: number = DARK_TOUCH_RADIUS,
): TileSet {
  if (!inBounds(grid, origin.x, origin.y)) {
    throw new Error(
      `fov: cannot feel from (${origin.x}, ${origin.y}), outside the ${grid.width}x${grid.height} grid`,
    );
  }
  if (!Number.isInteger(radius) || radius < 0) {
    throw new Error(`fov: touch radius must be a non-negative integer, got ${radius}`);
  }

  const flags = blankFlags(grid);
  for (let y = origin.y - radius; y <= origin.y + radius; y += 1) {
    for (let x = origin.x - radius; x <= origin.x + radius; x += 1) {
      if (inBounds(grid, x, y)) flags[tileIndex(grid, x, y)] = true;
    }
  }
  return sealTileSet(grid, flags);
}
