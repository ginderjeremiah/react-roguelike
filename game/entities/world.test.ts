import { describe, expect, it } from 'vitest';
import { scenario } from '@/tests/unit/support/scenario';
import { CINDER, PLAYER_ATTACK, PLAYER_MAX_HP } from '../content';
import { createRng } from '../rng';
import { generateFloor } from '../map';
import { addActor, hasActor, removeActor, type Schedule } from '../systems/schedule';
import { PLAYER_ID, withHp, withPosition } from './actor';
import {
  actorById,
  createActorWorld,
  creatureById,
  findActor,
  findWorldProblems,
  isVacant,
  occupantAt,
  playerOf,
  withActor,
  withoutActor,
  withSchedule,
} from './world';

describe('createActorWorld', () => {
  const floor = generateFloor(createRng('spawn-plans'), 4).value;
  const world = createActorWorld(floor);

  it('turns every spawn plan into exactly one actor, plus the player', () => {
    // Floor 4 spawns min(2 + 4, 6) = 6 creatures (§8). A world that dropped one would be a
    // difficulty change nobody made.
    expect(floor.creatures.length).toBe(6);
    expect(world.actors.length).toBe(floor.creatures.length + 1);
  });

  it('numbers creatures by their index in the floor list, which is row-major', () => {
    // ADR-0004's failure mode in its most concrete form: if ids followed the order the generator
    // *drew* the creatures in rather than where they ended up, two floors that differ only in draw
    // order would schedule their creatures in different orders and play differently from the same
    // seed. `generateFloor` sorts `creatures` row-major precisely so this mapping is positional.
    const creatures = world.actors.filter((actor) => actor.kind === 'creature');
    expect(creatures.map((creature) => creature.at)).toEqual(
      floor.creatures.map((spawn) => spawn.at),
    );
    expect(creatures.map((creature) => creature.id)).toEqual([1, 2, 3, 4, 5, 6]);

    // ...and that list really is row-major, so "index order" and "reading order" are the same fact.
    const sorted = [...floor.creatures].sort((a, b) =>
      a.at.y === b.at.y ? a.at.x - b.at.x : a.at.y - b.at.y,
    );
    expect(floor.creatures).toEqual(sorted);
  });

  it('starts the player at the entrance with the content table s numbers', () => {
    const player = playerOf(world);
    expect(player.id).toBe(PLAYER_ID);
    expect(player.at).toEqual(floor.entrance);
    expect(player.hp).toBe(PLAYER_MAX_HP);
    expect(player.maxHp).toBe(PLAYER_MAX_HP);
    expect(player.attack).toBe(PLAYER_ATTACK);
  });

  it('starts every creature dormant, at full HP, and out of the schedule', () => {
    // §5 step 7: creatures spawn dormant. Out of the schedule is this codebase's expression of it —
    // see the scheduling invariant in `world.ts`. A floor that started with six scheduled sleepers
    // would give every one of them a turn before the player had lit anything.
    for (const creature of world.actors.filter((actor) => actor.kind === 'creature')) {
      expect(creature.mind.kind).toBe('dormant');
      expect(creature.hp).toBe(CINDER.maxHp);
      expect(creature.attack).toBe(CINDER.attack);
      expect(hasActor(world.schedule, creature.id)).toBe(false);
    }
    expect(world.schedule.entries.map((entry) => entry.actorId)).toEqual([PLAYER_ID]);
  });

  it('is a pure function of the floor', () => {
    expect(createActorWorld(floor)).toEqual(world);
  });

  it('produces a world with no problems in it', () => {
    expect(findWorldProblems(world)).toEqual([]);
  });
});

describe('occupancy', () => {
  const { world, ids, at } = scenario([
    '#####',
    '#@.c#',
    '#####',
  ]);

  it('finds the living actor standing on a tile', () => {
    expect(occupantAt(world, at('@'))?.id).toBe(PLAYER_ID);
    expect(occupantAt(world, at('c'))?.id).toBe(ids[0]);
    expect(occupantAt(world, { x: 2, y: 1 })).toBeNull();
  });

  it('does not let a corpse occupy space', () => {
    // A creature killed in phase 1 sits at 0 HP until phase 5. If it still blocked its tile, a
    // second creature's declared move into it would fail for the rest of the turn and an attack
    // declared on that tile would "hit" a body instead of missing. Phase 5 is bookkeeping, not the
    // moment the thing stops being in the way.
    const dead = withActor(world, withHp(creatureById(world, ids[0]), 0));
    expect(occupantAt(dead, at('c'))).toBeNull();
    expect(isVacant(dead, at('c'), PLAYER_ID)).toBe(true);
  });

  it('refuses walls, out of bounds, and tiles someone else is standing on', () => {
    expect(isVacant(world, { x: 0, y: 1 }, PLAYER_ID)).toBe(false); // wall
    expect(isVacant(world, { x: -1, y: 1 }, PLAYER_ID)).toBe(false); // outside the grid
    expect(isVacant(world, at('c'), PLAYER_ID)).toBe(false); // occupied
    expect(isVacant(world, at('@'), PLAYER_ID)).toBe(true); // its own tile
    expect(isVacant(world, { x: 2, y: 1 }, PLAYER_ID)).toBe(true);
  });
});

