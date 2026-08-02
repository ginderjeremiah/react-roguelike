import { describe, expect, it } from 'vitest';
import { awaken, playTurn, scenario, SHUTTERED } from '@/tests/unit/support/scenario';
import { hasActor } from '../systems/schedule';
import { isDormant, WAIT, type Intent } from './actor';
import { commitNextIntent, nextMind, wakeCreature } from './behaviour';
import { creatureById, playerOf, withActor, type ActorWorld } from './world';

/**
 * §4's awake-creature rule: **a woken Cinder pursues (#83), and it never stops (#123).** Every test
 * here names the bug it catches, and the ones that carry the ruling are written so that they fail
 * against the rules this replaced — a suite that passes on both is not evidence for the change.
 *
 * **What this file stopped testing, and why that is not a coverage loss.** Until #123 half of it was
 * about the eight-turn re-dormancy clock: that it counted, that contact reset it, that light and
 * adjacency reset it independently, that a creature slept where the chase left it and was a fresh
 * dormant-strike target there. **All of that behaviour is deleted, so those tests are deleted** —
 * a test kept alive against a rule that no longer exists is worse than no test, because it has to be
 * rewritten into something that passes and the something is usually vacuous. What replaces them is
 * one assertion in the opposite direction (`never returns to dormant`, below), plus the corpus-tier
 * `wentDormant === 0` in `game/systems/floorplay.test.ts`.
 *
 * **`nextMind` no longer takes a light query**, and there is nothing here that could give it one:
 * the whole of `game/entities/` is now blind to the shutter. Where a test used to contrast lit
 * against shuttered, the contrast is gone because the *answer* is the same — which is the rule.
 * `SHUTTERED` survives only where `playTurn` needs a lighting for §2 phase 3's waking.
 *
 * The two positive properties an all-negative suite would miss are still the ones to protect: that
 * the declaration **varies with the situation**, and that a creature repeatedly declaring and acting
 * **actually closes the distance**. A Cinder that declared `wait` forever would pass every "nothing
 * is wrong" assertion in this file.
 */

/** The mind a creature would declare in this world, as a plain object for comparison. */
function declare(world: ActorWorld, id: number) {
  return nextMind(world, creatureById(world, id));
}

/** A corridor long enough that a pursuer would have run out of clock before it ran out of floor. */
const LONG_CORRIDOR = ['##############', '#@..........c#', '##############'];

