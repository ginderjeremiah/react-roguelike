/**
 * Recursive shadowcasting — **the only line-of-sight code in the project**.
 *
 * Nothing else may compute visibility. Ember-sense in particular must never reach this file: it
 * passes through stone by design (GDD §4), and the way that rule gets broken is by someone
 * "reusing the visibility pass" for it. `embersense.ts` does not import this module and a test
 * asserts that it does not.
 *
 * ## The variant: symmetric shadowcasting, and why that one
 *
 * This is Albert Ford's symmetric recursive shadowcasting, not the classic Björn Bergström variant
 * that most roguelikes ship. They differ in one line — whether a floor tile is revealed because the
 * scan reached it, or only when the tile's **centre** lies inside the scanned wedge — and that line
 * is the difference between an FOV that is symmetric and one that is not.
 *
 * Symmetry is a rule here, not a nicety. GDD §4 gives creatures and the player the same senses at
 * the same reach, so "I can see it" and "it can see me" have to be the same proposition. The
 * classic variant makes them different for tiles adjacent to a wall corner, and the resulting bug
 * is invisible until an enemy shoots you through a wall you cannot see through. It is property
 * tested in `shadowcast.test.ts` over every passable pair on generated floors.
 *
 * The cost of symmetry is that a few tiles behind a corner that a "generous" FOV would light stay
 * dark. That is the correct trade for this game: §4's promise is that the player can state the rule.
 *
 * The error is **not** one-directional, though, and an earlier version of this comment implied it
 * was. Shadowcasting approximates an occluder's angular width by its width at its own centre row,
 * so it also lights some tiles a strict centre-to-centre raycast would call blocked. Measured over
 * six generated floors at radius 4, ~12% of lit floor-tile relations have a centre-to-centre
 * segment clipping the interior of an opaque tile, up to a quarter of the segment's length. This
 * is Ford's algorithm exactly and it stays symmetric — which is the property that matters — but do
 * not describe it as conservative.
 *
 * ## Why there is no radius check
 *
 * The metric is Chebyshev (issue #25, GDD §4): `max(|dx|, |dy|) <= r`. A quadrant scan walks
 * outward in rows whose `depth` **is** the major axis, and every tile in a row satisfies
 * `|column| <= depth`. So `depth <= radius` *is* `max(|dx|, |dy|) <= radius`, exactly, and stopping
 * the recursion at `depth > radius` produces the square with no distance predicate anywhere in the
 * file. Adding one — `chebyshevDistance(...) <= radius`, or worse a Euclidean one — would be either
 * dead code or a silent change of the shape to a disc. Do not add one.
 *
 * ## Why the slopes are exact fractions
 *
 * Shadowcasting compares a tile's column against `depth * slope`. Done in floating point that is
 * deterministic (IEEE-754 doubles are exactly specified, so a replay would still reproduce), but it
 * is decided by rounding at the boundary, and the boundary is exactly where the wedge edges lie —
 * every slope in the algorithm has the form `(2c - 1) / 2d`. Comparing `num/den` pairs by
 * cross-multiplication keeps every comparison exact with integers under a thousand, so the lit
 * shape is the one the geometry says it is rather than the one the rounding chose.
 *
 * ## Out of bounds is opaque
 *
 * The level has no perimeter wall — `lattice.ts`: rooms sit flush against the screen edge, which is
 * the boundary of the world. Treating off-grid tiles as opaque (and never revealing them) means the
 * scan stops at the edge instead of running to the radius through imaginary open space.
 *
 * The choice is **unobservable**, which is worth knowing before someone tries to "fix" it: the
 * columns that fall off an edge are contiguous at the end of a row and stay off it at every greater
 * depth, so treating them as floor instead produces a byte-identical field. That was checked rather
 * than argued — flipping the predicate and comparing 26,400 fields (20 floors x every tile x eight
 * radii) gave no difference. Mutation testing reports it as a surviving mutant for that reason, and
 * it is a genuinely equivalent one; opaque is kept because it stops the scan sooner.
 */

import { inBounds, tileIndex, type Grid, type Position, type Tile } from '../map';
import { blankFlags, sealTileSet, type TileSet } from './tileset';

/** An exact rational `num / den`, with `den > 0` always. Compared, never evaluated. */
type Slope = { readonly num: number; readonly den: number };

/** The full wedge: a quadrant spans slopes -1 to 1, which is the 90 degrees it owns. */
const WEDGE_START: Slope = { num: -1, den: 1 };
const WEDGE_END: Slope = { num: 1, den: 1 };

/**
 * A 90-degree wedge, as the linear map from `(depth, column)` to grid coordinates:
 * `x = origin.x + xDepth * depth + xColumn * column`, and likewise for `y`.
 *
 * Four of them cover the plane. The two diagonals of each wedge are shared with a neighbour, so
 * those tiles are scanned twice and the result is the union — which is what keeps the whole field
 * symmetric even though each wedge is scanned independently.
 */
type Wedge = {
  readonly xDepth: number;
  readonly xColumn: number;
  readonly yDepth: number;
  readonly yColumn: number;
};

/** North, east, south, west. A fixed array, iterated in order; the union is order-independent. */
const WEDGES: readonly Wedge[] = [
  { xDepth: 0, xColumn: 1, yDepth: -1, yColumn: 0 },
  { xDepth: 1, xColumn: 0, yDepth: 0, yColumn: 1 },
  { xDepth: 0, xColumn: 1, yDepth: 1, yColumn: 0 },
  { xDepth: -1, xColumn: 0, yDepth: 0, yColumn: 1 },
];

/** Everything one wedge scan needs. Only `flags` is written to. */
type Scan = {
  readonly grid: Grid;
  readonly origin: Position;
  readonly radius: number;
  readonly blocks: (tile: Tile) => boolean;
  readonly wedge: Wedge;
  readonly flags: boolean[];
};

