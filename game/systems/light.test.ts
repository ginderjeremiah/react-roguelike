import { describe, expect, it } from 'vitest';
import { drawTileSet, origin, parseScene } from '@/tests/unit/support/ascii-grid';
import { allDueNow, awaken, scenario } from '@/tests/unit/support/scenario';
import { CACHE_FUEL, CINDER, FUEL_BURN_LIT, FUEL_BURN_SHUTTERED } from '../content';
import { findFieldDivergence, formatFieldDivergence } from '../core';
import {
  createActorWorld,
  creatureIdAt,
  isAwake,
  isDormant,
  PLAYER_ID,
  playerOf,
  withActor,
  type ActorWorld,
  type Mind,
} from '../entities';
import {
  ADAPTATION_FLOOR,
  closeShutter,
  computeLitField,
  computeTouchField,
  hasBeenLit,
  hasTile,
  revealByLight,
  tileSetContains,
  tileSetsEqual,
  type ShutterState,
} from '../fov';
import {
  generateFloor,
  isPassableAt,
  tileAt,
  type Grid,
  type Position,
} from '../map';
import { createRng } from '../rng';
import { bump } from './combat';
import { canOpen, createLantern, type Lantern } from './lantern';
import {
  collectFuelUnderfoot,
  createLanternWorld,
  deathsAndCollectionPhase,
  lanternLight,
  lanternPhases,
  lightingAndWakingPhase,
  setShutterCommand,
  setShutterTurn,
  type LanternWorld,
} from './light';
import { ACTION_COST, chargeActor } from './schedule';
import { resolveTurn } from './turn';

/**
 * The seam: the real `LightQuery`, the phases built on it, and the free action.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE ASSERTION THIS FILE EXISTS FOR IS THE SYMMETRY ONE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `LightQuery` asks "is the player's light visible **from this tile**" — a creature's-eye question,
 * because §2 phase 3 wakes a sleeper from what *it* can see — and `light.ts` answers it out of the
 * player's-eye lit field. (The question used to be asked from `game/entities/contact.ts`, and moved
 * here with #123 when the entity layer stopped needing it; the asymmetry hazard is unchanged, which
 * is why this block is.) Those are the same set
 * only because `shadowcast.ts` is symmetric, which is a choice that can be undone by a one-line
 * "generous FOV" tweak two milestones from now. The journal's own example of a bug worth writing
 * down is exactly this one: "enemies could see the player through walls the player couldn't see
 * through". So it is asserted over every passable pair on generated floors, from this side of the
 * seam, rather than trusted.
 *
 * The scenes below are deliberately **non-square and off-diagonal**. The FOV review found two
 * shipped coordinate transpositions that survived 629 tests because every positively-pinned grid
 * was square or had its origin on `x == y`; a 3×3 block centred on the diagonal transposes onto
 * itself. Anything indexing a 2-D grid needs a fixture where `(x, y)` and `(y, x)` are different
 * tiles and both are in bounds.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

// --- the real LightQuery -------------------------------------------------------------------------

/**
 * 13 wide, 7 tall, with the player at (3, 5) — off the diagonal, and `(5, 3)` is a different tile
 * that is also in bounds and is a wall rather than floor. A transposition anywhere under this call
 * changes the answer.
 */
const ROOM = [
  '#############',
  '#...........#',
  '#....#......#',
  '#....#......#',
  '#....#......#',
  '#..@.#......#',
  '#############',
];

function lanternOn(grid: Grid, shutter: ShutterState, fuel = 80): Lantern {
  return createLantern(grid, shutter, fuel);
}

/**
 * §9's thumb control, as one free command: whichever way the shutter is, ask for the other.
 *
 * The *command* is `setShutter(to)` — absolute, so a dropped or duplicated command in a stored log
 * cannot silently invert the rest of a run (`game/core/command.ts`). The control is still a toggle,
 * and these tests are about the control, so the toggle is reconstructed here rather than in `game/`.
 */
function flip(state: LanternWorld): LanternWorld {
  return setShutterTurn(state, state.lantern.vision.shutter === 'open' ? 'shuttered' : 'open');
}

