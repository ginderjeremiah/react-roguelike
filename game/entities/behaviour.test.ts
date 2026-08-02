import { describe, expect, it } from 'vitest';
import {
  awaken,
  FLOODLIT,
  litTiles,
  playTurn,
  scenario,
  SHUTTERED,
} from '@/tests/unit/support/scenario';
import { hasActor } from '../systems/schedule';
import { isDormant, WAIT, type Intent } from './actor';
import { commitNextIntent, nextMind, TURNS_TO_REDORMANCY, wakeCreature } from './behaviour';
import { creatureById, playerOf, withActor, type ActorWorld } from './world';

/**
 * §4's awake-creature rule (#83): **a woken Cinder pursues.** Every test here names the bug it
 * catches, and the ones that carry the ruling are written so that they fail against the rule this
 * replaced — a suite that passes on both is not evidence for the change.
 *
 * The two positive properties an all-negative suite would miss are still the ones to protect: that
 * the declaration **varies with the situation**, and that a creature repeatedly declaring and acting
 * **actually closes the distance**. A Cinder that declared `wait` forever would pass every "nothing
 * is wrong" assertion in this file.
 */

/** The mind a creature would declare in this world, as a plain object for comparison. */
function declare(world: ActorWorld, id: number, lit = SHUTTERED) {
  return nextMind(world, creatureById(world, id), lit);
}

/** A corridor long enough that a pursuer runs out of clock before it runs out of floor. */
const LONG_CORRIDOR = ['##############', '#@..........c#', '##############'];

