/**
 * Level generation. One algorithm, one theme: the chambered ruin of GDD §5.
 *
 * ```ts
 * import { createRng } from '@/game/rng';
 * import { generateFloor, renderFloorAscii } from '@/game/map';
 *
 * const floor = generateFloor(createRng('emberdepth'), 1);  // { value: Floor, rng }
 * console.log(renderFloorAscii(floor.value));
 * ```
 *
 * `generateFloor` is pure and consumes a **fixed number of draws for a given floor number** — read
 * the draw-count decision at the top of `generate.ts` before adding anything random to it.
 *
 * What a legal floor is (connected, no corridors) lives in `soundness.ts`, is used by the generator
 * to filter pillar placements, and is asserted from the outside by the property tests.
 */

export { renderFloorAscii, renderFloorLines, renderGridLines, DEBUG_GLYPHS } from './debug';
export { NO_MERGE, type CreatureSpawn, type Doorway, type Floor, type Merge, type Room } from './floor';
export {
  creatureCount,
  expectedDrawCount,
  generateFloor,
  MAX_PILLARS_PER_ROOM,
} from './generate';
export {
  blocksEmberSense,
  blocksLight,
  blocksMovement,
  CACHE,
  chebyshevDistance,
  comparePositions,
  DOORWAY,
  ENTRANCE,
  FLOOR,
  inBounds,
  isPassable,
  isPassableAt,
  ORTHOGONAL_STEPS,
  PILLAR,
  positionOf,
  samePosition,
  STAIRS,
  tileAt,
  tileIndex,
  TILE_KINDS,
  WALL,
  type Grid,
  type Position,
  type Tile,
  type TileKind,
} from './grid';
export {
  COLUMN_SEPARATOR_X,
  COLUMN_SPANS,
  FLOOR_HEIGHT,
  FLOOR_WIDTH,
  LATTICE_EDGES,
  LATTICE_EDGE_IDS,
  MERGEABLE_EDGE_IDS,
  ROOM_COLUMNS,
  ROOM_COUNT,
  ROOM_ROWS,
  ROW_SEPARATOR_Y,
  ROW_SPANS,
  roomColumn,
  roomIdAt,
  roomRow,
  type LatticeEdge,
  type RoomId,
  type SharedWall,
  type Span,
} from './lattice';
export {
  exitCount,
  findCorridors,
  findDeadEnds,
  findSoundnessProblems,
  isPinch,
  isReachable,
  isSound,
  passableIndices,
  reachableFrom,
} from './soundness';
