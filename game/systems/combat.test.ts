import { describe, expect, it } from 'vitest';
import { awaken, FLOODLIT, scenario, SHUTTERED } from '@/tests/unit/support/scenario';
import { CINDER, PLAYER_ATTACK, PLAYER_MAX_HP } from '../content';
import {
  creatureById,
  findActor,
  findWorldProblems,
  playerOf,
  withActor,
  withHp,
  PLAYER_ID,
  type ActorWorld,
} from '../entities';
import { hasActor } from './schedule';
import {
  bump,
  canMove,
  damageFrom,
  DORMANT_STRIKE_MULTIPLIER,
  resolveAttack,
  resolveDeaths,
  resolveMove,
  restoreOnDescent,
} from './combat';

/**
 * GDD §3. Two things this file is watching for beyond the obvious:
 *
 *   - **A kill leaves the queue at the instant of the kill**, not at phase 5. The scheduler cannot
 *     do that for us — `runActorPhase` re-reads the queue, but only removal takes the actor out of
 *     it — and the symptom of getting it wrong is an attack from something the player already
 *     killed, one phase later.
 *   - **Damage is the same every time.** There is nothing to make random here, which is exactly why
 *     a test asserting it has to be written before someone "improves" it.
 */

describe('damage', () => {
  const { world, ids } = scenario(['#####', '#@c.#', '#####']);

  it('is flat, integer, and identical on every repetition', () => {
    // §3: "No to-hit rolls, no damage ranges." A hundred identical answers is a weak statement on
    // its own — the strong one is that `damageFrom` has no parameter that could carry entropy, and
    // this suite never passes it one.
    const player = playerOf(world);
    const creature = creatureById(world, ids[0]);
    const awakeCreature = creatureById(awaken(world, ids[0], { kind: 'wait' }), ids[0]);

    for (let i = 0; i < 100; i += 1) {
      expect(damageFrom(player, awakeCreature)).toBe(PLAYER_ATTACK);
      expect(damageFrom(awakeCreature, player)).toBe(CINDER.attack);
      expect(damageFrom(player, creature)).toBe(PLAYER_ATTACK * DORMANT_STRIKE_MULTIPLIER);
    }
  });

  it('doubles against a dormant target and only a dormant target', () => {
    // §3's payoff for playing dark. The dormant strike is the only free kill in the game.
    const dormant = creatureById(world, ids[0]);
    const awakened = creatureById(awaken(world, ids[0], { kind: 'wait' }), ids[0]);
    expect(damageFrom(playerOf(world), dormant)).toBe(
      damageFrom(playerOf(world), awakened) * DORMANT_STRIKE_MULTIPLIER,
    );
  });
});

