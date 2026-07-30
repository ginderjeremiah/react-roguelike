import { describe, expect, it } from 'vitest';
import {
  allDueNow,
  awaken,
  FLOODLIT,
  litTiles,
  playTurn,
  scenario,
  SHUTTERED,
} from '@/tests/unit/support/scenario';
import { CINDER, PLAYER_MAX_HP } from '../content';
import { creatureById, playerOf, withActor, withHp, PLAYER_ID } from '../entities';
import { actOnce, actorPhase, wakeInLight } from './actors';
import { ACTION_COST, hasActor, nextActAtOf } from './schedule';

describe('actOnce', () => {
  it('resolves the declared move, then declares the next action from where it landed', () => {
    // GDD §2 phase 4, in order. The second half matters as much as the first: a creature that
    // declared from its *old* tile would path from a tile it is no longer standing on, which reads
    // in play as an enemy walking into walls.
    const { world, ids, at } = scenario(['#######', '#@...c#', '#######']);
    const committed = allDueNow(awaken(world, ids[0], { kind: 'move', to: { x: 4, y: 1 } }));

    const after = actOnce(committed, ids[0], FLOODLIT);
    const creature = creatureById(after, ids[0]);

    expect(creature.at).toEqual({ x: 4, y: 1 });
    expect(creature.mind).toMatchObject({ intent: { kind: 'move', to: { x: 3, y: 1 } } });
    expect(at('c')).toEqual({ x: 5, y: 1 });
  });

  it('resolves a declared attack against whatever is on the tile now', () => {
    const { world, ids, at } = scenario(['#####', '#@c.#', '#####']);
    const committed = allDueNow(awaken(world, ids[0], { kind: 'attack', at: at('@') }));

    expect(playerOf(actOnce(committed, ids[0], SHUTTERED)).hp).toBe(PLAYER_MAX_HP - CINDER.attack);
  });

  it('refuses the player', () => {
    // The tripwire for a command that forgot to charge. Without it the player acts twice in a turn
    // — once in phase 1 and once in phase 4 — and a free action hands every creature a free turn.
    const { world } = scenario(['#####', '#@c.#', '#####']);
    expect(() => actOnce(world, PLAYER_ID, SHUTTERED)).toThrow(/resolves in phase 1/);
  });

  it('refuses a dormant or dead creature', () => {
    // Both are out of the schedule by invariant, so reaching here means the invariant broke
    // upstream. A silent no-op would hide it until the creature's behaviour looked wrong.
    const { world, ids } = scenario(['#####', '#@c.#', '#####']);
    expect(() => actOnce(world, ids[0], SHUTTERED)).toThrow(/dormant/);

    const awakened = awaken(world, ids[0], { kind: 'wait' });
    const dead = withActor(awakened, withHp(creatureById(awakened, ids[0]), 0));
    expect(() => actOnce(dead, ids[0], SHUTTERED)).toThrow(/dead actor/);
  });
});

