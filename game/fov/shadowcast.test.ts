import { describe, expect, it } from 'vitest';
import { blocksLight, chebyshevDistance, generateFloor, positionOf, type Grid, type Position } from '@/game/map';
import { createRng } from '@/game/rng';
import { drawTileSet, origin, parseScene } from '@/tests/unit/support/ascii-grid';
import { shadowcast } from './shadowcast';
import { hasTile, tileSetSize, type TileSet } from './tileset';

/**
 * ## What these tests are guarding against
 *
 * An all-negative FOV suite is worthless: "no tile beyond the radius is lit" and "no tile behind a
 * wall is lit" both hold perfectly for an FOV that lights **nothing**. So the assertions here are
 * mostly pictures and counts — exactly which tiles are lit, and how many — which fail in both
 * directions.
 *
 * The three claims that carry the design are:
 *
 *   - the lit region is a **square** (Chebyshev), not a disc or a diamond;
 *   - a flash from anywhere in a 5x5 room lights the whole room, which is why radius is 4;
 *   - visibility is **symmetric** between passable tiles, so nothing can see the player through a
 *     wall the player cannot see through.
 */

const OPEN_FIELD = [
  '.........',
  '.........',
  '.........',
  '.........',
  '....@....',
  '.........',
  '.........',
  '.........',
  '.........',
];

function litFrom(rows: readonly string[], radius: number): { grid: Grid; lit: TileSet; at: Position } {
  const scene = parseScene(rows);
  const at = origin(scene);
  return { grid: scene.grid, at, lit: shadowcast(scene.grid, at, radius, blocksLight) };
}

/** Every tile of the grid, row-major. */
function allPositions(grid: Grid): Position[] {
  return grid.tiles.map((_, index) => positionOf(grid, index));
}

describe('shadowcast produces a Chebyshev square', () => {
  it('lights the whole square and nothing outside it, in open ground', () => {
    // The positive half is the important one: 81 tiles, not "no tile outside 4".
    const { grid, lit, at } = litFrom(OPEN_FIELD, 4);
    expect(tileSetSize(lit)).toBe(81);
    for (const p of allPositions(grid)) {
      expect(hasTile(lit, p.x, p.y)).toBe(chebyshevDistance(at, p) <= 4);
    }
  });

  it('lights the corners, which is what separates a square from a disc', () => {
    // Euclidean radius 4 excludes (4,4) at distance 5.66; Manhattan excludes it at 8. Only
    // Chebyshev includes it, and the four corners are the whole visual difference.
    const { lit, at } = litFrom(OPEN_FIELD, 4);
    for (const dx of [-4, 4]) {
      for (const dy of [-4, 4]) {
        expect(hasTile(lit, at.x + dx, at.y + dy)).toBe(true);
      }
    }
  });

  it('lights the compass points at exactly the radius and nothing one step further', () => {
    const { lit, at } = litFrom(OPEN_FIELD, 3);
    expect(tileSetSize(lit)).toBe(49);
    expect(hasTile(lit, at.x + 3, at.y)).toBe(true);
    expect(hasTile(lit, at.x, at.y - 3)).toBe(true);
    expect(hasTile(lit, at.x + 4, at.y)).toBe(false);
  });

  it('lights only the origin at radius 0', () => {
    const { lit, at } = litFrom(OPEN_FIELD, 0);
    expect(tileSetSize(lit)).toBe(1);
    expect(hasTile(lit, at.x, at.y)).toBe(true);
  });

  it('clips the square at the grid edge, which has no wall ring', () => {
    // lattice.ts: rooms sit flush against the screen edge. A caster that ran past it would either
    // crash or light phantom tiles.
    const { grid, lit, at } = litFrom(['@....', '.....', '.....'], 4);
    expect(at).toEqual({ x: 0, y: 0 });
    expect(tileSetSize(lit)).toBe(15);
    for (const p of allPositions(grid)) expect(hasTile(lit, p.x, p.y)).toBe(true);
  });
});

describe('shadowcast respects the opacity predicate it is given', () => {
  const WALLED = ['.........', '.........', '..#####..', '..#...#..', '..#.@.#..', '..#...#..', '..#####..', '.........', '.........'];

  it('lights the room and its walls, and nothing beyond them', () => {
    const { grid, lit } = litFrom(WALLED, 4);
    expect(drawTileSet(grid, lit.flags)).toEqual([
      '         ',
      '         ',
      '  #####  ',
      '  #...#  ',
      '  #...#  ',
      '  #...#  ',
      '  #####  ',
      '         ',
      '         ',
    ]);
  });

  it('lights the entire square when nothing is opaque, on the same grid', () => {
    // The counterpart: same walls, a predicate that lets light through, so this can only pass if
    // the caster actually consults the predicate rather than hardcoding a tile kind.
    const scene = parseScene(WALLED);
    const lit = shadowcast(scene.grid, origin(scene), 4, () => false);
    expect(tileSetSize(lit)).toBe(81);
  });

  it('lights only the origin when everything is opaque', () => {
    const scene = parseScene(WALLED);
    const lit = shadowcast(scene.grid, origin(scene), 4, () => true);
    // The eight neighbours are opaque, and opaque tiles are still revealed — you see the wall
    // facing you. Nothing past them is.
    expect(tileSetSize(lit)).toBe(9);
  });
});

