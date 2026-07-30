import { describe, expect, it } from 'vitest';
import {
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
  type Tile,
  type TileKind,
} from '@/game/map';

const BY_KIND: Record<TileKind, Tile> = {
  wall: WALL,
  floor: FLOOR,
  pillar: PILLAR,
  doorway: DOORWAY,
  entrance: ENTRANCE,
  stairs: STAIRS,
  cache: CACHE,
};

const GRID: Grid = { width: 3, height: 2, tiles: [WALL, FLOOR, PILLAR, DOORWAY, STAIRS, CACHE] };

describe('tile kinds', () => {
  it('TILE_KINDS lists every variant exactly once', () => {
    // Guards the constant against drifting from the union: a new variant added to `Tile` without
    // being listed here would leave every table test below silently skipping it.
    expect([...TILE_KINDS].sort()).toEqual(Object.keys(BY_KIND).sort());
    expect(new Set(TILE_KINDS).size).toBe(TILE_KINDS.length);
  });

  it('every exported tile constant has the kind its name claims', () => {
    for (const kind of TILE_KINDS) expect(BY_KIND[kind].kind).toBe(kind);
  });
});

describe('tile rules', () => {
  // A table, so a new tile kind that nobody classified fails here rather than defaulting to
  // "walkable and transparent" in the middle of a run.
  const EXPECTED: Record<TileKind, { movement: boolean; light: boolean }> = {
    wall: { movement: true, light: true },
    pillar: { movement: true, light: true },
    floor: { movement: false, light: false },
    doorway: { movement: false, light: false },
    entrance: { movement: false, light: false },
    stairs: { movement: false, light: false },
    cache: { movement: false, light: false },
  };

  for (const kind of TILE_KINDS) {
    it(`${kind}: blocks movement=${EXPECTED[kind].movement}, light=${EXPECTED[kind].light}`, () => {
      expect(blocksMovement(BY_KIND[kind])).toBe(EXPECTED[kind].movement);
      expect(blocksLight(BY_KIND[kind])).toBe(EXPECTED[kind].light);
      expect(isPassable(BY_KIND[kind])).toBe(!EXPECTED[kind].movement);
    });
  }

  it('nothing blocks ember-sense — including the pillar (GDD §5 step 5)', () => {
    // The pillar is the interesting case: it blocks movement and light but not ember-sense, which
    // is what gives darkness information light cannot give (§4). Collapsing the three rules into
    // one predicate would break the mechanic silently.
    for (const kind of TILE_KINDS) expect(blocksEmberSense(BY_KIND[kind])).toBe(false);
    expect(blocksLight(PILLAR)).toBe(true);
    expect(blocksEmberSense(PILLAR)).toBe(false);
  });
});

describe('indexing', () => {
  it('round-trips index and position', () => {
    for (let index = 0; index < GRID.tiles.length; index += 1) {
      const at = positionOf(GRID, index);
      expect(tileIndex(GRID, at.x, at.y)).toBe(index);
    }
  });

  it('is row-major', () => {
    expect(tileIndex(GRID, 2, 1)).toBe(5);
    expect(positionOf(GRID, 3)).toEqual({ x: 0, y: 1 });
  });

  it('reads the tile at a position', () => {
    expect(tileAt(GRID, 0, 0)).toBe(WALL);
    expect(tileAt(GRID, 2, 1)).toBe(CACHE);
  });

  it('throws rather than returning a wall for an out-of-bounds read', () => {
    // Returning a wall would let an off-by-one loop silently produce a plausible-looking map.
    expect(() => tileAt(GRID, 3, 0)).toThrow(/outside the 3x2 grid/);
    expect(() => tileAt(GRID, -1, 0)).toThrow(/outside/);
    expect(() => tileAt(GRID, 0, 2)).toThrow(/outside/);
  });

  it('bounds-checks every edge', () => {
    expect(inBounds(GRID, 0, 0)).toBe(true);
    expect(inBounds(GRID, 2, 1)).toBe(true);
    expect(inBounds(GRID, 3, 1)).toBe(false);
    expect(inBounds(GRID, 2, 2)).toBe(false);
    expect(inBounds(GRID, -1, 0)).toBe(false);
    expect(inBounds(GRID, 0, -1)).toBe(false);
  });

  it('isPassableAt is false out of bounds instead of throwing', () => {
    expect(isPassableAt(GRID, 1, 0)).toBe(true);
    expect(isPassableAt(GRID, 0, 0)).toBe(false);
    expect(isPassableAt(GRID, -1, 0)).toBe(false);
    expect(isPassableAt(GRID, 99, 99)).toBe(false);
  });
});

describe('geometry helpers', () => {
  it('ORTHOGONAL_STEPS is the four cardinal moves and nothing else', () => {
    // §9 settles movement as 4-directional. A diagonal sneaking in here would silently change
    // connectivity, corridor analysis, and the meaning of "adjacent" everywhere at once.
    expect(ORTHOGONAL_STEPS).toHaveLength(4);
    for (const step of ORTHOGONAL_STEPS) {
      expect(Math.abs(step.x) + Math.abs(step.y)).toBe(1);
    }
    expect(new Set(ORTHOGONAL_STEPS.map((s) => `${s.x},${s.y}`)).size).toBe(4);
  });

  it('chebyshevDistance is the king move, not the Manhattan walk', () => {
    expect(chebyshevDistance({ x: 0, y: 0 }, { x: 2, y: 2 })).toBe(2);
    expect(chebyshevDistance({ x: 0, y: 0 }, { x: 3, y: 1 })).toBe(3);
    expect(chebyshevDistance({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
  });

  it('samePosition compares by value', () => {
    expect(samePosition({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true);
    expect(samePosition({ x: 1, y: 2 }, { x: 2, y: 1 })).toBe(false);
  });

  it('comparePositions sorts row-major', () => {
    const shuffled = [
      { x: 2, y: 1 },
      { x: 0, y: 1 },
      { x: 5, y: 0 },
    ];
    expect(shuffled.slice().sort(comparePositions)).toEqual([
      { x: 5, y: 0 },
      { x: 0, y: 1 },
      { x: 2, y: 1 },
    ]);
  });
});