describe('the light query §2 phase 3 is resolved against', () => {
  it('answers false from everywhere while shuttered, including the tile you stand on', () => {
    // Darkness is the mechanic. A query that answered `true` while shuttered would delete the
    // game's central decision rather than change a number (`LightQuery`, in this file).
    const scene = parseScene(ROOM);
    const at = origin(scene);
    const light = lanternLight(scene.grid, lanternOn(scene.grid, 'shuttered'), at);

    for (let y = 0; y < scene.grid.height; y += 1) {
      for (let x = 0; x < scene.grid.width; x += 1) {
        expect(light.isPlayerLightVisibleFrom({ x, y })).toBe(false);
      }
    }
  });

  it('answers true on exactly the lit tiles, and the shape is the one §4 describes', () => {
    const scene = parseScene(ROOM);
    const at = origin(scene);
    const light = lanternLight(scene.grid, lanternOn(scene.grid, 'open'), at);

    const answered: boolean[] = [];
    for (let y = 0; y < scene.grid.height; y += 1) {
      for (let x = 0; x < scene.grid.width; x += 1) answered.push(light.isPlayerLightVisibleFrom({ x, y }));
    }

    // The picture is ground truth by definition — generated from this implementation — so it pins
    // that the shape has not changed rather than that it is right. The claims it encodes are stated
    // as coordinates below, which is the part a deliberate re-pin must not silently discard.
    expect(drawTileSet(scene.grid, answered)).toEqual([
      '             ',
      '#.....       ',
      '#....#       ',
      '#....#       ',
      '#....#       ',
      '#....#       ',
      '######       ',
    ]);

    // Stated separately, in coordinates, because the picture above can be re-pinned:
    // the player's own tile is lit,
    expect(light.isPlayerLightVisibleFrom(at)).toBe(true);
    // the dividing wall at x=5 is lit — a wall the wedge reaches is revealed,
    expect(light.isPlayerLightVisibleFrom({ x: 5, y: 5 })).toBe(true);
    // nothing on the far side of it is,
    expect(light.isPlayerLightVisibleFrom({ x: 6, y: 5 })).toBe(false);
    // a tile at exactly Chebyshev 4 with clear line of sight is lit,
    expect(light.isPlayerLightVisibleFrom({ x: 3, y: 1 })).toBe(true);
    // one tile further is not, which is what radius 4 means,
    expect(light.isPlayerLightVisibleFrom({ x: 3, y: 0 })).toBe(false);
    // and neither is one inside the square that the wall hides.
    expect(light.isPlayerLightVisibleFrom({ x: 7, y: 1 })).toBe(false);
  });

  it('is not reading the grid transposed', () => {
    // The same scene turned on its side. If any index in this path swapped x and y, exactly one of
    // these two orientations would still look right — which is how two transpositions survived the
    // FOV suite.
    const upright = parseScene(ROOM);
    const sideways = parseScene(transpose(ROOM));
    const at = origin(upright);
    const flipped = { x: at.y, y: at.x };

    const a = lanternLight(upright.grid, lanternOn(upright.grid, 'open'), at);
    const b = lanternLight(sideways.grid, lanternOn(sideways.grid, 'open'), flipped);

    for (let y = 0; y < upright.grid.height; y += 1) {
      for (let x = 0; x < upright.grid.width; x += 1) {
        expect(b.isPlayerLightVisibleFrom({ x: y, y: x })).toBe(a.isPlayerLightVisibleFrom({ x, y }));
      }
    }
  });

  it('agrees with the player-side lit field tile for tile', () => {
    // The seam itself: the creature's-eye query and the player's-eye field must be the same set, or
    // a creature could be woken by light the player is not standing in.
    const scene = parseScene(ROOM);
    const at = origin(scene);
    const light = lanternLight(scene.grid, lanternOn(scene.grid, 'open'), at);
    const field = computeLitField(scene.grid, at);

    for (let y = 0; y < scene.grid.height; y += 1) {
      for (let x = 0; x < scene.grid.width; x += 1) {
        expect(light.isPlayerLightVisibleFrom({ x, y })).toBe(hasTile(field, x, y));
      }
    }
  });

  it('is symmetric on every generated floor: nothing sees a lantern it could not be seen from', () => {
    // The property the whole seam rests on. Asserted over every ordered pair of passable tiles on
    // real floors, in both directions, so an asymmetric FOV variant fails here rather than in play.
    let pairs = 0;
    let visiblePairs = 0;

    for (let seed = 0; seed < 6; seed += 1) {
      const grid = generateFloor(createRng(`sym-${seed}`), 4).value.grid;
      const lantern = lanternOn(grid, 'open');
      const standable: Position[] = [];
      for (let y = 0; y < grid.height; y += 1) {
        for (let x = 0; x < grid.width; x += 1) if (isPassableAt(grid, x, y)) standable.push({ x, y });
      }

      for (const a of standable) {
        const fromA = lanternLight(grid, lantern, a);
        for (const b of standable) {
          const fromB = lanternLight(grid, lantern, b);
          pairs += 1;
          const aSeesB = fromA.isPlayerLightVisibleFrom(b);
          if (aSeesB) visiblePairs += 1;
          expect(aSeesB).toBe(fromB.isPlayerLightVisibleFrom(a));
        }
      }
    }

    // The positive half: a query that answered `false` everywhere is perfectly symmetric.
    expect(pairs).toBeGreaterThan(10_000);
    expect(visiblePairs).toBeGreaterThan(pairs / 20);
  });
});

function transpose(rows: readonly string[]): string[] {
  const out: string[] = [];
  for (let x = 0; x < rows[0].length; x += 1) {
    out.push(rows.map((row) => row[x]).join(''));
  }
  return out;
}

// --- the phases ----------------------------------------------------------------------------------

/** A scenario plus a lantern. `scenario()` builds the world; this adds the light. */
function lit(lines: readonly string[], shutter: ShutterState, fuel = 80): LanternWorld {
  const built = scenario(lines);
  return { world: built.world, lantern: createLantern(built.world.floor.grid, shutter, fuel) };
}

/** A player one step west of an ember cache. The subject of §4's cache rule (#31/#41). */
const CACHE_SCENE = ['#####', '#@♦.#', '#####'];
const CACHE_AT: Position = { x: 2, y: 1 };

/**
 * A scene, shuttered, but the lantern has already lit `at`: a room flashed earlier and shut again.
 * That is the state §4's **ever lit** reading is about, and no sequence of commands can produce it
 * inside a 5×3 corridor, so it is built here.
 *
 * **Named for the predicate rather than for the cache**, because since *The dark can take nothing*
 * (#144/#149) it is the precondition of both halves of phase 5: a cache pays where the lantern has
 * been and so does a drop.
 *
 * Through the real `revealByLight` and a real lit field rather than by writing flags, so that a
 * test cannot reveal a tile in a shape the simulation could not produce.
 */
function alreadyLit(lines: readonly string[], at: Position, fuel: number): LanternWorld {
  const state = lit(lines, 'shuttered', fuel);
  const grid = state.world.floor.grid;
  return {
    world: state.world,
    lantern: {
      fuel: state.lantern.fuel,
      vision: revealByLight(state.lantern.vision, computeLitField(grid, at)),
    },
  };
}

