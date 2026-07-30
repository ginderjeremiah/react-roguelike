/**
 * What makes a floor legal: it is one connected space, and it contains no corridor.
 *
 * ## Why this is production code and not a test helper
 *
 * The generator *uses* it. Pillar placement asks "would this tile still leave a sound floor?" and
 * only draws from the tiles where the answer is yes, which is what lets pillars be placed without
 * rejection sampling (see the draw-count note in `generate.ts`). The property tests then assert the
 * same predicate over the finished floor from the outside.
 *
 * That overlap is deliberate but it is also the classic way a suite goes vacuous: if `isConnected`
 * were broken to always return `true`, the generator would place pillars anywhere and the property
 * test would still pass. The defence is that `soundness.test.ts` exercises every function here
 * against hand-built grids with known answers, including grids that are *not* sound. Those tests
 * do not call the generator at all.
 *
 * ## What "no corridors" means, mechanically
 *
 * GDD §5: "a corridor is a sequence of turns with one legal move". §9 settles movement as
 * 4-directional, so the adjacency is orthogonal and the analysis is:
 *
 *   - **dead end** — a passable tile with fewer than two exits. Standing there, the only move is
 *     back the way you came. One tile of it is already a turn that should not exist.
 *   - **pinch** — a passable tile with exactly two exits that are *opposite* each other: a
 *     through-passage. A single pinch is a **threshold**, which §5 explicitly allows ("rooms and
 *     thresholds only"); a doorway is exactly this.
 *   - **corridor** — two adjacent pinches. That is the shortest sequence that is a passage rather
 *     than a doorway, and it is what is forbidden.
 *
 * A tile with two exits that meet at a right angle is a room corner, not a passage, which is why
 * "exactly two exits" alone is not the test.
 */

import {
  isPassable,
  isPassableAt,
  ORTHOGONAL_STEPS,
  positionOf,
  tileIndex,
  type Grid,
  type Position,
} from './grid';

/** Indices of every passable tile, ascending (row-major). Safe to iterate. */
export function passableIndices(grid: Grid): number[] {
  const out: number[] = [];
  for (let index = 0; index < grid.tiles.length; index += 1) {
    if (isPassable(grid.tiles[index])) out.push(index);
  }
  return out;
}

/**
 * Flood fill from `start`, 4-connected through passable tiles.
 *
 * @returns one flag per tile index; `true` where the tile is passable and reachable.
 * @throws if `start` is impassable — filling from a wall would return an all-`false` map, which
 *   every caller would read as "nothing is connected" and none would read as "you asked wrong".
 */
export function reachableFrom(grid: Grid, start: Position): boolean[] {
  if (!isPassableAt(grid, start.x, start.y)) {
    throw new Error(`map: cannot flood fill from impassable tile (${start.x}, ${start.y})`);
  }

  const reached: boolean[] = new Array<boolean>(grid.tiles.length).fill(false);
  const stack: number[] = [tileIndex(grid, start.x, start.y)];
  reached[stack[0]] = true;

  while (stack.length > 0) {
    const index = stack.pop() as number;
    const here = positionOf(grid, index);
    for (const step of ORTHOGONAL_STEPS) {
      const x = here.x + step.x;
      const y = here.y + step.y;
      if (!isPassableAt(grid, x, y)) continue;
      const next = tileIndex(grid, x, y);
      if (reached[next]) continue;
      reached[next] = true;
      stack.push(next);
    }
  }
  return reached;
}

/** Is `to` reachable from `from` by 4-directional movement through passable tiles? */
export function isReachable(grid: Grid, from: Position, to: Position): boolean {
  if (!isPassableAt(grid, to.x, to.y)) return false;
  return reachableFrom(grid, from)[tileIndex(grid, to.x, to.y)];
}

/** How many of the four orthogonal neighbours of `(x, y)` can be stepped onto. */
export function exitCount(grid: Grid, x: number, y: number): number {
  let count = 0;
  for (const step of ORTHOGONAL_STEPS) {
    if (isPassableAt(grid, x + step.x, y + step.y)) count += 1;
  }
  return count;
}

/**
 * A through-passage: passable, exactly two exits, and they are opposite each other.
 *
 * True for every doorway by construction. One of these is a threshold; two adjacent ones are a
 * corridor.
 */
export function isPinch(grid: Grid, x: number, y: number): boolean {
  if (!isPassableAt(grid, x, y)) return false;
  const north = isPassableAt(grid, x, y - 1);
  const south = isPassableAt(grid, x, y + 1);
  const east = isPassableAt(grid, x + 1, y);
  const west = isPassableAt(grid, x - 1, y);
  const count = (north ? 1 : 0) + (south ? 1 : 0) + (east ? 1 : 0) + (west ? 1 : 0);
  if (count !== 2) return false;
  return (north && south) || (east && west);
}

/** Every passable tile with fewer than two exits, row-major. */
export function findDeadEnds(grid: Grid): Position[] {
  const out: Position[] = [];
  for (const index of passableIndices(grid)) {
    const at = positionOf(grid, index);
    if (exitCount(grid, at.x, at.y) < 2) out.push(at);
  }
  return out;
}

/**
 * Every adjacent pair of pinches, row-major, each pair reported once (the second tile is always
 * east or south of the first).
 */
