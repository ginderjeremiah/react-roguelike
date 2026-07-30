/**
 * `TileSet` — a set of grid tiles, stored as one flag per tile index.
 *
 * ## Why not a `Set<number>`
 *
 * Because it would be deleted again the first time a `GameState` containing one was compared.
 * `game/core/divergence.ts` **throws** on a `Map`, `Set`, or class instance: comparing them by
 * own-enumerable-keys reports different values as identical, so the replay tripwire would go quiet
 * instead of red. Everything FOV produces is destined for `GameState` (what the player has seen is
 * run state, not map state), so the representation is a plain row-major `boolean[]` — a bitset in
 * an array, which round-trips through JSON and compares field by field.
 *
 * It is also the right shape for the work: FOV asks "is this tile lit?" once per tile per frame,
 * which is an index, and it never needs insertion order — which is the other half of the rule, since
 * iterating a `Set` and letting the order matter is the determinism bug lint cannot catch.
 * `tileSetPositions` is the only way out of the set and it is row-major by construction.
 *
 * The dimensions travel with the flags so that a set built for one grid cannot be silently read
 * against another.
 */

import { tileIndex, type Grid, type Position } from '../map';

/** A set of tiles. Not a JS `Set` — see the header. */
export type TileSet = {
  readonly width: number;
  readonly height: number;
  /** Row-major, exactly `width * height` flags. `true` means the tile is a member. */
  readonly flags: readonly boolean[];
};

/**
 * A mutable flag array sized for `grid`, for a producer to fill in.
 *
 * Producers mutate this local array and then `sealTileSet` it. Local mutation of a value that has
 * not been published is not a purity violation; writing through a `TileSet` you were handed is.
 */
export function blankFlags(grid: Grid): boolean[] {
  return new Array<boolean>(grid.tiles.length).fill(false);
}

/**
 * Wrap a finished flag array as a `TileSet`.
 *
 * @throws if the array is not exactly one flag per tile. A short array reads as "everything past
 *   the end is unlit", which is a silently wrong field rather than a failure.
 */
export function sealTileSet(grid: Grid, flags: readonly boolean[]): TileSet {
  if (flags.length !== grid.tiles.length) {
    throw new Error(
      `fov: tile set has ${flags.length} flags for a ${grid.width}x${grid.height} grid ` +
        `(expected ${grid.tiles.length})`,
    );
  }
  return { width: grid.width, height: grid.height, flags };
}

/** The set containing nothing. */
export function emptyTileSet(grid: Grid): TileSet {
  return sealTileSet(grid, blankFlags(grid));
}

/**
 * Is `(x, y)` in the set?
 *
 * Out of bounds is `false` rather than a throw — unlike `tileAt`, whose callers are asking about a
 * tile that must exist. Every caller here is scanning neighbours and "off the edge is not lit" is
 * the answer it wants.
 */
export function hasTile(set: TileSet, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= set.width || y >= set.height) return false;
  return set.flags[y * set.width + x];
}

export function tileSetSize(set: TileSet): number {
  let count = 0;
  for (const flag of set.flags) if (flag) count += 1;
  return count;
}

/** Where index `i` of a set this shape sits. Local to this module; `positionOf` wants a whole `Grid`. */
function positionAt(set: TileSet, index: number): Position {
  const x = index % set.width;
  return { x, y: (index - x) / set.width };
}

/** Every member, row-major ascending. The only iteration order this module offers. */
export function tileSetPositions(set: TileSet): Position[] {
  const out: Position[] = [];
  for (let index = 0; index < set.flags.length; index += 1) {
    if (set.flags[index]) out.push(positionAt(set, index));
  }
  return out;
}

function assertSameShape(a: TileSet, b: TileSet, context: string): void {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `fov: ${context} needs two sets of the same shape, got ${a.width}x${a.height} and ${b.width}x${b.height}`,
    );
  }
}

/** Everything in either set. This is how terrain memory accumulates. */
export function unionTileSets(a: TileSet, b: TileSet): TileSet {
  assertSameShape(a, b, 'unionTileSets');
  const flags = new Array<boolean>(a.flags.length);
  for (let index = 0; index < flags.length; index += 1) flags[index] = a.flags[index] || b.flags[index];
  return { width: a.width, height: a.height, flags };
}

/** Is every member of `inner` also a member of `outer`? The shape of the §4 containment guarantee. */
export function tileSetContains(outer: TileSet, inner: TileSet): boolean {
  assertSameShape(outer, inner, 'tileSetContains');
  for (let index = 0; index < inner.flags.length; index += 1) {
    if (inner.flags[index] && !outer.flags[index]) return false;
  }
  return true;
}

/** Members of `inner` that are missing from `outer`, row-major. For a failure message that names them. */
export function tileSetDifference(inner: TileSet, outer: TileSet): Position[] {
  assertSameShape(outer, inner, 'tileSetDifference');
  const out: Position[] = [];
  for (let index = 0; index < inner.flags.length; index += 1) {
    if (inner.flags[index] && !outer.flags[index]) out.push(positionAt(inner, index));
  }
  return out;
}

export function tileSetsEqual(a: TileSet, b: TileSet): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let index = 0; index < a.flags.length; index += 1) {
    if (a.flags[index] !== b.flags[index]) return false;
  }
  return true;
}

/** A set holding exactly the given positions. Out-of-bounds positions are an error, not a no-op. */
export function tileSetOf(grid: Grid, positions: readonly Position[]): TileSet {
  // No sort: setting a flag is idempotent and commutative, so the input order cannot reach the
  // result. Sorting here would be a check that enforces nothing.
  const flags = blankFlags(grid);
  for (const at of positions) {
    if (at.x < 0 || at.y < 0 || at.x >= grid.width || at.y >= grid.height) {
      throw new Error(`fov: (${at.x}, ${at.y}) is outside the ${grid.width}x${grid.height} grid`);
    }
    flags[tileIndex(grid, at.x, at.y)] = true;
  }
  return sealTileSet(grid, flags);
}
