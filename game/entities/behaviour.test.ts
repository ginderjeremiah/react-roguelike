import { describe, expect, it } from 'vitest';
import { awaken, FLOODLIT, litTiles, scenario, SHUTTERED } from '@/tests/unit/support/scenario';
import { hasActor } from '../systems/schedule';
import { WAIT, type Intent } from './actor';
import { commitNextIntent, nextMind, TURNS_TO_REDORMANCY, wakeCreature } from './behaviour';
import { creatureById, playerOf, withActor, type ActorWorld } from './world';

/**
 * GDD §6's five cases, and the two positive properties an all-negative suite would miss: that the
 * declaration **varies with the situation**, and that a creature repeatedly declaring and acting
 * **actually closes the distance**. A Cinder that declared `wait` forever would pass every
 * "nothing is wrong" assertion here.
 */

/** The mind a creature would declare in this world, as a plain object for comparison. */
function declare(world: ActorWorld, id: number, lit = SHUTTERED) {
  return nextMind(world, creatureById(world, id), lit);
}

describe('an awake Cinder with contact', () => {
  it('declares an attack on the tile the player is standing on when adjacent', () => {
    const { world, ids, at } = scenario(['#####', '#@c.#', '#####']);
    const mind = declare(awaken(world, ids[0], WAIT), ids[0]);

    expect(mind).toEqual({
      kind: 'awake',
      intent: { kind: 'attack', at: at('@') },
      awareness: { kind: 'lastSeen', at: at('@') },
      turnsSinceContact: 0,
    });
  });

  it('has contact when adjacent even with the shutter closed', () => {
    // §4: "an awake creature knows the player's tile while the shutter is open **or** while
    // adjacent." Without the adjacency half you could stand next to a woken Cinder in the dark and
    // be ignored, which would make shuttering strictly dominant inside every fight.
    const { world, ids, at } = scenario(['#####', '#@c.#', '#####']);
    expect(declare(awaken(world, ids[0], WAIT), ids[0], SHUTTERED)).toMatchObject({
      intent: { kind: 'attack', at: at('@') },
      turnsSinceContact: 0,
    });
  });

  it('declares a step toward the player when the light reaches it', () => {
    // §6: "the Cinder is drawn to light". The step is toward the player, and the tile is
    // remembered, which is what makes shuttering later a real move.
    const { world, ids, at } = scenario(['#######', '#@...c#', '#######']);
    const mind = declare(awaken(world, ids[0], WAIT), ids[0], FLOODLIT);

    expect(mind).toEqual({
      kind: 'awake',
      intent: { kind: 'move', to: { x: 4, y: 1 } },
      awareness: { kind: 'lastSeen', at: at('@') },
      turnsSinceContact: 0,
    });
  });

  it('asks the light query about its own tile, not the player s', () => {
    // The seam's contract: "is the player's light visible *from here*". A creature outside the lit
    // area has no contact even though the player is standing in the middle of it.
    const { world, ids, at } = scenario(['#######', '#@...c#', '#######']);
    const litButNotAtTheCreature = litTiles([at('@'), { x: 2, y: 1 }, { x: 3, y: 1 }]);
    expect(declare(awaken(world, ids[0], WAIT), ids[0], litButNotAtTheCreature)).toMatchObject({
      turnsSinceContact: 1,
    });
    expect(declare(awaken(world, ids[0], WAIT), ids[0], litTiles([at('c')]))).toMatchObject({
      turnsSinceContact: 0,
    });
  });

  it('declares a wait when every step toward the player is blocked', () => {
    const { world, ids } = scenario(['#####', '#@#c#', '#####']);
    expect(declare(awaken(world, ids[0], WAIT), ids[0], FLOODLIT)).toMatchObject({ intent: WAIT });
  });
});

describe('an awake Cinder that has lost the player', () => {
  const { world, ids, at } = scenario([
    '#######',
    '#@...c#',
    '#######',
  ]);
  const remembering = awaken(world, ids[0], WAIT, { kind: 'lastSeen', at: at('@') });

  it('paths to where it last saw the light', () => {
    // §6: "Shuttered and non-adjacent, it paths to where it last saw your light."
    expect(declare(remembering, ids[0], SHUTTERED)).toEqual({
      kind: 'awake',
      intent: { kind: 'move', to: { x: 4, y: 1 } },
      awareness: { kind: 'lastSeen', at: at('@') },
      turnsSinceContact: 1,
    });
  });

  it('holds position once it arrives and finds nothing', () => {
    // "...then searches." The minimal honest reading: it has arrived, there is nothing here, and it
    // waits out the clock. Flagged in `behaviour.ts` as the one under-specified case in §6.
    const arrived = withActor(remembering, {
      ...creatureById(remembering, ids[0]),
      // Standing on the remembered tile, and far enough from the player that adjacency is not
      // quietly supplying contact.
      at: { x: 3, y: 1 },
      mind: {
        kind: 'awake',
        intent: WAIT,
        awareness: { kind: 'lastSeen', at: { x: 3, y: 1 } },
        turnsSinceContact: 3,
      },
    });
    expect(declare(arrived, ids[0], SHUTTERED)).toMatchObject({ intent: WAIT });
  });

  it('waits when it never had contact at all', () => {
    const blind = awaken(world, ids[0], WAIT, { kind: 'none' });
    expect(declare(blind, ids[0], SHUTTERED)).toMatchObject({
      intent: WAIT,
      awareness: { kind: 'none' },
    });
  });
});