export function findCorridors(grid: Grid): (readonly [Position, Position])[] {
  const out: (readonly [Position, Position])[] = [];
  for (const index of passableIndices(grid)) {
    const at = positionOf(grid, index);
    if (!isPinch(grid, at.x, at.y)) continue;
    // Only east and south, so a pair is not reported twice from both ends.
    for (const step of [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ]) {
      const next = { x: at.x + step.x, y: at.y + step.y };
      if (isPinch(grid, next.x, next.y)) out.push([at, next] as const);
    }
  }
  return out;
}

/**
 * Every reason the floor is illegal, as readable strings. Empty means sound.
 *
 * Strings rather than a code enum because the only consumers are an assertion message and a
 * developer reading it; a `FloorProblem` union would be ceremony around `join('\n')`.
 */
export function findSoundnessProblems(grid: Grid): string[] {
  const problems: string[] = [];

  const passable = passableIndices(grid);
  if (passable.length === 0) {
    problems.push('no passable tiles at all');
    return problems;
  }

  const origin = positionOf(grid, passable[0]);
  const reached = reachableFrom(grid, origin);
  const unreachable = passable.filter((index) => !reached[index]);
  if (unreachable.length > 0) {
    const first = positionOf(grid, unreachable[0]);
    problems.push(
      `floor is not connected: ${unreachable.length} of ${passable.length} passable tiles are ` +
        `unreachable from (${origin.x}, ${origin.y}), first at (${first.x}, ${first.y})`,
    );
  }

  for (const at of findDeadEnds(grid)) {
    problems.push(`dead end at (${at.x}, ${at.y}): fewer than two exits`);
  }

  for (const [a, b] of findCorridors(grid)) {
    problems.push(
      `corridor: through-passages at (${a.x}, ${a.y}) and (${b.x}, ${b.y}) are adjacent`,
    );
  }

  return problems;
}

/**
 * Connected, no dead ends, no corridors — the same question `findSoundnessProblems` answers, in a
 * form that short-circuits and allocates almost nothing.
 *
 * ## Why this is a second implementation instead of `findSoundnessProblems(g).length === 0`
 *
 * That is what it was, and it made floor generation cost **2.7ms per floor** on a desktop, against
 * a 2ms budget for an entire turn on a mid-range phone. The generator asks this question once per
 * candidate tile per pillar — roughly 240 times per floor — and the descriptive version allocates a
 * position object and several arrays per call. Measured, then fixed; the benchmark in
 * `generate.bench.test.ts` is what noticed, and it is why ARCHITECTURE.md asks for one here.
 *
 * Two implementations of one predicate is a real hazard: they can drift, and the fast one is the
 * one the generator trusts. `soundness.test.ts` pins them together — it asserts they agree on every
 * hand-built grid, on every generated floor, and on thousands of grids with a tile knocked out,
 * which is exactly the perturbation the generator performs.
 */
export function isSound(grid: Grid): boolean {
  const { width, height, tiles } = grid;
  const size = tiles.length;

  const open = new Uint8Array(size);
  let start = -1;
  let openCount = 0;
  for (let index = 0; index < size; index += 1) {
    if (!isPassable(tiles[index])) continue;
    open[index] = 1;
    openCount += 1;
    if (start < 0) start = index;
  }
  if (openCount === 0) return false;

  // Dead ends and through-passages in one pass. Bounds are checked by coordinate rather than by
  // calling isPassableAt, so the inner loop touches no objects at all.
  const pinch = new Uint8Array(size);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (open[index] === 0) continue;
      const north = y > 0 && open[index - width] === 1;
      const south = y < height - 1 && open[index + width] === 1;
      const east = x < width - 1 && open[index + 1] === 1;
      const west = x > 0 && open[index - 1] === 1;
      const exits = (north ? 1 : 0) + (south ? 1 : 0) + (east ? 1 : 0) + (west ? 1 : 0);
      if (exits < 2) return false;
      if (exits === 2 && ((north && south) || (east && west))) pinch[index] = 1;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (pinch[index] === 0) continue;
      if (x < width - 1 && pinch[index + 1] === 1) return false;
      if (y < height - 1 && pinch[index + width] === 1) return false;
    }
  }

  const seen = new Uint8Array(size);
  const stack: number[] = [start];
  seen[start] = 1;
  let reached = 1;
  while (stack.length > 0) {
    const index = stack.pop() as number;
    const x = index % width;
    const y = (index - x) / width;
    if (y > 0 && open[index - width] === 1 && seen[index - width] === 0) {
      seen[index - width] = 1;
      reached += 1;
      stack.push(index - width);
    }
    if (y < height - 1 && open[index + width] === 1 && seen[index + width] === 0) {
      seen[index + width] = 1;
      reached += 1;
      stack.push(index + width);
    }
    if (x > 0 && open[index - 1] === 1 && seen[index - 1] === 0) {
      seen[index - 1] = 1;
      reached += 1;
      stack.push(index - 1);
    }
    if (x < width - 1 && open[index + 1] === 1 && seen[index + 1] === 0) {
      seen[index + 1] = 1;
      reached += 1;
      stack.push(index + 1);
    }
  }

  return reached === openCount;
}
