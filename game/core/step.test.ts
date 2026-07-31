import { describe, expect, it } from 'vitest';
import { scenario } from '@/tests/unit/support/scenario';
import { atTheStairs, diveToTheBottom, standUntilDead } from '@/tests/unit/support/run-script';
import {
  CACHE_FUEL,
  CINDER,
  DESCENT_HEAL,
  FUEL_BURN_LIT,
  FUEL_BURN_SHUTTERED,
  LAST_FLOOR,
  PLAYER_MAX_HP,
  STARTING_FUEL,
} from '../content';
import { isAlive, playerOf, PLAYER_ID, type ActorWorld } from '../entities';
import {
  ADAPTATION_FLOOR,
  computeLitField,
  computeTouchField,
  tileSetsEqual,
  type ShutterState,
} from '../fov';
import { expectedDrawCount, generateFloor, samePosition, tileAt, type Floor, type Position } from '../map';
import { createRng, next, type Rng } from '../rng';
import { ACTION_COST, createLantern } from '../systems';
import { COMMAND_KINDS, DIRECTIONS, neighbourOf, SHUTTER_STATES, type Command } from './command';
import { findFieldDivergence } from './divergence';
import { replay, runCommands } from './replay';
import { createInitialState, floorNumberOf, RUNNING, withWorld, worldOf, type GameState } from './state';
import { step } from './step';

/**
 * Unit tests for one turn of resolution.
 *
 * The replay suite proves that whatever `step` does, it does the same way twice. That is not the
 * same as doing the right thing — a `step` that ignored its command entirely would satisfy every
 * determinism property in the repo. These tests pin what it actually does, with particular
 * attention to three things that are invisible in a casual reading of the state:
 *
 *   - **the generator**, because "consumed a draw it should not have" shifts every subsequent value
 *     in the run and surfaces later, somewhere else, looking like a bug in whatever drew next;
 *   - **refusals**, which must be byte-identical no-ops (contract 6) and are therefore exactly the
 *     thing a passing test can fail to notice;
 *   - **the two counters**, which mean different things and are easy to conflate back together.
 */

const SEED = 'emberdepth';

/** The generator state after `count` raw draws — the yardstick for every draw-count assertion. */
function advance(rng: Rng, count: number): Rng {
  let current = rng;
  for (let i = 0; i < count; i += 1) current = next(current).rng;
  return current;
}

/**
 * A `GameState` around a hand-drawn floor.
 *
 * Generated floors are used where the point is that something holds over the whole space of floors;
 * an ASCII scene is used where the point is a *situation* — the player one step west of a wall, or
 * standing on the stairs with a Cinder in the doorway — which cannot be arranged on a generated
 * floor without first finding one that happens to contain it.
 */
function sceneState(
  lines: readonly string[],
  shutter: ShutterState = 'shuttered',
  fuel = 40,
  floorNumber = 1,
): GameState {
  const built = scenario(lines);
  const world: ActorWorld = {
    ...built.world,
    floor: { ...built.world.floor, floorNumber },
  };
  return {
    world,
    lantern: createLantern(world.floor.grid, shutter, fuel),
    status: RUNNING,
    turnsElapsed: 0,
    commandsResolved: 0,
    kills: 0,
    fuelBurned: 0,
    seed: `scene/${lines.join('|')}`,
    rng: createRng(`scene/${lines.join('|')}`),
  };
}

function playerAt(state: GameState): Position {
  return playerOf(state.world).at;
}

/** The same state with a wounded player. §3 forbids healing, so this cannot be arranged by play. */
function withPlayerHp(state: GameState, hp: number): GameState {
  return {
    ...state,
    world: {
      ...state.world,
      actors: state.world.actors.map((actor) => (actor.kind === 'player' ? { ...actor, hp } : actor)),
    },
  };
}

function litTileCount(state: GameState): number {
  return state.lantern.vision.remembered.flags.filter(Boolean).length;
}

// --- the start of a run ---------------------------------------------------------------------------

describe('createInitialState', () => {
  it('derives the whole floor from the seed, and nothing from anywhere else', () => {
    // Catches: an initial state that ignores its seed. Every replay test in the repo would still
    // pass, because a constant generator is perfectly reproducible — and every run would be the
    // same run, which nobody notices until someone types a seed and gets the map they had before.
    const floor = generateFloor(createRng(SEED), 1).value;
    expect(createInitialState(SEED).world.floor).toEqual(floor);
    expect(findFieldDivergence(createInitialState('other').world.floor, floor)).not.toBeNull();
  });

  it('leaves the generator exactly where generating floor 1 left it', () => {
    // The draw-budget anchor at turn 0. A run consumes entropy *before* its first command, so a
    // budget computed from the command log alone would be short by `expectedDrawCount(1)` — this
    // is the assertion that pins where the count actually starts.
    expect(createInitialState(SEED).rng).toEqual(advance(createRng(SEED), expectedDrawCount(1)));
  });

  it('starts the run GDD §4 says it starts: floor 1, at the entrance, open, 80 fuel', () => {
    const state = createInitialState(SEED);
    expect(floorNumberOf(state)).toBe(1);
    expect(playerAt(state)).toEqual(state.world.floor.entrance);
    expect(state.lantern.vision.shutter).toBe('open');
    expect(state.lantern.fuel).toBe(STARTING_FUEL);
    expect(playerOf(state.world).hp).toBe(PLAYER_MAX_HP);
    expect(state.status).toEqual({ kind: 'running' });
    expect(state.turnsElapsed).toBe(0);
    expect(state.commandsResolved).toBe(0);
  });

  it('starts at the adaptation floor, because full adaptation is always earned', () => {
    // §4, and the reason it is asserted here rather than left to `createVision`: the alternative —
    // starting at `EMBER_SENSE_RADIUS` — hands the player a radius-5 wall-piercing sense on turn 1
    // for free, is invisible in play (shuttering resets it anyway), and shows on §9's HUD as a
    // number the player will act on. An unobservable-in-play rule needs a test or it will be
    // "simplified" back.
    expect(createInitialState(SEED).lantern.vision.senseRadius).toBe(ADAPTATION_FLOOR);
  });

  it('has already perceived the entrance room, and exactly the lit field', () => {
    // §4: "the entrance room is already on screen — the opening perception is not something the
    // first command pays for". Two halves, and the second is what makes it a test: the remembered
    // set is the *lit* field from the entrance, so a start that ran the touch field instead (9
    // tiles rather than a room) fails, and one that ran no perception at all fails harder.
    const state = createInitialState(SEED);
    const lit = computeLitField(state.world.floor.grid, state.world.floor.entrance);
    expect(tileSetsEqual(state.lantern.vision.remembered, lit)).toBe(true);
    expect(litTileCount(state)).toBeGreaterThan(9);
  });

  it('charges no fuel for the opening perception', () => {
    // The other half of "not something the first command pays for". A start that ran a whole turn
    // to light the room would open at 76.
    expect(createInitialState(SEED).lantern.fuel).toBe(STARTING_FUEL);
  });

  it('starts every creature dormant, and the player alone in the schedule', () => {
    const state = createInitialState(SEED);
    expect(state.world.actors.filter((actor) => actor.kind === 'creature' && actor.mind.kind === 'awake')).toEqual([]);
    expect(state.world.schedule.entries).toEqual([{ actorId: PLAYER_ID, nextActAt: 0 }]);
    expect(state.world.schedule.now).toBe(0);
  });

  it('accepts the empty seed', () => {
    // Catches: a guard that rejects '' as falsy. The seed comes from a text field, and an empty one
    // must be a valid run rather than a crash on first launch.
    expect(() => createInitialState('')).not.toThrow();
  });
});