/** One whole turn: a wait, or a bump onto `to`. Wired exactly as #18 must wire it. */
function turn(state: LanternWorld, to?: Position): LanternWorld {
  return resolveTurn(
    state,
    lanternPhases('costsATurn', (current) => {
      const charged: LanternWorld = {
        lantern: current.lantern,
        world: { ...current.world, schedule: chargeActor(current.world.schedule, PLAYER_ID) },
      };
      if (to === undefined) return charged;
      return {
        lantern: charged.lantern,
        world: bump(charged.world, PLAYER_ID, to),
      };
    }),
  );
}

/**
 * The single creature's awake mind, or a failure that says what it actually was.
 *
 * A helper rather than a chain of `&&`s in the assertion: a boolean chain collapses "the creature is
 * dormant" and "it declared the wrong thing" into the same `expected false to be true`, which is how
 * a test ends up passing for the wrong reason after an unrelated change moves a creature out of
 * range.
 */
function awakeMind(world: ActorWorld): Extract<Mind, { kind: 'awake' }> {
  const creature = world.actors.find((actor) => actor.kind === 'creature');
  if (creature === undefined || creature.kind !== 'creature') {
    throw new Error('expected a creature in this scene');
  }
  if (creature.mind.kind !== 'awake') throw new Error(`creature ${creature.id} is dormant`);
  return creature.mind;
}

function creatureMinds(world: ActorWorld): string[] {
  return world.actors
    .filter((actor) => actor.kind === 'creature')
    .map((actor) => (actor.kind === 'creature' ? actor.mind.kind : 'player'));
}