describe('shadowcast casts the shadows the geometry says it should', () => {
  it('shadows the region behind a pillar', () => {
    const { grid, lit } = litFrom(
      [
        '#########',
        '#.......#',
        '#.......#',
        '#...o...#',
        '#..@....#',
        '#.......#',
        '#.......#',
        '#.......#',
        '#########',
      ],
      4,
    );
    // The pillar sits one up and one right of the origin, so its umbra opens to the upper right.
    // (7,2) is lit and (6,2) is not: the umbra boundary is the ray through the pillar's near edge,
    // which passes exactly through (7,2)'s centre and above (6,2)'s.
    expect(drawTileSet(grid, lit.flags)).toEqual([
      '######   ',
      '#....    ',
      '#....  . ',
      '#...o... ',
      '#....... ',
      '#....... ',
      '#....... ',
      '#....... ',
      '######## ',
    ]);
  });

  it('leaks light through a doorway into the next room', () => {
    // §4: a doorway is a threshold, and light goes through it. The cone widens with distance,
    // which is what makes a doorway readable as an aperture rather than a hole in the rule.
    const { grid, lit } = litFrom(
      [
        '###########',
        '#....#....#',
        '#....#....#',
        '#..@.+....#',
        '#....#....#',
        '#....#....#',
        '###########',
      ],
      4,
    );
    expect(drawTileSet(grid, lit.flags)).toEqual([
      '######     ',
      '#....#     ',
      '#....# .   ',
      '#....+..   ',
      '#....# .   ',
      '#....#     ',
      '######     ',
    ]);
    // Stated separately so the claim survives a re-pin of the picture: the far side of the wall
    // is lit through the gap, and the wall itself is not transparent.
    expect(hasTile(lit, 6, 3)).toBe(true);
    expect(hasTile(lit, 7, 3)).toBe(true);
    expect(hasTile(lit, 6, 1)).toBe(false);
  });

  it('reveals the face of a wall the light only clips', () => {
    // Walls are revealed whenever a scan reaches them, floors only when their centre is inside the
    // wedge. Without that asymmetry the boundary of a lit region is a ragged edge of half-drawn
    // walls, and a room stops reading as a room. (6, 2) is the case: reached through the doorway
    // aperture, but its centre is outside the cone, so only the wall rule reveals it.
    const { lit } = litFrom(
      [
        '###########',
        '#....#....#',
        '#....##...#',
        '#..@.+....#',
        '#....##...#',
        '#....#....#',
        '###########',
      ],
      4,
    );
    expect(hasTile(lit, 6, 2)).toBe(true);
    expect(hasTile(lit, 6, 4)).toBe(true);
    // ...and the floor tile at the same clipped position is not revealed, which is the half of the
    // rule that keeps visibility symmetric.
    expect(hasTile(lit, 7, 2)).toBe(false);
  });

  it('reveals the wall you are standing against but not what is behind it', () => {
    const { lit } = litFrom(['.....', '.....', '.@###', '.....', '.....'], 4);
    expect(hasTile(lit, 2, 2)).toBe(true);
    expect(hasTile(lit, 3, 2)).toBe(false);
    expect(hasTile(lit, 4, 2)).toBe(false);
  });
});

describe('one flash lights one room — GDD §4', () => {
  /** A 5x5 room, walled, in a grid with room to spare around it. */
  const ROOM_5X5 = [
    '#######',
    '#.....#',
    '#.....#',
    '#.....#',
    '#.....#',
    '#.....#',
    '#######',
  ];

  it('lights every tile of a 5x5 room from every tile in it', () => {
    // This is why the radius is 4: the corner-to-corner Chebyshev span of the largest unmerged
    // room is exactly 4, so the flash decision is *when*, never *where*.
    const scene = parseScene(ROOM_5X5);
    const interior: Position[] = [];
    for (let y = 1; y <= 5; y += 1) for (let x = 1; x <= 5; x += 1) interior.push({ x, y });

    for (const from of interior) {
      const lit = shadowcast(scene.grid, from, 4, blocksLight);
      for (const to of interior) {
        expect(
          hasTile(lit, to.x, to.y),
          `(${to.x}, ${to.y}) should be lit from (${from.x}, ${from.y})`,
        ).toBe(true);
      }
    }
  });

  it('lights the wall ring around the room from the middle of it', () => {
    const scene = parseScene(ROOM_5X5);
    const lit = shadowcast(scene.grid, { x: 3, y: 3 }, 4, blocksLight);
    expect(tileSetSize(lit)).toBe(7 * 7);
  });

  it('cannot light the whole merged hall from anywhere in it', () => {
    // §4 keeps this as the sole exception: the merged hall is 5x10, Chebyshev 9 end to end, so it
    // is the one space on the floor a single flash cannot reveal.
    const hall = ['#######', ...Array.from({ length: 10 }, () => '#.....#'), '#######'];
    const scene = parseScene(hall);
    for (let y = 1; y <= 10; y += 1) {
      for (let x = 1; x <= 5; x += 1) {
        const lit = shadowcast(scene.grid, { x, y }, 4, blocksLight);
        const dark: Position[] = [];
        for (let ty = 1; ty <= 10; ty += 1) {
          for (let tx = 1; tx <= 5; tx += 1) if (!hasTile(lit, tx, ty)) dark.push({ x: tx, y: ty });
        }
        expect(dark.length, `flash from (${x}, ${y}) revealed the whole hall`).toBeGreaterThan(0);
      }
    }
  });
});

