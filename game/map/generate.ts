/**
 * The chambered-ruin generator. GDD §5, step for step.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE DRAW-COUNT DECISION — read before adding or removing a draw
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * **`generateFloor` consumes exactly `54 + creatureCount(floorNumber)` draws. The count is a pure
 * function of the floor number and does not vary with the seed.** `expectedDrawCount` states it,
 * `generate.test.ts` counts the generator's actual advance and asserts equality across many seeds.
 *
 * Two techniques buy that, and both are deliberate:
 *
 * 1. **No rejection sampling anywhere.** The naive way to place a pillar is "pick a tile, retry if
 *    it is occupied or would wall something off". That consumes a seed-dependent number of draws.
 *    Instead every placement first builds a *candidate list* — deterministically filtered from the
 *    grid as it stands, scanned row-major so its order never depends on iteration order — and then
 *    spends exactly one draw indexing into it. `chooseFrom` is the only way a position is chosen.
 *
 * 2. **Optional things still draw.** "0-2 pillars per room" rolls the count, then runs two slots
 *    and consumes a draw for each even when the slot is unused (`skipDraw`). Likewise the loop
 *    doorways, the caches, and the doorway position of an edge that turns out not to get a doorway.
 *    A handful of drawn values are discarded; the alternative is a draw count that depends on drawn
 *    values, which is precisely the fragility `rng/draw.ts` describes.
 *
 * Why go to the trouble, when a variable count would still be *deterministic*? Because a fixed
 * count is testable. A test can assert "generating floor 1 advances the generator by exactly 57
 * steps", and then a stray conditional draw added by a later change fails that test at the point it
 * is introduced, instead of silently shifting every subsequent value in the run and surfacing a
 * fortnight later as an unrelated bug. See the contract at the top of `rng/draw.ts`; this module is
 * the first real consumer of it and holds itself to the same standard.
 *
 * **Consequence: the order of the steps below is part of the rules.** Reordering them, or changing
 * the order of `LATTICE_EDGES`, changes what every existing seed produces and needs a
 * `RULES_VERSION` bump.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## How connectivity is guaranteed rather than checked
 *
 * Jitter only ever pulls a room *away from the screen edge*, never away from a wall it shares with
 * a neighbour. So the two rooms on either side of a shared wall always touch it, and a doorway
 * carved at any position within the overlap of their extents necessarily has room floor on both
 * sides. A random spanning tree over the six rooms then makes the room graph connected by
 * construction, and every later step (pillars especially) is filtered so it cannot break it.
 *
 * ## How "no corridors" is guaranteed
 *
 * Doorways are one tile in a one-tile-thick wall, and no two of them can be adjacent: each lattice
 * edge gets at most one doorway, and doorways on different walls are always separated by at least
 * the wall junction tile. A single through-passage is a *threshold*, which §5 allows. Pillars are
 * the one thing that could manufacture a passage, so a pillar is only ever placed on a tile that
 * leaves the whole floor sound — see `soundness.ts` for what that means.
 */

import { int, shuffle, weighted, type Draw, type Rng } from '../rng';
import {
  CACHE,
  manhattanDistance,
  DOORWAY,
  ENTRANCE,
  FLOOR,
  PILLAR,
  positionOf,
  STAIRS,
  WALL,
  type Grid,
  type Position,
  type Tile,
} from './grid';
import {
  NO_MERGE,
  type CreatureSpawn,
  type Doorway,
  type Floor,
  type Merge,
  type Room,
} from './floor';
import {
  COLUMN_SPANS,
  FLOOR_HEIGHT,
  FLOOR_WIDTH,
  LATTICE_EDGE_IDS,
  LATTICE_EDGES,
  MERGEABLE_EDGE_IDS,
  ROOM_COUNT,
  roomColumn,
  roomRow,
  ROW_SPANS,
  type LatticeEdge,
  type RoomId,
  type Span,
} from './lattice';
import { isSound } from './soundness';