describe('an awake Cinder pursues (§4)', () => {
  it('paths toward the player while shuttered and non-adjacent', () => {
    // **The headline, and the test that fails against the rule this replaced.** With no contact the
    // old `nextMind` walked to the tile it last saw the light from and then held position there
    // forever; from a standing start with no memory it declared a flat `wait`. §4: "awake, it paths
    // toward the player every turn, shutter open or shut". The bug this catches is the whole issue —
    // a woken creature that the player can simply walk away from, which made the flash refundable
    // at a profit.
    const { world, ids } = scenario(['#######', '#@...c#', '#######']);
    const mind = declare(awaken(world, ids[0], WAIT), ids[0], SHUTTERED);

    expect(mind).toEqual({
      kind: 'awake',
      intent: { kind: 'move', to: { x: 4, y: 1 } },
      // Pursuit does not feed the clock: §4 keeps the counter on *contact*, and there is none here.
      turnsSinceContact: 1,
    });
  });

  it('closes the distance turn after turn in the dark, and arriving resets its own clock', () => {
    // Pursuit as a claim about behaviour over time rather than about one declaration, and the half
    // of it a single-turn test cannot see: a creature that declares one plausible step and then
    // parks passes the test above. Shuttered throughout, so every step is taken without contact —
    // and the moment it arrives, adjacency restores contact and the eight starts over, which is
    // §4's "a creature that catches you starts its eight over".
    const { world, ids, at } = scenario(['#######', '#@...c#', '#######']);
    let current: ActorWorld = awaken(world, ids[0], WAIT);
    const positions: number[] = [];

    for (let turn = 0; turn < TURNS_TO_REDORMANCY; turn += 1) {
      current = playTurn(current, { kind: 'wait' }, SHUTTERED);
      const creature = creatureById(current, ids[0]);
      positions.push(creature.at.x);
      if (creature.mind.kind === 'awake' && creature.mind.intent.kind === 'attack') break;
    }

    const creature = creatureById(current, ids[0]);
    if (creature.mind.kind !== 'awake') throw new Error('the creature fell asleep mid-chase');

    // Turn one resolves the wait it was holding; then it walks x=5 → 2 without once being in
    // contact, and declares a swing at the tile the player is standing on.
    expect(positions).toEqual([5, 5, 4, 3, 2]);
    expect(creature.mind.intent).toEqual({ kind: 'attack', at: at('@') });
    expect(creature.mind.turnsSinceContact).toBe(0);
  });

  it('declares an attack on the tile the player is standing on when adjacent', () => {
    const { world, ids, at } = scenario(['#####', '#@c.#', '#####']);
    expect(declare(awaken(world, ids[0], WAIT), ids[0])).toEqual({
      kind: 'awake',
      intent: { kind: 'attack', at: at('@') },
      turnsSinceContact: 0,
    });
  });

  it('declares a step toward the player when the light reaches it', () => {
    // §6: "the Cinder is drawn to light". Kept from before #83 because the lit case is unchanged and
    // a rewrite that only covered the dark would stop pinning it.
    const { world, ids } = scenario(['#######', '#@...c#', '#######']);
    expect(declare(awaken(world, ids[0], WAIT), ids[0], FLOODLIT)).toEqual({
      kind: 'awake',
      intent: { kind: 'move', to: { x: 4, y: 1 } },
      turnsSinceContact: 0,
    });
  });

  it('declares a wait when there is no legal step, and keeps counting down to sleep', () => {
    // `stepToward` returns `null` for "walled off, or every improving step blocked". That is "no
    // legal step this turn", **not** a hold-still state: the clock has to keep running underneath
    // it, or a creature sealed away from the player would stay awake for the rest of the run. The
    // bug caught is a `WAIT` branch that also short-circuits the counter.
    const { world, ids } = scenario(['#####', '#@#c#', '#####']);
    let current: ActorWorld = awaken(world, ids[0], WAIT);

    for (let turn = 1; turn < TURNS_TO_REDORMANCY; turn += 1) {
      current = commitNextIntent(current, ids[0], SHUTTERED);
      expect(creatureById(current, ids[0]).mind).toEqual({
        kind: 'awake',
        intent: WAIT,
        turnsSinceContact: turn,
      });
    }
    current = commitNextIntent(current, ids[0], SHUTTERED);
    expect(creatureById(current, ids[0]).mind).toEqual({ kind: 'dormant' });
  });

  it('declares a wait over a dead player instead of walking to the corpse', () => {
    // The one case §4's ruling does not name. `hasContact` answers `false` for a dead player on
    // purpose — "creatures must not spend the intervening turns attacking a corpse" — and
    // unconditional pursuit would have routed around that guard rather than honouring it: adjacent,
    // it would declare a swing at the body; further off, a walk toward it. Both branches asserted,
    // because a gate written only on the movement branch leaves the attack live.
    const adjacent = scenario(['#####', '#@c.#', '#####']);
    const fallenNext = withActor(awaken(adjacent.world, adjacent.ids[0], WAIT), {
      ...playerOf(adjacent.world),
      hp: 0,
    });
    expect(declare(fallenNext, adjacent.ids[0])).toMatchObject({ intent: WAIT });

    const across = scenario(['#######', '#@...c#', '#######']);
    const fallenAcross = withActor(awaken(across.world, across.ids[0], WAIT), {
      ...playerOf(across.world),
      hp: 0,
    });
    expect(declare(fallenAcross, across.ids[0], FLOODLIT)).toMatchObject({ intent: WAIT });
  });

  it('asks the light query about its own tile, not the player s', () => {
    // The seam's contract: "is the player's light visible *from here*". A creature outside the lit
    // area has no contact even though the player is standing in the middle of it. Since #83 the
    // declared intent is the same either way, so `turnsSinceContact` is the only observable left —
    // which is exactly why it is asserted on both sides of the boundary here.
    const { world, ids, at } = scenario(['#######', '#@...c#', '#######']);
    const litButNotAtTheCreature = litTiles([at('@'), { x: 2, y: 1 }, { x: 3, y: 1 }]);
    expect(declare(awaken(world, ids[0], WAIT), ids[0], litButNotAtTheCreature)).toMatchObject({
      turnsSinceContact: 1,
    });
    expect(declare(awaken(world, ids[0], WAIT), ids[0], litTiles([at('c')]))).toMatchObject({
      turnsSinceContact: 0,
    });
  });
});

