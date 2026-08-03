import { describe, expect, it } from 'vitest';
import { playTurn, type PlayerAction } from '@/tests/unit/support/scenario';
import { CINDER } from '../content';
import { findFieldDivergence, formatFieldDivergence } from '../core';
import {
  findWorldProblems,
  createActorWorld,
  isAlive,
  isAdjacent,
  playerOf,
  stepToward,
  PLAYER_ID,
  type ActorWorld,
} from '../entities';
import { generateFloor, manhattanDistance, type Position } from '../map';
import { createRng, int, type Rng } from '../rng';
import type { LightQuery } from './light';
import { ACTION_COST } from './schedule';

/**
 * Whole floors, played out. The corpus test for everything the single-situation suites assert one
 * case of at a time.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * AN ALL-NEGATIVE SUITE CANNOT CATCH A CINDER THAT STOPPED THINKING
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The invariants below — HP never negative, nobody inside a wall, damage deterministic, the
 * schedule consistent — are all of the form "nothing is wrong with this floor", and **every one of
 * them holds for a Cinder that never moves, never wakes, and never attacks.** This repo has shipped
 * five checks that enforced nothing; the most recent was a floor-soundness suite that could not
 * notice a generator which had stopped generating.
 *
 * So the run collects evidence as it goes, and asserts at the end that the interesting things
 * actually *happened*: creatures woke, moved, closed distance, landed hits and died. Those counters
 * are the part of this file that fails when the behaviour quietly degenerates.
 *
 * **One counter is asserted at zero, and it is the sharpest thing in this file (#123):
 * `wentDormant`.** §4: a woken Cinder is awake for the rest of the floor. Over 24 generated floors
 * and 90 turns each, with the shutter cycling open and shut the whole way, not one awake creature
 * may go back to sleep. It is a zero with a positive control beside it — `woke` is asserted well
 * above zero on the same corpus — so it cannot pass by nothing ever waking.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The lighting query here is a **stand-in** — "lit within 4 steps of the player while the shutter is
 * open" — written in the test rather than in `game/`: the real one is `light.ts`'s, its metric is
 * still open (#25), and a placeholder living in the simulation is a lie that outlives the session
 * that wrote it. Nothing asserted here depends on the shape of the lit area, only on light existing
 * and going away.
 */

const SEEDS = 24;
const TURNS = 90;
/**
 * Turns of open shutter, then closed.
 *
 * The 18 shuttered turns used to be there to let the 8-turn re-dormancy clock run out twice over.
 * #123 deleted the clock, and the cycle is kept exactly as it was: it is now what makes
 * `wentDormant === 0` a claim about long stretches of darkness rather than about a floor that was
 * lit the whole time.
 */
const SHUTTER_PERIOD = 24;
const SHUTTER_OPEN_FOR = 6;

/** Placeholder lighting. See the header: not a model, just something for the seam to be handed. */
function lightAround(player: Position, open: boolean): LightQuery {
  return {
    isPlayerLightVisibleFrom: (at) => open && manhattanDistance(at, player) <= 4,
  };
}

type Scripted = { readonly action: PlayerAction; readonly rng: Rng };

/**
 * A deterministic pseudo-player: attacks what it can reach, hunts what it cannot, and works the
 * shutter on a fixed cycle. Not an AI — a way of generating varied, *legal* command sequences so
 * that the invariants are asserted against real play rather than a hand-picked situation.
 */
function scriptPlayer(world: ActorWorld, rng: Rng, turn: number): Scripted {
  if (turn % SHUTTER_PERIOD === 0) return { action: { kind: 'free' }, rng };

  const player = playerOf(world);
  const creatures = world.actors.filter((actor) => actor.kind === 'creature' && isAlive(actor));

  const adjacent = creatures.find((creature) => isAdjacent(player.at, creature.at));
  const roll = int(rng, 0, 3);
  if (adjacent !== undefined && roll.value > 0) {
    return { action: { kind: 'bump', to: adjacent.at }, rng: roll.rng };
  }

  // Hunt the lowest-id living creature — a fixed rule, so the script is a function of the seed and
  // the state and of nothing else.
  const quarry = creatures[0];
  if (quarry !== undefined && roll.value > 0) {
    const step = stepToward(world, PLAYER_ID, player.at, quarry.at);
    if (step !== null) return { action: { kind: 'bump', to: step }, rng: roll.rng };
  }

  const steps: Position[] = [
    { x: player.at.x, y: player.at.y - 1 },
    { x: player.at.x + 1, y: player.at.y },
    { x: player.at.x, y: player.at.y + 1 },
    { x: player.at.x - 1, y: player.at.y },
  ];
  const which = int(roll.rng, 0, steps.length - 1);
  return { action: { kind: 'bump', to: steps[which.value] }, rng: which.rng };
}