/** §5 step 5: "0-2 pillars per room". */
export const MAX_PILLARS_PER_ROOM = 2;

/** §5 step 3: "1-2 extra doorways". Also the number of non-tree edges, which is always 2. */
const LOOP_DOORWAY_SLOTS = 2;

/** §5 step 8 / §8: "caches stay at 1-2". */
const CACHE_SLOTS = 2;

/**
 * How much likelier a cache is to land in a spanning-tree leaf room. §5 wants caches "biased toward
 * leaf rooms" — bias, not restriction, so a cache on the main route stays possible. **(tuning)**
 */
const LEAF_ROOM_CACHE_WEIGHT = 3;
const ORDINARY_ROOM_CACHE_WEIGHT = 1;

/**
 * How close to the entrance a creature may spawn, in **Manhattan** steps.
 *
 * Ruled Manhattan by the game-designer during the §5 correction, overturning an earlier Chebyshev
 * reading. Movement and attacks are 4-directional, so the player's unit of distance is the step: a
 * creature at (+2,+2) is four steps away and four moves from threatening you. Excluding it would
 * make the rule impossible to check by counting, which is what Pillar 2 asks of a rule, and
 * Chebyshev has no referent anywhere else in the rules.
 *
 * The stricter reading was not merely conservative — it systematically thinned spawns in the rooms
 * adjacent to the entrance, making the early floor emptier than §8's curve says.
 */
const CREATURE_ENTRANCE_EXCLUSION = 2;

/** §8: `min(2 + floor, 6)`. Floors are 1-based. */
export function creatureCount(floorNumber: number): number {
  return Math.min(2 + floorNumber, 6);
}

/**
 * Draws consumed by everything except creature placement.
 *
 *   jitter     10  (2 per room in the top and bottom bands, 1 per middle-band room)
 *   merge       2  (whether, and which of the four stacked pairs)
 *   links       8  (shuffle 7 edges = 6, loop count = 1, shuffle 2 spares = 1)
 *   doorways    7  (one position per lattice edge, used or not)
 *   pillars    18  (per room: 1 count + 2 slots)
 *   entrance    2  (room, then tile)
 *   stairs      2  (room among the farthest, then tile)
 *   caches      5  (1 count + 2 slots x (room, tile))
 */
const FIXED_DRAWS = 10 + 2 + 8 + 7 + 18 + 2 + 2 + 5;

/**
 * Exactly how many times `generateFloor` advances the generator. Depends on the floor number and
 * nothing else — not on the seed. Asserted in `generate.test.ts` by counting.
 */
export function expectedDrawCount(floorNumber: number): number {
  return FIXED_DRAWS + creatureCount(floorNumber);
}

// --- draw-count-stable choice helpers -----------------------------------------------------------

/**
 * Choose one candidate. **Exactly one draw, always**, including when there is nothing to choose.
 *
 * The empty case returns `null` rather than throwing (unlike `rng.pick`) because several call sites
 * legitimately have nothing to place — an unused pillar slot passes an empty list on purpose — and
 * every one of them must still consume its draw.
 */
function chooseFrom<T>(rng: Rng, candidates: readonly T[]): Draw<T | null> {
  const roll = int(rng, 0, Math.max(candidates.length - 1, 0));
  return { value: candidates.length === 0 ? null : candidates[roll.value], rng: roll.rng };
}

/**
 * Consume one draw and discard it.
 *
 * Used where a decision was already made not to place something. The range is irrelevant — `next()`
 * advances the same way whatever bounds `int` was given — so this is exactly "spend one step".
 */
function skipDraw(rng: Rng): Rng {
  return int(rng, 0, 0).rng;
}

// --- the working grid ---------------------------------------------------------------------------

/**
 * The level under construction. `grid.tiles` **aliases** `tiles`, so writing to `tiles` is visible
 * through `grid` — that is what lets soundness be re-checked cheaply after a trial placement.
 *
 * The draft never escapes `generateFloor`; the array it owns becomes the finished `Floor`'s tiles
 * and is not referenced anywhere else, so no caller can mutate a `Floor` through it.
 */
