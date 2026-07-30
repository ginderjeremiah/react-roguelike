import { describe, expect, it } from 'vitest';
import { tileAt } from '@/game/map';
import { creatures, drawTileSet, markedPositions, origin, parseScene } from './ascii-grid';

/**
 * The FOV suite asserts against pictures produced by this file. If the parser or the printer is
 * wrong, every one of those tests is comparing two wrong things — and a printer that returned the
 * terrain unchanged would make "the lit region is exactly this shape" pass for any FOV at all.
 *
 * So: the instrument gets tested before the thing it measures.
 */

describe('parseScene', () => {
  it('reads terrain glyphs into the tile union', () => {
    const scene = parseScene(['#.o', '+<>', '$..']);
    expect(scene.grid.width).toBe(3);
    expect(scene.grid.height).toBe(3);
    expect(tileAt(scene.grid, 0, 0).kind).toBe('wall');
    expect(tileAt(scene.grid, 1, 0).kind).toBe('floor');
    expect(tileAt(scene.grid, 2, 0).kind).toBe('pillar');
    expect(tileAt(scene.grid, 0, 1).kind).toBe('doorway');
    expect(tileAt(scene.grid, 1, 1).kind).toBe('entrance');
    expect(tileAt(scene.grid, 2, 1).kind).toBe('stairs');
    expect(tileAt(scene.grid, 0, 2).kind).toBe('cache');
  });

  it('puts marks on floor and records where they were', () => {
    const scene = parseScene(['#c#', '.@.', '#c#']);
    expect(tileAt(scene.grid, 1, 0).kind).toBe('floor');
    expect(origin(scene)).toEqual({ x: 1, y: 1 });
    expect(creatures(scene)).toEqual([
      { x: 1, y: 0 },
      { x: 1, y: 2 },
    ]);
  });

  it('returns marks row-major regardless of where they appear', () => {
    const scene = parseScene(['..c', 'c..', '.c.']);
    expect(markedPositions(scene, 'c')).toEqual([
      { x: 2, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 2 },
    ]);
  });

  it('rejects a ragged picture', () => {
    expect(() => parseScene(['###', '##'])).toThrow(/row 1 is 2 wide/);
  });

  it('rejects an unknown glyph rather than guessing', () => {
    expect(() => parseScene(['#x#'])).toThrow(/unknown glyph 'x'/);
  });

  it('rejects an empty picture', () => {
    expect(() => parseScene([])).toThrow(/empty scene/);
    expect(() => parseScene([''])).toThrow(/zero-width/);
  });

  it('requires exactly one origin', () => {
    expect(() => origin(parseScene(['...']))).toThrow(/found 0/);
    expect(() => origin(parseScene(['@.@']))).toThrow(/found 2/);
  });
});

describe('drawTileSet', () => {
  it('shows members as terrain and non-members as blanks', () => {
    const scene = parseScene(['#.#', '...', '#.#']);
    // Row 1 only.
    const flags = [false, false, false, true, true, true, false, false, false];
    expect(drawTileSet(scene.grid, flags)).toEqual(['   ', '...', '   ']);
  });

  it('distinguishes an empty set from a full one', () => {
    // The check that stops every picture assertion from being vacuous: if drawTileSet ignored its
    // flags and returned the terrain, these two would be equal.
    const scene = parseScene(['#.#', '...']);
    const none = new Array<boolean>(6).fill(false);
    const all = new Array<boolean>(6).fill(true);
    expect(drawTileSet(scene.grid, none)).toEqual(['   ', '   ']);
    expect(drawTileSet(scene.grid, all)).toEqual(['#.#', '...']);
  });

  it('rejects a flag array that does not match the grid', () => {
    const scene = parseScene(['##']);
    expect(() => drawTileSet(scene.grid, [true])).toThrow(/1 flags for 2 tiles/);
  });
});