describe('resolving an attack', () => {
  it('kills a dormant Cinder in one strike', () => {
    // §3's stated consequence: "a dormant Cinder dies to one strike and costs 0 HP."
    const { world, ids, at } = scenario(['#####', '#@c.#', '#####']);
    const after = resolveAttack(world, PLAYER_ID, at('c'), SHUTTERED);

    expect(creatureById(after, ids[0]).hp).toBe(0);
    expect(playerOf(after).hp).toBe(PLAYER_MAX_HP);
  });

  it('takes two strikes on an awake one', () => {
    const { world, ids, at } = scenario(['#####', '#@c.#', '#####']);
    const woken = awaken(world, ids[0], { kind: 'wait' });

    const once = resolveAttack(woken, PLAYER_ID, at('c'), SHUTTERED);
    expect(creatureById(once, ids[0]).hp).toBe(CINDER.maxHp - PLAYER_ATTACK);

    const twice = resolveAttack(once, PLAYER_ID, at('c'), SHUTTERED);
    expect(creatureById(twice, ids[0]).hp).toBe(0);
  });

  it('wakes a dormant target that survives, and it declares from where it is', () => {
    // §3/§6: "If the target survives, it wakes." Set up with a creature tough enough to survive a
    // dormant strike, because the Cinder at M1's numbers never does — the *rule* is being tested,
    // not the tuning.
    const { world, ids, at } = scenario(['#####', '#@c.#', '#####']);
    const tough = withActor(world, { ...creatureById(world, ids[0]), hp: 20, maxHp: 20 });
    const after = resolveAttack(tough, PLAYER_ID, at('c'), SHUTTERED);
    const creature = creatureById(after, ids[0]);

    expect(creature.hp).toBe(20 - PLAYER_ATTACK * DORMANT_STRIKE_MULTIPLIER);
    expect(creature.mind).toMatchObject({
      kind: 'awake',
      // It woke adjacent to the player, so it has contact and commits to hitting back — even
      // though the shutter is closed.
      intent: { kind: 'attack', at: at('@') },
    });
    // And it is now in the queue, for next turn rather than this one.
    expect(hasActor(after.schedule, ids[0])).toBe(true);
  });

  it('never drops HP below zero', () => {
    const { world, ids, at } = scenario(['#####', '#@c.#', '#####']);
    const overkill = withActor(world, { ...playerOf(world), attack: 999 });
    const after = resolveAttack(overkill, PLAYER_ID, at('c'), SHUTTERED);
    expect(creatureById(after, ids[0]).hp).toBe(0);
    expect(findWorldProblems(after)).toEqual([]);
  });

  it('removes the killed actor from the schedule immediately, not at phase 5', () => {
    // The load-bearing one. A creature killed in phase 1 is still due at `now`, so without this it
    // takes its turn in phase 4 and attacks after it died. GDD §2 still resolves the *death* at
    // phase 5 — the body and the embers — and this test pins the split: out of the queue now, out
    // of the world later.
    const { world, ids, at } = scenario(['#####', '#@c.#', '#####']);
    const woken = awaken(world, ids[0], { kind: 'attack', at: at('@') });
    expect(hasActor(woken.schedule, ids[0])).toBe(true);

    const killed = resolveAttack(
      withActor(woken, { ...playerOf(woken), attack: 99 }),
      PLAYER_ID,
      at('c'),
      SHUTTERED,
    );

    expect(hasActor(killed.schedule, ids[0])).toBe(false);
    // Still in the world, at zero HP, until the deaths phase runs.
    expect(findActor(killed, ids[0])?.hp).toBe(0);
    expect(killed.embers).toEqual([]);
  });

  it('hits nothing when the target has stepped off the marked tile', () => {
    // §2: "Step off the marked tile is a real defensive move that costs a turn." An attack marks a
    // tile; if the tile is empty when it resolves, the turn is spent on nothing.
    const { world, ids } = scenario(['#####', '#@c.#', '#####']);
    const woken = awaken(world, ids[0], { kind: 'attack', at: { x: 1, y: 1 } });
    const dodged = withActor(woken, { ...playerOf(woken), at: { x: 3, y: 1 } });

    const after = resolveAttack(dodged, ids[0], { x: 1, y: 1 }, SHUTTERED);
    expect(playerOf(after).hp).toBe(PLAYER_MAX_HP);
    expect(after).toBe(dodged);
  });

  it('does not let creatures hurt each other', () => {
    // Deliberately conservative: a creature *can* end up on a tile another creature marked, and
    // whether that hurts is a design question §6 does not answer. Until it does, nothing happens.
    const { world, ids } = scenario(['#####', '#@cc#', '#####']);
    const attacker = awaken(world, ids[0], { kind: 'attack', at: { x: 3, y: 1 } });
    const after = resolveAttack(attacker, ids[0], { x: 3, y: 1 }, SHUTTERED);
    expect(creatureById(after, ids[1]).hp).toBe(CINDER.maxHp);
  });

  it('refuses to let an actor attack its own tile or act while dead', () => {
    const { world, ids, at } = scenario(['#####', '#@c.#', '#####']);
    expect(() => resolveAttack(world, PLAYER_ID, at('@'), SHUTTERED)).toThrow(/its own tile/);

    const dead = withActor(world, withHp(playerOf(world), 0));
    expect(() => resolveAttack(dead, PLAYER_ID, at('c'), SHUTTERED)).toThrow(/dead actor/);
    expect(ids.length).toBe(1);
  });
});

describe('movement', () => {
  it('moves one orthogonal step onto passable, unoccupied ground', () => {
    const { world } = scenario(['#####', '#@..#', '#####']);
    expect(playerOf(resolveMove(world, PLAYER_ID, { x: 2, y: 1 })).at).toEqual({ x: 2, y: 1 });
  });

  it('spends the turn without moving when the destination is blocked', () => {
    // A creature committed to this tile a turn ago. §2 accepts that enemies can be baited; the
    // move failing is what makes baiting cost them something.
    const { world, ids } = scenario(['#####', '#@c.#', '#####']);
    const blocked = resolveMove(world, ids[0], { x: 1, y: 1 });
    expect(creatureById(blocked, ids[0]).at).toEqual({ x: 2, y: 1 });
    expect(blocked).toBe(world);
  });

  it('refuses a wall, and says so through canMove before a turn is charged', () => {
    const { world } = scenario(['#####', '#@..#', '#####']);
    expect(canMove(world, PLAYER_ID, { x: 1, y: 0 })).toBe(false);
    expect(resolveMove(world, PLAYER_ID, { x: 1, y: 0 })).toBe(world);
    expect(canMove(world, PLAYER_ID, { x: 2, y: 1 })).toBe(true);
  });

  it('throws on a move that is not one orthogonal step', () => {
    // §3: movement is 4-directional. A diagonal or a two-tile jump is a bug in the caller, and
    // treating it as "blocked" would hide a teleport.
    const { world } = scenario(['#####', '#@..#', '#####']);
    expect(() => resolveMove(world, PLAYER_ID, { x: 3, y: 1 })).toThrow(/4-directional/);
    expect(() => resolveMove(world, PLAYER_ID, { x: 2, y: 2 })).toThrow(/4-directional/);
    expect(canMove(world, PLAYER_ID, { x: 2, y: 2 })).toBe(false);
  });
});