// --- every command kind ---------------------------------------------------------------------------

describe('step — every command kind', () => {
  /**
   * One representative command per kind. `Record<Command['kind'], Command>` requires every kind and
   * permits no others, so adding a `Command` variant without adding it here is a compile error —
   * which is the point. A table test that has to be remembered is a table test that gets forgotten.
   */
  const SAMPLES: Record<Command['kind'], Command> = {
    move: { kind: 'move', dir: 'north' },
    wait: { kind: 'wait' },
    setShutter: { kind: 'setShutter', to: 'shuttered' },
    descend: { kind: 'descend' },
  };

  it('covers exactly the declared command kinds', () => {
    // Catches: COMMAND_KINDS drifting out of sorted order, which would make anything iterating it
    // order-dependent on declaration order.
    expect(COMMAND_KINDS).toEqual([...COMMAND_KINDS].sort());
    expect([...COMMAND_KINDS].sort()).toEqual(Object.keys(SAMPLES).sort());
  });

  it('lists the four directions and the two shutter settings, sorted', () => {
    // The same rule for the payload vocabularies, which are declared out of sorted order on purpose
    // so that dropping the `.sort()` is observable. Found by mutation testing: `COMMAND_KINDS` had
    // this assertion and `DIRECTIONS` did not, so its sort was a line that could be deleted with
    // every test still green — which is the same as not having it. Nothing in the simulation
    // iterates either list today; both are declared sorted, and a declared property with no test is
    // what gets tidied away.
    expect(DIRECTIONS).toEqual(['east', 'north', 'south', 'west']);
    expect(DIRECTIONS).toEqual([...DIRECTIONS].sort());
    expect(SHUTTER_STATES).toEqual(['open', 'shuttered']);
    expect(SHUTTER_STATES).toEqual([...SHUTTER_STATES].sort());
  });

  for (const kind of COMMAND_KINDS) {
    it(`resolves '${kind}' without throwing, from a state where it is legal`, () => {
      // The legality precondition differs per command, so each sample is issued from a state that
      // permits it — a table that issued them all from the entrance would silently test four
      // refusals and pass.
      const start = kind === 'descend' ? atTheStairs(SEED) : createInitialState(SEED);
      const before = start.commandsResolved;
      const after = step(start, SAMPLES[kind]);
      expect(after.commandsResolved, `'${kind}' was refused`).toBe(before + 1);
      expect(after).not.toBe(start);
    });
  }
});

// --- move -----------------------------------------------------------------------------------------

