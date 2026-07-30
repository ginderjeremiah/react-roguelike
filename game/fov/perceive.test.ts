import { describe, expect, it } from 'vitest';
import type { Position } from '@/game/map';
import { creatures, origin, parseScene } from '@/tests/unit/support/ascii-grid';
import { computeLitField } from './light';
import { perceive, type CreatureSense } from './perceive';
import { hasTile, tileSetSize, tileSetsEqual } from './tileset';
import { computeTouchField } from './touch';
import { closeShutter, createVision, EMBER_SENSE_RADIUS, openShutter } from './vision';

/**
 * `perceive` is GDD §4's vision table as one switch. These tests are written as the table: for each
 * of the two states, what terrain and which creatures.
 */

function positionsOf(senses: readonly CreatureSense[]): Position[] {
  return senses.map((sense) => sense.at);
}

describe('shutter open: light, line of sight, identity', () => {
  const scene = parseScene([
    '###########',
    '#....#....#',
    '#..c.#..c.#',
    '#..@.+....#',
    '#....#....#',
    '#....#....#',
    '###########',
  ]);
  const at = origin(scene);
  const vision = createVision(scene.grid, 'open');

  it('perceives terrain out to the lit radius, blocked by walls', () => {
    const perception = perceive(scene.grid, vision, at, []);
    expect(tileSetsEqual(perception.terrain, computeLitField(scene.grid, at))).toBe(true);
    expect(hasTile(perception.terrain, 4, 3)).toBe(true);
    expect(hasTile(perception.terrain, 8, 2)).toBe(false);
  });

  it('sees the creature in the lit region and not the one across the wall', () => {
    const perception = perceive(scene.grid, vision, at, creatures(scene));
    expect(perception.creatures).toEqual([{ kind: 'seen', at: { x: 3, y: 2 } }]);
  });

  it('does not see a creature standing in the shadow of a pillar', () => {
    // "In the lit radius" is "on a lit tile" — the same rule the player reads off the screen. The
    // creature is four tiles away, well inside the radius, and directly behind the pillar.
    const shadow = parseScene(['.......', '...c...', '...o...', '.......', '.......', '...@...']);
    const from = origin(shadow);
    const perception = perceive(shadow.grid, createVision(shadow.grid, 'open'), from, creatures(shadow));
    expect(hasTile(perception.terrain, 3, 1)).toBe(false);
    expect(perception.creatures).toEqual([]);
  });

  it('does not feel anything through a wall while the shutter is open', () => {
    // The trade §4's table makes: light identifies, and gives up the wall-piercing sense.
    const perception = perceive(scene.grid, vision, at, creatures(scene));
    expect(positionsOf(perception.creatures)).not.toContainEqual({ x: 8, y: 2 });
  });
});

describe('shutter closed: touch, ember-sense, position only', () => {
  const scene = parseScene([
    '###########',
    '#....#....#',
    '#..c.#..c.#',
    '#..@.#....#',
    '#....#....#',
    '#....#....#',
    '###########',
  ]);
  const at = origin(scene);
  const vision = { ...createVision(scene.grid, 'shuttered'), senseRadius: EMBER_SENSE_RADIUS };

  it('perceives only the nine tiles it can touch', () => {
    const perception = perceive(scene.grid, vision, at, []);
    expect(tileSetSize(perception.terrain)).toBe(9);
    expect(tileSetsEqual(perception.terrain, computeTouchField(scene.grid, at))).toBe(true);
  });

  it('feels both creatures, including the one behind the wall', () => {
    // This is the whole reason to go dark: darkness tells you what is in the next room.
    const perception = perceive(scene.grid, vision, at, creatures(scene));
    expect(perception.creatures).toEqual([
      { kind: 'felt', at: { x: 3, y: 2 } },
      { kind: 'felt', at: { x: 8, y: 2 } },
    ]);
  });

  it('feels nothing beyond the current adaptation radius', () => {
    const blind = { ...vision, senseRadius: 1 };
    const perception = perceive(scene.grid, blind, at, creatures(scene));
    expect(perception.creatures).toEqual([{ kind: 'felt', at: { x: 3, y: 2 } }]);
  });

  it('does not reveal terrain across the room it can feel creatures in', () => {
    const perception = perceive(scene.grid, vision, at, creatures(scene));
    expect(hasTile(perception.terrain, 8, 2)).toBe(false);
    expect(positionsOf(perception.creatures)).toContainEqual({ x: 8, y: 2 });
  });
});