describe('returning to dormant', () => {
  const { world, ids } = scenario(['#######', '#@...c#', '#######']);

  it('goes dormant on the eighth turn without contact, and not before', () => {
    // §4/§6: "after 8 turns with no light and no adjacency it returns to dormant." Both halves
    // asserted, because an off-by-one here is invisible in play and changes how long a botched
    // flash costs you. **The 8 did not move with #83** — the ruling deleted the parking, not the
    // clock — so this is the assertion that catches a re-tune smuggled in with a rule change.
    const seven = awaken(world, ids[0], WAIT, TURNS_TO_REDORMANCY - 2);
    expect(declare(seven, ids[0], SHUTTERED)).toMatchObject({
      kind: 'awake',
      turnsSinceContact: TURNS_TO_REDORMANCY - 1,
    });

    const eight = awaken(world, ids[0], WAIT, TURNS_TO_REDORMANCY - 1);
    expect(declare(eight, ids[0], SHUTTERED)).toEqual({ kind: 'dormant' });
  });

  it('counts eight turns from a standing start, one declaration at a time', () => {
    // The counter driven the way the game drives it, rather than injected. Catches a reset that
    // happens on every declaration, which would make re-dormancy unreachable — and unreachable
    // re-dormancy means darkness stops being restorative (§4), which no negative test would notice.
    let current = awaken(world, ids[0], WAIT);
    for (let turn = 1; turn < TURNS_TO_REDORMANCY; turn += 1) {
      current = commitNextIntent(current, ids[0], SHUTTERED);
      expect(creatureById(current, ids[0]).mind).toMatchObject({ kind: 'awake' });
    }
    current = commitNextIntent(current, ids[0], SHUTTERED);
    expect(creatureById(current, ids[0]).mind).toEqual({ kind: 'dormant' });
  });

  it('resets the count on light, and independently on adjacency in the dark', () => {
    // Two halves of one rule, and they fail differently: without the light half the lantern stops
    // being a combat control (§6); without the adjacency half you could stand next to a woken
    // Cinder in the dark and be ignored, which makes shuttering strictly dominant in every fight.
    // Both are asserted one turn from sleep, so a reset that silently stopped working would show as
    // a creature that dozes off in the player's face.
    const nearlyAsleep = awaken(world, ids[0], WAIT, TURNS_TO_REDORMANCY - 2);
    expect(declare(nearlyAsleep, ids[0], FLOODLIT)).toMatchObject({ turnsSinceContact: 0 });

    const touching = scenario(['#####', '#@c.#', '#####']);
    const almost = awaken(touching.world, touching.ids[0], WAIT, TURNS_TO_REDORMANCY - 2);
    expect(declare(almost, touching.ids[0], SHUTTERED)).toMatchObject({ turnsSinceContact: 0 });
  });

  it('falls asleep where the chase left it, and is a dormant-strike target there', () => {
    // §4's payoff clause: "a creature that gives up is asleep wherever it ended — usually near you —
    // and is a legal dormant-strike target again." Under the rule this replaced it fell asleep on
    // the tile it last saw the light from, which the player had left eight turns earlier, so this
    // fails against the old behaviour twice over: the sleeping tile is wrong, and the walk back to
    // collect it is a different walk.
    const { world: corridor, ids: chaser, at } = scenario(LONG_CORRIDOR);
    const woke = at('c');
    let current: ActorWorld = awaken(corridor, chaser[0], WAIT);

    // One turn to resolve the wait it woke holding, then the eight the clock actually counts.
    for (let turn = 0; turn <= TURNS_TO_REDORMANCY; turn += 1) {
      current = playTurn(current, { kind: 'wait' }, SHUTTERED);
    }

    const asleep = creatureById(current, chaser[0]);
    expect(isDormant(asleep)).toBe(true);
    expect(asleep.at).not.toEqual(woke);
    // Seven tiles of ground closed before the clock ran out: it slept at (5, 1), four from the
    // player, not at (12, 1) where it woke.
    expect(asleep.at).toEqual({ x: 5, y: 1 });
    expect(hasActor(current.schedule, chaser[0])).toBe(false);

    // And it is a legal dormant strike where it lies (§3): three steps east and a bump kills it
    // outright at double damage, and the ember drops on the tile the chase ended on.
    for (const x of [2, 3, 4]) current = playTurn(current, { kind: 'bump', to: { x, y: 1 } }, SHUTTERED);
    current = playTurn(current, { kind: 'bump', to: { x: 5, y: 1 } }, SHUTTERED);

    expect(current.actors.some((actor) => actor.id === chaser[0])).toBe(false);
    expect(current.embers.map((ember) => ember.at)).toEqual([{ x: 5, y: 1 }]);
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

  it('leaves the schedule when it falls asleep, and rejoins it when woken', () => {
    // The scheduling invariant, at the transition where it is easiest to get wrong. A dormant
    // creature left in the queue takes turns in its sleep.
    const asleep = awaken(world, ids[0], WAIT, TURNS_TO_REDORMANCY - 1);
    expect(hasActor(asleep.schedule, ids[0])).toBe(true);

    const dormant = commitNextIntent(asleep, ids[0], SHUTTERED);
    expect(creatureById(dormant, ids[0]).mind).toEqual({ kind: 'dormant' });
    expect(hasActor(dormant.schedule, ids[0])).toBe(false);

    const rewoken = wakeCreature(dormant, creatureById(dormant, ids[0]), FLOODLIT);
    expect(hasActor(rewoken.schedule, ids[0])).toBe(true);
  });
});

describe('the retreat procedure, as a regression test', () => {
  it('does not leave the creature where the player left it', () => {
    /**
     * **The measured degenerate line, run end to end.** §4: "shutter, step out of adjacency, walk
     * anywhere for eight turns, walk back, one-shot a dormant target" — free, automatic, available
     * every time, and net *profitable* after paying for the whole retreat.
     *
     * Against the rule this replaced the creature loses contact on the first step away, walks to the
     * tile it last saw the light from, and **parks there until it sleeps**: the player comes back to
     * find it exactly where it was left, at full value. That is the bug this test catches, and it is
     * the only test in the file that describes the player's whole procedure rather than one rule.
     */
    const { world, ids, at } = scenario(['##############', '#..........@c#', '##############']);
    const parkedByTheOldRule = at('@'); // where the player stood when it last had contact
    let current: ActorWorld = awaken(world, ids[0], WAIT);

    // Shutter is already shut. Walk west, out of adjacency and then away, for six turns.
    for (let x = 10; x >= 5; x -= 1) {
      current = playTurn(current, { kind: 'bump', to: { x, y: 1 } }, SHUTTERED);
    }
    expect(playerOf(current).at).toEqual({ x: 5, y: 1 });

    const chased = creatureById(current, ids[0]);
    expect(chased.at).not.toEqual(parkedByTheOldRule);
    expect(chased.at).not.toEqual(at('c'));
    // It followed: it is west of the tile the old rule pinned it to, and still on the player's heels
    // rather than eight tiles back down the corridor.
    expect(chased.at.x).toBeLessThan(parkedByTheOldRule.x);
    expect(chased.at).toEqual({ x: 8, y: 1 });

    // Now walk back, which under the old rule was the free half of the procedure: three tiles east
    // to a sleeping creature, one bump, twenty fuel. It is not free any more — one step east is
    // enough to be met, because the thing being walked back toward has been walking too.
    const before = playerOf(current).hp;
    current = playTurn(current, { kind: 'bump', to: { x: 6, y: 1 } }, SHUTTERED);
    const met = creatureById(current, ids[0]);
    expect(met.mind).toEqual({
      kind: 'awake',
      intent: { kind: 'attack', at: { x: 6, y: 1 } },
      turnsSinceContact: 0,
    });

    // ...and the next step east is a bump into it, at full HP rather than a free double-damage
    // strike on a sleeper: the player is hit back on the same turn.
    current = playTurn(current, { kind: 'bump', to: { x: 7, y: 1 } }, SHUTTERED);
    expect(creatureById(current, ids[0]).hp).toBeLessThan(5);
    expect(playerOf(current).hp).toBeLessThan(before);
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

  it('comes for the player from the moment it wakes', () => {
    // §4: "waking it is what tells it where you are". A creature that woke holding a `wait` would
    // give the player a free turn of head start that the ruling does not grant.
    expect(declare(world, ids[0], FLOODLIT)).toMatchObject({
      intent: { kind: 'move', to: { x: 4, y: 1 } },
    });
    expect(at('c')).toEqual({ x: 5, y: 1 });
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
    // single-turn test above. Lit, and around a corner, so the distance field is doing real work.
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
