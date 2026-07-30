import { describe, expect, it } from 'vitest';
import { scenario } from '@/tests/unit/support/scenario';
import { DESCENT_HEAL, PLAYER_MAX_HP, STARTING_FUEL } from '../content';
import { findFieldDivergence, formatFieldDivergence } from '../core';
import { isAlive, playerOf, PLAYER_ID, withActor, withHp } from '../entities';
import {
  ADAPTATION_FLOOR,
  computeLitField,
  EMBER_SENSE_RADIUS,
  hasTile,
  tileSetsEqual,
} from '../fov';
import { generateFloor, tileAt, type Floor } from '../map';
import { createRng } from '../rng';
import { createLantern } from './lantern';
import { createLanternWorld, lightingAndWakingPhase, type LanternWorld } from './light';
import { arriveOnFloor, beginRun, descendTurn, isOnStairs } from './run';
import { ACTION_COST, hasActor, nextActAtOf } from './schedule';

/**
 * GDD §13 — the rules that span floors — and §4's "where a run starts".
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * EVERY ASSERTION HERE IS ABOUT A *DELETION* AS MUCH AS A CARRY
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * §13's table has two columns and the right-hand one is the interesting half. "Fuel carries" is
 * the sort of thing that is right by accident; "the map does not" is the sort of thing that is
 * wrong by accident, because the obvious implementation of a descent is to edit the state you have
 * rather than build a new one. So each of the four things §13 says does *not* cross the stairs has
 * its own test, and each of them is arranged so that the pre-descent value is non-empty — a
 * "remembered is empty afterwards" assertion means nothing if it was empty before.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

const FLOOR_ONE: Floor = generateFloor(createRng('descent'), 1).value;
const FLOOR_TWO: Floor = generateFloor(createRng('descent-below'), 2).value;

/** A floor already crossed: shuttered, mid-ramp, part-spent, wounded, with terrain remembered. */
function crossedFloor(): LanternWorld {
  const arrived = createLanternWorld(FLOOR_ONE, 'shuttered', 40);
  const explored = {
    ...arrived,
    world: withActor(arrived.world, withHp(playerOf(arrived.world), 4)),
    lantern: {
      fuel: 40,
      vision: {
        shutter: 'shuttered' as const,
        senseRadius: 3,
        remembered: computeLitField(FLOOR_ONE.grid, FLOOR_ONE.entrance),
      },
    },
  };
  return {
    ...explored,
    world: { ...explored.world, embers: [{ at: FLOOR_ONE.entrance, amount: 20 }] },
  };
}

