/**
 * How a creature works out which way is toward something. GDD §6: the Cinder "paths toward you".
 *
 * ## Why a distance field and not a greedy step
 *
 * "Step whichever way reduces the gap" walks into the wall between two rooms and stays there. §5
 * builds the level out of rooms joined by single-tile doorways precisely so that getting from A to B
 * is a route rather than a direction, so a creature that cannot find a doorway is a creature that
 * never arrives — and "the Cinder is drawn to light" would be a rule the player never sees.
 *
 * So: one breadth-first flood from the goal, giving the step distance from every passable tile, and
 * then a single step down the gradient. On an 11×15 grid that is 165 tiles of work per creature per
 * turn, which is nothing against the 2ms budget (`actors.bench.test.ts` measures it).
 *
 * ## Two rules that keep it legible, both deliberate
 *
 * **The field is computed over terrain alone — other actors are not obstacles in it.** A creature
 * therefore does not path *around* its neighbours; it takes the shortest terrain route, and if
 * something is standing in the next tile when the turn comes, the move fails and the turn is spent
 * (§2: a declared move can be blocked). Pathing around each other would be smarter and less
 * readable, and §2 chose "a legible enemy you can outwit" over a smart one you cannot read.
 *
 * **A step is only ever taken toward the goal.** Candidates that do not strictly reduce the
 * distance are refused rather than taken as a sidestep, which is what stops two creatures in a
 * doorway from oscillating forever and what makes "it got closer every turn" an assertable
 * property rather than an emergent hope.
 *
 * Ties — genuinely common on an open floor, where two steps reduce the distance equally — are
 * broken by the fixed order of `ORTHOGONAL_STEPS` (north, east, south, west). Fixed, because the
 * alternative is a draw, and a draw here would put the RNG on a path taken a variable number of
 * times per turn: exactly the conditional consumption that shifts a whole run's generator stream
 * and surfaces days later as an unrelated bug. **Nothing in `game/entities/` touches the RNG.**
 */

import {
  inBounds,
  isPassableAt,
  ORTHOGONAL_STEPS,
  tileIndex,
  type Grid,
  type Position,
} from '../map';
import type { ActorId } from '../systems/schedule';
import { isVacant, type ActorWorld } from './world';

/** Distance to the goal is unknown here: the tile is a wall, or walled off from the goal. */
export const UNREACHABLE = -1;

/**
 * Step distance from every tile to `goal`, over passable terrain, 4-directionally.
 *
 * Flat and row-major so it indexes exactly like `grid.tiles`. `UNREACHABLE` for walls, pillars, and
 * anything the goal cannot be walked to from.
 *
 * @throws if `goal` is out of bounds. An impassable goal is *not* an error — a creature can be sent
 *   to a tile a pillar was later placed on — and simply yields an all-`UNREACHABLE` field.
 */
export function stepDistanceField(grid: Grid, goal: Position): number[] {
  if (!inBounds(grid, goal.x, goal.y)) {
    throw new Error(`entities: goal (${goal.x}, ${goal.y}) is outside the grid`);
  }

  const distance = new Array<number>(grid.tiles.length).fill(UNREACHABLE);
  if (!isPassableAt(grid, goal.x, goal.y)) return distance;

  // A plain array used as a FIFO queue. Row-major indices, so the order the flood visits tiles is
  // fixed by the grid rather than by any collection's iteration order.
  const queue: Position[] = [goal];
  distance[tileIndex(grid, goal.x, goal.y)] = 0;

  for (let head = 0; head < queue.length; head += 1) {
    const at = queue[head];
    const next = distance[tileIndex(grid, at.x, at.y)] + 1;
    for (const step of ORTHOGONAL_STEPS) {
      const x = at.x + step.x;
      const y = at.y + step.y;
      if (!isPassableAt(grid, x, y)) continue;
      const index = tileIndex(grid, x, y);
      if (distance[index] !== UNREACHABLE) continue;
      distance[index] = next;
      queue.push({ x, y });
    }
  }

  return distance;
}

/**
 * The tile `mover` should step to in order to get closer to `goal`, or `null` if it cannot.
 *
 * `null` covers every "no move" case on purpose — already there, walled off, or every improving
 * step blocked by another actor — because the caller does the same thing with all of them: declare
 * a wait and try again next turn.
 */
export function stepToward(
  world: ActorWorld,
  mover: ActorId,
  from: Position,
  goal: Position,
): Position | null {
  const grid = world.floor.grid;
  const distance = stepDistanceField(grid, goal);
  const here = distance[tileIndex(grid, from.x, from.y)];
  if (here === UNREACHABLE || here === 0) return null;

  let best: Position | null = null;
  let bestDistance = here;

  for (const step of ORTHOGONAL_STEPS) {
    const candidate = { x: from.x + step.x, y: from.y + step.y };
    if (!inBounds(grid, candidate.x, candidate.y)) continue;
    const candidateDistance = distance[tileIndex(grid, candidate.x, candidate.y)];
    if (candidateDistance === UNREACHABLE || candidateDistance >= bestDistance) continue;
    if (!isVacant(world, candidate, mover)) continue;
    best = candidate;
    bestDistance = candidateDistance;
  }

  return best;
}
