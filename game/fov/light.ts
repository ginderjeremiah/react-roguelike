/**
 * Lit terrain: GDD §4's shutter-open vision.
 *
 * Chebyshev radius 4, line of sight blocked by walls and pillars. That is the entire rule, and it
 * is thin on purpose — the geometry lives in `shadowcast.ts` and the "what stops light" question
 * lives in `map/grid.ts`'s `blocksLight`, which is a separate predicate from `blocksMovement`
 * precisely so a future see-through obstacle is expressible.
 *
 * Radius 4 is not a taste: it is exactly the corner-to-corner Chebyshev span of the largest
 * unmerged room (5x5), so **one flash lights one room, from anywhere in it, and no further**. The
 * merged hall is 5x10 and is the one space a single flash cannot reveal. Both are tested.
 */

import { blocksLight, type Grid, type Position } from '../map';
import { shadowcast } from './shadowcast';
import { LIT_RADIUS } from './vision';
import type { TileSet } from './tileset';

/**
 * The terrain a flash reveals from `origin`.
 *
 * @param radius override for tests and for §4's *Open* item on an adjustable lit radius. Defaults
 *   to `LIT_RADIUS`; every caller in the game should take the default.
 */
export function computeLitField(grid: Grid, origin: Position, radius: number = LIT_RADIUS): TileSet {
  return shadowcast(grid, origin, radius, blocksLight);
}
