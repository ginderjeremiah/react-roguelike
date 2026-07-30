import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  blocksEmberSense,
  chebyshevDistance,
  manhattanDistance,
  TILE_KINDS,
  type Position,
} from '@/game/map';
import { creatures, origin, parseScene } from '@/tests/unit/support/ascii-grid';
import { computeSensedField, senseCreatures } from './embersense';
import { computeLitField } from './light';
import { hasTile, tileSetPositions, tileSetSize } from './tileset';
import { EMBER_SENSE_RADIUS } from './vision';

/**
 * GDD §4 / ADR-0007: ember-sense is the reason darkness carries information. Two rules, and both
 * are easy to break by "tidying up":
 *
 *   1. it goes **through walls**, and
 *   2. it gives **position only**.
 *
 * The tests below are the ones that would notice.
 */

describe('ember-sense passes through stone', () => {
  it('feels a creature behind a wall that light cannot cross', () => {
    // The contrast is the test. Same grid, same origin, same creature: felt, and not lit.
    const scene = parseScene(['#######', '#@#c..#', '#######']);
    const at = origin(scene);
    const creature = creatures(scene)[0];

    expect(senseCreatures(at, EMBER_SENSE_RADIUS, [creature])).toEqual([creature]);

    const lit = computeLitField(scene.grid, at);
    expect(hasTile(lit, creature.x, creature.y)).toBe(false);
  });

  it('feels a creature through an entire sealed room', () => {
    const scene = parseScene([
      '.......',
      '.#####.',
      '.#...#.',
      '.#.c.#.',
      '.#...#.',
      '.#####.',
      '...@...',
    ]);
    const at = origin(scene);
    expect(senseCreatures(at, EMBER_SENSE_RADIUS, creatures(scene))).toHaveLength(1);
    expect(hasTile(computeLitField(scene.grid, at), 3, 3)).toBe(false);
  });

  it('the sensed region includes walls and pillars', () => {
    const scene = parseScene(['###', '#@#', '###']);
    const sensed = computeSensedField(scene.grid, origin(scene), 1);
    expect(tileSetSize(sensed)).toBe(9);
  });

  it.each(TILE_KINDS)('nothing stops ember-sense, including a %s', (kind) => {
    // `computeSensedField` consults `blocksEmberSense` per tile, and that predicate is constant
    // false — so no test of the field can catch someone making a tile opaque to ember-sense. This
    // pins the predicate directly, which is the assertion that would.
    expect(blocksEmberSense({ kind })).toBe(false);
  });
});

describe('ember-sense measures a Chebyshev square', () => {
  const at: Position = { x: 10, y: 10 };

  it('feels a creature at exactly the radius and not one step past it', () => {
    expect(senseCreatures(at, 5, [{ x: 15, y: 10 }])).toHaveLength(1);
    expect(senseCreatures(at, 5, [{ x: 16, y: 10 }])).toHaveLength(0);
    expect(senseCreatures(at, 5, [{ x: 10, y: 5 }])).toHaveLength(1);
    expect(senseCreatures(at, 5, [{ x: 10, y: 4 }])).toHaveLength(0);
  });

  it('feels the far diagonal, which a disc would not', () => {
    // (15, 15) is Chebyshev 5, Euclidean 7.07. A Euclidean implementation fails here, and this is
    // the corner §4 says would otherwise break containment.
    const corner = { x: 15, y: 15 };
    expect(chebyshevDistance(at, corner)).toBe(5);
    expect(senseCreatures(at, 5, [corner])).toEqual([corner]);
  });

  it('feels a near diagonal that a diamond would not', () => {
    // Manhattan 6 but Chebyshev 3. §5's spawn exclusion is Manhattan; vision is not.
    const near = { x: 13, y: 13 };
    expect(manhattanDistance(at, near)).toBe(6);
    expect(senseCreatures(at, 5, [near])).toEqual([near]);
  });

  it('feels only what you stand on at radius 0', () => {
    expect(senseCreatures(at, 0, [{ x: 10, y: 10 }, { x: 11, y: 10 }])).toEqual([{ x: 10, y: 10 }]);
  });

  it('senses a (2r+1) square region in open ground', () => {
    const scene = parseScene(Array.from({ length: 21 }, (_, y) => (y === 10 ? '..........@..........' : '.'.repeat(21))));
    for (const radius of [0, 1, 2, 3, 4, 5]) {
      const sensed = computeSensedField(scene.grid, origin(scene), radius);
      expect(tileSetSize(sensed), `radius ${radius}`).toBe((2 * radius + 1) ** 2);
    }
  });
});