describe("step — 'move'", () => {
  const ROOM = ['#####', '#...#', '#.@.#', '#...#', '#####'];

  it('steps exactly one tile in the direction named', () => {
    // Catches a transposed or sign-flipped direction table. The scene is asymmetric about both
    // axes only in the assertions, so each direction is checked against the position it must land
    // on rather than against "it moved".
    const start = sceneState(ROOM);
    const from = playerAt(start);
    for (const dir of ['north', 'east', 'south', 'west'] as const) {
      expect(playerAt(step(start, { kind: 'move', dir }))).toEqual(neighbourOf(from, dir));
    }
  });

  it('costs exactly one turn, and moves the clock by exactly one action', () => {
    const start = sceneState(ROOM);
    const after = step(start, { kind: 'move', dir: 'north' });
    expect(after.turnsElapsed).toBe(1);
    expect(after.commandsResolved).toBe(1);
    expect(after.world.schedule.now).toBe(start.world.schedule.now + ACTION_COST);
    expect(after.lantern.fuel).toBe(start.lantern.fuel - FUEL_BURN_SHUTTERED);
  });

  it('attacks what is standing there instead of moving into it (§3, bump-to-attack)', () => {
    // The rule §3 settles by *subtracting* a command: "what a tap on an adjacent tile does is
    // decided by what is standing there, never by a mode". A `move` that resolved through
    // `resolveMove` instead of `bump` would leave the Cinder untouched and the player in place,
    // spending the turn on nothing — and every determinism property would still pass.
    const start = sceneState(['#####', '#@c.#', '#####']);
    const after = step(start, { kind: 'move', dir: 'east' });
    const cinder = after.world.actors.find((actor) => actor.kind === 'creature');

    expect(playerAt(after)).toEqual(playerAt(start));
    // Dormant, so §3's double damage applies and 3 × 2 kills a 5 HP Cinder outright. Phase 5 then
    // drops its ember where it fell — on the tile the player did *not* step onto, so the fuel is
    // still on the ground and the turn cost its 1.
    expect(cinder).toBeUndefined();
    expect(after.world.embers).toEqual([{ at: { x: 2, y: 1 }, amount: CINDER.emberDrop }]);
    expect(after.lantern.fuel).toBe(start.lantern.fuel - FUEL_BURN_SHUTTERED);
    // ...and stepping onto it next turn collects it, which is what makes the line above a
    // statement about *where* the ember is rather than about it not existing.
    expect(step(after, { kind: 'move', dir: 'east' }).lantern.fuel).toBe(
      start.lantern.fuel - 2 * FUEL_BURN_SHUTTERED + CINDER.emberDrop,
    );
  });

  it('is refused by a wall, byte-identically', () => {
    // §2: "a move into a wall, a pillar, or off the grid — there is nowhere to step", and "a
    // refusal costs nothing: no fuel, no creature turn, no adaptation tick, no change to any field
    // of the state". Asserted as reference identity, which is the strongest form of that and the
    // only one that cannot rot.
    const start = sceneState(['###', '#@#', '###']);
    for (const dir of ['north', 'east', 'south', 'west'] as const) {
      expect(step(start, { kind: 'move', dir })).toBe(start);
    }
  });

  it('is refused by a pillar and off the grid, not only by a wall', () => {
    // Three tiles named in §2 and three separately reachable branches: `blocksMovement` for the
    // pillar, `inBounds` for the edge. A `canBump` that checked only the tile kind would walk the
    // player off the grid and throw somewhere inside the FOV code next turn.
    const pillar = sceneState(['####', '#@o#', '####']);
    expect(step(pillar, { kind: 'move', dir: 'east' })).toBe(pillar);

    // No wall on the west side: the player is at x = 0 and the tile beyond is off the grid.
    const edge = sceneState(['@.#', '...', '###']);
    expect(step(edge, { kind: 'move', dir: 'west' })).toBe(edge);
    expect(step(edge, { kind: 'move', dir: 'north' })).toBe(edge);
  });

  it('collects an ember cache by walking onto it', () => {
    // Phase 5 runs on a move, and the tile stops being a cache. Included here rather than only in
    // `light.test.ts` because collection is the one thing in the game that *mutates the generated
    // floor*, and `Floor` lives inside `GameState` precisely so that mutation is replayed.
    const built = scenario(['#####', '#@♦.#', '#####']);
    const withCache: GameState = {
      ...sceneState(['#####', '#@♦.#', '#####']),
      world: { ...built.world, floor: { ...built.world.floor, caches: [{ x: 2, y: 1 }] } },
    };
    const after = step(withCache, { kind: 'move', dir: 'east' });
    expect(after.lantern.fuel).toBe(withCache.lantern.fuel - FUEL_BURN_SHUTTERED + CACHE_FUEL);
    expect(tileAt(after.world.floor.grid, 2, 1).kind).toBe('floor');
    expect(after.world.floor.caches).toEqual([]);
  });
});

// --- wait -----------------------------------------------------------------------------------------

describe("step — 'wait'", () => {
  it('spends the turn without moving', () => {
    const start = sceneState(['#####', '#.@.#', '#####']);
    const after = step(start, { kind: 'wait' });
    expect(playerAt(after)).toEqual(playerAt(start));
    expect(after.turnsElapsed).toBe(1);
    expect(after.world.schedule.now).toBe(ACTION_COST);
    expect(after.lantern.fuel).toBe(start.lantern.fuel - FUEL_BURN_SHUTTERED);
  });

  it('is legal on the stairs, which is the whole reason descend is its own command', () => {
    // §9: "Not the self-tap — that is `wait`, and **waiting on the stairs is a real move**: the
    // stairs are exactly where §3's macro decision is made." A `wait` that was quietly rerouted to
    // `descend` on the stairs would delete that decision and pass every other test in this file.
    const start = atTheStairs(SEED);
    const after = step(start, { kind: 'wait' });
    expect(floorNumberOf(after)).toBe(floorNumberOf(start));
    expect(after.rng).toEqual(start.rng);
    expect(after.turnsElapsed).toBe(start.turnsElapsed + 1);
  });

  it('consumes no randomness', () => {
    // Every command except `descend` must leave the generator byte-identical. A stray draw here is
    // invisible in the visible state and shifts every subsequent value in the run.
    const start = sceneState(['#####', '#.@.#', '#####']);
    expect(step(start, { kind: 'wait' }).rng).toEqual(start.rng);
  });
});

// --- setShutter -----------------------------------------------------------------------------------