describe('an awake Cinder pursues (§4)', () => {
  it('paths toward the player while shuttered and non-adjacent', () => {
    // **The headline, and the test that fails against the rule #83 replaced.** With no contact the
    // pre-#83 `nextMind` walked to the tile it last saw the light from and then held position there
    // forever; from a standing start with no memory it declared a flat `wait`. §4: "awake, it paths
    // toward the player every turn, shutter open or shut". The bug this catches is a woken creature
    // the player can simply walk away from, which made the flash refundable at a profit.
    const { world, ids } = scenario(['#######', '#@...c#', '#######']);

    expect(declare(awaken(world, ids[0], WAIT), ids[0])).toEqual({
      kind: 'awake',
      intent: { kind: 'move', to: { x: 4, y: 1 } },
    });
  });

  it('closes the distance turn after turn in the dark, and arriving does not end the chase', () => {
    // Pursuit as a claim about behaviour over time rather than about one declaration, and the half
    // of it a single-turn test cannot see: a creature that declares one plausible step and then
    // parks passes the test above. Shuttered throughout, so every step is taken with the lantern
    // shut — which since #123 is not a fact the creature can even observe.
    const { world, ids, at } = scenario(['#######', '#@...c#', '#######']);
    let current: ActorWorld = awaken(world, ids[0], WAIT);
    const positions: number[] = [];

    for (let turn = 0; turn < 8; turn += 1) {
      current = playTurn(current, { kind: 'wait' }, SHUTTERED);
      const creature = creatureById(current, ids[0]);
      positions.push(creature.at.x);
      if (creature.mind.kind === 'awake' && creature.mind.intent.kind === 'attack') break;
    }

    const creature = creatureById(current, ids[0]);
    if (creature.mind.kind !== 'awake') throw new Error('the creature fell asleep mid-chase');

    // Turn one resolves the wait it was holding; then it walks x=5 → 2 and declares a swing at the
    // tile the player is standing on.
    expect(positions).toEqual([5, 5, 4, 3, 2]);
    expect(creature.mind.intent).toEqual({ kind: 'attack', at: at('@') });
  });

  it('declares an attack on the tile the player is standing on when adjacent', () => {
    const { world, ids, at } = scenario(['#####', '#@c.#', '#####']);
    expect(declare(awaken(world, ids[0], WAIT), ids[0])).toEqual({
      kind: 'awake',
      intent: { kind: 'attack', at: at('@') },
    });
  });

  it('declares a wait when there is no legal step, and stays awake holding it', () => {
    // `stepToward` returns `null` for "walled off, or every improving step blocked". That is "no
    // legal step this turn", **not** a hold-still state and **not** a reason to sleep: a creature
    // sealed away from the player keeps declaring a wait for as long as the wall is there, and
    // resumes the chase the moment a route opens. Before #123 this was where the clock ran out and
    // the creature dozed off, which is exactly the behaviour being deleted.
    const { world, ids } = scenario(['#####', '#@#c#', '#####']);
    let current: ActorWorld = awaken(world, ids[0], WAIT);

    for (let turn = 0; turn < 20; turn += 1) {
      current = commitNextIntent(current, ids[0]);
      expect(creatureById(current, ids[0]).mind, `turn ${turn}`).toEqual({
        kind: 'awake',
        intent: WAIT,
      });
      expect(hasActor(current.schedule, ids[0])).toBe(true);
    }
  });

  it('declares a wait over a dead player instead of walking to the corpse', () => {
    // The one case §4's ruling does not name, and it is #83's gate surviving #123 unchanged. The
    // run does not end inside this layer, so an ungated pursuit would have a creature swinging at a
    // corpse when adjacent and walking to it when not. Both branches asserted, because a gate
    // written only on the movement branch leaves the attack live.
    const adjacent = scenario(['#####', '#@c.#', '#####']);
    const fallenNext = withActor(awaken(adjacent.world, adjacent.ids[0], WAIT), {
      ...playerOf(adjacent.world),
      hp: 0,
    });
    expect(declare(fallenNext, adjacent.ids[0])).toEqual({ kind: 'awake', intent: WAIT });

    const across = scenario(['#######', '#@...c#', '#######']);
    const fallenAcross = withActor(awaken(across.world, across.ids[0], WAIT), {
      ...playerOf(across.world),
      hp: 0,
    });
    expect(declare(fallenAcross, across.ids[0])).toEqual({ kind: 'awake', intent: WAIT });
  });
});