describe('ember-sense gives position and nothing else', () => {
  it('returns bare positions, not the objects it was handed', () => {
    // If the caller passes actors, nothing about them may ride along into the perception — §4 cut
    // identity, health and intent deliberately.
    const carrier = { x: 3, y: 3, id: 7, hp: 5, kind: 'cinder' } as unknown as Position;
    const felt = senseCreatures({ x: 3, y: 3 }, 5, [carrier]);

    expect(felt).toEqual([{ x: 3, y: 3 }]);
    expect(Object.keys(felt[0]).sort()).toEqual(['x', 'y']);
    expect(felt[0]).not.toBe(carrier);
  });

  it('returns creatures row-major whatever order they arrive in', () => {
    const at: Position = { x: 5, y: 5 };
    const positions: Position[] = [
      { x: 7, y: 7 },
      { x: 3, y: 3 },
      { x: 7, y: 3 },
      { x: 3, y: 7 },
    ];
    const expected: Position[] = [
      { x: 3, y: 3 },
      { x: 7, y: 3 },
      { x: 3, y: 7 },
      { x: 7, y: 7 },
    ];

    expect(senseCreatures(at, 5, positions)).toEqual(expected);
    expect(senseCreatures(at, 5, [...positions].reverse())).toEqual(expected);
  });

  it('does not reorder the array it was given', () => {
    const positions: Position[] = [
      { x: 7, y: 7 },
      { x: 3, y: 3 },
    ];
    const snapshot = [...positions];
    senseCreatures({ x: 5, y: 5 }, 5, positions);
    expect(positions).toEqual(snapshot);
  });

  it('throws on a radius that is not a whole number of tiles', () => {
    expect(() => senseCreatures({ x: 0, y: 0 }, -1, [])).toThrow(/non-negative/);
    expect(() => senseCreatures({ x: 0, y: 0 }, 2.5, [])).toThrow(/non-negative/);
  });
});

describe('the region and the creature filter agree', () => {
  it('feels exactly the creatures standing on sensed tiles', () => {
    // Two implementations of one radius — the filter uses chebyshevDistance, the region uses loop
    // bounds — so they are pinned together the way soundness.ts pins its two connectivity passes.
    const scene = parseScene([
      '...........',
      '.c...c...c.',
      '...........',
      '.....@.....',
      '..c.....c..',
      '...........',
      '.c...c...c.',
    ]);
    const at = origin(scene);
    const all = creatures(scene);

    for (const radius of [0, 1, 2, 3, 4, 5]) {
      const sensed = computeSensedField(scene.grid, at, radius);
      const viaRegion = all.filter((c) => hasTile(sensed, c.x, c.y));
      expect(senseCreatures(at, radius, all), `radius ${radius}`).toEqual(viaRegion);
    }
  });

  it('senses a region that grows strictly with every radius', () => {
    const scene = parseScene(Array.from({ length: 13 }, (_, y) => (y === 6 ? '......@......' : '.'.repeat(13))));
    const at = origin(scene);
    let previous = 0;
    for (const radius of [0, 1, 2, 3, 4, 5]) {
      const size = tileSetPositions(computeSensedField(scene.grid, at, radius)).length;
      expect(size, `radius ${radius}`).toBeGreaterThan(previous);
      previous = size;
    }
  });
});

describe('ember-sense is structurally separate from line of sight', () => {
  /**
   * A comment saying "do not route this through the shadowcaster" is not a defence. This reads the
   * source and fails if anyone ever does — which is the single most likely way §4's wall-piercing
   * rule dies, because the two systems look like the same function with a different radius.
   */
  const source = fs.readFileSync(path.resolve(__dirname, 'embersense.ts'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

  it('imports nothing that computes visibility', () => {
    const imports = [...code.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(imports).not.toContain('./shadowcast');
    expect(imports).not.toContain('./light');
    expect(imports).not.toContain('./perceive');
  });

  it('never mentions the opacity predicate light uses', () => {
    expect(code).not.toMatch(/\bblocksLight\b/);
    expect(code).not.toMatch(/\bshadowcast\b/);
  });

  it('the scan itself has no grid to consult', () => {
    // senseCreatures(origin, radius, creatures) — the wall-piercing rule is in the signature.
    expect(senseCreatures.length).toBe(3);
    expect(code).toMatch(/export function senseCreatures\(\s*origin: Position,\s*radius: number,/);
  });
});