describe("step — 'setShutter'", () => {
  const ROOM = ['#######', '#@...c#', '#######'];

  it('is free: no turn passes and no creature acts', () => {
    // §2: "a free action runs 1, 2, 3 and 5 and skips 4 and 6". The mistake this guards against is
    // not subtle in its consequences — a free command wired as costing a turn hands every creature
    // on the floor a free turn — but it is entirely invisible in the lantern's own fields.
    //
    // The Cinder is woken by a *first* flash, so the command under test is issued against a floor
    // that already has something in the queue with an action declared. A test that shuttered an
    // empty floor would pass on a free action that ran the whole actor phase.
    const flashed = step(sceneState(ROOM, 'shuttered', 50), { kind: 'setShutter', to: 'open' });
    const declared = flashed.world.actors.find((actor) => actor.kind === 'creature');
    expect(declared?.kind === 'creature' && declared.mind.kind).toBe('awake');

    const after = step(flashed, { kind: 'setShutter', to: 'shuttered' });
    expect(after.turnsElapsed).toBe(0);
    expect(after.commandsResolved).toBe(2);
    expect(after.world.schedule.now).toBe(flashed.world.schedule.now);
    expect(after.world.schedule.entries).toEqual(flashed.world.schedule.entries);
    // The creature still holds what it declared: it has not resolved it, and has not re-declared.
    expect(after.world.actors.find((actor) => actor.kind === 'creature')).toEqual(declared);
  });

  it('still burns its fuel, at the rate the shutter now sits at', () => {
    // §4's arithmetic — "a flash buys a room for 4 fuel", "light is roughly three times cheaper in
    // fuel" — is false if a flash is free, and light would simply dominate exploring.
    const start = sceneState(ROOM, 'shuttered', 50);
    const opened = step(start, { kind: 'setShutter', to: 'open' });
    expect(opened.lantern.fuel).toBe(50 - FUEL_BURN_LIT);
    expect(step(opened, { kind: 'setShutter', to: 'shuttered' }).lantern.fuel).toBe(
      50 - FUEL_BURN_LIT - FUEL_BURN_SHUTTERED,
    );
  });

  it('wakes the room immediately, without costing a turn to do it', () => {
    const start = sceneState(ROOM, 'shuttered', 50);
    const flashed = step(start, { kind: 'setShutter', to: 'open' });
    expect(flashed.world.actors.filter((actor) => actor.kind === 'creature' && actor.mind.kind === 'awake')).toHaveLength(1);
    expect(flashed.world.schedule.now).toBe(start.world.schedule.now);
  });

  it('drops ember-sense to the adaptation floor on shuttering, and does not tick it back', () => {
    const start = sceneState(ROOM, 'open', 50);
    const shut = step(start, { kind: 'setShutter', to: 'shuttered' });
    expect(shut.lantern.vision.senseRadius).toBe(ADAPTATION_FLOOR);
    // §4: the ramp recovers "+1 per turn", and a free action is not a turn — so strobing cannot
    // buy ramp progress. The `wait` afterwards is the contrast that makes this assertion mean
    // something rather than pass on a ramp that never moves at all.
    const strobed = step(step(shut, { kind: 'setShutter', to: 'open' }), { kind: 'setShutter', to: 'shuttered' });
    expect(strobed.lantern.vision.senseRadius).toBe(ADAPTATION_FLOOR);
    expect(step(strobed, { kind: 'wait' }).lantern.vision.senseRadius).toBe(ADAPTATION_FLOOR + 1);
  });

  it('is refused when the shutter is already set that way', () => {
    // Not §2's table — this case did not exist while the command was a *toggle*. Refused because
    // §2 makes the toggle free and re-asserting a setting is not a toggle: resolving it would
    // charge 4 fuel for a double-tap on a control that already read "open", which is exactly the
    // fat-fingered-tap argument §2 uses to justify the free toggle in the first place.
    const open = sceneState(ROOM, 'open', 50);
    expect(step(open, { kind: 'setShutter', to: 'open' })).toBe(open);
    const shut = sceneState(ROOM, 'shuttered', 50);
    expect(step(shut, { kind: 'setShutter', to: 'shuttered' })).toBe(shut);
  });

  it('resolves — does not refuse — an open the lantern is too dry to honour', () => {
    // §4: at 0 fuel "the shutter can no longer be opened", and `lantern.ts` implements that as a
    // legal no-op rather than an error: the control is still under the player's thumb. So this is
    // a *resolved* free action whose effect on the lantern is nil, and it is the one case where
    // `commandsResolved` is the only field that moves. Conflating it with a refusal is the bug
    // this test exists to catch — it would make a resolved command byte-identical to a refused one
    // and quietly falsify the replay suite's "identical means refused" cross-check.
    const dry = sceneState(['#####', '#@..#', '#####'], 'shuttered', 0);
    const after = step(dry, { kind: 'setShutter', to: 'open' });
    expect(after).not.toBe(dry);
    expect(after.commandsResolved).toBe(1);
    expect(after.turnsElapsed).toBe(0);
    expect(after.lantern.vision.shutter).toBe('shuttered');
    expect(after.lantern.fuel).toBe(0);
  });
});

// --- descend ---------------------------------------------------------------------------------------