/** Attack tiles marked by creatures that will actually resolve this turn. */
function markedTiles(world: ActorWorld): Position[] {
  const due = world.schedule.entries
    .filter((entry) => entry.nextActAt <= world.schedule.now)
    .map((entry) => entry.actorId);

  return world.actors.flatMap((actor) => {
    if (actor.kind !== 'creature' || actor.mind.kind !== 'awake') return [];
    if (!due.includes(actor.id)) return [];
    return actor.mind.intent.kind === 'attack' ? [actor.mind.intent.at] : [];
  });
}

function hpById(world: ActorWorld): Map<number, number> {
  return new Map(world.actors.map((actor) => [actor.id, actor.hp]));
}

type Tally = {
  woke: number;
  moved: number;
  hitThePlayer: number;
  missedThePlayer: number;
  killed: number;
  wentDormant: number;
  closedDistance: number;
};

describe('playing whole floors', () => {
  const tally: Tally = {
    woke: 0,
    moved: 0,
    hitThePlayer: 0,
    missedThePlayer: 0,
    killed: 0,
    wentDormant: 0,
    closedDistance: 0,
  };

  it('holds every invariant, turn after turn, on every floor', () => {
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const floorNumber = (seed % 8) + 1;
      const floor = generateFloor(createRng(`play-${seed}`), floorNumber).value;
      let world = createActorWorld(floor);
      let rng = createRng(`script-${seed}`);

      expect(findWorldProblems(world)).toEqual([]);

      for (let turn = 0; turn < TURNS; turn += 1) {
        const open = turn % SHUTTER_PERIOD < SHUTTER_OPEN_FOR;
        const before = world;
        const light = lightAround(playerOf(world).at, open);
        const marked = markedTiles(world);
        const beforeHp = hpById(world);
        const beforeAwake = world.actors.filter((a) => a.kind === 'creature' && a.mind.kind === 'awake').length;
        const beforeDistances = new Map(
          world.actors
            .filter((actor) => actor.kind === 'creature')
            .map((actor) => [actor.id, manhattanDistance(actor.at, playerOf(world).at)] as const),
        );

        const scripted = scriptPlayer(world, rng, turn);
        rng = scripted.rng;
        world = playTurn(world, scripted.action, light);

        // --- the invariants ---------------------------------------------------------------------
        expect(findWorldProblems(world)).toEqual([]);

        // §3: no healing within a floor. Nothing in a turn may raise anyone's HP.
        for (const actor of world.actors) {
          const was = beforeHp.get(actor.id);
          if (was !== undefined) expect(actor.hp).toBeLessThanOrEqual(was);
          expect(actor.hp).toBeGreaterThanOrEqual(0);
        }

        // §2: a free action costs no turn; anything else costs exactly one — **unless the player
        // died on it**, in which case §13 stops the turn where it happens and the clock is left
        // standing at the frame of the killing blow. Three cases, and each one is a rule.
        const died = !isAlive(playerOf(world));
        const expectedNow =
          scripted.action.kind === 'free' || died
            ? before.schedule.now
            : before.schedule.now + ACTION_COST;
        expect(world.schedule.now).toBe(expectedNow);

        // GDD §2's commit-one-turn-ahead rule, as a property of the whole run: the player can only
        // be hit on a tile that was already marked when the turn began. A creature that recomputed
        // its attack against the player's new position would land a hit on an unmarked tile here.
        const damage = (beforeHp.get(PLAYER_ID) ?? 0) - playerOf(world).hp;
        if (damage > 0) {
          expect(marked).toContainEqual(playerOf(world).at);
          expect(damage % CINDER.attack).toBe(0);
          tally.hitThePlayer += 1;
        } else if (marked.length > 0 && scripted.action.kind !== 'free') {
          tally.missedThePlayer += 1;
        }

        // Embers only ever appear where a creature just died.
        const newDrops = world.embers.slice(before.embers.length);
        for (const drop of newDrops) {
          const corpse = before.actors.find(
            (actor) => actor.id !== PLAYER_ID && actor.at.x === drop.at.x && actor.at.y === drop.at.y,
          );
          expect(corpse).toBeDefined();
          expect(drop.amount).toBe(CINDER.emberDrop);
        }
        tally.killed += newDrops.length;

        // --- the evidence -----------------------------------------------------------------------
        const afterAwake = world.actors.filter(
          (a) => a.kind === 'creature' && a.mind.kind === 'awake',
        ).length;
        if (afterAwake > beforeAwake) tally.woke += afterAwake - beforeAwake;
        for (const actor of world.actors) {
          if (actor.kind !== 'creature') continue;
          const wasAwake = before.actors.find((a) => a.id === actor.id);
          if (
            wasAwake?.kind === 'creature' &&
            wasAwake.mind.kind === 'awake' &&
            actor.mind.kind === 'dormant'
          ) {
            tally.wentDormant += 1;
          }
          if (wasAwake !== undefined && (wasAwake.at.x !== actor.at.x || wasAwake.at.y !== actor.at.y)) {
            tally.moved += 1;
            const was = beforeDistances.get(actor.id);
            if (was !== undefined && manhattanDistance(actor.at, playerOf(before).at) < was) {
              tally.closedDistance += 1;
            }
          }
        }

        if (!isAlive(playerOf(world))) break;
      }
    }
  });

  it('saw the behaviour it is meant to be testing actually happen', () => {
    // Printed so the margin above each threshold is visible rather than guessed at — a counter
    // sitting one above its floor is a test that will start flaking on an unrelated tuning change.
    console.log(`behaviour tally: ${JSON.stringify(tally)}`);
    // The positive half. Each of these fails on a Cinder that has quietly stopped doing its job,
    // and none of the invariants above would notice any of them.
    // Thresholds sit at roughly half of what the corpus produces today, so an ordinary tuning
    // change does not trip them but a behaviour that has stopped happening does.
    expect(tally.woke).toBeGreaterThan(30); // light wakes the room (§4)
    expect(tally.moved).toBeGreaterThan(80); // awake creatures actually move (§6)
    expect(tally.closedDistance).toBeGreaterThan(60); // ...and mostly toward the player
    expect(tally.hitThePlayer).toBeGreaterThan(25); // committed attacks land (§3)
    expect(tally.missedThePlayer).toBeGreaterThan(25); // ...and stepping aside works (§2)
    expect(tally.killed).toBeGreaterThan(50); // the player can kill things (§4's fuel economy)
    // ═══ #123, at the corpus tier: a woken Cinder never returns to dormant ═══
    //
    // This counter used to be asserted **above 2**. It is now asserted at exactly 0, over 2160
    // scripted turns in which the shutter spends three quarters of its cycle shut and the script
    // regularly walks away from what it woke.
    //
    // **Measured, not guessed: with the clock restored this reads 4** (checked out at `c422315` and
    // run — the whole tally was `woke 70, moved 168, hitThePlayer 70, missedThePlayer 72, killed
    // 118, wentDormant 4, closedDistance 141`). An earlier draft of this comment claimed "in the
    // twenties", which was a guess dressed as a measurement in a file whose neighbour insists on
    // printing margins rather than guessing them. 4 still kills the mutant, and the margin being
    // *thin* is the useful thing to know: this corpus kills most creatures long before eight silent
    // turns can elapse, which is why the pre-#123 assertion here was only `> 2`.
    //
    // Not vacuous: `woke` above is asserted at more than 30 on the same runs, so there is always
    // something awake that *could* have gone back to sleep.
    expect(tally.wentDormant).toBe(0);
  });
});