type Draft = { readonly grid: Grid; readonly tiles: Tile[] };

function createDraft(tiles: Tile[]): Draft {
  return { grid: { width: FLOOR_WIDTH, height: FLOOR_HEIGHT, tiles }, tiles };
}

function indexAt(x: number, y: number): number {
  return y * FLOOR_WIDTH + x;
}

function roomContains(room: Room, at: Position): boolean {
  return (
    at.x >= room.x && at.x < room.x + room.width && at.y >= room.y && at.y < room.y + room.height
  );
}

/** The room whose interior contains `at`, or `null` for a wall, doorway, or merged-wall tile. */
function roomContaining(rooms: readonly Room[], at: Position): RoomId | null {
  for (const room of rooms) {
    if (roomContains(room, at)) return room.id;
  }
  return null;
}

/** Indices of a room's plain floor tiles, row-major. Excludes pillars and anything already placed. */
function freeFloorIn(draft: Draft, room: Room): number[] {
  const out: number[] = [];
  for (let y = room.y; y < room.y + room.height; y += 1) {
    for (let x = room.x; x < room.x + room.width; x += 1) {
      const index = indexAt(x, y);
      if (draft.tiles[index].kind === 'floor') out.push(index);
    }
  }
  return out;
}

// --- step 1: the lattice, jittered --------------------------------------------------------------

/**
 * §5 step 1. Each room starts as its full lattice cell and may be pulled in by one tile "where the
 * lattice allows" — which means: only on a side facing the screen edge.
 *
 * A side facing a *separator* wall may never move. If it could, a doorway carved in that wall could
 * open onto a wall tile instead of floor, which is both a disconnection and, worse, the beginnings
 * of a corridor. Restricting jitter this way is what makes connectivity structural rather than
 * something to verify afterwards.
 *
 * Middle-band rooms are sandwiched between the two separator rows and therefore never jitter
 * vertically. That is a property of the lattice, not of a drawn value, so the draw count is still
 * fixed: 2 draws for a top- or bottom-band room, 1 for a middle-band room.
 */
function jitterRooms(rng: Rng): Draw<Room[]> {
  const rooms: Room[] = [];
  let current = rng;

  for (let id = 0; id < ROOM_COUNT; id += 1) {
    const column = roomColumn(id);
    const row = roomRow(id);
    const xs: Span = COLUMN_SPANS[column];
    const ys: Span = ROW_SPANS[row];

    // Column 0's outer side is its left edge, so an inset moves x right; column 1's outer side is
    // its right edge, so an inset only shortens the width.
    const horizontal = int(current, 0, 1);
    current = horizontal.rng;
    const x = xs.min + (column === 0 ? horizontal.value : 0);
    const width = xs.max - xs.min + 1 - horizontal.value;

    let y = ys.min;
    let height = ys.max - ys.min + 1;
    if (row !== 1) {
      const vertical = int(current, 0, 1);
      current = vertical.rng;
      y = ys.min + (row === 0 ? vertical.value : 0);
      height -= vertical.value;
    }

    rooms.push({ id, column, row, x, y, width, height });
  }

  return { value: rooms, rng: current };
}

// --- step 4: the merge (chosen early, because the connection graph depends on it) ---------------

/**
 * §5 step 4: "0-1 room merges". Both draws happen either way — the "which pair" roll is made and
 * discarded when there is no merge, so the count does not depend on the coin flip.
 *
 * Chosen before the spanning tree rather than after, because a merge *is* a connection: the two
 * rooms are pre-united so the tree spends its edges elsewhere, and the merged wall never also gets
 * a redundant doorway.
 */