describe("step — 'descend'", () => {
  it('is refused anywhere but the stairs', () => {
    // §9/§13: "the stairs are where you take them." Byte-identical, and in particular **no draw**:
    // a refused descent that generated a floor and threw it away would advance the generator by
    // ~57 steps and poison every subsequent value in the run without changing anything visible.
    const start = createInitialState(SEED);
    expect(step(start, { kind: 'descend' })).toBe(start);
    expect(step(start, { kind: 'descend' }).rng).toEqual(start.rng);
  });

  it('draws exactly what generating the floor below costs, and nothing else does', () => {
    const start = atTheStairs(SEED);
    const after = step(start, { kind: 'descend' });
    expect(after.rng).toEqual(advance(start.rng, expectedDrawCount(floorNumberOf(after))));
  });

  it('carries the lantern, the eyes and the wounds (§13)', () => {
    // The whole of §13's "carries" column, on a state contrived to make every one of them visible:
    // shuttered (so the shutter has something to carry), mid-ramp (so the sense radius does), and
    // wounded (so the heal does).
    const arrivedAbove = atTheStairs(SEED);
    const start: GameState = {
      ...arrivedAbove,
      world: {
        ...arrivedAbove.world,
        actors: arrivedAbove.world.actors.map((actor) =>
          actor.kind === 'player' ? { ...actor, hp: 5 } : actor,
        ),
      },
      lantern: {
        fuel: 33,
        vision: { ...arrivedAbove.lantern.vision, shutter: 'shuttered', senseRadius: 3 },
      },
    };

    const after = step(start, { kind: 'descend' });
    expect(floorNumberOf(after)).toBe(floorNumberOf(start) + 1);
    expect(after.lantern.vision.shutter).toBe('shuttered');
    expect(after.lantern.vision.senseRadius).toBe(3 + 1); // carried, then phase 6 ticks it
    expect(after.lantern.fuel).toBe(33 - FUEL_BURN_SHUTTERED);
    expect(playerOf(after.world).hp).toBe(5 + DESCENT_HEAL);
  });

  it('caps the descent heal at the player’s maximum', () => {
    const start = atTheStairs(SEED);
    expect(playerOf(start.world).hp).toBe(PLAYER_MAX_HP);
    expect(playerOf(step(start, { kind: 'descend' }).world).hp).toBe(PLAYER_MAX_HP);
  });

  it('leaves the map behind: arriving memory is exactly one perception of the new floor', () => {
    // §13's sharpest "does not": "Memory is of a place, and you have never been to this one." A
    // descent that carried `remembered` across would draw the floor above's walls over the floor
    // below's.
    //
    // The assertion is **equality with the arriving floor's own phase-3 perception**, spelled out
    // from §4's vision table rather than by re-running the descent. Two weaker forms of it were
    // here before and neither could fail:
    //
    //   - "no more tiles than before" — `atTheStairs` arrives from a *shuttered* dive, so the new
    //     floor's touch field is nine tiles and is already a subset of the thirty-odd the floor
    //     above left in memory. A memory that was never cleared satisfies it.
    //   - "sized to the new grid" — every generated floor is the same 11x15, so the width and
    //     length checks hold for the carried set too. `run.test.ts` puts that claim against a floor
    //     of a genuinely different shape, which is where it can fail.
    //
    // Both arrival states are checked, because they perceive differently and only the lit one has
    // a field big enough for "it kept the old map" and "it perceived the new one" to be different
    // sizes.
    const start = atTheStairs(SEED);
    const carried = start.lantern.vision.remembered;
    expect(carried.flags.filter(Boolean).length).toBeGreaterThan(9);

    for (const shutter of SHUTTER_STATES) {
      const poised =
        start.lantern.vision.shutter === shutter ? start : step(start, { kind: 'setShutter', to: shutter });
      const after = step(poised, { kind: 'descend' });
      const grid = after.world.floor.grid;
      const entrance = after.world.floor.entrance;
      const perceived =
        shutter === 'open' ? computeLitField(grid, entrance) : computeTouchField(grid, entrance);

      expect(tileSetsEqual(after.lantern.vision.remembered, perceived), `arriving ${shutter}`).toBe(true);
      // ...and the perception is of the *new* floor, so it is not a coincidence that the two agree:
      // the old floor's memory is a different set.
      expect(tileSetsEqual(after.lantern.vision.remembered, carried), `arriving ${shutter}`).toBe(false);
    }
  });

  it('leaves the creatures, the embers and the clock behind', () => {
    const start = atTheStairs(SEED);
    const after = step(start, { kind: 'descend' });

    expect(after.world.embers).toEqual([]);
    expect(after.world.actors.filter((actor) => actor.kind === 'creature' && actor.mind.kind === 'awake')).toEqual([]);
    // §13: nothing about the clock is floor-crossing, and the arriving schedule holds exactly the
    // player, charged for the turn the descent cost. If the player were still due, phase 4 would
    // have thrown "the player was due in phase 4" — which is why this is the assertion and not a
    // comment.
    expect(after.world.schedule.now).toBe(ACTION_COST);
    expect(after.world.schedule.entries).toEqual([{ actorId: PLAYER_ID, nextActAt: ACTION_COST }]);
  });

  it('puts the player on the new floor’s entrance', () => {
    const after = step(atTheStairs(SEED), { kind: 'descend' });
    expect(playerAt(after)).toEqual(after.world.floor.entrance);
  });

  it('pays the turn on the floor below, so the floor above gets no parting shot', () => {
    // §13: "The creatures on the floor you left get no parting shot ... **the stairs are the one
    // escape nothing follows you down**." Contrived on a hand-drawn floor: the player stands on the
    // stairs, flashes (free, so nothing resolves), and the Cinder below wakes with an attack
    // declared on the tile the player is standing on. The next turn either eats that attack or
    // does not — which is the whole assertion.
    // The player starts wounded, so that "took the hit" and "took the hit and then healed the
    // descent's +2" are different numbers. At full HP they are the same number and this test would
    // pass on a rule that resolved the parting shot and then papered over it.
    const scene = ['#####', '#@>.#', '#.c.#', '#####'];
    const wounded = withPlayerHp(sceneState(scene, 'shuttered', 40), 6);
    const onStairs = step(wounded, { kind: 'move', dir: 'east' });
    const woken = step(onStairs, { kind: 'setShutter', to: 'open' });

    const cinder = woken.world.actors.find((actor) => actor.kind === 'creature');
    expect(cinder?.kind === 'creature' && cinder.mind.kind === 'awake' && cinder.mind.intent).toEqual({
      kind: 'attack',
      at: playerAt(woken),
    });

    // §2: "a creature woken *during* a free action sees two player commands before its declared
    // action resolves." So one turn passes before the attack is due; this is that turn.
    const poised = step(woken, { kind: 'wait' });
    expect(playerOf(poised.world).hp).toBe(6);

    // The control: spend the turn here, and the declared attack lands.
    expect(playerOf(step(poised, { kind: 'wait' }).world).hp).toBe(6 - CINDER.attack);

    // The rule: take the stairs instead, and it does not — the turn is paid on a floor that Cinder
    // is not on. What the player arrives with is the +2, not the −2.
    const after = step(poised, { kind: 'descend' });
    expect(playerOf(after.world).hp).toBe(6 + DESCENT_HEAL);
    expect(floorNumberOf(after)).toBe(2);
  });
});

// --- the end of a run -------------------------------------------------------------------------------