describe('returning to dormant', () => {
  const { world, ids, at } = scenario(['#######', '#@...c#', '#######']);

  it('goes dormant on the eighth turn without contact, and not before', () => {
    // §4/§6: "after 8 turns with no light and no adjacency it returns to dormant." Both halves
    // asserted, because an off-by-one here is invisible in play and changes how long a botched
    // flash costs you.
    const seven = awaken(world, ids[0], WAIT, { kind: 'lastSeen', at: at('@') }, TURNS_TO_REDORMANCY - 2);
    expect(declare(seven, ids[0], SHUTTERED)).toMatchObject({
      kind: 'awake',
      turnsSinceContact: TURNS_TO_REDORMANCY - 1,
    });

    const eight = awaken(world, ids[0], WAIT, { kind: 'lastSeen', at: at('@') }, TURNS_TO_REDORMANCY - 1);
    expect(declare(eight, ids[0], SHUTTERED)).toEqual({ kind: 'dormant' });
  });

  it('counts eight turns from a standing start, one declaration at a time', () => {
    // The counter driven the way the game drives it, rather than injected. Catches a reset that
    // happens on every declaration, which would make re-dormancy unreachable — and unreachable
    // re-dormancy means darkness stops being restorative (§4), which no negative test would notice.
    let current = awaken(world, ids[0], WAIT, { kind: 'lastSeen', at: at('@') });
    for (let turn = 1; turn < TURNS_TO_REDORMANCY; turn += 1) {
      current = commitNextIntent(current, ids[0], SHUTTERED);
      expect(creatureById(current, ids[0]).mind).toMatchObject({ kind: 'awake' });
    }
    current = commitNextIntent(current, ids[0], SHUTTERED);
    expect(creatureById(current, ids[0]).mind).toEqual({ kind: 'dormant' });
  });

  it('leaves the schedule when it falls asleep, and rejoins it when woken', () => {
    // The scheduling invariant, at the transition where it is easiest to get wrong. A dormant
    // creature left in the queue takes turns in its sleep.
    const asleep = awaken(world, ids[0], WAIT, { kind: 'none' }, TURNS_TO_REDORMANCY - 1);
    expect(hasActor(asleep.schedule, ids[0])).toBe(true);

    const dormant = commitNextIntent(asleep, ids[0], SHUTTERED);
    expect(creatureById(dormant, ids[0]).mind).toEqual({ kind: 'dormant' });
    expect(hasActor(dormant.schedule, ids[0])).toBe(false);

    const rewoken = wakeCreature(dormant, creatureById(dormant, ids[0]), FLOODLIT);
    expect(hasActor(rewoken.schedule, ids[0])).toBe(true);
  });

  it('loses contact with a dead player and goes to sleep over it', () => {
    // Found by mutation testing: removing the dead-player check in `hasContact` left every test
    // green. It matters because the run does not end inside this layer — #18 decides what a dead
    // player means — and until it does, an adjacent creature would otherwise stay permanently awake
    // swinging at a corpse, which is a state the re-dormancy clock can never leave.
    const { world: adjacent, ids: nearby } = scenario(['#####', '#@c.#', '#####']);
    const fallen = withActor(awaken(adjacent, nearby[0], WAIT), {
      ...playerOf(adjacent),
      hp: 0,
    });

    let current = fallen;
    for (let turn = 1; turn < TURNS_TO_REDORMANCY; turn += 1) {
      current = commitNextIntent(current, nearby[0], SHUTTERED);
      expect(creatureById(current, nearby[0]).mind).toMatchObject({
        kind: 'awake',
        turnsSinceContact: turn,
      });
    }
    expect(creatureById(commitNextIntent(current, nearby[0], SHUTTERED), nearby[0]).mind).toEqual({
      kind: 'dormant',
    });
  });

  it('resets the count on contact, however late', () => {
    const nearlyAsleep = awaken(world, ids[0], WAIT, { kind: 'none' }, TURNS_TO_REDORMANCY - 2);
    expect(declare(nearlyAsleep, ids[0], FLOODLIT)).toMatchObject({ turnsSinceContact: 0 });
  });
});

