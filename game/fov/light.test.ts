import { describe, expect, it } from 'vitest';
import { chebyshevDistance, TILE_KINDS, type TileKind } from '@/game/map';
import { origin, parseScene } from '@/tests/unit/support/ascii-grid';
import { computeLitField } from './light';
import { hasTile, tileSetSize } from './tileset';
import { LIT_RADIUS } from './vision';

/** The glyph `ascii-grid` parses into each tile kind, so the table below can build a scene per kind. */
const GLYPH_BY_KIND: Readonly<Record<TileKind, string>> = {
  wall: '#',
  floor: '.',
  pillar: 'o',
  doorway: '+',
  entrance: '<',
  stairs: '>',
  cache: '$',
};

/** GDD §5 gives the pillar three properties; this is the one about light. */
const BLOCKS_LIGHT: Readonly<Record<TileKind, boolean>> = {
  wall: true,
  pillar: true,
  floor: false,
  doorway: false,
  entrance: false,
  stairs: false,
  cache: false,
};

describe('computeLitField applies the GDD §4 lit radius', () => {
  const OPEN = [
    '...........',
    '...........',
    '...........',
    '...........',
    '...........',
    '.....@.....',
    '...........',
    '...........',
    '...........',
    '...........',
    '...........',
  ];

  it('defaults to Chebyshev radius 4 — the span of the largest room', () => {
    expect(LIT_RADIUS).toBe(4);
    const scene = parseScene(OPEN);
    const at = origin(scene);
    const lit = computeLitField(scene.grid, at);

    expect(tileSetSize(lit)).toBe(81);
    expect(hasTile(lit, at.x + 4, at.y + 4)).toBe(true);
    expect(hasTile(lit, at.x + 5, at.y)).toBe(false);
    expect(hasTile(lit, at.x, at.y + 5)).toBe(false);
  });

  it('honours an explicit radius, for the adjustable-radius item §4 leaves open', () => {
    const scene = parseScene(OPEN);
    const at = origin(scene);
    for (const radius of [0, 1, 2, 3, 5]) {
      const lit = computeLitField(scene.grid, at, radius);
      const expected = scene.grid.tiles.filter((_, index) => {
        const p = { x: index % scene.grid.width, y: Math.floor(index / scene.grid.width) };
        return chebyshevDistance(at, p) <= radius;
      }).length;
      expect(tileSetSize(lit), `radius ${radius}`).toBe(expected);
    }
  });
});

describe('what stops light is exactly blocksLight', () => {
  /**
   * A table test over every tile kind: put one of each between the player and a target three tiles
   * away, and see whether the target is lit. This is the test that fails when someone adds an
   * eighth tile kind, or decides a cache should be waist-high.
   */
  it.each(TILE_KINDS)('a %s between the player and a tile', (kind) => {
    const scene = parseScene([`@${GLYPH_BY_KIND[kind]}..`]);
    const lit = computeLitField(scene.grid, origin(scene));

    // The obstacle itself is always visible — you see the face of the wall.
    expect(hasTile(lit, 1, 0)).toBe(true);
    expect(hasTile(lit, 2, 0)).toBe(!BLOCKS_LIGHT[kind]);
    expect(hasTile(lit, 3, 0)).toBe(!BLOCKS_LIGHT[kind]);
  });

  it('covers every tile kind, so a new one cannot slip past the table', () => {
    expect(Object.keys(BLOCKS_LIGHT).sort()).toEqual([...TILE_KINDS].sort());
    expect(Object.keys(GLYPH_BY_KIND).sort()).toEqual([...TILE_KINDS].sort());
  });
});