describe('phase 3: lighting and waking', () => {
  const ROOM_WITH_SLEEPERS = [
    '###########',
    '#@..c..#c.#',
    '#......#..#',
    '###########',
  ];

  it('wakes every dormant creature in the lit radius, and they declare there and then', () => {
    // The issue's headline rule, and §2 phase 3. "Wakes" without "declares" would leave an awake
    // creature with no intent, which `Mind` makes unrepresentable — so this asserts both at once by
    // reading the intent back.
    const after = lightingAndWakingPhase(lit(ROOM_WITH_SLEEPERS, 'open'));
    const woken = after.world.actors.filter(isAwake);

    expect(woken).toHaveLength(1);
    expect(woken[0].kind === 'creature' && woken[0].mind.kind === 'awake').toBe(true);
    if (woken[0].kind === 'creature' && woken[0].mind.kind === 'awake') {
      // It declared a real action *against the player*, not a placeholder wait: the Cinder is at
      // (4, 1) and the player at (1, 1), so the only declaration that counts is the step west. A
      // move to any other tile would be a creature that woke and wandered.
      expect(woken[0].mind).toEqual({ kind: 'awake', intent: { kind: 'move', to: { x: 3, y: 1 } } });
    }
  });

  it('does not wake the one behind the wall, though it is inside the radius', () => {
    // The Cinder at (8, 1) is Chebyshev 4 from the player and has no line of sight. Light does not
    // go through walls (§4); ember-sense does, and ember-sense wakes nothing.
    const after = lightingAndWakingPhase(lit(ROOM_WITH_SLEEPERS, 'open'));
    const behind = after.world.actors.find((actor) => actor.at.x === 8 && actor.at.y === 1);
    expect(behind && isDormant(behind)).toBe(true);
  });

  it('wakes nothing at all while shuttered', () => {
    const after = lightingAndWakingPhase(lit(ROOM_WITH_SLEEPERS, 'shuttered'));
    expect(creatureMinds(after.world)).toEqual(['dormant', 'dormant']);
  });

  it('never un-wakes anything because the shutter closed again', () => {
    // §4: "nothing ever un-wakes because you shuttered again. A player who strobes wakes the floor."
    // Asserted across several shuttered turns rather than one, because the failure this guards
    // against — recomputing dormancy from the current lighting — would look identical after one.
    let state = lightingAndWakingPhase(lit(ROOM_WITH_SLEEPERS, 'open'));
    expect(state.world.actors.filter(isAwake)).toHaveLength(1);

    state = { world: state.world, lantern: createLantern(state.world.floor.grid, 'shuttered') };
    for (let step = 0; step < 3; step += 1) state = turn(state);
    expect(state.world.actors.filter(isAwake)).toHaveLength(1);
  });

  it('centres the waking light on the PLAYER, not on some fixed tile', () => {
    /**
     * Found in review, and it is the same shape as the FOV suite's square grids: most tests here
     * use `scenario()`, which sets `floor.entrance` to the `@` glyph — so in every ascii fixture
     * `floor.entrance === playerOf(world).at`, and the player never moves during it. A query built
     * from `floor.entrance` instead of the player's position is therefore indistinguishable, and it
     * passed all 712 tests while genuinely changing behaviour.
     *
     * Here the player walks two tiles off the entrance, so the two origins are four tiles apart and
     * disagree about whether the creature is lit.
     *
     *   #############
     *   #@.....c....#   entrance (1,1) · creature (7,1)
     *   #############
     *
     * Chebyshev 4 from the entrance reaches x=5 — the creature is out of it. From the player's
     * tile after two steps, (3,1), it reaches x=7 — the creature is in it.
     *
     * **Retargeted from phase 4 to phase 3 by #123**, which is where the question now lives: a
     * declaration no longer consults the lantern at all, so `lightingAndWakingPhase` is the only
     * place left that can get the origin wrong. The claim is unchanged and the mutant it kills is
     * unchanged; only the phase that would carry it has moved.
     */
    const OFF_ENTRANCE = ['#############', '#@.....c....#', '#############'];

    let state = lit(OFF_ENTRANCE, 'open', 400);
    expect(state.world.floor.entrance).toEqual({ x: 1, y: 1 });
    // Nothing is awake yet: from the entrance the creature is three tiles outside the lit radius.
    expect(state.world.actors.filter(isAwake)).toHaveLength(0);

    // One paid step right leaves it still unlit from either origin — the negative control, which is
    // what stops "it woke eventually" from being the whole of the assertion.
    state = turn(state, { x: 2, y: 1 });
    expect(state.world.actors.filter(isAwake)).toHaveLength(0);

    // The second step puts the creature inside Chebyshev 4 of the *player* and nowhere near the
    // entrance's radius. A query centred on the entrance leaves it asleep here.
    state = turn(state, { x: 3, y: 1 });
    expect(playerOf(state.world).at).toEqual({ x: 3, y: 1 });
    expect(playerOf(state.world).at).not.toEqual(state.world.floor.entrance);
    expect(awakeMind(state.world).intent).toEqual({ kind: 'move', to: { x: 6, y: 1 } });
  });

  // ═══ DELETED BY #123, and recorded rather than quietly dropped ═══
  //
  // There used to be a test here called `lets a creature declaring in phase 4 see the light phase 3
  // just recomputed`. It was found by mutation testing — replacing the light query the *actor*
  // phase was handed with a permanently-dark one left the whole suite green — and its observable
  // was `Mind.turnsSinceContact`, the re-dormancy clock.
  //
  // #123 deleted the clock, and with it the last reason phase 4 was handed a lighting at all:
  // `actorPhase` takes no `LightQuery` any more, so the mutant it killed can no longer be written.
  // The test is not rewritten into something that passes, because there is nothing left for it to
  // assert: a declaration is `attack the tile the player is on if adjacent, otherwise step toward
  // it`, and no lighting can change it. The one rule that still reads the lantern is phase 3's
  // waking, and the test above is what pins its origin.

  it('folds this turn’s terrain into permanent memory, per vision state', () => {
    const shuttered = lightingAndWakingPhase(lit(ROOM_WITH_SLEEPERS, 'shuttered'));
    const grid = shuttered.world.floor.grid;
    const at = playerOf(shuttered.world).at;
    expect(tileSetsEqual(shuttered.lantern.vision.remembered, computeTouchField(grid, at))).toBe(true);

    const open = lightingAndWakingPhase(lit(ROOM_WITH_SLEEPERS, 'open'));
    expect(tileSetsEqual(open.lantern.vision.remembered, computeLitField(grid, at))).toBe(true);
    // The point of the pair: a flash remembers strictly more than a touch, or light would buy
    // nothing (§4's "a flash buys a room; touch buys a step").
    expect(countTiles(open.lantern.vision.remembered.flags)).toBeGreaterThan(
      countTiles(shuttered.lantern.vision.remembered.flags) * 2,
    );
  });

  it('grows the lantern’s own plane only under light, and never by touch', () => {
    // §4's cache rule at its source (#31/#41). Two planes, one of which the dark may not touch —
    // and the dark half is the assertion: a `rememberPerception` that folded the touch field into
    // `revealed` would hand a shuttered crawl every cache on the floor, which is the exact bug the
    // ruling exists to fix, and it would leave the `remembered` assertions above untouched.
    const shuttered = lightingAndWakingPhase(lit(ROOM_WITH_SLEEPERS, 'shuttered'));
    expect(countTiles(shuttered.lantern.vision.remembered.flags)).toBeGreaterThan(0);
    expect(countTiles(shuttered.lantern.vision.revealed.flags)).toBe(0);

    const open = lightingAndWakingPhase(lit(ROOM_WITH_SLEEPERS, 'open'));
    const grid = open.world.floor.grid;
    const at = playerOf(open.world).at;
    expect(tileSetsEqual(open.lantern.vision.revealed, computeLitField(grid, at))).toBe(true);

    // And it is monotone across the transition that matters: light, then go dark, and what the
    // lantern showed you stays shown. This is the state §4's "ever lit" reading is about.
    const wentDark = lightingAndWakingPhase({
      world: open.world,
      lantern: { fuel: open.lantern.fuel, vision: closeShutter(open.lantern.vision) },
    });
    expect(tileSetContains(wentDark.lantern.vision.revealed, open.lantern.vision.revealed)).toBe(true);
    expect(countTiles(wentDark.lantern.vision.revealed.flags)).toBe(
      countTiles(open.lantern.vision.revealed.flags),
    );
  });
});

function countTiles(flags: readonly boolean[]): number {
  return flags.filter(Boolean).length;
}

