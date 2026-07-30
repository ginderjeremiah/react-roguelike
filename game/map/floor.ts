/**
 * `Floor` — one generated level, as plain data.
 *
 * Everything here is JSON-round-trippable: objects, arrays, numbers, strings. No `Map`, no `Set`,
 * no class instances. `game/core/divergence.ts` throws on any of those (comparing them by own
 * enumerable keys reports different values as identical), and a `Floor` is destined for
 * `GameState`, so the rule is load-bearing rather than stylistic.
 *
 * ## What is here that is not in the grid
 *
 * The grid alone would be enough to *draw* the level. The room list, doorways, and merge are kept
 * because the rules need them, not for debugging: creature spawning needs "the entrance room",
 * cache placement needs "leaf rooms of the spanning tree", stairs need graph distance between
 * rooms, and §5's whole premise is that the player's mental map is "rooms and which wall the door
 * was in". Recomputing that from tiles would mean re-deriving a structure the generator already
 * knew exactly.
 *
 * ## What is deliberately not here
 *
 * The player, actors, light, and what has been seen. Those belong to the run, not to the map. A
 * `Floor` is a pure function of `(seed, floor number)` and stays valid however the run goes.
 */

import type { Grid, Position } from './grid';
import type { RoomId } from './lattice';

/**
 * One room's interior rectangle after jitter. Always non-empty and always flush against every
 * lattice wall it shares with a neighbour — jitter only ever pulls a room away from the *screen*
 * edge, which is what makes every doorway connect by construction (see `generate.ts`).
 */
export type Room = {
  readonly id: RoomId;
  readonly column: number;
  readonly row: number;
  /** Top-left of the interior, inclusive. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/**
 * A one-tile opening in a shared wall.
 *
 * `origin` distinguishes the spanning-tree doorways, which are what guarantee connectivity, from
 * the extra loop doorways of §5 step 3. The distinction is not cosmetic: the loops are escape
 * routes, and a future "is this floor too safe / too lethal" balance question is asked in terms of
 * how many there are and where.
 */
export type Doorway = {
  /** Index into `LATTICE_EDGES`. At most one doorway per edge. */
  readonly edge: number;
  readonly at: Position;
  /** The two rooms it joins, ascending. */
  readonly rooms: readonly [RoomId, RoomId];
  readonly origin: 'tree' | 'loop';
};

/**
 * The 0-1 room merges of §5 step 4, as a union rather than a nullable field: reading which rooms
 * were merged requires establishing that any were.
 */
export type Merge =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'merged';
      /** Index into `LATTICE_EDGES` — always one of `MERGEABLE_EDGE_IDS`. */
      readonly edge: number;
      readonly rooms: readonly [RoomId, RoomId];
    };

/** Shared by every floor with no merge. Structural sharing of an immutable value; never written to. */
export const NO_MERGE: Merge = { kind: 'none' };

/**
 * Where a creature starts, and what it is. **A spawn plan, not an actor** — it has no id, no HP and
 * no schedule, because `game/entities/` does not exist yet and inventing an actor model here would
 * be a design decision made by the wrong module. The entity layer turns these into actors.
 *
 * All M1 creatures are dormant Cinders (§6), so dormancy is not a field: there is nothing else to
 * be. It becomes one when a second creature or a non-dormant spawn exists.
 */
export type CreatureSpawn = {
  readonly kind: 'cinder';
  readonly at: Position;
};

/** One generated level. Immutable. */
export type Floor = {
  /** 1-based. Drives creature count (§8) and nothing else yet. */
  readonly floorNumber: number;
  readonly grid: Grid;
  /** All six lattice rooms, in id order. */
  readonly rooms: readonly Room[];
  /** Ascending by edge id. Tree doorways and loop doorways together. */
  readonly doorways: readonly Doorway[];
  readonly merge: Merge;
  /** Where the player arrives. The tile is `entrance` in the grid. */
  readonly entrance: Position;
  readonly stairs: Position;
  /** Row-major. 1-2 of them (§5 step 8). */
  readonly caches: readonly Position[];
  /** Row-major. `min(2 + floorNumber, 6)` of them (§8). */
  readonly creatures: readonly CreatureSpawn[];
};