describe('a woken Cinder never returns to dormant (§4, #123)', () => {
  it('is still awake, still coming, and still scheduled after a retreat that used to put it out', () => {
    // ═══ THE DELETION, PINNED BY MUTATION ═══
    //
    // The rule this replaces: "eight turns (tuning) after the last one in which it saw your light or
    // stood next to you, it sleeps where it stands." Restoring `TURNS_TO_REDORMANCY` and the
    // `DORMANT` return makes this fail on the ninth iteration.
    //
    // Twenty turns, not nine, and shuttered throughout: contact is broken on the first step and
    // never resumes, which is precisely the state the old clock counted. The corridor is long
    // enough that the creature never catches the player, so nothing here restarts a clock that a
    // careless re-introduction might reset on adjacency.
    const { world, ids, at } = scenario(LONG_CORRIDOR);
    const woke = at('c');
    let current: ActorWorld = awaken(world, ids[0], WAIT);

    for (let turn = 0; turn < 20; turn += 1) {
      current = commitNextIntent(current, ids[0]);
      expect(creatureById(current, ids[0]).mind.kind, `turn ${turn}`).toBe('awake');
    }

    const chaser = creatureById(current, ids[0]);
    expect(isDormant(chaser)).toBe(false);
    expect(hasActor(current.schedule, ids[0])).toBe(true);
    // ...and it is still declaring against the player rather than idling where it woke.
    expect(chaser.mind).toEqual({ kind: 'awake', intent: { kind: 'move', to: { x: 11, y: 1 } } });
    expect(woke).toEqual({ x: 12, y: 1 });
  });

  it('stays awake across thirty turns actually played, walled away from the player', () => {
    // The same claim driven through `playTurn` — the real §2 phase order, including phase 3's
    // waking — rather than through `commitNextIntent` alone. It is the difference between "the
    // declaration function never returns dormant" and "nothing in a turn puts a creature to sleep":
    // a re-introduced clock wired into the *turn* instead of into `nextMind` passes the test above
    // and fails this one.
    //
    // Walled off and shuttered, which is exactly the condition the old clock counted — no light, no
    // adjacency, ever, for thirty turns. It is also the only way to play this many turns without
    // the creature arriving and killing the player, which since #123 is what happens if you let it.
    const { world, ids } = scenario(['#####', '#@#c#', '#####']);
    let current: ActorWorld = awaken(world, ids[0], WAIT);

    for (let turn = 0; turn < 30; turn += 1) {
      current = playTurn(current, { kind: 'wait' }, SHUTTERED);
      expect(creatureById(current, ids[0]).mind.kind, `turn ${turn}`).toBe('awake');
      expect(hasActor(current.schedule, ids[0]), `turn ${turn}`).toBe(true);
    }
    expect(playerOf(current).hp).toBe(12);
  });

  it('does not fall asleep over a dead player either', () => {
    // Found by mutation testing before #123 and kept for the opposite reason. The old rule had an
    // adjacent creature lose contact with a corpse and doze off over it; the new rule has it stand
    // there declaring a wait forever, which is the honest reading of "a woken creature is awake for
    // the rest of the floor" and keeps the dead-player gate from being a sleep condition in
    // disguise. The run ending is #18's, not this layer's.
    const { world, ids } = scenario(['#####', '#@c.#', '#####']);
    let current = withActor(awaken(world, ids[0], WAIT), { ...playerOf(world), hp: 0 });

    for (let turn = 0; turn < 20; turn += 1) {
      current = commitNextIntent(current, ids[0]);
      expect(creatureById(current, ids[0]).mind, `turn ${turn}`).toEqual({
        kind: 'awake',
        intent: WAIT,
      });
    }
    expect(hasActor(current.schedule, ids[0])).toBe(true);
  });
});