describe('phase 5: embers and caches', () => {
  it('collects the ember a kill dropped, once the player walks onto it', () => {
    // The lantern has lit the tile the Cinder is standing on, which is what makes the drop takeable
    // at all (§4, *The dark can take nothing*). The unlit case is its own test, below.
    const start = alreadyLit(['#####', '#@c.#', '#####'], { x: 2, y: 1 }, 10);
    const struck = turn(start, { x: 2, y: 1 });

    // A dormant Cinder dies to one strike (§3), drops its ember where it stood, and the player is
    // not standing there yet.
    expect(struck.world.embers).toEqual([{ at: { x: 2, y: 1 }, amount: CINDER.emberDrop }]);
    expect(struck.lantern.fuel).toBe(10 - FUEL_BURN_SHUTTERED);

    const collected = turn(struck, { x: 2, y: 1 });
    expect(collected.world.embers).toEqual([]);
    expect(collected.lantern.fuel).toBe(10 - 2 * FUEL_BURN_SHUTTERED + CINDER.emberDrop);
  });

  it('leaves an ember alone until it is actually stood on', () => {
    // The negative half. Collection "by walking over them" (§2) is a rule about a tile, not about
    // proximity, and a radius here would make the last strike of a fight refuel you for free. Run on
    // lit ground so that the *only* reason nothing is collected is the tile the player is on.
    const start = alreadyLit(['#####', '#@c.#', '#####'], { x: 2, y: 1 }, 10);
    const struck = turn(start, { x: 2, y: 1 });
    const waited = turn(struck);
    expect(waited.world.embers).toHaveLength(1);
    expect(waited.lantern.fuel).toBe(10 - 2 * FUEL_BURN_SHUTTERED);
  });

  it('takes a cache the lantern found by standing on it, and the cache stops existing', () => {
    const withCache = alreadyLit(CACHE_SCENE, CACHE_AT, 10);
    expect(withCache.world.floor.caches).toEqual([CACHE_AT]);

    const taken = turn(withCache, CACHE_AT);
    expect(taken.lantern.fuel).toBe(10 - FUEL_BURN_SHUTTERED + CACHE_FUEL);
    // The terrain changed, so nothing else in the game needs a second list of what has been taken.
    expect(tileAt(taken.world.floor.grid, 2, 1).kind).toBe('floor');
    expect(taken.world.floor.caches).toEqual([]);

    // And standing there again pays nothing — the assertion that fails if collection is keyed on
    // anything other than the tile itself.
    const again = turn(taken);
    expect(again.lantern.fuel).toBe(10 - 2 * FUEL_BURN_SHUTTERED + CACHE_FUEL);
  });

  it('pays for a cache the lantern lit two rooms ago, with the shutter shut now', () => {
    // ═══ §4's cache rule keys on EVER lit, not on CURRENTLY lit (#31, ruled 2026-08-01) ═══
    //
    // The distinguishing case, and the only one that separates the two readings: the tile is in
    // `revealed`, the lantern is **shut**, and no light falls anywhere during the turn that pays.
    // Under *currently lit* this collects nothing.
    //
    // > **It used to be run at 0 fuel, to make the assertion "the sentence rather than an
    // > approximation of it".** The sentence it quoted — §4's *"a kill or a cache re-opens the
    // > shutter the moment it lands"*, protecting the desperate state — is spent: fuel reaching 0
    // > ends the run (#149), so a lantern cannot sit at 0 waiting to be paid. The distinction the
    // > test pins is untouched, so it is re-pointed at a **low** fuel rather than deleted. What
    // > carries *ever lit* now is the autopilot argument, which never depended on the fuel rule:
    // > the shutter is free and §2 runs phase 5 on a free action, so *currently lit* would make
    // > `open`-`shut` **while standing on the tile** a pickup for 4 fuel and no *further* turns.
    // > (Underfoot only: flashing beside a drop pays nothing, it just makes the tile takeable.)
    const low = alreadyLit(CACHE_SCENE, CACHE_AT, 2);
    expect(canOpen(low.lantern)).toBe(true);

    const taken = turn(low, CACHE_AT);
    expect(taken.lantern.vision.shutter).toBe('shuttered'); // no light fell during the turn that paid
    expect(taken.lantern.fuel).toBe(2 - FUEL_BURN_SHUTTERED + CACHE_FUEL);
  });

  it('pays nothing for a cache the lantern never found, and leaves it where it is', () => {
    // The negative half of the rule, and the controlled comparison against the test above: same
    // scene, same command, same shuttered lantern, and the *only* difference is `vision.revealed`.
    const unlit = lit(CACHE_SCENE, 'shuttered', 10);
    expect(hasBeenLit(unlit.lantern.vision, CACHE_AT.x, CACHE_AT.y)).toBe(false);

    const walked = turn(unlit, CACHE_AT);
    expect(playerOf(walked.world).at).toEqual(CACHE_AT); // it is walked over, not blocked
    expect(walked.lantern.fuel).toBe(10 - FUEL_BURN_SHUTTERED);
    // Untouched, both in the grid and in the list: it is still there to be found later, which is
    // §4's "a `♦` you lit two rooms ago is still on the map when the lamp dies".
    expect(tileAt(walked.world.floor.grid, 2, 1).kind).toBe('cache');
    expect(walked.world.floor.caches).toEqual([CACHE_AT]);
    // Standing on it a second time changes nothing either — there is no counter being decremented.
    const again = turn(walked);
    expect(again.lantern.fuel).toBe(10 - 2 * FUEL_BURN_SHUTTERED);
    expect(again.world.floor.caches).toEqual([CACHE_AT]);
  });

  it('leaves an ember a kill dropped in the dark exactly where it fell', () => {
    // ═══ §4's *The dark can take nothing*, clause 1 (#144, ruled 2026-08-04; built by #149) ═══
    //
    // This test asserted the **opposite** for two milestones — "the tile has never been lit, and the
    // ember pays anyway" — because §4 excluded drops from the cache rule by name. That exclusion is
    // reversed: *ember the ruin hid, the lantern finds; ember you made, the lantern claims; neither
    // is yours in the dark.* Both branches of phase 5 now read one predicate on one plane.
    //
    // **The drop is left, not destroyed.** Nothing about the tile changes, so it is still there to be
    // lit and taken later — which is what makes the fuel left in the lantern a number of turns to
    // reach a destination rather than a countdown to nothing (§4).
    const start = lit(['#####', '#@c.#', '#####'], 'shuttered', 10);
    const struck = turn(start, { x: 2, y: 1 });
    expect(struck.world.embers).toEqual([{ at: { x: 2, y: 1 }, amount: CINDER.emberDrop }]);

    const stoodOn = turn(struck, { x: 2, y: 1 });
    expect(playerOf(stoodOn.world).at).toEqual({ x: 2, y: 1 }); // standing right on it...
    expect(hasBeenLit(stoodOn.lantern.vision, 2, 1)).toBe(false); // ...on ground never lit...
    expect(stoodOn.lantern.fuel).toBe(10 - 2 * FUEL_BURN_SHUTTERED); // ...and it paid nothing.
    expect(stoodOn.world.embers).toEqual([{ at: { x: 2, y: 1 }, amount: CINDER.emberDrop }]);

    // Standing there a second time changes nothing either: there is no counter being decremented,
    // exactly as there is none for a cache the lantern has not found.
    const again = turn(stoodOn);
    expect(again.lantern.fuel).toBe(10 - 3 * FUEL_BURN_SHUTTERED);
    expect(again.world.embers).toHaveLength(1);
  });

  it('pays for a drop on ground the lantern lit, with the shutter shut now', () => {
    // The other half of clause 1, and the one that says the predicate is **ever** lit rather than
    // *currently* lit — the same distinction the cache branch is keyed on, now shared. The room was
    // flashed before the kill; the shutter is shut for every turn below, so no light falls on the
    // tile during the turn that pays.
    //
    // The controlled comparison against the test above: same scene, same three commands, same
    // shuttered lantern, and the **only** difference is `vision.revealed`.
    const start = alreadyLit(['#####', '#@c.#', '#####'], { x: 2, y: 1 }, 10);
    expect(start.lantern.vision.shutter).toBe('shuttered');
    const struck = turn(start, { x: 2, y: 1 });
    expect(struck.world.embers).toEqual([{ at: { x: 2, y: 1 }, amount: CINDER.emberDrop }]);

    const collected = turn(struck, { x: 2, y: 1 });
    expect(hasBeenLit(collected.lantern.vision, 2, 1)).toBe(true);
    expect(collected.lantern.fuel).toBe(10 - 2 * FUEL_BURN_SHUTTERED + CINDER.emberDrop);
    expect(collected.world.embers).toEqual([]);
  });

  it('does not touch the map when the only thing underfoot is a drop it may not take', () => {
    // The identity shortcut, on the drop branch — the mirror of the cache one below it. An
    // implementation that filtered `world.embers` before consulting the predicate would rebuild the
    // actor world on every turn a dark crawler stands on its own kill, which no assertion above
    // would notice and which costs a fresh object per turn on the commonest path in dark play.
    const start = lit(['#####', '#@c.#', '#####'], 'shuttered', 10);
    const struck = turn(start, { x: 2, y: 1 });
    const standing: LanternWorld = {
      lantern: struck.lantern,
      world: withActor(struck.world, { ...playerOf(struck.world), at: { x: 2, y: 1 } }),
    };
    expect(standing.world.embers).toHaveLength(1); // it really is underfoot
    expect(collectFuelUnderfoot(standing)).toBe(standing);
  });

  it('does not touch the map on a turn that collects nothing', () => {
    const start = lit(['#####', '#@..#', '#####'], 'shuttered', 10);
    const after = collectFuelUnderfoot(start);
    expect(after).toBe(start);
  });

  it('does not touch the map when the only thing underfoot is a cache it may not take', () => {
    // The identity shortcut has to survive the new branch. Before the rule, "standing on a cache"
    // and "collecting a cache" were the same condition; now they are not, and an implementation
    // that rebuilt the world before checking `hasBeenLit` would allocate a fresh 165-tile grid on
    // every turn a dark crawler stands on a cache — invisible to every assertion above, and a real
    // divergence risk the day anything compares by reference.
    const onIt = alreadyLit(CACHE_SCENE, CACHE_AT, 10);
    const unlit: LanternWorld = {
      lantern: lit(CACHE_SCENE, 'shuttered', 10).lantern,
      world: withActor(onIt.world, { ...playerOf(onIt.world), at: CACHE_AT }),
    };
    expect(tileAt(unlit.world.floor.grid, 2, 1).kind).toBe('cache'); // it really is underfoot
    expect(collectFuelUnderfoot(unlit)).toBe(unlit);
  });

  it('drops the body before the player can stand where it fell', () => {
    // Deaths resolve before collection inside phase 5, so an ember dropped this turn is collectable
    // this turn. Unreachable today (a creature dies on its own tile) and asserted anyway, because
    // the reverse order fails silently rather than loudly.
    const built = scenario(['#####', '#@c.#', '#####']);
    const world = { ...built.world };
    const state: LanternWorld = {
      world,
      lantern: createLantern(world.floor.grid, 'shuttered', 10),
    };
    const struck = turn(state, { x: 2, y: 1 });
    const resolved = deathsAndCollectionPhase(struck);
    expect(resolved.world.actors.filter((actor) => actor.kind === 'creature')).toEqual([]);
  });
});

