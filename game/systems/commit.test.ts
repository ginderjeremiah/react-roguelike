import { describe, expect, it } from 'vitest';
import { allDueNow, awaken, FLOODLIT, playTurn, scenario, SHUTTERED } from '@/tests/unit/support/scenario';
import { CINDER, PLAYER_MAX_HP } from '../content';
import { creatureById, playerOf, type ActorWorld } from '../entities';

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * COMMIT ONE TURN AHEAD — the property, not the implementation
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * GDD §2: "On its turn an awake creature resolves the action it declared last turn... It cannot
 * react to what you do in between." This is Pillar 2 in its strongest form — the enemy's plan was
 * fixed *before* you moved, so the outcome of your turn was fully determined by your decision.
 *
 * Every test below is the same experiment: take one world, play **two different player commands**
 * from it, and assert the creature resolved the same committed action in both. That shape is the
 * point. A test that asserted "the creature moved to (4,1)" would pass just as happily for a
 * creature that recomputed its move from scratch and happened to agree; only the branching form
 * can tell the difference.
 *
 * What it is protecting against is a change that looks like a *fix*. Making a declared attack
 * target the player wherever they now stand, or re-declaring on a creature that is already awake,
 * both make enemies look smarter and both silently delete the defensive move §2 is built around.
 * `floorplay.test.ts` carries the corpus-wide version of the same property: the player can only
 * ever be hit on a tile that was already marked when the turn began.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

describe('a committed attack', () => {
  /**
   * ```
   * ######
   * #@c..#      the Cinder is awake and has declared an attack on the player's tile
   * #....#
   * ######
   * ```
   */
  function situation(): { world: ActorWorld; id: number; marked: { x: number; y: number } } {
    const { world, ids, at } = scenario([
      '######',
      '#@c..#',
      '#....#',
      '######',
    ]);
    return {
      world: allDueNow(awaken(world, ids[0], { kind: 'attack', at: at('@') })),
      id: ids[0],
      marked: at('@'),
    };
  }

  it('lands when the player stays on the marked tile', () => {
    const { world } = situation();
    expect(playerOf(playTurn(world, { kind: 'wait' }, SHUTTERED)).hp).toBe(
      PLAYER_MAX_HP - CINDER.attack,
    );
  });

  it('misses when the player steps off it — and does not follow', () => {
    // The same world, one turn, a different decision. If the attack tracked the player rather than
    // the tile, this would deal exactly as much damage as waiting did, and "step off the marked
    // tile" — §2's reason movement is a combat action at all — would be worth nothing.
    const { world, marked } = situation();
    const after = playTurn(world, { kind: 'bump', to: { x: 1, y: 2 } }, SHUTTERED);

    expect(playerOf(after).at).toEqual({ x: 1, y: 2 });
    expect(playerOf(after).hp).toBe(PLAYER_MAX_HP);
    expect(marked).toEqual({ x: 1, y: 1 });
  });

  it('does not re-aim even when the player ends adjacent again — the two-move window', () => {
    /**
     * Found in review, and it is the case the three tests above provably cannot see.
     *
     * The unconditional reactive bug — "attack wherever the player now is" — is killed by the
     * step-off test. But the form a real author would write is guarded: retarget *only if the
     * player is still orthogonally adjacent*. In a one-move window that guard is never true, so
     * the mutant is identical to correct code: stepping one orthogonal tile off a marked tile
     * always lands at Manhattan distance 2 from the creature, since the other three neighbours of
     * the marked tile are diagonal to it.
     *
     * The window is two moves wide only on the free-action path, because a free command does not
     * charge the player, so the player acts again at the same instant before the creature
     * resolves. That is where the guarded mutant lands damage on a tile that was never marked.
     *
     *   #####
     *   #...#   t=0  free toggle: the Cinder wakes in light and declares an attack on (1,2)
     *   #@c.#   t=0  the player bumps to (1,1) — the toggle was free, so not charged
     *   #...#   t=1  the player bumps to (2,1), now adjacent to the Cinder again
     *   #####        the Cinder resolves its stale attack on (1,2) and hits nothing
     */
    const { world, ids, at } = scenario([
      '#####',
      '#...#',
      '#@c.#',
      '#...#',
      '#####',
    ]);

    // A free action: the creature wakes in light and declares, and the player is not charged.
    const woken = playTurn(world, { kind: 'free' }, FLOODLIT);
    expect(creatureById(woken, ids[0]).mind).toMatchObject({
      kind: 'awake',
      intent: { kind: 'attack', at: at('@') },
    });

    const stepped = playTurn(woken, { kind: 'bump', to: { x: 1, y: 1 } }, FLOODLIT);
    const after = playTurn(stepped, { kind: 'bump', to: { x: 2, y: 1 } }, FLOODLIT);

    // The player is orthogonally adjacent to the Cinder at (2,2) — the guarded mutant's condition
    // is satisfied — and must still be untouched, because (2,1) was never marked.
    expect(playerOf(after).at).toEqual({ x: 2, y: 1 });
    expect(playerOf(after).hp).toBe(PLAYER_MAX_HP);
  });

  it('is unchanged by the player attacking the creature that declared it', () => {
    // A wounded creature resolves the plan it made while unhurt. Anything else would make hitting
    // an enemy a way of changing its mind, which is reactivity wearing a friendlier hat.
    const { world, id } = situation();
    const after = playTurn(world, { kind: 'bump', to: { x: 2, y: 1 } }, SHUTTERED);

    expect(creatureById(after, id).hp).toBe(CINDER.maxHp - 3);
    expect(playerOf(after).hp).toBe(PLAYER_MAX_HP - CINDER.attack);
  });
});

