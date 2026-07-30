/**
 * The fixed 2 x 3 room lattice: where rooms may sit, which pairs are adjacent, and which wall they
 * share. Pure geometry — no randomness lives here.
 *
 * ```
 *      x: 0 1 2 3 4  5  6 7 8 9 10
 *  y:  0  ┌────────┐ │ ┌─────────┐
 *      3  │ room 0 │ │ │  room 1 │      column separator: x = 5
 *      4  ├────────┼─┼─┼─────────┤      row separators:   y = 4, y = 10
 *      5  │ room 2 │ │ │  room 3 │
 *      9  ├────────┼─┼─┼─────────┤
 *     11  │ room 4 │ │ │  room 5 │
 *     14  └────────┘ │ └─────────┘
 * ```
 *
 * ## The one place this deviates from GDD §5, and why
 *
 * §5 gives `height = 4 + 1 + 4 + 1 + 4 = 15`. That sum is 14, not 15 — the stated decomposition and
 * the stated grid size contradict each other. The grid size wins: **11 x 15 is bolded twice, derived
 * from a 390px phone at ~35px taps, called out as an ADR-level decision in issue #13, and is one of
 * the property-tested invariants**, whereas the decomposition is arithmetic in a prose block.
 *
 * The extra row goes to the middle band: `4 + 1 + 5 + 1 + 4 = 15`. Chosen over giving it to the top
 * or bottom band because it is the only assignment that keeps the lattice vertically symmetric, so
 * no floor has a systematically roomier corner. Rooms are then 5x4, 5x5, 5x4 before jitter — still
 * "six rooms of ~20 tiles" (20 / 25 / 20).
 *
 * **This needs a one-line GDD correction**; it is flagged in the journal entry for #13. Do not
 * "fix" it back to three 4-tall bands without changing `FLOOR_HEIGHT`, which would break the
 * invariant test and the tap-target derivation behind it.
 *
 * ## Rooms are flush with the grid edge
 *
 * `width = 5 + 1 + 5` leaves nothing for a perimeter wall, and that is intended: the lattice walls
 * *separate* rooms, they do not *enclose* the level. The screen edge is the boundary. Nothing may
 * assume a wall ring exists — `inBounds` is the only guard.
 */

/** GDD §5. Derived from the screen (Pillar 3), not chosen aesthetically. Do not change lightly. */
export const FLOOR_WIDTH = 11;
export const FLOOR_HEIGHT = 15;

export const ROOM_COLUMNS = 2;
export const ROOM_ROWS = 3;
export const ROOM_COUNT = ROOM_COLUMNS * ROOM_ROWS;

/** An inclusive `[min, max]` interval of cell coordinates. */
export type Span = { readonly min: number; readonly max: number };

/** Full x extent of each room column, before jitter. */
export const COLUMN_SPANS: readonly Span[] = [
  { min: 0, max: 4 },
  { min: 6, max: 10 },
];

/** Full y extent of each room row, before jitter. The middle band is 5 tall — see the header. */
export const ROW_SPANS: readonly Span[] = [
  { min: 0, max: 3 },
  { min: 5, max: 9 },
  { min: 11, max: 14 },
];

/** The single wall column between the two room columns. */
export const COLUMN_SEPARATOR_X = 5;

/** The wall rows between room row 0/1 and room row 1/2. */
export const ROW_SEPARATOR_Y: readonly number[] = [4, 10];

/** Index into `Floor.rooms`, equal to `row * ROOM_COLUMNS + col`. */
export type RoomId = number;

export function roomIdAt(col: number, row: number): RoomId {
  return row * ROOM_COLUMNS + col;
}

export function roomColumn(id: RoomId): number {
  return id % ROOM_COLUMNS;
}

export function roomRow(id: RoomId): number {
  return Math.floor(id / ROOM_COLUMNS);
}

/**
 * The wall two adjacent rooms share: either a stretch of the separator column, or a stretch of a
 * separator row. A union rather than an `axis: 'x' | 'y'` flag plus a coordinate, so that reading
 * the coordinate requires knowing which kind of wall it is.
 */
export type SharedWall =
  | { readonly kind: 'column'; readonly x: number }
  | { readonly kind: 'row'; readonly y: number };

/** A possible connection between two lattice rooms. Seven of them exist; see `LATTICE_EDGES`. */
export type LatticeEdge = {
  readonly id: number;
  /** Always ascending, so `rooms[0] < rooms[1]`. */
  readonly rooms: readonly [RoomId, RoomId];
  readonly wall: SharedWall;
};

/**
 * Every adjacent room pair, in a fixed source order that the generator's draw sequence depends on.
 *
 * **Reordering this array changes what every existing seed produces.** It is not a cosmetic list;
 * `chooseLinks` shuffles these ids and `chooseDoorways` walks them in order. A change here is a
 * rules change and needs a `RULES_VERSION` bump.
 *
 * Ids 0-2 are the side-by-side pairs (shared wall is a column), 3-6 the stacked pairs (shared wall
 * is a row). Only the stacked pairs can merge — see `MERGEABLE_EDGE_IDS`.
 */
export const LATTICE_EDGES: readonly LatticeEdge[] = [
  { id: 0, rooms: [0, 1], wall: { kind: 'column', x: COLUMN_SEPARATOR_X } },
  { id: 1, rooms: [2, 3], wall: { kind: 'column', x: COLUMN_SEPARATOR_X } },
  { id: 2, rooms: [4, 5], wall: { kind: 'column', x: COLUMN_SEPARATOR_X } },
  { id: 3, rooms: [0, 2], wall: { kind: 'row', y: 4 } },
  { id: 4, rooms: [2, 4], wall: { kind: 'row', y: 10 } },
  { id: 5, rooms: [1, 3], wall: { kind: 'row', y: 4 } },
  { id: 6, rooms: [3, 5], wall: { kind: 'row', y: 10 } },
];

export const LATTICE_EDGE_IDS: readonly number[] = LATTICE_EDGES.map((edge) => edge.id);

/**
 * Edges a room merge may delete. Stacked pairs only.
 *
 * §5 describes the merge result as "a 5x9 hall", a shape only a vertical merge produces — a
 * side-by-side merge would give an 11-wide band spanning the whole floor, which is a different
 * design idea and is not what the GDD asked for.
 */
export const MERGEABLE_EDGE_IDS: readonly number[] = [3, 4, 5, 6];