// --- the free action -----------------------------------------------------------------------------

describe('the shutter toggle is a free action', () => {
  const WITH_SLEEPER = ['#######', '#@...c#', '#######'];
  /** The only creature in that scene. Ids come from the row-major spawn list, so this is the first. */
  const SLEEPER_ID = creatureIdAt(0);

  it('costs no turn: the clock does not move and no creature acts', () => {
    // The mistake `turn.ts` and `actors.ts` both exist to prevent. Asserted on the schedule rather
    // than on a visible effect, because a free action that ran the actor phase would charge the
    // player *and* hand every creature on the floor a turn.
    const start = lit(WITH_SLEEPER, 'shuttered');
    const awake = awaken(start.world, SLEEPER_ID, { kind: 'move', to: { x: 4, y: 1 } });
    const before: LanternWorld = { world: awake, lantern: start.lantern };

    const after = flip(before);
    expect(after.world.schedule.now).toBe(before.world.schedule.now);
    expect(after.world.schedule.entries).toEqual(before.world.schedule.entries);
    // The creature still holds the action it declared: it has not resolved it.
    const creature = after.world.actors.find((actor) => actor.id === SLEEPER_ID);
    expect(creature?.kind === 'creature' && creature.mind.kind === 'awake' && creature.mind.intent).toEqual({
      kind: 'move',
      to: { x: 4, y: 1 },
    });
  });

  it('fails loudly if the actor phase is not skipped — the mistake this guards against', () => {
    // The wrong wiring, pinned so the failure mode is documented rather than merely avoided, exactly
    // as `turn.test.ts` pins it one layer down. Here it does not even manage to be a quiet bug:
    // `toggleShutterCommand` charges nobody, so declaring it as costing a turn leaves the player due
    // in phase 4, and `actOnce` refuses. That is the belt to `TurnCost`'s braces.
    const start = lit(WITH_SLEEPER, 'shuttered');
    expect(() => resolveTurn(start, lanternPhases('costsATurn', setShutterCommand('open')))).toThrow(
      /the player was due in phase 4/,
    );
  });

  it('still burns the fuel it costs to have the shutter where it now is', () => {
    // §4's arithmetic: "one lit turn ... reveals the entire room ... for 4 fuel ... light is roughly
    // three times cheaper in fuel" than feeling the room out at 1 a turn. A free flash would make
    // light infinitely cheaper than touch and delete that comparison.
    const start = lit(WITH_SLEEPER, 'shuttered', 50);
    const opened = flip(start);
    expect(opened.lantern.vision.shutter).toBe('open');
    expect(opened.lantern.fuel).toBe(50 - FUEL_BURN_LIT);

    const closed = flip(opened);
    expect(closed.lantern.vision.shutter).toBe('shuttered');
    expect(closed.lantern.fuel).toBe(50 - FUEL_BURN_LIT - FUEL_BURN_SHUTTERED);
  });

  it('does not advance dark adaptation, so the ramp cannot be strobed away', () => {
    // §4: ember-sense "recovers +1 per turn", and a free action is not a turn. If it ticked here,
    // `shutter -> toggle -> toggle` would buy sense radius without spending turns, and the four
    // blind turns §4 calls the tensest state in the game would be optional.
    const start = lit(WITH_SLEEPER, 'open', 50);
    const shut = flip(start);
    expect(shut.lantern.vision.senseRadius).toBe(ADAPTATION_FLOOR);

    const reopened = flip(shut);
    const shutAgain = flip(reopened);
    expect(shutAgain.lantern.vision.senseRadius).toBe(ADAPTATION_FLOOR);

    // ...whereas a real turn does advance it, which is what makes the assertion above mean something.
    expect(turn(shutAgain).lantern.vision.senseRadius).toBe(ADAPTATION_FLOOR + 1);
  });

  it('wakes the room immediately, without costing a turn to do it', () => {
    // The whole point of the toggle being expensive without being slow (§2: "free of tempo is not
    // free of consequence"). The Cinder is at (5, 1), Chebyshev 4 from the player at (1, 1).
    const start = lit(WITH_SLEEPER, 'shuttered');
    expect(creatureMinds(start.world)).toEqual(['dormant']);

    const flashed = flip(start);
    expect(creatureMinds(flashed.world)).toEqual(['awake']);
    expect(flashed.world.schedule.now).toBe(start.world.schedule.now);
    // Woken creatures join the queue for *next* turn, never for this one (§2 phase 3).
    expect(flashed.world.schedule.entries.some((entry) => entry.actorId === SLEEPER_ID)).toBe(true);
  });

  it('is refused at zero fuel, and refusing is still a legal free command', () => {
    // §4: at 0 fuel "the shutter can no longer be opened". The player still has the control under
    // their thumb; pressing it is ordinary, and the lantern simply has nothing to give.
    const dry = lit(WITH_SLEEPER, 'shuttered', 0);
    const after = flip(dry);
    expect(after.lantern.vision.shutter).toBe('shuttered');
    expect(after.lantern.fuel).toBe(0);
    expect(after.world.schedule.now).toBe(dry.world.schedule.now);
    expect(creatureMinds(after.world)).toEqual(['dormant']);
  });
});

