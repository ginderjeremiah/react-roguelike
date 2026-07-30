import { describe, expect, it } from 'vitest';
import { parseScene } from '@/tests/unit/support/ascii-grid';
import {
  blankFlags,
  emptyTileSet,
  hasTile,
  sealTileSet,
  tileSetContains,
  tileSetDifference,
  tileSetOf,
  tileSetPositions,
  tileSetSize,
  tileSetsEqual,
  unionTileSets,
} from './tileset';

/**
 * These helpers are the vocabulary the rest of the module and its tests are written in. A broken
 * `tileSetContains` would make the containment property pass for any FOV at all, so they get
 * tested before anything is built on them.
 */

const { grid } = parseScene(['...', '...', '...']);
const OTHER = parseScene(['....', '....']).grid;

describe('construction', () => {
  it('starts empty and sized to the grid', () => {
    const set = emptyTileSet(grid);
    expect(set.width).toBe(3);
    expect(set.height).toBe(3);
    expect(set.flags).toHaveLength(9);
    expect(tileSetSize(set)).toBe(0);
  });

  it('rejects a flag array that is the wrong length', () => {
    // A short array silently reads as "everything past the end is unlit".
    expect(() => sealTileSet(grid, [true, false])).toThrow(/2 flags for a 3x3 grid/);
    expect(() => sealTileSet(grid, new Array<boolean>(10).fill(false))).toThrow(/expected 9/);
  });

  it('builds a set from positions, whatever order they come in', () => {
    const set = tileSetOf(grid, [
      { x: 2, y: 2 },
      { x: 0, y: 0 },
      { x: 2, y: 2 },
    ]);
    expect(tileSetSize(set)).toBe(2);
    expect(tileSetPositions(set)).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 2 },
    ]);
  });

  it('rejects a position outside the grid rather than dropping it', () => {
    expect(() => tileSetOf(grid, [{ x: 3, y: 0 }])).toThrow(/outside the 3x3/);
  });

  it('hands out a blank array of the right size', () => {
    expect(blankFlags(grid)).toEqual(new Array<boolean>(9).fill(false));
  });
});

describe('membership', () => {
  const set = tileSetOf(grid, [
    { x: 1, y: 0 },
    { x: 0, y: 2 },
  ]);

  it('finds members and rejects non-members', () => {
    expect(hasTile(set, 1, 0)).toBe(true);
    expect(hasTile(set, 0, 2)).toBe(true);
    expect(hasTile(set, 0, 0)).toBe(false);
    expect(hasTile(set, 2, 2)).toBe(false);
  });

  it('answers false off the edge instead of throwing, because neighbour scans ask', () => {
    expect(hasTile(set, -1, 0)).toBe(false);
    expect(hasTile(set, 0, -1)).toBe(false);
    expect(hasTile(set, 3, 0)).toBe(false);
    expect(hasTile(set, 0, 3)).toBe(false);
  });

  it('does not wrap around the end of a row', () => {
    // The bounds check is not decoration. A flat row-major array with no x check turns (3, 0) into
    // (0, 1) and (-1, 1) into (2, 0) — both real tiles, both the wrong answer, and both `true` for
    // this set. That is a lit tile appearing on the far side of the map.
    const wrapping = tileSetOf(grid, [
      { x: 0, y: 1 },
      { x: 2, y: 0 },
    ]);
    expect(hasTile(wrapping, 0, 1)).toBe(true);
    expect(hasTile(wrapping, 2, 0)).toBe(true);
    expect(hasTile(wrapping, 3, 0)).toBe(false);
    expect(hasTile(wrapping, -1, 1)).toBe(false);
  });

  it('reads row-major, so x and y cannot be swapped without noticing', () => {
    const asymmetric = tileSetOf(grid, [{ x: 2, y: 0 }]);
    expect(hasTile(asymmetric, 2, 0)).toBe(true);
    expect(hasTile(asymmetric, 0, 2)).toBe(false);
    expect(tileSetPositions(asymmetric)).toEqual([{ x: 2, y: 0 }]);
  });
});

describe('set algebra', () => {
  const a = tileSetOf(grid, [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ]);
  const b = tileSetOf(grid, [
    { x: 1, y: 1 },
    { x: 2, y: 2 },
  ]);

  it('unions without mutating either side', () => {
    const union = unionTileSets(a, b);
    expect(tileSetPositions(union)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
    expect(tileSetSize(a)).toBe(2);
    expect(tileSetSize(b)).toBe(2);
  });

  it('reports containment in the direction it claims to', () => {
    const union = unionTileSets(a, b);
    expect(tileSetContains(union, a)).toBe(true);
    expect(tileSetContains(union, b)).toBe(true);
    expect(tileSetContains(a, union)).toBe(false);
    expect(tileSetContains(a, b)).toBe(false);
  });

  it('contains the empty set and is contained by nothing smaller', () => {
    const empty = emptyTileSet(grid);
    expect(tileSetContains(a, empty)).toBe(true);
    expect(tileSetContains(empty, a)).toBe(false);
    expect(tileSetContains(empty, empty)).toBe(true);
  });

  it('names what is missing, row-major', () => {
    expect(tileSetDifference(b, a)).toEqual([{ x: 2, y: 2 }]);
    expect(tileSetDifference(a, b)).toEqual([{ x: 0, y: 0 }]);
    expect(tileSetDifference(a, a)).toEqual([]);
  });

  it('compares by contents, not identity', () => {
    expect(tileSetsEqual(a, tileSetOf(grid, [{ x: 1, y: 1 }, { x: 0, y: 0 }]))).toBe(true);
    expect(tileSetsEqual(a, b)).toBe(false);
    expect(tileSetsEqual(a, emptyTileSet(grid))).toBe(false);
  });

  it('refuses to compare sets of different shapes rather than reading past the end', () => {
    const wrong = emptyTileSet(OTHER);
    expect(() => unionTileSets(a, wrong)).toThrow(/same shape/);
    expect(() => tileSetContains(a, wrong)).toThrow(/same shape/);
    expect(tileSetsEqual(a, wrong)).toBe(false);
  });
});