/** Rounds toward negative infinity, unlike `/` and unlike `Math.trunc`. */
function floorDiv(numerator: number, denominator: number): number {
  return Math.floor(numerator / denominator);
}

/**
 * The slope of the leading edge of the tile at `(depth, column)` — the line through the origin and
 * the tile's near corner, `(column - 1/2) / depth`.
 */
function edgeSlope(depth: number, column: number): Slope {
  return { num: 2 * column - 1, den: 2 * depth };
}

/** The leftmost column of the row: `round(depth * start)`, ties away from the wedge's interior. */
function minColumn(depth: number, start: Slope): number {
  // floor(depth * num/den + 1/2), kept in integers.
  return floorDiv(2 * depth * start.num + start.den, 2 * start.den);
}

/** The rightmost column of the row: `round(depth * end)`, ties away from the wedge's interior. */
function maxColumn(depth: number, end: Slope): number {
  // ceil(depth * num/den - 1/2) == -floor((den - 2 * depth * num) / (2 * den)).
  return -floorDiv(end.den - 2 * depth * end.num, 2 * end.den);
}

/**
 * Is the tile's **centre** inside the wedge?
 *
 * This is the whole of the symmetry property. A tile whose centre is inside the wedge can see the
 * origin's centre by the same line that lets the origin see it, so visibility is mutual. A tile
 * merely clipped by the wedge cannot, and the classic algorithm lights it anyway.
 */
function centreInWedge(depth: number, column: number, start: Slope, end: Slope): boolean {
  return column * start.den >= depth * start.num && column * end.den <= depth * end.num;
}

function projectX(scan: Scan, depth: number, column: number): number {
  return scan.origin.x + scan.wedge.xDepth * depth + scan.wedge.xColumn * column;
}

function projectY(scan: Scan, depth: number, column: number): number {
  return scan.origin.y + scan.wedge.yDepth * depth + scan.wedge.yColumn * column;
}

/** Off the grid counts as opaque — see the header. */
function isOpaque(scan: Scan, depth: number, column: number): boolean {
  const x = projectX(scan, depth, column);
  const y = projectY(scan, depth, column);
  if (!inBounds(scan.grid, x, y)) return true;
  return scan.blocks(scan.grid.tiles[tileIndex(scan.grid, x, y)]);
}

/** Mark a tile visible. Off-grid tiles block but are never revealed; there is nothing there. */
function reveal(scan: Scan, depth: number, column: number): void {
  const x = projectX(scan, depth, column);
  const y = projectY(scan, depth, column);
  if (!inBounds(scan.grid, x, y)) return;
  scan.flags[tileIndex(scan.grid, x, y)] = true;
}

/**
 * Scan one row of one wedge, recursing into the rows behind it.
 *
 * `start` narrows as the row is walked — a wall ends and the floor after it can only be seen from
 * the angle past that wall's corner. `end` is fixed for this row; a floor-to-wall transition spawns
 * a child scan of the rows behind the *gap*, bounded by the wall's near edge.
 *
 * The row's column range is computed once, from the slopes the row was entered with, before any of
 * that narrowing happens. Narrowing `start` mid-row must not change which tiles this row visits,
 * only what the rows behind it can see.
 */
function scanRow(scan: Scan, depth: number, entryStart: Slope, end: Slope): void {
  if (depth > scan.radius) return;

  const first = minColumn(depth, entryStart);
  const last = maxColumn(depth, end);

  let start = entryStart;
  let previousOpaque = false;
  let hasPrevious = false;

  for (let column = first; column <= last; column += 1) {
    const opaque = isOpaque(scan, depth, column);

    // Walls are revealed whenever the scan reaches them, floors only when their centre is in the
    // wedge. Revealing wall faces the wedge only clips is what makes a room look like a room; it
    // costs nothing in symmetry, because a wall is never somewhere a creature can look from.
    if (opaque || centreInWedge(depth, column, start, end)) reveal(scan, depth, column);

    if (hasPrevious && previousOpaque && !opaque) {
      start = edgeSlope(depth, column);
    } else if (hasPrevious && !previousOpaque && opaque) {
      scanRow(scan, depth + 1, start, edgeSlope(depth, column));
    }

    previousOpaque = opaque;
    hasPrevious = true;
  }

  // The row ended on open floor, so the wedge continues unbroken into the next row.
  if (hasPrevious && !previousOpaque) scanRow(scan, depth + 1, start, end);
}

/**
 * Every tile visible from `origin` within Chebyshev `radius`, given what `blocks` says is opaque.
 *
 * The origin is always visible: you know the tile you are standing on. `radius` 0 is legal and
 * means exactly that tile.
 *
 * @throws if the origin is off the grid, or the radius is negative — both are caller bugs, and a
 *   quietly empty field is the hardest possible symptom to trace back.
 */
export function shadowcast(
  grid: Grid,
  origin: Position,
  radius: number,
  blocks: (tile: Tile) => boolean,
): TileSet {
  if (!inBounds(grid, origin.x, origin.y)) {
    throw new Error(
      `fov: cannot cast from (${origin.x}, ${origin.y}), outside the ${grid.width}x${grid.height} grid`,
    );
  }
  if (!Number.isInteger(radius) || radius < 0) {
    throw new Error(`fov: radius must be a non-negative integer, got ${radius}`);
  }

  const flags = blankFlags(grid);
  flags[tileIndex(grid, origin.x, origin.y)] = true;

  for (const wedge of WEDGES) {
    scanRow({ grid, origin, radius, blocks, wedge, flags }, 1, WEDGE_START, WEDGE_END);
  }

  return sealTileSet(grid, flags);
}
