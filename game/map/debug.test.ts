import { describe, expect, it } from 'vitest';
import { createRng } from '@/game/rng';
import {
  CACHE,
  DEBUG_GLYPHS,
  DOORWAY,
  ENTRANCE,
  FLOOR,
  generateFloor,
  PILLAR,
  renderFloorAscii,
  renderFloorLines,
  renderGridLines,
  STAIRS,
  TILE_KINDS,
  WALL,
  type Grid,
  type Tile,
  type TileKind,
} from '@/game/map';

/**
 * The ASCII dump is what the pinned-floor tests compare, so a bug in it would either hide a
 * generator change or invent one. It is worth its own tests for that reason alone.
 */

const BY_KIND: Record<TileKind, Tile> = {
  wall: WALL,
  floor: FLOOR,
  pillar: PILLAR,
  doorway: DOORWAY,
  entrance: ENTRANCE,
  stairs: STAIRS,
  cache: CACHE,
};

describe('glyphs', () => {
  it('gives every tile kind a distinct glyph', () => {
    // Two kinds sharing a glyph would make a pinned map unable to tell them apart — a stairs tile
    // could turn into a cache with the expectation still passing.
    const glyphs = TILE_KINDS.map((kind) => DEBUG_GLYPHS[kind]);
    expect(new Set(glyphs).size).toBe(TILE_KINDS.length);
    expect(glyphs).not.toContain(DEBUG_GLYPHS.creature);
  });

  it('renders each kind as its own glyph', () => {
    const grid: Grid = {
      width: TILE_KINDS.length,
      height: 1,
      tiles: TILE_KINDS.map((kind) => BY_KIND[kind]),
    };
    expect(renderGridLines(grid)).toEqual([TILE_KINDS.map((kind) => DEBUG_GLYPHS[kind]).join('')]);
  });

  it('is pure ASCII, so a pinned expectation cannot break on text encoding', () => {
    for (const glyph of Object.values(DEBUG_GLYPHS)) {
      expect(glyph).toHaveLength(1);
      expect(glyph.charCodeAt(0)).toBeLessThan(128);
    }
  });
});

describe('renderGridLines', () => {
  it('produces one line per row, row-major', () => {
    const grid: Grid = { width: 2, height: 3, tiles: [WALL, FLOOR, FLOOR, WALL, PILLAR, FLOOR] };
    expect(renderGridLines(grid)).toEqual(['#.', '.#', 'o.']);
  });
});

describe('renderFloorLines', () => {
  it('draws creatures over the terrain without changing the grid', () => {
    const floor = generateFloor(createRng('debug-overlay'), 4).value;
    const terrain = renderGridLines(floor.grid);
    const withCreatures = renderFloorLines(floor);

    expect(withCreatures).not.toEqual(terrain);
    for (const creature of floor.creatures) {
      expect(withCreatures[creature.at.y][creature.at.x]).toBe(DEBUG_GLYPHS.creature);
      // The tile underneath is untouched: creatures are actors, not terrain.
      expect(terrain[creature.at.y][creature.at.x]).toBe(DEBUG_GLYPHS.floor);
    }

    const changed = withCreatures
      .join('')
      .split('')
      .filter((glyph, index) => glyph !== terrain.join('')[index]).length;
    expect(changed).toBe(floor.creatures.length);
  });

  it('renderFloorAscii is the same thing joined by newlines', () => {
    const floor = generateFloor(createRng('debug-join'), 1).value;
    expect(renderFloorAscii(floor)).toBe(renderFloorLines(floor).join('\n'));
  });
});