describe('a committed move', () => {
  /**
   * ```
   * #######
   * #@....#     the Cinder is awake, three tiles east, and has declared a step to (4,1)
   * #.....#
   * #######
   * ```
   */
  function situation() {
    const built = scenario([
      '#######',
      '#@...c#',
      '#.....#',
      '#######',
    ]);
    return {
      ...built,
      world: allDueNow(awaken(built.world, built.ids[0], { kind: 'move', to: { x: 4, y: 1 } })),
    };
  }

  it('resolves identically whatever the player does first', () => {
    // Four very different commands — including walking right up to it, which is the one a reactive
    // creature would answer with an attack. All four leave it standing on the tile it committed to.
    const { world, ids } = situation();
    const commands = [
      { kind: 'wait' } as const,
      { kind: 'bump', to: { x: 2, y: 1 } } as const,
      { kind: 'bump', to: { x: 1, y: 2 } } as const,
      { kind: 'free' } as const,
    ];

    const outcomes = commands.map((command) => playTurn(world, command, FLOODLIT));

    for (const [index, after] of outcomes.entries()) {
      if (commands[index].kind === 'free') {
        // A free action costs no turn, so the creature has not acted at all yet.
        expect(creatureById(after, ids[0]).at).toEqual({ x: 5, y: 1 });
        continue;
      }
      expect(creatureById(after, ids[0]).at).toEqual({ x: 4, y: 1 });
      expect(playerOf(after).hp).toBe(PLAYER_MAX_HP);
    }
  });

  it('is spent for nothing when the player takes the tile first', () => {
    // §2 accepts that enemies can be baited: "baiting is skill expression, and a legible enemy you
    // can outwit beats a smart enemy you cannot read." The creature does not re-plan, and it does
    // not attack the player who is now standing where it wanted to be.
    const built = scenario(['#######', '#@.c..#', '#######']);
    const baited = allDueNow(awaken(built.world, built.ids[0], { kind: 'move', to: { x: 2, y: 1 } }));

    const after = playTurn(baited, { kind: 'bump', to: { x: 2, y: 1 } }, SHUTTERED);

    // The player took the tile first. The creature's move is blocked, it stays put, its turn is
    // gone — and, standing next to the player, it still does not swing this turn.
    expect(playerOf(after).at).toEqual({ x: 2, y: 1 });
    expect(creatureById(after, built.ids[0]).at).toEqual({ x: 3, y: 1 });
    expect(playerOf(after).hp).toBe(PLAYER_MAX_HP);

    // The price of the bait: it has now declared the attack, and next turn it lands.
    expect(creatureById(after, built.ids[0]).mind).toMatchObject({
      intent: { kind: 'attack', at: { x: 2, y: 1 } },
    });
    expect(playerOf(playTurn(after, { kind: 'wait' }, SHUTTERED)).hp).toBe(
      PLAYER_MAX_HP - CINDER.attack,
    );
  });
});

describe('waking is not acting', () => {
  it('gives a creature woken by light no turn in the turn it woke', () => {
    // §2 phase 3 runs before phase 4, so this is only true because waking schedules the creature at
    // `now + ACTION_COST`. Otherwise opening the shutter would wake a room *and* immediately hand
    // it a turn — the player would take damage on the turn they flashed, from an enemy whose
    // telegraph they never got to see.
    const { world, ids, at } = scenario(['#####', '#@c.#', '#####']);
    const flashed = playTurn(world, { kind: 'wait' }, FLOODLIT);

    expect(creatureById(flashed, ids[0]).mind).toMatchObject({
      kind: 'awake',
      intent: { kind: 'attack', at: at('@') },
    });
    expect(playerOf(flashed).hp).toBe(PLAYER_MAX_HP);

    // The declared attack lands on the following turn, which is the turn the player had to answer.
    const next = playTurn(flashed, { kind: 'wait' }, FLOODLIT);
    expect(playerOf(next).hp).toBe(PLAYER_MAX_HP - CINDER.attack);
  });

  it('gives a creature woken by a strike no turn in the turn it was struck', () => {
    // §3: a dormant target that survives wakes. It must not then hit back in the same turn — the
    // strike would cost HP it was supposed to save, and the whole point of stalking is that the
    // exchange is on the player's terms.
    const { world, ids, at } = scenario(['#####', '#@c.#', '#####']);
    const tough = {
      ...world,
      actors: world.actors.map((actor) =>
        actor.id === ids[0] ? { ...actor, hp: 20, maxHp: 20 } : actor,
      ),
    };

    const struck = playTurn(tough, { kind: 'bump', to: at('c') }, SHUTTERED);
    expect(creatureById(struck, ids[0]).mind.kind).toBe('awake');
    expect(playerOf(struck).hp).toBe(PLAYER_MAX_HP);

    const answered = playTurn(struck, { kind: 'wait' }, SHUTTERED);
    expect(playerOf(answered).hp).toBe(PLAYER_MAX_HP - CINDER.attack);
  });

  it('does not re-declare for a creature that is already awake and standing in the light', () => {
    // The subtlest way to lose the rule: waking is idempotent, but if it were not, a creature
    // standing in an open shutter's light would re-declare every single turn and be perfectly
    // reactive while every test about *waking* still passed.
    const { world, ids } = scenario(['#######', '#@...c#', '#######']);
    const committed = allDueNow(awaken(world, ids[0], { kind: 'move', to: { x: 4, y: 1 } }));
    const before = creatureById(committed, ids[0]).mind;

    // Phase 3 runs with the light on; the creature is already awake, so its plan must survive.
    const lit = playTurn(committed, { kind: 'free' }, FLOODLIT);
    expect(creatureById(lit, ids[0]).mind).toEqual(before);
  });
});