describe('beginRun — GDD §4s start of a run', () => {
  it('starts at the entrance with the lantern open and the full reserve', () => {
    const start = beginRun(FLOOR_ONE);
    expect(playerOf(start.world).at).toEqual(FLOOR_ONE.entrance);
    expect(start.lantern.vision.shutter).toBe('open');
    expect(start.lantern.fuel).toBe(STARTING_FUEL);
    expect(playerOf(start.world).hp).toBe(PLAYER_MAX_HP);
  });

  it('starts at the adaptation floor — full adaptation is always earned', () => {
    expect(beginRun(FLOOR_ONE).lantern.vision.senseRadius).toBe(ADAPTATION_FLOOR);
    expect(beginRun(FLOOR_ONE).lantern.vision.senseRadius).not.toBe(EMBER_SENSE_RADIUS);
  });

  it('has the entrance room already perceived, and charges nothing for it', () => {
    // §4: "the entrance room is already on screen — the opening perception is not something the
    // first command pays for". Both halves: the memory is exactly phase 3's lit field, and the
    // fuel is untouched. A start that ran a whole turn to light the room would open 4 fuel down
    // and with the clock at 100.
    const start = beginRun(FLOOR_ONE);
    expect(tileSetsEqual(start.lantern.vision.remembered, computeLitField(FLOOR_ONE.grid, FLOOR_ONE.entrance))).toBe(true);
    expect(start.lantern.fuel).toBe(STARTING_FUEL);
    expect(start.world.schedule.now).toBe(0);
  });

  it('leaves the player due, because no command has been issued yet', () => {
    // The mirror image of `arriveOnFloor`, and the reason they are different functions: a run's
    // first command has still to be paid for, whereas a descent's has already been paid.
    expect(nextActAtOf(beginRun(FLOOR_ONE).world.schedule, PLAYER_ID)).toBe(0);
  });

  it('wakes exactly what the opening light reaches — which is sometimes not nothing', () => {
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // A MEASURED CONTRADICTION WITH §13, RECORDED HERE RATHER THAN CODED AROUND
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    //
    // §4 and §13 both claim the opening flash is safe *by construction*: "§5 step 7 puts no
    // creature in the entrance room or in the room merged with it, so phase 3 on the new floor
    // lights a room that is guaranteed empty."
    //
    // The premise is true and the conclusion does not follow. §5's exclusion is about *rooms*; the
    // lit field is Chebyshev 4 **with line of sight**, and line of sight runs through a doorway.
    // An entrance within four tiles of a door, with a Cinder standing in the next room behind it,
    // is lit and therefore woken. Measured over 480 generated floors: **97 of them (20%) wake at
    // least one creature on arrival.**
    //
    // §4's vision table is not negotiable — "every dormant creature in the lit radius wakes" — and
    // adding a first-turn exemption would be a fifth vision state invented by an implementation.
    // So the code does the table, and this test asserts the honest property: everything awake is
    // something the light actually reached. The GDD sentence is the thing that needs correcting.
    let litWakings = 0;
    for (let seed = 0; seed < 40; seed += 1) {
      const floor = generateFloor(createRng(`arrival-${seed}`), (seed % 8) + 1).value;
      const start = beginRun(floor);
      const lit = computeLitField(floor.grid, floor.entrance);
      for (const actor of start.world.actors) {
        if (actor.kind !== 'creature') continue;
        if (actor.mind.kind !== 'awake') continue;
        expect(hasTile(lit, actor.at.x, actor.at.y), `seed ${seed} at (${actor.at.x}, ${actor.at.y})`).toBe(true);
        litWakings += 1;
      }
    }
    // And it happens: a corpus in which nothing ever woke would satisfy the loop above vacuously,
    // which is exactly how the GDD's claim came to be believed.
    expect(litWakings).toBeGreaterThan(0);
  });

  it('never wakes a creature the light does not reach', () => {
    // The other side of the same rule, and the one §5 really does guarantee: nothing in the
    // entrance room, so nothing wakes from being *near* the player. Proximity does not wake — only
    // light does — which is what keeps the dormant strike (§1's only free kill) reachable.
    const floor = generateFloor(createRng('arrival-dark'), 4).value;
    const shuttered = createLanternWorld(floor, 'shuttered');
    const start = lightingAndWakingPhase(shuttered);
    expect(start.world.actors.filter((actor) => actor.kind === 'creature' && actor.mind.kind === 'awake')).toEqual([]);
  });
});

describe('isOnStairs', () => {
  it('asks the tile, not the floors record of where it put them', () => {
    // The grid is the single source of truth about what is on a tile — the same rule that makes a
    // collected cache stop being a cache. A predicate reading `floor.stairs` would answer a
    // different question the moment anything ever rewrites a stairs tile.
    const off = createLanternWorld(FLOOR_ONE, 'shuttered');
    expect(isOnStairs(off)).toBe(false);

    const on = {
      ...off,
      world: withActor(off.world, { ...playerOf(off.world), at: FLOOR_ONE.stairs }),
    };
    expect(isOnStairs(on)).toBe(true);
    expect(tileAt(FLOOR_ONE.grid, FLOOR_ONE.stairs.x, FLOOR_ONE.stairs.y).kind).toBe('stairs');
  });

  it('is false on a hand-built floor with no stairs at all', () => {
    const built = scenario(['#####', '#@..#', '#####']);
    expect(isOnStairs({ world: built.world, lantern: createLantern(built.world.floor.grid, 'shuttered') })).toBe(
      false,
    );
  });
});