// --- the whole turn ------------------------------------------------------------------------------

describe('a turn that costs a turn', () => {
  it('advances the clock by one action, burns one turn of fuel, and adapts', () => {
    const start = lit(['#######', '#@....#', '#######'], 'shuttered', 30);
    const shut = { lantern: { ...start.lantern, vision: { ...start.lantern.vision, senseRadius: 2 } }, world: start.world };
    const after = turn(shut);

    expect(after.world.schedule.now).toBe(start.world.schedule.now + ACTION_COST);
    expect(after.lantern.fuel).toBe(30 - FUEL_BURN_SHUTTERED);
    expect(after.lantern.vision.senseRadius).toBe(3);
  });

  it('burns fuel before lighting recomputes, so the turn you run dry is a dark turn', () => {
    // GDD §2's phase order, stated by `turn.ts`'s header as the reason it is what it is. With
    // exactly one lit turn of fuel left, the flame dies in phase 2 and phase 3 therefore lights
    // nothing — the sleeper four tiles away stays asleep.
    const empty = lit(['#######', '#@...c#', '#######'], 'open', FUEL_BURN_LIT);
    const after = turn(empty);
    expect(after.lantern.fuel).toBe(0);
    expect(after.lantern.vision.shutter).toBe('shuttered');
    expect(creatureMinds(after.world)).toEqual(['dormant']);

    // The contrast, without which the assertion above passes for a lighting phase that never wakes
    // anything: one more turn's worth of fuel and the same flash wakes the same creature.
    const spare = lit(['#######', '#@...c#', '#######'], 'open', FUEL_BURN_LIT * 2);
    expect(creatureMinds(turn(spare).world)).toEqual(['awake']);
  });

  it('is a pure function of the state and the commands', () => {
    const play = (): LanternWorld => {
      let state = createLanternWorld(generateFloor(createRng('replay'), 3).value, 'shuttered');
      for (let step = 0; step < 20; step += 1) {
        state = step % 7 === 0 ? flip(state) : turn(state);
      }
      return state;
    };
    const divergence = findFieldDivergence(play(), play());
    if (divergence) throw new Error(`diverged: ${formatFieldDivergence(divergence)}`);
  });

  it('is plain JSON-shaped data, all the way down', () => {
    // `game/core/divergence.ts` throws on a Map, Set or class instance, and this whole structure is
    // headed for `GameState` (#18) — including the `TileSet` inside `Vision`.
    let state = createLanternWorld(generateFloor(createRng('json'), 2).value, 'open');
    for (let step = 0; step < 12; step += 1) state = turn(state);
    const divergence = findFieldDivergence(state, JSON.parse(JSON.stringify(state)) as LanternWorld);
    if (divergence) throw new Error(`not JSON round-trippable: ${formatFieldDivergence(divergence)}`);
  });

  it('does not mutate the state it is given', () => {
    const floor = generateFloor(createRng('frozen'), 2).value;
    const start = deepFreeze(createLanternWorld(floor, 'open'));
    expect(() => turn(start)).not.toThrow();
    expect(() => flip(start)).not.toThrow();
    expect(start.lantern.fuel).toBe(80);
    expect(start.world.schedule.now).toBe(0);
  });

  it('starts a floor asleep, unseen, and full', () => {
    const floor = generateFloor(createRng('arrival'), 1).value;
    const start = createLanternWorld(floor, 'shuttered');
    expect(start.lantern.fuel).toBe(80);
    // §4: full adaptation is earned, so a fresh lantern's eyes reach one tile, not five.
    expect(start.lantern.vision.senseRadius).toBe(ADAPTATION_FLOOR);
    expect(countTiles(start.lantern.vision.remembered.flags)).toBe(0);
    expect(start.world.actors.filter(isAwake)).toEqual([]);
    expect(createActorWorld(floor).actors).toHaveLength(start.world.actors.length);
  });
});