describe('the end of a run', () => {
  it('wins by descending from the last floor, and generates no floor 9', () => {
    // §13: "The eighth descent *is* the ending", and it "ends in phase 1 and nothing else runs,
    // because there is no floor below to burn fuel on". Both halves asserted: the status, and the
    // generator standing exactly where it stood — a `step` that generated floor 9 and discarded it
    // would satisfy the status assertion alone.
    const start = sceneState(['#####', '#@>.#', '#####'], 'shuttered', 40, LAST_FLOOR);
    const onStairs = step(start, { kind: 'move', dir: 'east' });
    expect(tileAt(onStairs.world.floor.grid, playerAt(onStairs).x, playerAt(onStairs).y).kind).toBe('stairs');

    const won = step(onStairs, { kind: 'descend' });
    expect(won.status).toEqual({ kind: 'reachedBottom' });
    expect(won.rng).toEqual(onStairs.rng);
    expect(floorNumberOf(won)).toBe(LAST_FLOOR);
    expect(won.lantern.fuel).toBe(onStairs.lantern.fuel);
    expect(won.world.schedule.now).toBe(onStairs.world.schedule.now);
    // It is still a turn the player spent, and §13's summary screen counts it.
    expect(won.turnsElapsed).toBe(onStairs.turnsElapsed + 1);
    expect(won.commandsResolved).toBe(onStairs.commandsResolved + 1);
  });

  it('refuses every command once the run has been won', () => {
    const start = sceneState(['#####', '#@>.#', '#####'], 'shuttered', 40, LAST_FLOOR);
    const won = step(step(start, { kind: 'move', dir: 'east' }), { kind: 'descend' });
    for (const command of [
      { kind: 'wait' },
      { kind: 'move', dir: 'west' },
      { kind: 'setShutter', to: 'open' },
      { kind: 'descend' },
    ] as Command[]) {
      expect(step(won, command), JSON.stringify(command)).toBe(won);
    }
  });

  it('ends the run when the player dies, and refuses everything after', () => {
    // §13: "a stored run whose command log runs past the death must still replay." So the trailing
    // commands are not an error and are not resolved — the state at the end of the log is the
    // state at the moment of the blow.
    const record = standUntilDead('grave', 4);
    const final = replay(record);
    expect(final.status).toEqual({ kind: 'died' });
    expect(playerOf(final.world).hp).toBe(0);
    // Four commands were issued after the death and none of them resolved.
    expect(final.commandsResolved).toBe(record.commands.length - 4);
    expect(step(final, { kind: 'wait' })).toBe(final);
  });

  it('stops the turn where the killing blow lands: the clock does not advance past it', () => {
    // §13, and the part of it that is genuinely easy to ship wrong, because the wrong version looks
    // like nothing at all: `runActorPhase` returns without `advanceToNextActor`, so `schedule.now`
    // ends one action behind `turnsElapsed`.
    //
    // **Phase 6 is deliberately not asserted here.** The obvious companion line —
    // `fatal.lantern.vision.senseRadius === before.lantern.vision.senseRadius` — cannot fail on this
    // fixture: `standUntilDead` never shutters, a run starts open, and `adaptVision` returns its
    // input unchanged while the shutter is open, so the radius is equal whether or not the phase
    // ran. It sat here reading like coverage. `light.test.ts`'s "a terminal state stops the turn
    // where it happens" owns both skipped phases, on a state contrived so each has something
    // visible to do: a body waiting to be cleared for phase 5, and a mid-climb ramp for phase 6.
    const record = standUntilDead('grave', 0);
    const states = record.commands.map((_, i) => runCommands(record.seed, record.commands.slice(0, i + 1)));
    const fatal = states[states.length - 1];
    const before = states[states.length - 2];

    expect(fatal.status).toEqual({ kind: 'died' });
    expect(fatal.turnsElapsed).toBe(before.turnsElapsed + 1); // the turn was spent...
    expect(fatal.world.schedule.now).toBe(before.world.schedule.now); // ...and the clock did not move
    // ...and an ordinary turn does advance the clock, or the assertion above passes on a clock
    // that never moves.
    expect(before.world.schedule.now).toBeGreaterThan(0);
    expect(before.world.schedule.now).toBe(before.turnsElapsed * ACTION_COST);
  });

  it('runs a whole eight-floor run to the bottom', () => {
    // The full loop, end to end, through the real `step()`. Everything below is a property of a
    // *run* rather than of a turn, and none of it is checkable one command at a time.
    const record = diveToTheBottom(SEED);
    const final = replay(record);

    expect(final.status).toEqual({ kind: 'reachedBottom' });
    expect(floorNumberOf(final)).toBe(LAST_FLOOR);
    expect(isAlive(playerOf(final.world))).toBe(true);
    // Seven descents plus the eighth that wins it — so the floor number moved exactly seven times.
    expect(record.commands.filter((command) => command.kind === 'descend')).toHaveLength(LAST_FLOOR);
    // A free action is in there, so the two counters must disagree by exactly the number of them.
    const free = record.commands.filter((command) => command.kind === 'setShutter').length;
    expect(final.commandsResolved).toBe(record.commands.length);
    expect(final.turnsElapsed).toBe(record.commands.length - free);
    // §4: 0 fuel is not an ending. This run reaches the bottom on an empty lantern, which is the
    // situation §4 says is desperate rather than lost — and the assertion that says so.
    expect(final.lantern.fuel).toBe(0);
  });
});

// --- the run tally ----------------------------------------------------------------------------------

/**
 * §13's summary numbers — `kills` and `fuelBurned` — and **where in the turn each one is counted**.
 *
 * Both are accumulated inside `step` rather than derived from the final state, because §13 forbids
 * the derivation in as many words: "the terminal state is a snapshot of the moment the run ended,
 * not a tidied-up world, so counters must be accumulated as they happen". That makes *which moment*
 * the load-bearing decision, and the two moments are different:
 *
 *   - **`fuelBurned` is GDD §2 phase 2, and only phase 2.** Not the turn's net fuel change, because
 *     phase 5 collects embers and caches; not the burn rate, because the rate is a rule that lives
 *     in `lantern.ts` and the clamp at 0 is part of it.
 *   - **`kills` is the turn as a whole.** Not phase 5, which is where the *body* goes — and which
 *     §13 skips entirely on the turn the player dies.
 *
 * Every test below fails if the counting moves. The last one is the important one: it is the single
 * state where phase 2 has run and phase 5 has not, so it pins both boundaries at once.
 */