describe('bump to attack', () => {
  it('attacks an adjacent creature and moves onto anything else', () => {
    // §9: "Tap an adjacent tile to move; tap an adjacent occupied tile to attack." One verb.
    const { world, ids, at } = scenario(['#####', '#@c.#', '#####']);
    const attacked = bump(world, PLAYER_ID, at('c'), SHUTTERED);
    expect(creatureById(attacked, ids[0]).hp).toBe(0);
    expect(playerOf(attacked).at).toEqual(at('@'));

    const { world: open } = scenario(['#####', '#@..#', '#####']);
    expect(playerOf(bump(open, PLAYER_ID, { x: 2, y: 1 }, SHUTTERED)).at).toEqual({ x: 2, y: 1 });
  });

  it('walks over a corpse rather than attacking it', () => {
    // Phase 5 has not run yet, so the body is still listed. It must not be a target or an obstacle.
    const { world, ids, at } = scenario(['#####', '#@c.#', '#####']);
    const killed = resolveAttack(world, PLAYER_ID, at('c'), SHUTTERED);
    const walked = bump(killed, PLAYER_ID, at('c'), SHUTTERED);
    expect(playerOf(walked).at).toEqual(at('c'));
    expect(creatureById(walked, ids[0]).hp).toBe(0);
  });
});

describe('the deaths phase', () => {
  it('drops the creature s ember where it fell and takes the body out of the world', () => {
    const { world, ids, at } = scenario(['#####', '#@c.#', '#####']);
    const after = resolveDeaths(resolveAttack(world, PLAYER_ID, at('c'), SHUTTERED));

    expect(findActor(after, ids[0])).toBeNull();
    expect(after.embers).toEqual([{ at: at('c'), amount: CINDER.emberDrop }]);
    expect(findWorldProblems(after)).toEqual([]);
  });

  it('does nothing at all when nobody died', () => {
    const { world } = scenario(['#####', '#@c.#', '#####']);
    expect(resolveDeaths(world)).toBe(world);
  });

  it('drops embers in ascending actor id order', () => {
    // Not cosmetic: `embers` is part of the state a replay compares, so two runs that killed the
    // same two creatures must list them in the same order.
    const { world, ids } = scenario(['######', '#@cc.#', '######']);
    const killed = [ids[1], ids[0]].reduce<ActorWorld>(
      (current, id) => withActor(current, withHp(creatureById(current, id), 0)),
      world,
    );
    expect(resolveDeaths(killed).embers.map((drop) => drop.at.x)).toEqual([2, 3]);
  });

  it('leaves a dead player in the world for the run to end around', () => {
    // #18 decides what a dead player means. Removing it here would make every query throw before
    // #18 got the chance.
    const { world, ids, at } = scenario(['#####', '#@c.#', '#####']);
    const woken = awaken(world, ids[0], { kind: 'attack', at: at('@') });
    const strong = withActor(woken, { ...creatureById(woken, ids[0]), attack: 99 });
    const killed = resolveAttack(strong, ids[0], at('@'), SHUTTERED);

    expect(playerOf(killed).hp).toBe(0);
    expect(hasActor(killed.schedule, PLAYER_ID)).toBe(false);

    const after = resolveDeaths(killed);
    expect(playerOf(after).hp).toBe(0);
    expect(after.embers).toEqual([]);
  });

  it('throws if a corpse is still holding a place in the queue', () => {
    // The tripwire for the kill-time removal having been lost. Its symptom in play — a corpse
    // taking a turn — would otherwise appear one phase later with nothing to point at.
    const { world, ids, at } = scenario(['#####', '#@c.#', '#####']);
    const woken = awaken(world, ids[0], { kind: 'attack', at: at('@') });
    const cheated = withActor(woken, withHp(creatureById(woken, ids[0]), 0));
    expect(() => resolveDeaths(cheated)).toThrow(/still in the schedule/);
  });
});

describe('healing', () => {
  it('restores 2 HP on descent, capped at the maximum', () => {
    const { world } = scenario(['#####', '#@..#', '#####']);
    const hurt = withActor(world, withHp(playerOf(world), 5));
    expect(playerOf(restoreOnDescent(hurt)).hp).toBe(7);

    const nearlyFull = withActor(world, withHp(playerOf(world), PLAYER_MAX_HP - 1));
    expect(playerOf(restoreOnDescent(nearlyFull)).hp).toBe(PLAYER_MAX_HP);
    expect(playerOf(restoreOnDescent(world)).hp).toBe(PLAYER_MAX_HP);
  });

  it('is the only thing in this module that raises HP', () => {
    // §3: "No healing within a floor. HP declines monotonically until you descend." Asserted by
    // driving every HP-touching entry point and watching the bar.
    const { world, ids, at } = scenario(['#####', '#@c.#', '#####']);
    const woken = awaken(world, ids[0], { kind: 'attack', at: at('@') });
    let current = woken;
    let previous = playerOf(current).hp;

    for (let turn = 0; turn < 4; turn += 1) {
      current = resolveAttack(current, ids[0], at('@'), FLOODLIT);
      current = resolveDeaths(current);
      expect(playerOf(current).hp).toBeLessThan(previous);
      previous = playerOf(current).hp;
    }
    expect(previous).toBe(PLAYER_MAX_HP - 4 * CINDER.attack);
  });
});