function chooseMerge(rng: Rng): Draw<Merge> {
  const enabled = int(rng, 0, 1);
  const which = int(enabled.rng, 0, MERGEABLE_EDGE_IDS.length - 1);
  if (enabled.value === 0) return { value: NO_MERGE, rng: which.rng };

  const edge = LATTICE_EDGES[MERGEABLE_EDGE_IDS[which.value]];
  return { value: { kind: 'merged', edge: edge.id, rooms: edge.rooms }, rng: which.rng };
}

// --- steps 2 and 3: which rooms are joined ------------------------------------------------------

/** Which lattice edges become doorways, and why. Both lists ascend by edge id. */
type Links = { readonly tree: readonly number[]; readonly loops: readonly number[] };

/**
 * §5 steps 2 and 3: a random spanning tree, plus 1-2 extra edges for loops.
 *
 * Randomized Kruskal over a shuffled edge list — a shuffle is a fixed 6 draws for 7 edges, where
 * "keep drawing until the tree is spanning" would not be. The merged pair, if any, starts already
 * united, so a merge replaces a tree edge instead of adding to it.
 *
 * Either way exactly two edges are left over (6 rooms need 5 connections; 7 - 5 = 2), which is what
 * makes "1-2 loops" a fixed-shape choice: roll how many, shuffle the two spares, take that many.
 */
function chooseLinks(rng: Rng, merge: Merge): Draw<Links> {
  const order = shuffle(rng, LATTICE_EDGE_IDS);

  const parent: number[] = [];
  for (let id = 0; id < ROOM_COUNT; id += 1) parent.push(id);
  const find = (room: RoomId): RoomId => {
    let node = room;
    while (parent[node] !== node) {
      parent[node] = parent[parent[node]];
      node = parent[node];
    }
    return node;
  };
  const union = (a: RoomId, b: RoomId): boolean => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return false;
    parent[rootB] = rootA;
    return true;
  };

  if (merge.kind === 'merged') union(merge.rooms[0], merge.rooms[1]);

  const tree: number[] = [];
  for (const id of order.value) {
    const edge = LATTICE_EDGES[id];
    if (union(edge.rooms[0], edge.rooms[1])) tree.push(id);
  }
  tree.sort((a, b) => a - b);

  const spare = LATTICE_EDGE_IDS.filter(
    (id) => !tree.includes(id) && !(merge.kind === 'merged' && merge.edge === id),
  );
  if (spare.length !== LOOP_DOORWAY_SLOTS) {
    // Unreachable: 6 rooms take 5 connections out of 7 edges, and a merge supplies one of them.
    // A throw rather than a silent adjustment, because reaching it means the lattice constants and
    // this function disagree, and every floor after it would be quietly wrong.
    throw new Error(
      `map: expected ${LOOP_DOORWAY_SLOTS} spare edges after spanning, got ${spare.length}`,
    );
  }

  const extra = int(order.rng, 0, LOOP_DOORWAY_SLOTS - 1);
  const shuffled = shuffle(extra.rng, spare);
  const loops = shuffled.value.slice(0, extra.value + 1).sort((a, b) => a - b);

  return { value: { tree, loops }, rng: shuffled.rng };
}

/**
 * The stretch of shared wall where a doorway may sit: the overlap of the two rooms' extents along
 * it. Non-empty for every edge, because jitter never pulls a room off a shared wall and shortens a
 * room by at most one tile on the far side.
 */
function doorwaySpan(edge: LatticeEdge, rooms: readonly Room[]): Span {
  const a = rooms[edge.rooms[0]];
  const b = rooms[edge.rooms[1]];
  const span =
    edge.wall.kind === 'column'
      ? { min: Math.max(a.y, b.y), max: Math.min(a.y + a.height - 1, b.y + b.height - 1) }
      : { min: Math.max(a.x, b.x), max: Math.min(a.x + a.width - 1, b.x + b.width - 1) };

  if (span.max < span.min) {
    throw new Error(
      `map: rooms ${edge.rooms[0]} and ${edge.rooms[1]} do not overlap along their shared wall`,
    );
  }
  return span;
}