describe('the run tally (§13’s summary numbers)', () => {
  const ROOM = ['#######', '#@...c#', '#######'];

  it('starts at zero and remembers the seed it was given', () => {
    for (const seed of ['emberdepth', '', 'ø☃ -_.']) {
      const start = createInitialState(seed);
      expect(start.kills, seed).toBe(0);
      expect(start.fuelBurned, seed).toBe(0);
      // Verbatim. §13's summary prints it and Pillar 4 expects someone to type it back in, so a
      // trim, a lowercase or a `?? 'default'` on the empty seed makes the printed run unshareable
      // while leaving every determinism property green.
      expect(start.seed, seed).toBe(seed);
    }
  });

  it('counts the burn on a free action, which is where the flash costs its 4 (§4)', () => {
    // The boundary against phase 6: `darkAdaptation` is wrapped in `perTurn`, so a meter attached to
    // it would report 0 here while the lantern demonstrably paid. §4's whole exploration arithmetic
    // is that a flash costs 4 fuel; a summary that did not count it would under-report exactly the
    // spending the player is being asked to weigh.
    const start = sceneState(ROOM, 'shuttered', 50);
    const flashed = step(start, { kind: 'setShutter', to: 'open' });
    expect(flashed.turnsElapsed).toBe(0); // free — no turn passed...
    expect(flashed.fuelBurned).toBe(FUEL_BURN_LIT); // ...and it was still paid for
    expect(flashed.lantern.fuel).toBe(50 - FUEL_BURN_LIT);
  });

  it('counts what the lantern actually had, not what the rate would have charged', () => {
    // `burn` clamps at 0 (§4: running dry is a state, not an error), so the last lit turn takes the
    // 2 that were there rather than the 4 the rate names. Metering the *difference* rather than
    // `burnRate(shutter)` is what makes the run's total fuel that actually existed — and it is the
    // one case where the two implementations disagree.
    const nearlyDry = sceneState(ROOM, 'open', 2);
    const after = step(nearlyDry, { kind: 'wait' });
    expect(after.lantern.fuel).toBe(0);
    expect(after.fuelBurned).toBe(2);
    expect(after.fuelBurned).toBeLessThan(FUEL_BURN_LIT);
  });

  it('books the burn gross, so collecting fuel does not cancel it out', () => {
    // Phase 5's income is not a discount on phase 2's cost. The turn below *gains* 24 net fuel, so a
    // meter reading the turn's fuel difference would book a burn of -24 and a summary would show a
    // number that goes backwards when the run goes well.
    const built = scenario(['#####', '#@♦.#', '#####']);
    const withCache: GameState = {
      ...sceneState(['#####', '#@♦.#', '#####']),
      world: { ...built.world, floor: { ...built.world.floor, caches: [{ x: 2, y: 1 }] } },
    };
    const after = step(withCache, { kind: 'move', dir: 'east' });
    expect(after.lantern.fuel).toBeGreaterThan(withCache.lantern.fuel); // the reserve went up...
    expect(after.fuelBurned).toBe(FUEL_BURN_SHUTTERED); // ...and the burn is still one turn's worth
    // §4's conservation identity, which is why `fuelGathered` is not a field: what was gathered is
    // exactly `fuelBurned + fuel - (what the run began with)`.
    expect(after.fuelBurned + after.lantern.fuel - withCache.lantern.fuel).toBe(CACHE_FUEL);
  });

  it('does not move on a refusal, because a refusal runs no phases at all', () => {
    const start = step(createInitialState(SEED), { kind: 'setShutter', to: 'shuttered' });
    expect(start.fuelBurned).toBeGreaterThan(0); // the positive control: the meter does move
    const refused = step(start, { kind: 'descend' });
    expect(refused).toBe(start);
    expect(refused.fuelBurned).toBe(start.fuelBurned);
    expect(refused.kills).toBe(start.kills);
  });

  it('does not move on the winning descent, which resolves in phase 1 and runs nothing else', () => {
    // §13: the eighth descent "ends in phase 1 and nothing else runs, because there is no floor
    // below to burn fuel on". A meter that ran anyway would charge the player fuel for a floor that
    // does not exist, on the last line of the summary they are about to read.
    const start = sceneState(['#####', '#@>.#', '#####'], 'shuttered', 40, LAST_FLOOR);
    const onStairs = step(start, { kind: 'move', dir: 'east' });
    const won = step(onStairs, { kind: 'descend' });

    expect(won.status).toEqual({ kind: 'reachedBottom' });
    expect(won.turnsElapsed).toBe(onStairs.turnsElapsed + 1); // the turn counted...
    expect(won.fuelBurned).toBe(onStairs.fuelBurned); // ...and no fuel did
    expect(won.lantern.fuel).toBe(onStairs.lantern.fuel);
    expect(won.kills).toBe(onStairs.kills);
  });

  it('credits a descent with no kills, however the floor below is populated', () => {
    // Phase 1 of `descend` replaces the floor and everyone on it, so the *population* of living
    // creatures changes with nobody dying — and `createActorWorld` reissues the same ids, so an
    // identity-based count would be fooled too. §13 calls the floor's remaining creatures a forfeit;
    // crediting them as kills would pay the player for walking away.
    const start = atTheStairs(SEED);
    const above = start.world.floor.creatures.length;
    const after = step(start, { kind: 'descend' });
    const below = after.world.floor.creatures.length;

    expect(after.kills).toBe(start.kills);
    // The positive control: the two floors must actually hold different numbers of creatures, or
    // this passes on a subtraction that happens to come out at zero.
    expect(above).not.toBe(below);
    expect(after.world.actors.filter((actor) => actor.kind === 'creature')).toHaveLength(below);
  });

  it('counts a kill made in phase 1 of the turn the player dies in phase 4', () => {
    // ═══ THE BOUNDARY TEST ═══
    //
    // §13: "If the player dies in phase 4, the actor sweep stops there and **phases 5 and 6 do not
    // run**." So on this one turn, phase 2 has run and phase 5 has not — which makes it the single
    // state that pins both counters to their own moment:
    //
    //   - a `kills` counted at phase 5 (the sweep, `resolveDeaths`) reads **0** here, and the last
    //     thing the player did before dying vanishes off their summary;
    //   - a `fuelBurned` metered at phase 5 or 6 reads **0** for this turn as well.
    //
    // The scene: the player, two Cinders adjacent, and 2 HP left. The flash wakes both (free, so
    // they declare and do not act). The first strike puts the north Cinder to 2 HP; the second kills
    // it in phase 1, and the west one lands the blow that ends the run in phase 4.
    const scene = ['#####', '#.c.#', '#c@.#', '#####'];
    const start = withPlayerHp(sceneState(scene, 'shuttered', 50), 2);
    const flashed = step(start, { kind: 'setShutter', to: 'open' });
    expect(
      flashed.world.actors.filter((actor) => actor.kind === 'creature' && actor.mind.kind === 'awake'),
    ).toHaveLength(2);

    const wounded = step(flashed, { kind: 'move', dir: 'north' });
    expect(wounded.status).toEqual({ kind: 'running' });
    expect(wounded.kills).toBe(0); // struck, not killed — 5 HP less 3 is not 0

    const fatal = step(wounded, { kind: 'move', dir: 'north' });
    expect(fatal.status).toEqual({ kind: 'died' });
    expect(playerOf(fatal.world).hp).toBe(0);

    // The kill counted...
    expect(fatal.kills).toBe(1);
    // ...and phase 5 provably did not run, which is what makes the line above a boundary assertion
    // rather than a restatement: the body is still standing in the world at 0 HP and its ember was
    // never dropped. Both would be false if the sweep had happened.
    const bodies = fatal.world.actors.filter((actor) => actor.kind === 'creature' && !isAlive(actor));
    expect(bodies).toHaveLength(1);
    expect(fatal.world.embers).toEqual([]);
    // The other half: phase 2 *did* run on this turn, so the burn is counted.
    expect(fatal.fuelBurned).toBe(wounded.fuelBurned + FUEL_BURN_LIT);
  });
});

