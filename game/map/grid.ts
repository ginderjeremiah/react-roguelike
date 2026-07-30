/**
 * Tiles and the grid they sit in.
 *
 * ## Why `Tile` is a union of single-field objects
 *
 * Every variant currently carries nothing but its `kind`, which makes `type Tile = 'wall' | 'floor'
 * | ...` look like the simpler model. It is rejected on purpose: `cache` will carry an ember amount
 * (§4 says 40, tuning) and `stairs` may carry a destination, and widening a bare string union into
 * an object union later means touching every comparison in the codebase. An object union costs one
 * `.kind` at each site today and nothing at all when the first payload arrives.
 *
 * The variants are exactly the seven the level generator can produce. There is no `unknown` or
 * `remembered` tile: what the *player* has seen is a property of the run, not of the map, and lives
 * with FOV. A map that knows about visibility is a map that cannot be generated without a player.
 *
 * ## Shape rules
 *
 * A `Grid` is plain JSON-shaped data — a flat, row-major array of tile objects plus its dimensions.
 * No `Map`, no `Set`, no class instance: `game/core/divergence.ts` throws on any of those, because
 * comparing them by own-enumerable-keys silently reports different values as identical, and this
 * grid is headed for `GameState`.
 *
 * Tile values are shared singletons (`WALL` and friends). Structural sharing between immutable
 * values is normal here — see `NO_OUTCOME` in `state.ts` — and it keeps a floor at 7 tile objects
 * rather than 165. Nothing may ever write *through* one of those references.
 */

import { assertNever } from '../core/assert';

/** What occupies a single cell. Terrain only — actors and the player are not tiles. */
export type Tile =
  | { readonly kind: 'wall' }
  | { readonly kind: 'floor' }
  | { readonly kind: 'pillar' }
  | { readonly kind: 'doorway' }
  | { readonly kind: 'entrance' }
  | { readonly kind: 'stairs' }
  | { readonly kind: 'cache' };

export type TileKind = Tile['kind'];

/** Every tile kind, in a fixed order. Iterate this, never `Object.keys` of a tile table. */
export const TILE_KINDS: readonly TileKind[] = [
  'wall',
  'floor',
  'pillar',
  'doorway',
  'entrance',
  'stairs',
  'cache',
];

export const WALL: Tile = { kind: 'wall' };
export const FLOOR: Tile = { kind: 'floor' };
export const PILLAR: Tile = { kind: 'pillar' };
export const DOORWAY: Tile = { kind: 'doorway' };
export const ENTRANCE: Tile = { kind: 'entrance' };
export const STAIRS: Tile = { kind: 'stairs' };
export const CACHE: Tile = { kind: 'cache' };

/** A cell coordinate. `x` is the column, `y` the row; the origin is the top-left. */
export type Position = { readonly x: number; readonly y: number };

/**
 * Row-major tiles plus dimensions. `tiles.length === width * height`, always.
 *
 * Flat array rather than an array of rows: one allocation, one bounds rule, and an index that can
 * be used as a key into parallel per-tile data (visited flags, light levels) without a nested
 * lookup. `index = y * width + x`.
 */
export type Grid = {
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly Tile[];
};