/**
 * One position per lattice edge, in edge-id order — including for edges that get no doorway, whose
 * roll is discarded. That is what keeps the count at a flat 7 regardless of how the tree came out.
 */
function chooseDoorways(rng: Rng, rooms: readonly Room[], links: Links): Draw<Doorway[]> {
  const doorways: Doorway[] = [];
  let current = rng;

  for (const edge of LATTICE_EDGES) {
    const span = doorwaySpan(edge, rooms);
    const roll = int(current, span.min, span.max);
    current = roll.rng;

    const origin: Doorway['origin'] | null = links.tree.includes(edge.id)
      ? 'tree'
      : links.loops.includes(edge.id)
        ? 'loop'
        : null;
    if (origin === null) continue;

    const at =
      edge.wall.kind === 'column'
        ? { x: edge.wall.x, y: roll.value }
        : { x: roll.value, y: edge.wall.y };
    doorways.push({ edge: edge.id, at, rooms: edge.rooms, origin });
  }

  return { value: doorways, rng: current };
}

/** Rooms, the merged wall, and the doorways, painted onto an otherwise solid grid. */
function paintBaseTiles(
  rooms: readonly Room[],
  merge: Merge,
  doorways: readonly Doorway[],
): Tile[] {
  const tiles = new Array<Tile>(FLOOR_WIDTH * FLOOR_HEIGHT).fill(WALL);

  for (const room of rooms) {
    for (let y = room.y; y < room.y + room.height; y += 1) {
      for (let x = room.x; x < room.x + room.width; x += 1) tiles[indexAt(x, y)] = FLOOR;
    }
  }

  if (merge.kind === 'merged') {
    const wall = LATTICE_EDGES[merge.edge].wall;
    if (wall.kind !== 'row') {
      throw new Error(`map: edge ${merge.edge} is not a stacked pair and cannot be merged`);
    }
    // Only the overlap of the two rooms' widths, so the hall stays a rectangle rather than growing
    // an L-shaped lip where one room was jittered narrower than the other.
    const a = rooms[merge.rooms[0]];
    const b = rooms[merge.rooms[1]];
    const from = Math.max(a.x, b.x);
    const to = Math.min(a.x + a.width - 1, b.x + b.width - 1);
    for (let x = from; x <= to; x += 1) tiles[indexAt(x, wall.y)] = FLOOR;
  }

  for (const doorway of doorways) tiles[indexAt(doorway.at.x, doorway.at.y)] = DOORWAY;

  return tiles;
}

// --- step 5: pillars ----------------------------------------------------------------------------

/**
 * Room floor tiles where a pillar would leave the floor sound — connected, no dead ends, no
 * corridors (`soundness.ts`).
 *
 * Each candidate is tested by placing the pillar, asking, and putting the tile back. That is the
 * whole safety rule: nothing else constrains where a pillar may go. In particular the "not next to
 * a doorway" rule one might reach for is unnecessary — a doorway has exactly two exits, so a pillar
 * on either of them creates a dead end and is rejected by the same check.
 *
 * Filtering *before* drawing, rather than drawing and retrying, is what keeps the draw count fixed.
 */
function pillarCandidates(draft: Draft, room: Room): number[] {
  const out: number[] = [];
  for (const index of freeFloorIn(draft, room)) {
    draft.tiles[index] = PILLAR;
    const sound = isSound(draft.grid);
    draft.tiles[index] = FLOOR;
    if (sound) out.push(index);
  }
  return out;
}

/** §5 step 5. Per room: roll 0-2, then run both slots so the draw count does not follow the roll. */
function placePillars(rng: Rng, draft: Draft, rooms: readonly Room[]): Rng {
  let current = rng;
  for (const room of rooms) {
    const count = int(current, 0, MAX_PILLARS_PER_ROOM);
    current = count.rng;

    for (let slot = 0; slot < MAX_PILLARS_PER_ROOM; slot += 1) {
      if (slot >= count.value) {
        current = skipDraw(current);
        continue;
      }
      const choice = chooseFrom(current, pillarCandidates(draft, room));
      current = choice.rng;
      if (choice.value !== null) draft.tiles[choice.value] = PILLAR;
    }
  }
  return current;
}