// --- refusals, as a class -------------------------------------------------------------------------

describe('refusals', () => {
  it('return the input state itself, not a copy of it', () => {
    // Contract 6. Reference identity is a stronger statement than structural equality and it is
    // the one that cannot rot: a later `{ ...state }` that also touched the generator would still
    // pass a `toEqual` against a state whose `rng` had not been read.
    const start = createInitialState(SEED);
    expect(step(start, { kind: 'descend' })).toBe(start);
  });

  it('leave the generator, the clock, the fuel and both counters untouched', () => {
    // Spelled out field by field as well as by identity, because identity is what a refactor
    // breaks first and this is the list of what breaking it would cost.
    const start = step(createInitialState(SEED), { kind: 'setShutter', to: 'shuttered' });
    const refused = step(start, { kind: 'descend' });
    expect(refused.rng).toEqual(start.rng);
    expect(refused.world.schedule.now).toBe(start.world.schedule.now);
    expect(refused.lantern.fuel).toBe(start.lantern.fuel);
    expect(refused.turnsElapsed).toBe(start.turnsElapsed);
    expect(refused.commandsResolved).toBe(start.commandsResolved);
  });

  it('do not hand the floor a turn', () => {
    // The consequence §2 gives as the reason refusals are free: charging for a fat-fingered tap
    // "hands every creature on the floor a free turn". A woken Cinder next door must not move.
    const start = sceneState(['#######', '#@...c#', '#######'], 'open', 40);
    const woken = step(start, { kind: 'setShutter', to: 'shuttered' });
    const before = woken.world.actors.find((actor) => actor.kind === 'creature');
    const refused = step(woken, { kind: 'move', dir: 'north' });
    expect(refused).toBe(woken);
    expect(refused.world.actors.find((actor) => actor.kind === 'creature')).toBe(before);
  });
});

// --- malformed commands ---------------------------------------------------------------------------

describe('step — malformed commands', () => {
  const start = createInitialState(SEED);

  it('throws on an unknown command kind rather than silently doing nothing', () => {
    // A record parsed from a save file is `unknown` whatever its declared type says. A default case
    // that returned the state unchanged would make a corrupt record replay as a plausible run that
    // never happened — which is worse than a crash, because it is believable.
    const bogus = { kind: 'teleport' } as unknown as Command;
    expect(() => step(start, bogus)).toThrow(/unknown command kind/);
    expect(() => step(start, bogus)).toThrow(/teleport/);
  });

  it.each([
    ['a diagonal', { kind: 'move', dir: 'northeast' }],
    ['a vector', { kind: 'move', dir: { x: 1, y: 0 } }],
    ['nothing at all', { kind: 'move' }],
  ])('throws on a move with %s', (_label, command) => {
    expect(() => step(start, command as unknown as Command)).toThrow(/move requires a direction/);
  });

  it.each([
    ['ajar', { kind: 'setShutter', to: 'ajar' }],
    ['missing', { kind: 'setShutter' }],
  ])('throws on a setShutter to %s', (_label, command) => {
    expect(() => step(start, command as unknown as Command)).toThrow(/setShutter requires/);
  });

  it('validates before it draws, so a malformed command cannot move the generator', () => {
    // `draw.ts`'s corollary, one level up: nothing may consume entropy and then throw. With an
    // immutable threaded generator the caller's `Rng` survives the exception anyway — the real
    // content of this test is that the *state* is untouched and the error names the command rather
    // than coming from somewhere inside the map generator.
    const onStairs = atTheStairs(SEED);
    const broken = { kind: 'descend', dir: 'nowhere' } as unknown as Command;
    expect(() => step(onStairs, broken)).not.toThrow(); // `descend` carries no payload to break
    expect(() => step(onStairs, { kind: 'move', dir: 'up' } as unknown as Command)).toThrow(/^step: /);
    expect(onStairs.rng).toEqual(atTheStairs(SEED).rng);
  });
});

// --- the floor is inside the state -----------------------------------------------------------------

describe('the seam between the run and the floor', () => {
  it('hands game/systems/ the floor and the lantern, and nothing else', () => {
    // `worldOf` is a *projection*, and the projection is the point: a turn phase must not be able
    // to reach the run's generator, its counters or its ending. Spreading the whole state instead
    // would compile, would pass every behavioural test (the extra fields are dropped again on the
    // way back), and would quietly make `game/systems/` able to read `rng` — at which point the
    // determinism argument for keeping randomness in one layer stops being structural.
    const state = createInitialState(SEED);
    expect(Object.keys(worldOf(state)).sort()).toEqual(['lantern', 'world']);
  });

  it('puts the resolved floor and lantern back, keeping the run’s own fields', () => {
    const state = step(createInitialState(SEED), { kind: 'wait' });
    const elsewhere = createInitialState('elsewhere');
    const merged = withWorld(state, worldOf(elsewhere));

    expect(merged.world).toBe(elsewhere.world);
    expect(merged.lantern).toBe(elsewhere.lantern);
    expect(merged.rng).toEqual(state.rng);
    expect(merged.turnsElapsed).toBe(state.turnsElapsed);
    expect(merged.status).toEqual(state.status);
  });
});

describe('the floor lives inside GameState', () => {
  it('is a plain, JSON-round-trippable value, all the way down', () => {
    // `divergence.ts` throws on a `Map`, a `Set`, or a class instance rather than reporting two
    // different ones as identical, so this is the assertion that keeps the replay tripwire honest
    // about the largest thing in the state.
    const state = replay(diveToTheBottom(SEED, 2));
    const divergence = findFieldDivergence(JSON.parse(JSON.stringify(state)) as GameState, state);
    expect(divergence).toBeNull();
  });

  it('carries the floor’s own number rather than a second copy of it', () => {
    // One source of truth. A `floorNumber` field on `GameState` could disagree with the map the
    // player is standing on, and the disagreement would be invisible until something generated the
    // wrong next floor.
    const state = replay(diveToTheBottom(SEED, 3));
    const floor: Floor = state.world.floor;
    expect(floorNumberOf(state)).toBe(floor.floorNumber);
    expect(samePosition(playerAt(state), floor.entrance)).toBe(true);
  });
});