type Mutable = Record<string, unknown>;

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Mutable).sort()) deepFreeze((value as Mutable)[key]);
  return value;
}

describe('a terminal state stops the turn where it happens (§13)', () => {
  it('does not run phases 5 and 6 on the turn the player dies', () => {
    // §13: "If the player dies in phase 4, the actor sweep stops there and **phases 5 and 6 do not
    // run** — the final state is the frame of the killing blow."
    //
    // Arranged so that both skipped phases have something visible to do. The player kills the west
    // Cinder in phase 1, so phase 5 has a body to clear and an ember to drop; the ramp is mid-climb,
    // so phase 6 has a radius to raise. The east Cinder's declared attack finishes the player in
    // phase 4, and neither happens.
    const built = scenario(['#####', '#c@c#', '#####']);
    let world = awaken(built.world, creatureIdAt(1), { kind: 'attack', at: { x: 2, y: 1 } });
    world = allDueNow(withActor(world, { ...playerOf(world), hp: CINDER.attack, attack: 99 }));

    const before: LanternWorld = {
      world,
      lantern: {
        fuel: 20,
        vision: { ...createLantern(world.floor.grid, 'shuttered', 20).vision, senseRadius: 2 },
      },
    };
    const after = turn(before, { x: 1, y: 1 });

    expect(playerOf(after.world).hp).toBe(0);
    // Phase 5 did not run: the body the player felled in phase 1 is still in the world at 0 HP and
    // its ember has not dropped.
    const felled = after.world.actors.find((actor) => actor.id === creatureIdAt(0));
    expect(felled?.hp).toBe(0);
    expect(after.world.embers).toEqual([]);
    // Phase 6 did not run: the adaptation ramp did not tick on the turn the run ended.
    expect(after.lantern.vision.senseRadius).toBe(2);
    // Phase 2 *did* run — the turn was resolved up to the blow, not abandoned wholesale.
    expect(after.lantern.fuel).toBe(20 - FUEL_BURN_SHUTTERED);
  });

  it('runs both phases when the player survives, which is what makes the skip mean something', () => {
    // The contrast, differing in one number: one more point of HP and the same turn clears the
    // body, drops and does not collect the ember, and ticks the ramp.
    const built = scenario(['#####', '#c@c#', '#####']);
    let world = awaken(built.world, creatureIdAt(1), { kind: 'attack', at: { x: 2, y: 1 } });
    world = allDueNow(withActor(world, { ...playerOf(world), hp: CINDER.attack + 1, attack: 99 }));

    const before: LanternWorld = {
      world,
      lantern: {
        fuel: 20,
        vision: { ...createLantern(world.floor.grid, 'shuttered', 20).vision, senseRadius: 2 },
      },
    };
    const after = turn(before, { x: 1, y: 1 });

    expect(playerOf(after.world).hp).toBe(1);
    expect(after.world.actors.find((actor) => actor.id === creatureIdAt(0))).toBeUndefined();
    expect(after.world.embers).toEqual([{ at: { x: 1, y: 1 }, amount: CINDER.emberDrop }]);
    expect(after.lantern.vision.senseRadius).toBe(3);
  });
});
