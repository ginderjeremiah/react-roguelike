import { describe, expect, it } from 'vitest';
import { scenario } from '@/tests/unit/support/scenario';
import {
  creatureIdAt,
  declaredIntent,
  isAdjacent,
  isAlive,
  isAwake,
  isDormant,
  PLAYER_ID,
  withHp,
  withPosition,
  type CreatureActor,
} from './actor';
import { creatureById, playerOf } from './world';

describe('adjacency', () => {
  it('is one orthogonal step and nothing else', () => {
    // GDD §3 chose 4-directional movement partly so that "adjacent" has exactly one meaning for
    // attacks and dormant strikes. A diagonal counting as adjacent would silently give every
    // creature eight attack directions and make a doorway stop being a chokepoint.
    const here = { x: 3, y: 3 };
    expect(isAdjacent(here, { x: 3, y: 2 })).toBe(true);
    expect(isAdjacent(here, { x: 4, y: 3 })).toBe(true);
    expect(isAdjacent(here, { x: 3, y: 4 })).toBe(true);
    expect(isAdjacent(here, { x: 2, y: 3 })).toBe(true);

    expect(isAdjacent(here, { x: 4, y: 4 })).toBe(false);
    expect(isAdjacent(here, { x: 2, y: 2 })).toBe(false);
    expect(isAdjacent(here, { x: 3, y: 5 })).toBe(false);
    // A tile is not adjacent to itself: an actor may never attack its own tile.
    expect(isAdjacent(here, here)).toBe(false);
  });
});

describe('actor ids', () => {
  it('gives the player the lowest id there is', () => {
    // Load-bearing. `schedule.ts` breaks ties by ascending id, and every M1 action costs the same,
    // so ties are the normal case — the player acting first at each instant is a consequence of
    // this number and of nothing else.
    expect(PLAYER_ID).toBe(0);
    expect(creatureIdAt(0)).toBeGreaterThan(PLAYER_ID);
  });

  it('numbers creatures by their position in the floor spawn list', () => {
    expect(creatureIdAt(0)).toBe(1);
    expect(creatureIdAt(3)).toBe(4);
  });
});

describe('actor state', () => {
  const { world, ids } = scenario([
    '#####',
    '#@.c#',
    '#.C.#',
    '#####',
  ]);

  it('reports dormancy from the mind, never from a flag', () => {
    const dormant = creatureById(world, ids[0]);
    const awake = creatureById(world, ids[1]);
    // Ids are assigned row-major, so the `c` on row 1 is the first creature and the `C` on row 2
    // is the second. Asserted rather than assumed — the numbering is what every ordering rule in
    // the scheduler rests on.
    expect(dormant.at).toEqual({ x: 3, y: 1 });
    expect(awake.at).toEqual({ x: 2, y: 2 });

    expect(isDormant(dormant)).toBe(true);
    expect(isAwake(dormant)).toBe(false);
    expect(isDormant(awake)).toBe(false);
    expect(isAwake(awake)).toBe(true);
    // The player is neither, whatever else it is.
    expect(isDormant(playerOf(world))).toBe(false);
    expect(isAwake(playerOf(world))).toBe(false);
  });

  it('refuses to report an intent for a dormant creature', () => {
    // A sentinel `wait` here would let a sleeping creature take a turn's worth of nothing instead
    // of reporting that something put it in the schedule.
    expect(() => declaredIntent(creatureById(world, ids[0]))).toThrow(/dormant/);
    expect(declaredIntent(creatureById(world, ids[1]))).toEqual({ kind: 'wait' });
  });

  it('treats zero HP as dead and anything above it as alive', () => {
    const creature: CreatureActor = creatureById(world, ids[0]);
    expect(isAlive(creature)).toBe(true);
    expect(isAlive(withHp(creature, 1))).toBe(true);
    expect(isAlive(withHp(creature, 0))).toBe(false);
  });

  it('copies rather than mutating, and keeps every other field', () => {
    const creature = creatureById(world, ids[0]);
    const moved = withPosition(withHp(creature, 2), { x: 9, y: 9 });

    expect(creature.hp).toBe(creature.maxHp);
    expect(creature.at).toEqual({ x: 3, y: 1 });
    expect(moved).toEqual({ ...creature, hp: 2, at: { x: 9, y: 9 } });
  });
});
