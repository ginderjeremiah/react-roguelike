/**
 * Hand-built grids from ASCII art, and ASCII pictures of the fields computed over them.
 *
 * ## Why this exists
 *
 * FOV tests are claims about *shapes*. "Nothing behind the wall is lit" is a claim that holds
 * equally well for an FOV that lights nothing, and this project has shipped six of those. A picture
 * of exactly which tiles were lit is a positive assertion and a negative one at once: it fails if a
 * tile that should be lit is dark, and it fails if a tile that should be dark is lit.
 *
 * Failures are readable, too — a diff of two small pictures says where the shadow went wrong, which
 * a set of 40 coordinates does not.
 *
 * The glyphs are `map/debug.ts`'s, so a scene here and a dump of a generated floor read the same.
 * The parser is tested in `ascii-grid.test.ts`; an untested instrument measures nothing.
 *
 * This is test support and lives outside `game/` on purpose: it is not simulation code, and nothing
 * the game ships may depend on it.
 */

import {
  CACHE,
  DOORWAY,
  ENTRANCE,
  FLOOR,
  PILLAR,
  renderGridLines,
  STAIRS,
  WALL,
  type Grid,
  type Position,
  type Tile,
} from '@/game/map';

/** Terrain glyphs, matching `DEBUG_GLYPHS`. */
const TILE_BY_GLYPH: Readonly<Record<string, Tile>> = {
  '#': WALL,
  '.': FLOOR,
  o: PILLAR,
  '+': DOORWAY,
  '<': ENTRANCE,
  '>': STAIRS,
  $: CACHE,
};

/**
 * Glyphs that mark a position and stand on plain floor. Anything not in either table is a typo and
 * throws, so a mistyped scene fails loudly instead of quietly becoming a wall.
 */
const MARK_GLYPHS = '@c123456789';

/** Where a mark glyph was found. */
export type Mark = { readonly glyph: string; readonly at: Position };

export type Scene = {
  readonly grid: Grid;
  /** Row-major, so a scene's marks are in a defined order however they were drawn. */
  readonly marks: readonly Mark[];
};

/**
 * Parse rows of ASCII into a grid plus the positions of any marks.
 *
 * @throws on a ragged picture, an empty picture, or an unknown glyph.
 */
export function parseScene(rows: readonly string[]): Scene {
  if (rows.length === 0) throw new Error('ascii-grid: empty scene');
  const width = rows[0].length;
  if (width === 0) throw new Error('ascii-grid: scene has zero-width rows');

  const tiles: Tile[] = [];
  const marks: Mark[] = [];
  for (let y = 0; y < rows.length; y += 1) {
    const row = rows[y];
    if (row.length !== width) {
      throw new Error(`ascii-grid: row ${y} is ${row.length} wide, expected ${width}`);
    }
    for (let x = 0; x < width; x += 1) {
      const glyph = row[x];
      if (MARK_GLYPHS.includes(glyph)) {
        marks.push({ glyph, at: { x, y } });
        tiles.push(FLOOR);
        continue;
      }
      const tile = TILE_BY_GLYPH[glyph];
      if (!tile) throw new Error(`ascii-grid: unknown glyph '${glyph}' at (${x}, ${y})`);
      tiles.push(tile);
    }
  }

  return { grid: { width, height: rows.length, tiles }, marks };
}

/** Every position carrying `glyph`, row-major. */
export function markedPositions(scene: Scene, glyph: string): Position[] {
  return scene.marks.filter((mark) => mark.glyph === glyph).map((mark) => mark.at);
}

/** The single `@`. @throws if there is not exactly one — an ambiguous origin is a broken test. */
export function origin(scene: Scene): Position {
  const found = markedPositions(scene, '@');
  if (found.length !== 1) {
    throw new Error(`ascii-grid: expected exactly one '@' origin, found ${found.length}`);
  }
  return found[0];
}

/** Every `c`, row-major. Creature positions for the ember-sense and perception tests. */
export function creatures(scene: Scene): Position[] {
  return markedPositions(scene, 'c');
}

/**
 * A picture of a set of tiles: members drawn with their terrain glyph, non-members as a space.
 *
 * Used as the expected value in shape tests. A space is unambiguous because no tile glyph is one.
 */
export function drawTileSet(grid: Grid, flags: readonly boolean[]): string[] {
  if (flags.length !== grid.tiles.length) {
    throw new Error(`ascii-grid: ${flags.length} flags for ${grid.tiles.length} tiles`);
  }
  const terrain = renderGridLines(grid);
  return terrain.map((row, y) =>
    row
      .split('')
      .map((glyph, x) => (flags[y * grid.width + x] ? glyph : ' '))
      .join(''),
  );
}