/** The four moves the player has. §9: movement is 4-directional, so this is *the* adjacency. */
export const ORTHOGONAL_STEPS: readonly Position[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

export function tileIndex(grid: Grid, x: number, y: number): number {
  return y * grid.width + x;
}

export function positionOf(grid: Grid, index: number): Position {
  return { x: index % grid.width, y: Math.floor(index / grid.width) };
}

export function inBounds(grid: Grid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height;
}

/** @throws if `(x, y)` is outside the grid — an out-of-bounds read is a bug, not a wall. */
export function tileAt(grid: Grid, x: number, y: number): Tile {
  if (!inBounds(grid, x, y)) {
    throw new Error(`map: (${x}, ${y}) is outside the ${grid.width}x${grid.height} grid`);
  }
  return grid.tiles[tileIndex(grid, x, y)];
}

/**
 * Can an actor stand here? Walls and pillars say no; everything else is walkable, including the
 * cache and the stairs (you walk onto them to use them — §9).
 *
 * Written as an exhaustive switch over every kind rather than `kind === 'wall' || kind === 'pillar'`
 * so that adding an eighth tile kind is a type error here instead of a silently-walkable surprise.
 */
export function blocksMovement(tile: Tile): boolean {
  switch (tile.kind) {
    case 'wall':
    case 'pillar':
      return true;
    case 'floor':
    case 'doorway':
    case 'entrance':
    case 'stairs':
    case 'cache':
      return false;
    default:
      return assertNever(tile, 'blocksMovement');
  }
}

/** The complement of `blocksMovement`, named for the direction most call sites read in. */
export function isPassable(tile: Tile): boolean {
  return !blocksMovement(tile);
}

/** As `isPassable`, but out of bounds is impassable rather than an error. For neighbour scans. */
export function isPassableAt(grid: Grid, x: number, y: number): boolean {
  return inBounds(grid, x, y) && isPassable(grid.tiles[tileIndex(grid, x, y)]);
}

/**
 * Does light stop here? Same set as movement today (walls and pillars), and deliberately a separate
 * function: GDD §5 gives the pillar three distinct properties — blocks movement, blocks light, does
 * *not* block ember-sense — and collapsing them into one predicate is how a later "see-through
 * rubble" tile ends up unimplementable.
 */
export function blocksLight(tile: Tile): boolean {
  switch (tile.kind) {
    case 'wall':
    case 'pillar':
      return true;
    case 'floor':
    case 'doorway':
    case 'entrance':
    case 'stairs':
    case 'cache':
      return false;
    default:
      return assertNever(tile, 'blocksLight');
  }
}

/**
 * Nothing blocks ember-sense. GDD §4: "Ember-sense ignores walls; light does not" — that asymmetry
 * is the whole reason darkness carries information, so it gets a named rule the FOV work has to
 * call rather than an assumption it has to remember.
 */
export function blocksEmberSense(tile: Tile): boolean {
  switch (tile.kind) {
    case 'wall':
    case 'pillar':
    case 'floor':
    case 'doorway':
    case 'entrance':
    case 'stairs':
    case 'cache':
      return false;
    default:
      return assertNever(tile, 'blocksEmberSense');
  }
}

/**
 * Manhattan (step) distance — the number of 4-directional moves between two tiles.
 *
 * This is the game's unit of *movement*: movement and attacks are 4-directional (GDD §3), so
 * "within N tiles" means "within N moves". Used for the creature/entrance spawn exclusion.
 *
 * **Not the metric for anything the player sees.** GDD §4 settled that (issue #25) and drew the
 * line as: *anything the player reads as a region on the screen is Chebyshev; anything counted as
 * steps of movement is Manhattan*. Light is a field and is measured by looking at it, so it is
 * `chebyshevDistance`; the spawn exclusion asks "how many turns before that is on me", so it is
 * this one. Manhattan light would render as a diamond and leave room corners dark for no visible
 * cause.
 */
export function manhattanDistance(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * Chebyshev (king-move) distance — `max(|dx|, |dy|)`, a square.
 *
 * **The metric for every vision radius** (GDD §4, issue #25): the lit radius, the dark touch
 * radius, ember-sense, and every value the dark-adaptation ramp passes through. `game/fov/` is the
 * consumer. Two consequences worth knowing before changing anything here: "radius 1 is the 8 tiles
 * you can touch" is only true under this metric, and light and ember-sense sharing it is what makes
 * the lit region a subset of the sensed one — §4's "everything a flash can wake, you can already
 * feel".
 *
 * The shadowcaster does not call this: a wedge scan's depth *is* the major axis, so it produces the
 * square directly. This is the metric for the box scans and for asserting the shape from outside.
 */
export function chebyshevDistance(a: Position, b: Position): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function samePosition(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Total order on positions: row-major. For sorting anything before it is iterated. */
export function comparePositions(a: Position, b: Position): number {
  return a.y === b.y ? a.x - b.x : a.y - b.y;
}