describe('the same creature, both ways round', () => {
  /** One scene, one creature behind a wall, both shutter states. The design in four lines. */
  const scene = parseScene(['#######', '#@.#c.#', '#######']);
  const at = origin(scene);
  const there = creatures(scene);

  it('is felt in the dark and invisible in the light', () => {
    // Fully adapted, stated explicitly: a run starts at the adaptation floor (§4), and the whole
    // claim here is about what ember-sense reaches *at* full radius.
    const adapted = { ...createVision(scene.grid, 'shuttered'), senseRadius: EMBER_SENSE_RADIUS };
    const dark = perceive(scene.grid, adapted, at, there);
    const lit = perceive(scene.grid, createVision(scene.grid, 'open'), at, there);

    expect(dark.creatures).toEqual([{ kind: 'felt', at: { x: 4, y: 1 } }]);
    expect(lit.creatures).toEqual([]);
    // And the light shows more terrain in exchange.
    expect(tileSetSize(lit.terrain)).toBeGreaterThan(tileSetSize(dark.terrain));
  });
});

describe('perception is independent of how it was asked', () => {
  const scene = parseScene([
    '...........',
    '..c.....c..',
    '...........',
    '.....@.....',
    '...........',
    '..c.....c..',
    '...........',
  ]);
  const at = origin(scene);

  const ROW_MAJOR: Position[] = [
    { x: 2, y: 1 },
    { x: 8, y: 1 },
    { x: 2, y: 5 },
    { x: 8, y: 5 },
  ];

  it('feels creatures row-major whatever order they arrive in', () => {
    // Fully adapted, stated explicitly: `createVision` starts at the adaptation *floor* (§4 —
    // full adaptation is earned), and at radius 1 there would be nothing to order.
    const vision = { ...createVision(scene.grid, 'shuttered'), senseRadius: EMBER_SENSE_RADIUS };
    const forward = perceive(scene.grid, vision, at, creatures(scene));
    const backward = perceive(scene.grid, vision, at, [...creatures(scene)].reverse());
    expect(backward.creatures).toEqual(forward.creatures);
    expect(positionsOf(forward.creatures)).toEqual(ROW_MAJOR);
  });

  it('sees creatures row-major whatever order they arrive in', () => {
    // The lit path needs its own ordering test: the entity layer will hand this list over in actor
    // id order, and §2 breaks scheduler ties by actor id, so spawn order leaking into perception
    // order would eventually leak into turn order.
    const vision = createVision(scene.grid, 'open');
    const forward = perceive(scene.grid, vision, at, creatures(scene));
    const backward = perceive(scene.grid, vision, at, [...creatures(scene)].reverse());

    expect(positionsOf(forward.creatures)).toEqual(ROW_MAJOR);
    expect(positionsOf(backward.creatures)).toEqual(ROW_MAJOR);
  });

  it('does not mutate the grid, the vision, or the creature list', () => {
    const vision = Object.freeze(createVision(scene.grid, 'open'));
    const list = Object.freeze(creatures(scene));
    const gridSnapshot = scene.grid.tiles.map((tile) => tile.kind);

    expect(() => perceive(scene.grid, vision, at, list)).not.toThrow();
    expect(scene.grid.tiles.map((tile) => tile.kind)).toEqual(gridSnapshot);
    expect(tileSetSize(vision.remembered)).toBe(0);
  });

  it('produces a fresh perception every call', () => {
    const vision = createVision(scene.grid, 'open');
    const first = perceive(scene.grid, vision, at, []);
    const second = perceive(scene.grid, vision, at, []);
    expect(second).not.toBe(first);
    expect(tileSetsEqual(second.terrain, first.terrain)).toBe(true);
  });
});

describe('perceive rejects a shutter state that is not one of the two', () => {
  it('throws instead of silently perceiving nothing', () => {
    const scene = parseScene(['...', '.@.', '...']);
    const broken = { ...createVision(scene.grid, 'open'), shutter: 'ajar' as 'open' };
    expect(() => perceive(scene.grid, broken, origin(scene), [])).toThrow(/perceive/);
  });
});

describe('closing the shutter changes what the next perception contains', () => {
  it('swaps the lit field for touch and the seen list for the felt list', () => {
    const scene = parseScene([
      '.........',
      '.........',
      '....c....',
      '.........',
      '....@....',
      '.........',
      '.........',
    ]);
    const at = origin(scene);
    const list = creatures(scene);

    const open = createVision(scene.grid, 'open');
    const before = perceive(scene.grid, open, at, list);
    expect(before.creatures).toEqual([{ kind: 'seen', at: { x: 4, y: 2 } }]);
    // A 9x9 square clipped to a 9x7 grid.
    expect(tileSetSize(before.terrain)).toBe(63);

    // Shuttering drops the sense radius to 1, so the creature two tiles away is lost as well.
    const after = perceive(scene.grid, closeShutter(open), at, list);
    expect(after.creatures).toEqual([]);
    expect(tileSetSize(after.terrain)).toBe(9);

    // Re-opening restores it.
    expect(perceive(scene.grid, openShutter(closeShutter(open)), at, list).creatures).toEqual(
      before.creatures,
    );
  });
});