describe('world edits', () => {
  const { world, ids } = scenario(['#####', '#@.c#', '#####']);

  it('replaces an actor in place, keeping ascending id order', () => {
    const updated = withActor(world, withHp(playerOf(world), 4));
    expect(updated.actors.map((actor) => actor.id)).toEqual(world.actors.map((actor) => actor.id));
    expect(playerOf(updated).hp).toBe(4);
    expect(playerOf(world).hp).toBe(PLAYER_MAX_HP);
  });

  it('throws rather than silently inserting an actor that is not there', () => {
    // A `withActor` that appended on a miss would resurrect an actor removed by phase 5 the next
    // time anything held a stale reference to it.
    const stranger = { ...playerOf(world), id: 99 };
    expect(() => withActor(world, stranger)).toThrow(/missing actor 99/);
    expect(() => withoutActor(world, 99)).toThrow(/missing actor 99/);
    expect(findActor(world, 99)).toBeNull();
    expect(() => actorById(world, 99)).toThrow(/no actor 99/);
  });

  it('removes an actor entirely', () => {
    const after = withoutActor(world, ids[0]);
    expect(findActor(after, ids[0])).toBeNull();
    expect(after.actors.length).toBe(world.actors.length - 1);
  });
});

describe('findWorldProblems', () => {
  /**
   * The invariant checker is the backbone of the property sweep, so it gets the treatment
   * `map/soundness.ts` gets: every violation is planted by hand and the checker must report it.
   * Otherwise the sweep is a check that enforces nothing — five PRs in this repo have shipped one.
   */
  const { world, ids, at } = scenario(['#####', '#@.c#', '#####']);

  it('reports an actor standing inside a wall', () => {
    const inside = withActor(world, withPosition(playerOf(world), { x: 0, y: 0 }));
    expect(findWorldProblems(inside)).toEqual([expect.stringContaining('inside a wall')]);
  });

  it('reports an actor outside the grid', () => {
    const outside = withActor(world, withPosition(playerOf(world), { x: 9, y: 9 }));
    expect(findWorldProblems(outside)).toEqual([expect.stringContaining('outside the grid')]);
  });

  it('reports negative HP and HP above the maximum', () => {
    // Negative HP also reads as dead, so the scheduling problem comes along with it — which is
    // itself worth seeing: HP below zero is not a cosmetic error, it takes the actor out of the
    // game.
    expect(findWorldProblems(withActor(world, withHp(playerOf(world), -1)))).toContainEqual(
      expect.stringContaining('negative HP'),
    );
    expect(findWorldProblems(withActor(world, withHp(playerOf(world), 99)))).toEqual([
      expect.stringContaining('above its maximum'),
    ]);
  });

  it('reports a dormant creature holding a place in the queue', () => {
    // The exact state that would let a sleeping creature take a turn.
    const scheduled = withSchedule(world, addActor(world.schedule, ids[0], world.schedule.now));
    expect(findWorldProblems(scheduled)).toEqual([expect.stringContaining('while dormant')]);
  });

  it('reports a dead actor still in the queue', () => {
    // The phase-1 kill-time removal having failed: a corpse that acts.
    const scheduled = withSchedule(world, addActor(world.schedule, ids[0], world.schedule.now));
    const dead = withActor(scheduled, withHp(creatureById(scheduled, ids[0]), 0));
    expect(findWorldProblems(dead)).toContainEqual(expect.stringContaining('while dead'));
  });

  it('reports the player missing from the queue while alive', () => {
    const unscheduled = withSchedule(world, removeActor(world.schedule, PLAYER_ID));
    expect(findWorldProblems(unscheduled)).toEqual([
      expect.stringContaining('owed turns but is not in the schedule'),
    ]);
  });

  it('reports a schedule entry for an actor that does not exist', () => {
    const ghost: Schedule = addActor(world.schedule, 42, world.schedule.now);
    expect(findWorldProblems(withSchedule(world, ghost))).toEqual([
      expect.stringContaining('not in this world'),
    ]);
  });

  it('reports two living actors on the same tile', () => {
    const stacked = withActor(world, withPosition(creatureById(world, ids[0]), at('@')));
    expect(findWorldProblems(stacked)).toContainEqual(expect.stringContaining('are both alive on'));
  });

  it('reports actors out of id order', () => {
    const shuffled = { ...world, actors: [...world.actors].reverse() };
    expect(findWorldProblems(shuffled)).toContainEqual(
      expect.stringContaining('not in ascending id order'),
    );
  });
});