describe('arriveOnFloor — what crosses the stairs (§13)', () => {
  const before = crossedFloor();
  const after = arriveOnFloor(before, FLOOR_TWO);

  it('carries the fuel', () => {
    expect(before.lantern.fuel).toBe(40);
    expect(after.lantern.fuel).toBe(40);
  });

  it('carries the shutter setting', () => {
    // §13: "walking downstairs does not touch a setting on a lamp you are holding."
    expect(after.lantern.vision.shutter).toBe('shuttered');
    expect(arriveOnFloor({ ...before, lantern: createLantern(FLOOR_ONE.grid, 'open', 40) }, FLOOR_TWO).lantern.vision.shutter).toBe(
      'open',
    );
  });

  it('carries the ember-sense radius mid-ramp, rather than resetting it', () => {
    // §13's runner-up, and it lost badly: resetting adaptation on descent would make the four turns
    // after every descent a guaranteed-safe wait-and-adapt ritual, seven times a run — Pillar 1's
    // autopilot turn with a fresh coat of paint. The ramp is triggered by the *act* of shuttering
    // (§4), and descending is not shuttering.
    expect(before.lantern.vision.senseRadius).toBe(3);
    expect(after.lantern.vision.senseRadius).toBe(3);
    expect(after.lantern.vision.senseRadius).not.toBe(ADAPTATION_FLOOR);
  });

  it('carries the wounds, plus §3s +2', () => {
    expect(playerOf(before.world).hp).toBe(4);
    expect(playerOf(after.world).hp).toBe(4 + DESCENT_HEAL);
  });

  it('caps the heal at the players maximum', () => {
    const healthy = { ...before, world: withActor(before.world, withHp(playerOf(before.world), PLAYER_MAX_HP)) };
    expect(playerOf(arriveOnFloor(healthy, FLOOR_TWO).world).hp).toBe(PLAYER_MAX_HP);
  });

  it('leaves the map behind: fresh memory, sized to the new grid', () => {
    // The sharpest "does not". Memory is of a place, and you have never been to this one. A
    // `remembered` carried across would draw the floor above's walls over the floor below's — and,
    // because a `TileSet` is a flat array indexed by tile, would index a row out on any grid of a
    // different width.
    expect(before.lantern.vision.remembered.flags.filter(Boolean).length).toBeGreaterThan(10);
    expect(after.lantern.vision.remembered.flags.filter(Boolean).length).toBe(0);
    expect(after.lantern.vision.remembered.width).toBe(FLOOR_TWO.grid.width);
    expect(after.lantern.vision.remembered.height).toBe(FLOOR_TWO.grid.height);
    expect(after.lantern.vision.remembered.flags).toHaveLength(FLOOR_TWO.grid.tiles.length);
  });

  it('sizes the fresh memory to a floor of a genuinely different shape', () => {
    // The three lines above are a *shape* claim, and against two generated floors they cannot fail:
    // every floor the generator builds is the same 11x15, so a carried `TileSet` has the right
    // width and the right length too. `arriveOnFloor` takes any `Floor`, so the claim is put
    // against one that is not 11x15 — which is the only arrangement in which "sized to the new
    // grid" is falsifiable, and the arrangement the comment above is really about.
    //
    // It is not hypothetical twice over: the flags array is indexed as `y * width + x`, so a
    // carried set of the wrong width does not merely look odd, it reads a different tile for every
    // row after the first.
    const small = scenario(['#####', '#@..#', '#####']).world.floor;
    expect(small.grid.width).not.toBe(FLOOR_ONE.grid.width);
    expect(small.grid.tiles.length).not.toBe(FLOOR_ONE.grid.tiles.length);

    const arrived = arriveOnFloor(before, small).lantern.vision.remembered;
    expect(arrived.width).toBe(small.grid.width);
    expect(arrived.height).toBe(small.grid.height);
    expect(arrived.flags).toHaveLength(small.grid.tiles.length);
    expect(arrived.flags.filter(Boolean).length).toBe(0);
  });

  it('leaves the uncollected ember on the floor above', () => {
    // §13: "Fuel you did not collect is fuel you did not earn."
    expect(before.world.embers).toHaveLength(1);
    expect(after.world.embers).toEqual([]);
    expect(after.lantern.fuel).toBe(before.lantern.fuel);
  });

  it('leaves the creatures behind, and the new floor sleeps', () => {
    expect(after.world.floor).toBe(FLOOR_TWO);
    expect(after.world.actors.filter((actor) => actor.kind === 'creature' && actor.mind.kind === 'awake')).toEqual([]);
    expect(after.world.actors).toHaveLength(FLOOR_TWO.creatures.length + 1);
  });

  it('puts the player on the new entrance', () => {
    expect(playerOf(after.world).at).toEqual(FLOOR_TWO.entrance);
  });

  it('restarts the clock at zero and arrives already charged for the descent', () => {
    // §13 pays the descent's turn on the floor below, so phase 1 has already happened by the time
    // this world exists. If the arriving player were still due, phase 4 would throw "the player was
    // due in phase 4" — this is the assertion that keeps that from being how it is discovered.
    expect(after.world.schedule.now).toBe(0);
    expect(nextActAtOf(after.world.schedule, PLAYER_ID)).toBe(ACTION_COST);
    expect(after.world.schedule.entries).toHaveLength(1);
    // The clock's absolute value is not floor-crossing. Nothing reads it, and that is stated here
    // so that the day something does, it is a decision rather than an inheritance.
    expect(before.world.schedule.now).toBe(0);
  });

  it('does not mutate the floor it left', () => {
    const original = crossedFloor();
    arriveOnFloor(original, FLOOR_TWO);
    const divergence = findFieldDivergence(original, crossedFloor());
    if (divergence) throw new Error(`arriveOnFloor mutated its input: ${formatFieldDivergence(divergence)}`);
  });
});