describe('shadowcast is symmetric', () => {
  /**
   * The bug this exists for: an FOV where A sees B but B does not see A lets a creature attack
   * from a tile the player cannot see into. It is invisible in a screenshot and obvious in play.
   *
   * Checked over generated floors rather than hand-drawn ones, because the pillar placements are
   * the awkward geometry and nobody would think to draw them.
   */
  function symmetryFailures(grid: Grid, radius: number): { pairs: number; failures: string[] } {
    const transparent = grid.tiles
      .map((tile, index) => ({ tile, index }))
      .filter(({ tile }) => !blocksLight(tile))
      .map(({ index }) => positionOf(grid, index));

    const fields = transparent.map((at) => shadowcast(grid, at, radius, blocksLight));
    const failures: string[] = [];
    let pairs = 0;

    for (let a = 0; a < transparent.length; a += 1) {
      for (let b = a + 1; b < transparent.length; b += 1) {
        const from = transparent[a];
        const to = transparent[b];
        const forward = hasTile(fields[a], to.x, to.y);
        const backward = hasTile(fields[b], from.x, from.y);
        if (forward !== backward) {
          failures.push(
            `(${from.x}, ${from.y}) -> (${to.x}, ${to.y}) is ${forward}, reverse is ${backward}`,
          );
        }
        if (forward && backward) pairs += 1;
      }
    }
    return { pairs, failures };
  }

  it('sees and is seen by exactly the same tiles, on twelve generated floors', () => {
    let mutual = 0;
    for (let seed = 0; seed < 12; seed += 1) {
      const floor = generateFloor(createRng(`symmetry-${seed}`), (seed % 8) + 1).value;
      const { pairs, failures } = symmetryFailures(floor.grid, 4);
      expect(failures.slice(0, 5)).toEqual([]);
      mutual += pairs;
    }
    // Non-vacuity: symmetry is trivially true for an FOV that lights nothing. Twelve floors of
    // ~130 open tiles each must produce thousands of mutually visible pairs.
    expect(mutual).toBeGreaterThan(5000);
  });

  it('stays symmetric at a radius that reaches the whole floor', () => {
    const floor = generateFloor(createRng('symmetry-wide'), 3).value;
    const { pairs, failures } = symmetryFailures(floor.grid, 20);
    expect(failures.slice(0, 5)).toEqual([]);
    expect(pairs).toBeGreaterThan(1000);
  });

  it('is symmetric around the awkward geometry of a wall corner', () => {
    // The specific configuration the classic (non-symmetric) shadowcasting variant gets wrong.
    const scene = parseScene(['.....', '.###.', '.#...', '.#...', '.....']);
    const { failures } = symmetryFailures(scene.grid, 4);
    expect(failures).toEqual([]);
  });
});

describe('shadowcast rejects nonsense rather than returning an empty field', () => {
  const scene = parseScene(['...', '.@.', '...']);

  it('throws when the origin is off the grid', () => {
    expect(() => shadowcast(scene.grid, { x: 3, y: 1 }, 4, blocksLight)).toThrow(/outside the 3x3/);
    expect(() => shadowcast(scene.grid, { x: -1, y: 1 }, 4, blocksLight)).toThrow(/outside the 3x3/);
  });

  it('throws on a negative or fractional radius', () => {
    expect(() => shadowcast(scene.grid, { x: 1, y: 1 }, -1, blocksLight)).toThrow(/non-negative/);
    expect(() => shadowcast(scene.grid, { x: 1, y: 1 }, 2.5, blocksLight)).toThrow(/non-negative/);
  });

  it('still lights the tile you stand on when that tile is opaque', () => {
    // Not reachable in play — the player cannot stand in a wall — but a caster that returned an
    // empty field here would be hiding a bug from every caller that ever asks.
    const walled = parseScene(['...', '.#.', '...']);
    const lit = shadowcast(walled.grid, { x: 1, y: 1 }, 4, blocksLight);
    expect(hasTile(lit, 1, 1)).toBe(true);
  });
});
