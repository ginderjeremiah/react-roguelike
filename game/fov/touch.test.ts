import { describe, expect, it } from 'vitest';
import { drawTileSet, origin, parseScene } from '@/tests/unit/support/ascii-grid';
import { hasTile, tileSetPositions, tileSetSize } from './tileset';
import { computeTouchField } from './touch';
import { DARK_TOUCH_RADIUS } from './vision';

/**
 * GDD §4's dark terrain rule is "the 8 tiles you can touch, no line-of-sight check". The number 8
 * is the load-bearing part: it is the evidence the metric ruling used to conclude the game had
 * already committed to Chebyshev, since Manhattan and Euclidean radius 1 are both 4 tiles.
 */

describe('computeTouchField feels the 8 tiles around you', () => {
  it('is the tile you stand on plus its eight neighbours', () => {
    expect(DARK_TOUCH_RADIUS).toBe(1);
    const scene = parseScene(['.....', '.....', '..@..', '.....', '.....']);
    const felt = computeTouchField(scene.grid, origin(scene));

    expect(tileSetSize(felt)).toBe(9);
    expect(tileSetPositions(felt)).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 1, y: 3 },
      { x: 2, y: 3 },
      { x: 3, y: 3 },
    ]);
  });

  it('feels the diagonal between two walls — you can feel a corner', () => {
    // The case a line-of-sight pass would take away, and the reason there is no such pass here.
    // The diagonal tile is wedged behind a corner: no ray from the origin reaches it.
    const scene = parseScene(['@#.', '#..', '...']);
    const felt = computeTouchField(scene.grid, origin(scene));

    expect(hasTile(felt, 1, 1)).toBe(true);
    expect(hasTile(felt, 1, 0)).toBe(true);
    expect(hasTile(felt, 0, 1)).toBe(true);
    expect(tileSetSize(felt)).toBe(4);
  });

  it('feels walls, which is what makes the dark navigable', () => {
    const scene = parseScene(['###', '#@#', '###']);
    const felt = computeTouchField(scene.grid, origin(scene));
    expect(drawTileSet(scene.grid, felt.flags)).toEqual(['###', '#.#', '###']);
    expect(tileSetSize(felt)).toBe(9);
  });

  it('feels nothing two tiles away, however open the ground is', () => {
    const scene = parseScene(['.....', '.....', '..@..', '.....', '.....']);
    const felt = computeTouchField(scene.grid, origin(scene));
    for (const at of [
      { x: 0, y: 2 },
      { x: 4, y: 2 },
      { x: 2, y: 0 },
      { x: 2, y: 4 },
      { x: 0, y: 0 },
    ]) {
      expect(hasTile(felt, at.x, at.y)).toBe(false);
    }
  });

  it('clips at the grid corner', () => {
    const scene = parseScene(['@..', '...', '...']);
    const felt = computeTouchField(scene.grid, origin(scene));
    expect(tileSetSize(felt)).toBe(4);
    expect(tileSetPositions(felt)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
  });

  it('throws rather than returning an empty field for a bad call', () => {
    const scene = parseScene(['...', '.@.', '...']);
    expect(() => computeTouchField(scene.grid, { x: 5, y: 0 })).toThrow(/outside the 3x3/);
    expect(() => computeTouchField(scene.grid, { x: 1, y: 1 }, -1)).toThrow(/non-negative/);
    expect(() => computeTouchField(scene.grid, { x: 1, y: 1 }, 1.5)).toThrow(/non-negative/);
  });
});