// --- step 6: entrance and stairs ----------------------------------------------------------------

/** §5 step 6, first half: a room, then a tile in it. */
function placeEntrance(rng: Rng, draft: Draft, rooms: readonly Room[]): Draw<Position> {
  const room = int(rng, 0, ROOM_COUNT - 1);
  const choice = chooseFrom(room.rng, freeFloorIn(draft, rooms[room.value]));
  if (choice.value === null) {
    throw new Error(`map: room ${room.value} has no free tile for the entrance`);
  }
  draft.tiles[choice.value] = ENTRANCE;
  return { value: positionOf(draft.grid, choice.value), rng: choice.rng };
}

/** Adjacency lists over the six rooms, ascending. A merge is an edge like any other. */
function roomAdjacency(doorways: readonly Doorway[], merge: Merge): number[][] {
  const adjacency: number[][] = [];
  for (let id = 0; id < ROOM_COUNT; id += 1) adjacency.push([]);

  const join = (a: RoomId, b: RoomId): void => {
    if (!adjacency[a].includes(b)) adjacency[a].push(b);
    if (!adjacency[b].includes(a)) adjacency[b].push(a);
  };

  for (const doorway of doorways) join(doorway.rooms[0], doorway.rooms[1]);

  // A merged pair is ONE node, not two joined by an edge — ruled by the game-designer during the
  // §5 correction. §5's own claim is that the unit of memory is "a room and its doors", and a
  // merge crosses no door. This also removes a self-contradiction: `forbiddenRooms` already
  // treated the merged partner as the entrance room for creature spawns (step 7) while this
  // function treated the merge as an ordinary hop for stairs distance (step 6).
  //
  // Contracting rather than joining: every neighbour of one half becomes a neighbour of the
  // other, so a BFS crosses the whole hall for free. Testable corollary — if the entrance is in
  // a merged hall, neither half can hold the stairs.
  if (merge.kind === 'merged') {
    const [a, b] = merge.rooms;
    for (const neighbour of [...adjacency[a]]) join(b, neighbour);
    for (const neighbour of [...adjacency[b]]) join(a, neighbour);
    join(a, b);
  }

  for (const list of adjacency) list.sort((a, b) => a - b);
  return adjacency;
}

/** Breadth-first hop count from `from` to every room. */
function roomDistances(adjacency: readonly number[][], from: RoomId): number[] {
  const distance: number[] = new Array<number>(ROOM_COUNT).fill(-1);
  distance[from] = 0;
  const queue: RoomId[] = [from];
  for (let head = 0; head < queue.length; head += 1) {
    const room = queue[head];
    for (const next of adjacency[room]) {
      if (distance[next] !== -1) continue;
      distance[next] = distance[room] + 1;
      queue.push(next);
    }
  }
  return distance;
}

/**
 * §5 step 6, second half: "stairs in the room with the greatest graph distance from it".
 *
 * Ties are broken by a draw among the tied rooms, ascending by id — not by taking the lowest id,
 * which would make some rooms systematically likelier to hold the stairs on symmetric layouts.
 */
function placeStairs(
  rng: Rng,
  draft: Draft,
  rooms: readonly Room[],
  entranceRoom: RoomId,
  adjacency: readonly number[][],
): Draw<Position> {
  const distance = roomDistances(adjacency, entranceRoom);
  if (distance.includes(-1)) {
    // Unreachable: the spanning tree connects every room. Loud, because a silently unreachable
    // staircase is an unwinnable floor.
    throw new Error(`map: room graph is disconnected from room ${entranceRoom}`);
  }

  const farthest = Math.max(...distance);
  const tied = rooms.filter((room) => distance[room.id] === farthest).map((room) => room.id);
  const room = chooseFrom(rng, tied);
  if (room.value === null) throw new Error('map: no room at maximum distance from the entrance');

  const choice = chooseFrom(room.rng, freeFloorIn(draft, rooms[room.value]));
  if (choice.value === null) {
    throw new Error(`map: room ${room.value} has no free tile for the stairs`);
  }
  draft.tiles[choice.value] = STAIRS;
  return { value: positionOf(draft.grid, choice.value), rng: choice.rng };
}