describe('waking', () => {
  const { world, ids, at } = scenario(['#######', '#@...c#', '#######']);

  it('declares immediately and joins the schedule for next turn, not this one', () => {
    // GDD §2 phase 3, and the reason it is expressed through the schedule: a creature woken by the
    // light you just opened "declares this turn and acts next turn". Joining at `now` instead would
    // let it act in phase 4 of the very turn it woke — the reactive behaviour §2 forbids.
    const woken = wakeCreature(world, creatureById(world, ids[0]), FLOODLIT);
    const creature = creatureById(woken, ids[0]);

    expect(creature.mind).toMatchObject({ kind: 'awake', turnsSinceContact: 0 });
    expect(hasActor(woken.schedule, ids[0])).toBe(true);
    expect(woken.schedule.entries.find((entry) => entry.actorId === ids[0])?.nextActAt).toBe(
      world.schedule.now + 100,
    );
  });

  it('does not re-declare for a creature that is already awake', () => {
    // Otherwise standing in the light next to a woken Cinder would rewrite its plan every turn,
    // which is commit-one-turn-ahead deleted by a side door.
    const committed = awaken(world, ids[0], { kind: 'move', to: { x: 5, y: 1 } });
    const again = wakeCreature(committed, creatureById(committed, ids[0]), FLOODLIT);
    expect(creatureById(again, ids[0]).mind).toEqual(creatureById(committed, ids[0]).mind);
  });

  it('does nothing to a dead creature', () => {
    const dead = withActor(world, { ...creatureById(world, ids[0]), hp: 0 });
    expect(wakeCreature(dead, creatureById(dead, ids[0]), FLOODLIT)).toBe(dead);
  });

  it('remembers the player s tile at the moment it woke', () => {
    expect(declare(world, ids[0], FLOODLIT)).toMatchObject({
      awareness: { kind: 'lastSeen', at: at('@') },
    });
  });
});

describe('the declaration is a function of the situation, not a constant', () => {
  it('declares a different action for each side the player approaches from', () => {
    // The positive assertion. Every negative property in this file holds for a Cinder that always
    // declares `wait`; this one does not. Four player positions, four distinct declared intents,
    // each one pointing at the player.
    const map = [
      '#####',
      '#.@.#',
      '#.c.#',
      '#...#',
      '#####',
    ];
    const positions = [
      { x: 2, y: 1 },
      { x: 3, y: 2 },
      { x: 2, y: 3 },
      { x: 1, y: 2 },
    ];

    const intents: Intent[] = positions.map((position) => {
      const built = scenario(map);
      const world = awaken(built.world, built.ids[0], WAIT);
      const moved = withActor(world, { ...playerOf(world), at: position });
      const mind = nextMind(moved, creatureById(moved, built.ids[0]), FLOODLIT);
      if (mind.kind !== 'awake') throw new Error('expected the creature to stay awake');
      return mind.intent;
    });

    // Adjacent on all four sides: four attacks, each on the tile the player actually stands on.
    expect(intents).toEqual(positions.map((at) => ({ kind: 'attack', at })));
    expect(new Set(intents.map((intent) => JSON.stringify(intent))).size).toBe(4);
  });

  it('closes the distance turn after turn until it is adjacent, then attacks', () => {
    // "Drawn to light" as a claim about behaviour over time rather than about one declaration.
    // A creature that declares a plausible-looking step and never actually arrives passes every
    // single-turn test above.
    const { world, ids, at } = scenario([
      '#########',
      '#@......#',
      '#.#####.#',
      '#......c#',
      '#########',
    ]);
    let current: ActorWorld = wakeCreature(world, creatureById(world, ids[0]), FLOODLIT);
    const distances: number[] = [];

    for (let turn = 0; turn < 12; turn += 1) {
      const creature = creatureById(current, ids[0]);
      if (creature.mind.kind !== 'awake') throw new Error('the creature fell asleep');
      const intent = creature.mind.intent;
      if (intent.kind === 'attack') {
        expect(intent.at).toEqual(at('@'));
        break;
      }
      if (intent.kind !== 'move') throw new Error(`expected a move, got ${intent.kind}`);
      current = withActor(current, { ...creature, at: intent.to });
      distances.push(Math.abs(intent.to.x - at('@').x) + Math.abs(intent.to.y - at('@').y));
      current = commitNextIntent(current, ids[0], FLOODLIT);
    }

    // It got closer every single turn, and it got all the way there.
    expect(distances.length).toBeGreaterThan(3);
    for (let i = 1; i < distances.length; i += 1) {
      expect(distances[i]).toBeLessThan(distances[i - 1]);
    }
    expect(distances[distances.length - 1]).toBe(1);
  });
});