describe('the same commands always produce the same floor', () => {
  /** One run, described entirely by its seed. */
  function play(seed: string, turns: number): ActorWorld {
    const floor = generateFloor(createRng(seed), 3).value;
    let world = createActorWorld(floor);
    let rng = createRng(`${seed}-script`);

    for (let turn = 0; turn < turns; turn += 1) {
      // §13: the run is over the moment the player's HP reaches 0, and a dead player is out of the
      // schedule — so `chargeActor` throws rather than handing a corpse a turn. The loop stopped
      // here implicitly before #123 because the corpus rarely got the player killed; with nothing
      // ever going back to sleep it does, and the stop is now stated. It is still deterministic:
      // where a run stops is a function of the seed like everything else here.
      if (!isAlive(playerOf(world))) break;
      const open = turn % SHUTTER_PERIOD < SHUTTER_OPEN_FOR;
      const scripted = scriptPlayer(world, rng, turn);
      rng = scripted.rng;
      world = playTurn(world, scripted.action, lightAround(playerOf(world).at, open));
    }
    return world;
  }

  it('replays byte-identically', () => {
    // The entity layer's contribution to the determinism tripwire. Everything here is a pure
    // function of the floor and the command sequence — this layer never draws from the RNG at all,
    // so a divergence means an ordering bug rather than a stream-position bug.
    for (let seed = 0; seed < 6; seed += 1) {
      const divergence = findFieldDivergence(play(`replay-${seed}`, 60), play(`replay-${seed}`, 60));
      if (divergence) throw new Error(`run ${seed} diverged: ${formatFieldDivergence(divergence)}`);
    }
  });

  it('is plain JSON-shaped data, all the way down', () => {
    // `game/core/divergence.ts` throws on a `Map`, a `Set`, or a class instance, and a `GameState`
    // holding one silently compares as equal to a different one. This world is destined for
    // `GameState` (#18), so the round trip has to hold now rather than be discovered later.
    const world = play('json', 40);
    const divergence = findFieldDivergence(world, JSON.parse(JSON.stringify(world)) as ActorWorld);
    if (divergence) throw new Error(`not JSON round-trippable: ${formatFieldDivergence(divergence)}`);
  });

  it('does not mutate the world it is given', () => {
    const floor = generateFloor(createRng('frozen'), 2).value;
    const world = deepFreeze(createActorWorld(floor));
    const light = lightAround(playerOf(world).at, true);

    expect(() => playTurn(world, { kind: 'wait' }, light)).not.toThrow();
    expect(world.schedule.now).toBe(0);
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