// --- step 8: caches -----------------------------------------------------------------------------

/** Rooms with exactly one connection in the spanning structure (tree edges plus the merge). */
function leafRooms(links: Links, merge: Merge): boolean[] {
  const degree: number[] = new Array<number>(ROOM_COUNT).fill(0);
  for (const id of links.tree) {
    const edge = LATTICE_EDGES[id];
    degree[edge.rooms[0]] += 1;
    degree[edge.rooms[1]] += 1;
  }
  if (merge.kind === 'merged') {
    degree[merge.rooms[0]] += 1;
    degree[merge.rooms[1]] += 1;
  }
  return degree.map((count) => count === 1);
}

/**
 * §5 step 8: 1-2 caches, biased toward leaf rooms — "so going off-route for fuel is itself the fuel
 * wager VISION asks for".
 *
 * The bias is a weighted room choice, not a restriction to leaves: a cache on the main route is
 * still possible, it is just less likely. Both slots draw a room and a tile whether or not they
 * place anything.
 */
function placeCaches(
  rng: Rng,
  draft: Draft,
  rooms: readonly Room[],
  links: Links,
  merge: Merge,
): Draw<Position[]> {
  const leaves = leafRooms(links, merge);
  const table = rooms.map((room) => ({
    value: room.id,
    weight: leaves[room.id] ? LEAF_ROOM_CACHE_WEIGHT : ORDINARY_ROOM_CACHE_WEIGHT,
  }));

  const count = int(rng, 0, CACHE_SLOTS - 1);
  let current = count.rng;
  const caches: Position[] = [];

  for (let slot = 0; slot < CACHE_SLOTS; slot += 1) {
    const room = weighted(current, table);
    current = room.rng;
    const wanted = slot <= count.value;
    const choice = chooseFrom(current, wanted ? freeFloorIn(draft, rooms[room.value]) : []);
    current = choice.rng;
    if (choice.value === null) continue;
    draft.tiles[choice.value] = CACHE;
    caches.push(positionOf(draft.grid, choice.value));
  }

  return { value: caches, rng: current };
}

// --- step 7: creatures --------------------------------------------------------------------------

/**
 * §5 step 7: dormant, never in the entrance room, never within 2 tiles of the entrance.
 *
 * "The entrance room" includes the room it was merged with, when it was merged: the two are one
 * space with no wall between them, and spawning across an invisible line the player cannot perceive
 * would honour the letter of the rule and not the point of it.
 *
 * Doorway tiles are excluded from spawning (only plain `floor` qualifies). A dormant creature
 * standing in the single threshold tile is a blocked passage, which is the corridor problem wearing
 * a different hat.
 */
function creatureCandidates(
  draft: Draft,
  rooms: readonly Room[],
  forbiddenRooms: readonly RoomId[],
  entrance: Position,
  taken: readonly boolean[],
): number[] {
  const out: number[] = [];
  for (let index = 0; index < draft.tiles.length; index += 1) {
    if (draft.tiles[index].kind !== 'floor') continue;
    if (taken[index]) continue;
    const at = positionOf(draft.grid, index);
    if (manhattanDistance(at, entrance) <= CREATURE_ENTRANCE_EXCLUSION) continue;
    const room = roomContaining(rooms, at);
    if (room === null || forbiddenRooms.includes(room)) continue;
    out.push(index);
  }
  return out;
}