describe('descendTurn — the turn is paid on the floor below', () => {
  it('runs phases 2-6 against the new floor, not the old one', () => {
    // The consequence §13 is built around. Fuel burns *below* (so the new floor's first turn is
    // paid for), phase 3 perceives the *new* entrance, and phase 6 ticks the ramp that crossed.
    const before = crossedFloor();
    const after = descendTurn(before, FLOOR_TWO);

    expect(after.lantern.fuel).toBe(before.lantern.fuel - 1); // shuttered rate, burned below
    expect(hasTile(after.lantern.vision.remembered, FLOOR_TWO.entrance.x, FLOOR_TWO.entrance.y)).toBe(true);
    expect(after.lantern.vision.senseRadius).toBe(before.lantern.vision.senseRadius + 1);
    expect(after.world.schedule.now).toBe(ACTION_COST);
    expect(isAlive(playerOf(after.world))).toBe(true);
  });

  it('does not leave the player due, so phase 4 has nothing to complain about', () => {
    expect(() => descendTurn(crossedFloor(), FLOOR_TWO)).not.toThrow();
    expect(hasActor(descendTurn(crossedFloor(), FLOOR_TWO).world.schedule, PLAYER_ID)).toBe(true);
  });

  it('is a pure function of the state and the floor', () => {
    const divergence = findFieldDivergence(
      descendTurn(crossedFloor(), FLOOR_TWO),
      descendTurn(crossedFloor(), FLOOR_TWO),
    );
    if (divergence) throw new Error(`descendTurn diverged: ${formatFieldDivergence(divergence)}`);
  });
});