describe('the retreat procedure, as a regression test', () => {
  it('does not leave the creature where the player left it, and does not leave it asleep', () => {
    /**
     * **The measured degenerate line, run end to end.** §4: "shutter, step out of adjacency, walk
     * anywhere for eight turns, walk back, one-shot a dormant target" — free, automatic, available
     * every time, and net *profitable* after paying for the whole retreat.
     *
     * It had two halves and this test now kills both. Against the pre-#83 rule the creature parked
     * on the tile it last saw the light from, so the player came back to find it where they left it.
     * Against the pre-#123 rule it followed but **fell asleep on the eighth turn**, so the walk back
     * still ended in a free double-damage strike — the refund #83 left behind. Here the walk back
     * ends in a fight, which is the whole of what the ruling is for.
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

    // Now walk back, which under both old rules was the free half of the procedure: three tiles east
    // to a sleeping creature, one bump, twenty fuel. It is not free any more — one step east is
    // enough to be met, because the thing being walked back toward has been walking too and has not
    // stopped being awake.
    const before = playerOf(current).hp;
    current = playTurn(current, { kind: 'bump', to: { x: 6, y: 1 } }, SHUTTERED);
    const met = creatureById(current, ids[0]);
    expect(met.mind).toEqual({ kind: 'awake', intent: { kind: 'attack', at: { x: 6, y: 1 } } });

    // ...and the next step east is a bump into it, at full HP rather than a free double-damage
    // strike on a sleeper: the player is hit back on the same turn, and the creature survives.
    current = playTurn(current, { kind: 'bump', to: { x: 7, y: 1 } }, SHUTTERED);
    expect(creatureById(current, ids[0]).hp).toBe(2);
    expect(playerOf(current).hp).toBeLessThan(before);
  });

  it('costs the player HP to finish, which is the price the clock used to refund', () => {
    // §4's arithmetic, as a test rather than as a paragraph: "a Cinder has 5 HP against the player's
    // 3 damage, so a woken one takes two strikes; and the player is adjacent at their own decision
    // point only when the creature has already declared on their tile, so the first strike always
    // eats 2." **Every woken Cinder costs exactly 2 HP.** Before #123 this same situation cost 0,
    // because the creature could be outwaited and struck asleep for double damage.
    const { world, ids } = scenario(['#######', '#@...c#', '#######']);
    let current: ActorWorld = awaken(world, ids[0], WAIT);
    const startingHp = playerOf(current).hp;

    for (let turn = 0; turn < 12; turn += 1) {
      const creature = current.actors.find((actor) => actor.id === ids[0]);
      if (creature === undefined) break;
      const adjacentTo = creature.at;
      const action =
        Math.abs(adjacentTo.x - playerOf(current).at.x) +
          Math.abs(adjacentTo.y - playerOf(current).at.y) ===
        1
          ? ({ kind: 'bump', to: adjacentTo } as const)
          : ({ kind: 'wait' } as const);
      current = playTurn(current, action, SHUTTERED);
    }

    expect(current.actors.some((actor) => actor.id === ids[0])).toBe(false);
    expect(startingHp - playerOf(current).hp).toBe(2);
  });
});

describe('waking', () => {
  const { world, ids, at } = scenario(['#######', '#@...c#', '#######']);

  it('declares immediately and joins the schedule for next turn, not this one', () => {
    // GDD §2 phase 3, and the reason it is expressed through the schedule: a creature woken by the
    // light you just opened "declares this turn and acts next turn". Joining at `now` instead would
    // let it act in phase 4 of the very turn it woke — the reactive behaviour §2 forbids.
    const woken = wakeCreature(world, creatureById(world, ids[0]));
    const creature = creatureById(woken, ids[0]);

    expect(creature.mind.kind).toBe('awake');
    expect(hasActor(woken.schedule, ids[0])).toBe(true);
    expect(woken.schedule.entries.find((entry) => entry.actorId === ids[0])?.nextActAt).toBe(
      world.schedule.now + 100,
    );
  });

  it('comes for the player from the moment it wakes', () => {
    // §4: "waking it is what tells it where you are". A creature that woke holding a `wait` would
    // give the player a free turn of head start that the ruling does not grant.
    expect(declare(world, ids[0])).toEqual({
      kind: 'awake',
      intent: { kind: 'move', to: { x: 4, y: 1 } },
    });
    expect(at('c')).toEqual({ x: 5, y: 1 });
  });

  it('does not re-declare for a creature that is already awake', () => {
    // Otherwise standing next to a woken Cinder would rewrite its plan every turn, which is
    // commit-one-turn-ahead deleted by a side door. Since #123 this guard is load-bearing on every
    // turn of every floor rather than for eight turns at a time.
    const committed = awaken(world, ids[0], { kind: 'move', to: { x: 5, y: 1 } });
    const again = wakeCreature(committed, creatureById(committed, ids[0]));
    expect(creatureById(again, ids[0]).mind).toEqual(creatureById(committed, ids[0]).mind);
  });

  it('does nothing to a dead creature', () => {
    const dead = withActor(world, { ...creatureById(world, ids[0]), hp: 0 });
    expect(wakeCreature(dead, creatureById(dead, ids[0]))).toBe(dead);
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
      return nextMind(moved, creatureById(moved, built.ids[0])).intent;
    });

    // Adjacent on all four sides: four attacks, each on the tile the player actually stands on.
    expect(intents).toEqual(positions.map((at) => ({ kind: 'attack', at })));
    expect(new Set(intents.map((intent) => JSON.stringify(intent))).size).toBe(4);
  });

  it('closes the distance turn after turn until it is adjacent, then attacks', () => {
    // Pursuit as a claim about behaviour over time rather than about one declaration. A creature
    // that declares a plausible-looking step and never actually arrives passes every single-turn
    // test above. Around a corner, so the distance field is doing real work.
    const { world, ids, at } = scenario([
      '#########',
      '#@......#',
      '#.#####.#',
      '#......c#',
      '#########',
    ]);
    let current: ActorWorld = wakeCreature(world, creatureById(world, ids[0]));
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
      current = commitNextIntent(current, ids[0]);
    }

    // It got closer every single turn, and it got all the way there.
    expect(distances.length).toBeGreaterThan(3);
    for (let i = 1; i < distances.length; i += 1) {
      expect(distances[i]).toBeLessThan(distances[i - 1]);
    }
    expect(distances[distances.length - 1]).toBe(1);
  });
});