function placeCreatures(
  rng: Rng,
  draft: Draft,
  rooms: readonly Room[],
  forbiddenRooms: readonly RoomId[],
  entrance: Position,
  count: number,
): Draw<CreatureSpawn[]> {
  const taken: boolean[] = new Array<boolean>(draft.tiles.length).fill(false);
  const spawns: CreatureSpawn[] = [];
  let current = rng;

  for (let i = 0; i < count; i += 1) {
    const choice = chooseFrom(current, creatureCandidates(draft, rooms, forbiddenRooms, entrance, taken));
    current = choice.rng;
    if (choice.value === null) {
      // Loud rather than quietly under-populating the floor: §8's difficulty curve is stated in
      // creature count, so a floor that silently spawned four instead of six is a balance change
      // nobody made.
      throw new Error(`map: no legal spawn tile for creature ${i} of ${count}`);
    }
    taken[choice.value] = true;
    spawns.push({ kind: 'cinder', at: positionOf(draft.grid, choice.value) });
  }

  return { value: spawns, rng: current };
}

// --- the generator ------------------------------------------------------------------------------

/**
 * Generate one floor. Pure: same `(rng, floorNumber)` in, same `Floor` out, every time.
 *
 * @param floorNumber 1-based. Only affects the creature count (§8).
 * @throws if `floorNumber` is not a positive safe integer. Validated **before the first draw**, per
 *   the corollary in `rng/draw.ts`: a helper must never consume entropy and then throw.
 */
export function generateFloor(rng: Rng, floorNumber: number): Draw<Floor> {
  if (!Number.isSafeInteger(floorNumber) || floorNumber < 1) {
    throw new Error(`map: floorNumber must be a positive integer, got ${String(floorNumber)}`);
  }

  const rooms = jitterRooms(rng);
  const merge = chooseMerge(rooms.rng);
  const links = chooseLinks(merge.rng, merge.value);
  const doorways = chooseDoorways(links.rng, rooms.value, links.value);

  const draft = createDraft(paintBaseTiles(rooms.value, merge.value, doorways.value));

  const afterPillars = placePillars(doorways.rng, draft, rooms.value);
  const entrance = placeEntrance(afterPillars, draft, rooms.value);

  const entranceRoom = roomContaining(rooms.value, entrance.value);
  if (entranceRoom === null) {
    throw new Error('map: the entrance was placed outside every room');
  }

  const adjacency = roomAdjacency(doorways.value, merge.value);
  const stairs = placeStairs(entrance.rng, draft, rooms.value, entranceRoom, adjacency);
  const caches = placeCaches(stairs.rng, draft, rooms.value, links.value, merge.value);

  // The room merged with the entrance room counts as the entrance room: the two are one space with
  // no wall between them, and spawning across a line the player cannot perceive would honour the
  // letter of §5 step 7 and not the point of it.
  const forbiddenRooms: RoomId[] = [entranceRoom];
  if (merge.value.kind === 'merged' && merge.value.rooms.includes(entranceRoom)) {
    forbiddenRooms.push(...merge.value.rooms.filter((id) => id !== entranceRoom));
  }

  const creatures = placeCreatures(
    caches.rng,
    draft,
    rooms.value,
    forbiddenRooms,
    entrance.value,
    creatureCount(floorNumber),
  );

  const floor: Floor = {
    floorNumber,
    grid: { width: FLOOR_WIDTH, height: FLOOR_HEIGHT, tiles: draft.tiles },
    rooms: rooms.value,
    doorways: doorways.value,
    merge: merge.value,
    entrance: entrance.value,
    stairs: stairs.value,
    // Canonical row-major order rather than the order they happened to be drawn in, so two floors
    // that differ only in draw order are not reported as different states.
    caches: caches.value.slice().sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y)),
    creatures: creatures.value
      .slice()
      .sort((a, b) => (a.at.y === b.at.y ? a.at.x - b.at.x : a.at.y - b.at.y)),
  };

  return { value: floor, rng: creatures.rng };
}