describe('the actor phase', () => {
  it('gives every awake creature exactly one turn, and charges each of them once', () => {
    const { world, ids } = scenario(['########', '#@.c..c#', '########']);
    const both = allDueNow(
      awaken(
        awaken(world, ids[0], { kind: 'move', to: { x: 2, y: 1 } }),
        ids[1],
        { kind: 'move', to: { x: 5, y: 1 } },
      ),
    );

    // Through a whole turn, because `actorPhase` alone would find the player still due at `now` —
    // phase 1 is what charges it, and `actOnce` throws rather than letting the player act twice.
    const after = playTurn(both, { kind: 'wait' }, SHUTTERED);
    expect(creatureById(after, ids[0]).at).toEqual({ x: 2, y: 1 });
    expect(creatureById(after, ids[1]).at).toEqual({ x: 5, y: 1 });
    expect(nextActAtOf(after.schedule, ids[0])).toBe(ACTION_COST);
    expect(nextActAtOf(after.schedule, ids[1])).toBe(ACTION_COST);
  });

  it('does not give a turn to a creature killed earlier in the same turn', () => {
    // The whole reason a kill leaves the schedule at kill time. Both creatures are due; the player
    // kills the first in phase 1; if it still acted in phase 4 it would attack from the grave.
    const { world, ids, at } = scenario(['######', '#@c..#', '######']);
    const committed = allDueNow(awaken(world, ids[0], { kind: 'attack', at: at('@') }));
    // Awake, so the dormant strike does not apply — the player is given enough attack to finish it
    // in one action, because what is being tested is the kill's effect on the queue, not the maths.
    const armed = withActor(committed, { ...playerOf(committed), attack: 99 });

    const after = playTurn(armed, { kind: 'bump', to: at('c') }, SHUTTERED);

    expect(playerOf(after).hp).toBe(PLAYER_MAX_HP);
    expect(after.embers).toEqual([{ at: at('c'), amount: CINDER.emberDrop }]);
  });

  it('is skipped entirely by a free action', () => {
    // GDD §2: "Toggling the shutter is a free action — it does not consume a turn." `runActorPhase`
    // charges every actor due at `now`, and the player is due at `now` when the turn begins — so a
    // command that merely declines to charge itself still costs a turn AND hands every creature
    // one. The fix is at this seam, and `TurnCost` has no default so it cannot be forgotten.
    const { world, ids, at } = scenario(['######', '#@c..#', '######']);
    const committed = allDueNow(awaken(world, ids[0], { kind: 'attack', at: at('@') }));

    // The phase itself first: `free` is identity, not "run it but skip the charge".
    expect(actorPhase('free', SHUTTERED)(committed)).toBe(committed);

    const free = playTurn(committed, { kind: 'free' }, SHUTTERED);
    expect(playerOf(free).hp).toBe(PLAYER_MAX_HP);
    expect(free.schedule).toEqual(committed.schedule);

    // ...and the same turn taken as a normal action does cost one, on both sides.
    const paid = playTurn(committed, { kind: 'wait' }, SHUTTERED);
    expect(playerOf(paid).hp).toBe(PLAYER_MAX_HP - CINDER.attack);
    expect(paid.schedule.now).toBeGreaterThan(committed.schedule.now);
  });
});

describe('waking in light', () => {
  it('wakes every dormant creature the light reaches, and nothing else', () => {
    // §4's table: lit — "every dormant creature in the radius wakes"; dark — "nothing wakes".
    const { world, ids, at } = scenario(['#######', '#@c..c#', '#######']);
    const lit = wakeInLight(world, litTiles([at('c')]));

    expect(creatureById(lit, ids[0]).mind.kind).toBe('awake');
    expect(creatureById(lit, ids[1]).mind.kind).toBe('dormant');
    expect(hasActor(lit.schedule, ids[0])).toBe(true);
    expect(hasActor(lit.schedule, ids[1])).toBe(false);
  });

  it('does not wake a creature merely because the player is standing next to it', () => {
    // The dormant strike is the only free kill in the game (§1) and it exists only in the dark. If
    // adjacency woke a sleeper, walking up to one would wake it and the strike would be
    // unreachable — which no "nothing is wrong" assertion would ever notice.
    const { world, ids } = scenario(['#####', '#@c.#', '#####']);
    expect(creatureById(wakeInLight(world, SHUTTERED), ids[0]).mind.kind).toBe('dormant');
  });

  it('wakes a creature to act next turn, never this one', () => {
    // §2 phase 3 sits before phase 4, so a creature woken by the light you just opened would act in
    // the same turn if waking scheduled it at `now`. It joins at `now + ACTION_COST` instead:
    // "opening the shutter woke the room" is a thing you see coming.
    const { world, ids, at } = scenario(['#######', '#@...c#', '#######']);
    const lit = playTurn(world, { kind: 'wait' }, FLOODLIT);

    expect(creatureById(lit, ids[0]).mind.kind).toBe('awake');
    expect(creatureById(lit, ids[0]).at).toEqual(at('c'));

    // On the next turn it does act, and moves.
    const next = playTurn(lit, { kind: 'wait' }, FLOODLIT);
    expect(creatureById(next, ids[0]).at).toEqual({ x: 4, y: 1 });
  });

  it('is a no-op when nothing is lit', () => {
    const { world } = scenario(['#######', '#@...c#', '#######']);
    expect(wakeInLight(world, SHUTTERED)).toBe(world);
  });
});
