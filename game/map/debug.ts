/**
 * An ASCII dump of a floor. **A debugging and testing aid, not the presentation layer** — the real
 * glyph grid is `render/`'s job (ADR-0003), and it consumes the `Floor` directly rather than
 * scraping strings.
 *
 * It lives in `game/` anyway because its consumers are here: a pinned dump is the cheapest possible
 * regression test for a generator ("this seed produces exactly this level"), and it is the only
 * practical way to look at a failing floor in a test report.
 *
 * The glyphs follow GDD §10 where §10 has one and stays ASCII where it does not — §10's `·` and `♦`
 * are replaced by `.` and `$` so a pinned expectation in a test file cannot break on a text encoding
 * difference between platforms. Doorway and entrance have no §10 glyph at all; `+` and `<` are the
 * roguelike conventions.
 */

import type { Floor } from './floor';
import { positionOf, type Grid, type Tile } from './grid';
import { assertNever } from '../core/assert';

export const DEBUG_GLYPHS = {
  wall: '#',
  floor: '.',
  pillar: 'o',
  doorway: '+',
  entrance: '<',
  stairs: '>',
  cache: '$',
  /** Overlaid on the tile a dormant creature stands on. §6: `c` is a dormant Cinder. */
  creature: 'c',
} as const;

function glyphFor(tile: Tile): string {
  switch (tile.kind) {
    case 'wall':
      return DEBUG_GLYPHS.wall;
    case 'floor':
      return DEBUG_GLYPHS.floor;
    case 'pillar':
      return DEBUG_GLYPHS.pillar;
    case 'doorway':
      return DEBUG_GLYPHS.doorway;
    case 'entrance':
      return DEBUG_GLYPHS.entrance;
    case 'stairs':
      return DEBUG_GLYPHS.stairs;
    case 'cache':
      return DEBUG_GLYPHS.cache;
    default:
      return assertNever(tile, 'glyphFor');
  }
}

/** One string per grid row, terrain only. */
export function renderGridLines(grid: Grid): string[] {
  const lines: string[] = [];
  for (let y = 0; y < grid.height; y += 1) {
    let line = '';
    for (let x = 0; x < grid.width; x += 1) line += glyphFor(grid.tiles[y * grid.width + x]);
    lines.push(line);
  }
  return lines;
}

/**
 * One string per grid row, with creature spawns drawn on top of the terrain.
 *
 * Creatures overlay rather than replace the tile record because they are not terrain; the tile
 * under a spawn is still whatever it was.
 */
export function renderFloorLines(floor: Floor): string[] {
  const lines = renderGridLines(floor.grid);
  const rows = lines.map((line) => line.split(''));
  for (const creature of floor.creatures) {
    rows[creature.at.y][creature.at.x] = DEBUG_GLYPHS.creature;
  }
  return rows.map((row) => row.join(''));
}

/** The whole floor as one newline-separated block. */
export function renderFloorAscii(floor: Floor): string {
  return renderFloorLines(floor).join('\n');
}

/** Where each glyph is, for a failure message that has to name a tile. */
export function describeTile(grid: Grid, index: number): string {
  const at = positionOf(grid, index);
  return `${grid.tiles[index].kind} at (${at.x}, ${at.y})`;
}
