import { describe, expect, it } from 'vitest';
import { DIRECTIONS, neighbourOf, runStates, type GameState } from '@/game/core';
import { isAlive, occupantAt, PLAYER_ID, playerOf } from '@/game/entities';
import { FLOOR, FLOOR_HEIGHT, FLOOR_WIDTH, inBounds } from '@/game/map';
import { canBump } from '@/game/systems';
import { scenarioState } from '@/tests/unit/support/presentation';
import { diveToTheBottom, standUntilDead } from '@/tests/unit/support/run-script';
import { presentScene } from './scene';
import { presentTaps, TAP_KINDS, tapAt, type TapAction, type TapInputs } from './taps';

/**
 * GDD §9's control scheme, asserted as rules rather than as one happy path.
 *
 * Two corpora, same split as `scene.test.ts`: hand-built situations where the point is a particular
 * arrangement (a wall to the north, a Cinder to the east), and real runs where the point is that
 * something holds everywhere. The real-run cross-check against `canBump` is the load-bearing one —
 * it is what makes "the tap targets are the legal moves" a property instead of a claim.
 */

const DIVE = diveToTheBottom('taps-dark', 3);
const DEATH = standUntilDead('grave', 3);
const CORPUS: readonly GameState[] = [
  ...runStates(DIVE.seed, DIVE.commands),
  ...runStates(DEATH.seed, DEATH.commands),
];

/** The situation §9 is written about: a wall north and south, a dormant Cinder east, floor west. */
function room(): readonly TapAction[] {
  const built = scenarioState(
    [
      '#####',
      '#...#',
      '#.@c#',
      '#.o.#',
      '#####',
    ],
    { shutter: 'open' },
  );
  return presentScene(built.state).taps;
}

function kindAt(taps: readonly TapAction[], x: number, y: number): TapAction['kind'] {
  return tapAt(taps, x, y).kind;
}

describe('the five kinds', () => {
  it('names every variant of the union, so a component switch can be checked', () => {
    // The same guard `CUE_KINDS` and `COMMAND_KINDS` use: a `Record` over the union has to list
    // every member, so a sixth kind (travel, in M2) breaks this line until it is added here.
    const keys: Record<TapAction['kind'], true> = {
      move: true,
      attack: true,
      wait: true,
      blocked: true,
      unbound: true,
    };
    expect([...TAP_KINDS].sort()).toEqual(Object.keys(keys).sort());
    expect(new Set(TAP_KINDS).size).toBe(TAP_KINDS.length);
  });
});

describe('§9, tile by tile', () => {
  it('makes your own tile `wait`', () => {
    // §9: "Tap your own tile to wait", and §9 again: it is NOT descend. A regression here reads as
    // a board where the player cannot pass a turn — which is how you die to a telegraph you could
    // have stepped away from, having tapped the one tile that should always work.
    expect(kindAt(room(), 2, 2)).toBe('wait');
  });

  it('makes a passable, empty neighbour `move`, carrying the direction that reaches it', () => {
    // `dir` is what the component passes to `move(run, dir)`. If it were computed the other way up
    // — north as +y — every tap would move the player the wrong way and every test that only
    // checked the *kind* would still pass.
    const taps = room();
    const west = tapAt(taps, 1, 2);
    const north = tapAt(taps, 2, 1);
    expect(west).toEqual({ kind: 'move', at: { x: 1, y: 2 }, dir: 'west' });
    expect(north).toEqual({ kind: 'move', at: { x: 2, y: 1 }, dir: 'north' });
  });

  it('makes an occupied neighbour `attack`, with the same direction a move would use', () => {
    // §3: there is no attack command. The kind exists so a component can *draw* the difference; the
    // intent it emits is identical, and this is the assertion that says so.
    expect(tapAt(room(), 3, 2)).toEqual({ kind: 'attack', at: { x: 3, y: 2 }, dir: 'east' });
  });

  it('makes an impassable neighbour `blocked` rather than a move that would be refused', () => {
    // THE §9 RULE: "an impassable neighbour is not a tap target". A pillar is the case that catches
    // a check written as `tile.kind === 'wall'` — it is passable-looking, mid-room, and stops you.
    expect(kindAt(room(), 2, 3)).toBe('blocked');

    const walled = scenarioState(['###', '#@#', '###'], { shutter: 'open' });
    const taps = presentScene(walled.state).taps;
    expect([kindAt(taps, 1, 0), kindAt(taps, 0, 1), kindAt(taps, 2, 1), kindAt(taps, 1, 2)]).toEqual(
      ['blocked', 'blocked', 'blocked', 'blocked'],
    );
  });

  it('leaves a diagonal unbound — adjacency is four tiles, not eight (§3)', () => {
    // `bump` throws on a non-orthogonal target, so a diagonal treated as adjacent would not be a
    // refusal but a crash in `step`. The input layer is the first of the two places that must know.
    expect(kindAt(room(), 3, 1)).toBe('unbound');
    expect(kindAt(room(), 1, 3)).toBe('unbound');
  });

  it('leaves a distant tile unbound, and `unbound` is not `blocked`', () => {
    // The distinction the whole design turns on. Both do nothing today; only one of them is a tile
    // the player aimed at and must be told about (§2), and only the other is where ADR-0009's
    // `travel(to)` lands in M2. Collapsing them is the simplification that costs both.
    const taps = room();
    expect(kindAt(taps, 1, 1)).toBe('unbound');
    expect(TAP_KINDS).toContain('blocked');
    expect(kindAt(taps, 1, 1)).not.toBe(kindAt(taps, 2, 3));
  });

  it('answers `unbound` for a coordinate that is not on the board at all', () => {
    // A hit test whose arithmetic has drifted must do nothing, not move the player somewhere they
    // did not aim. `cellAt` throws for this; a tap handler is the one caller where the safe answer
    // beats the loud one.
    expect(kindAt(room(), -1, 0)).toBe('unbound');
    expect(kindAt(room(), 999, 999)).toBe('unbound');
  });
});

describe('what every target carries', () => {
  it('gives every variant a position — ADR-0009’s constraint on this shape', () => {
    // The issue's requirement in one assertion: the tap handler must be able to produce a
    // `Position`, not only a `Direction`, so that `travel(run, to)` is a new case rather than a new
    // plumbing problem. `wait` and `blocked` carry no direction and must still carry `at`.
    for (const tap of room()) {
      expect(typeof tap.at.x, tap.kind).toBe('number');
      expect(typeof tap.at.y, tap.kind).toBe('number');
    }
    expect(tapAt(room(), 7, 7).at).toEqual({ x: 7, y: 7 });
  });

  it('lists the player’s tile first and then the four directions in sorted order', () => {
    // ADR-0004 applies here as much as in `game/`: the list must not be in whatever order a `Map`
    // or an `actors` array happened to yield. Nothing downstream should depend on it — which is
    // exactly why it is pinned here, where a change is visible.
    const open = scenarioState(['#####', '#...#', '#.@.#', '#...#', '#####'], { shutter: 'open' });
    const taps = presentScene(open.state).taps;
    expect(taps.map((tap) => tap.kind)).toEqual(['wait', 'move', 'move', 'move', 'move']);
    expect(taps.slice(1).map((tap) => ('dir' in tap ? tap.dir : null))).toEqual([...DIRECTIONS]);
  });

  it('omits a neighbour that is off the grid rather than inventing a blocked one', () => {
    // Not reachable on a generated floor — every floor is walled — but `presentTaps` takes a grid
    // and a position, and answering `blocked` for a tile that does not exist would put a target on
    // a cell no board has.
    const edge: TapInputs = {
      grid: { width: 2, height: 1, tiles: [FLOOR, FLOOR] },
      playerAt: { x: 0, y: 0 },
      occupied: new Set<number>(),
      running: true,
    };
    const taps = presentTaps(edge);
    expect(taps.map((tap) => tap.kind)).toEqual(['wait', 'move']);
    expect(tapAt(taps, 0, -1).kind).toBe('unbound');
  });
});

describe('a run that has ended', () => {
  it('offers no tap target at all, not even the self-tap', () => {
    // §13 refuses every command once the run is over. A board that still offered `wait` would be a
    // control that silently does nothing — the exact failure `hud.ts` refuses for the shutter.
    const dead = CORPUS.filter((state) => state.status.kind !== 'running');
    expect(dead.length).toBeGreaterThan(0);

    for (const state of dead) {
      const scene = presentScene(state);
      expect(scene.taps).toEqual([]);
      const at = playerOf(state.world).at;
      expect(tapAt(scene.taps, at.x, at.y).kind).toBe('unbound');
    }
  });
});

describe('over real runs, the targets are exactly the legal moves', () => {
  it('agrees with `canBump` on every neighbour of every state', () => {
    // THE CROSS-CHECK, and the reason this file is not just five scenarios. `canBump` is the
    // predicate `step` refuses on; if this layer's answer ever drifts from it — a new tile kind, a
    // changed adjacency rule — the screen starts offering moves the game refuses, or hiding moves it
    // would allow, and nothing else in the repo would notice.
    let moves = 0;
    let attacks = 0;
    let blocked = 0;

    for (const state of CORPUS) {
      if (state.status.kind !== 'running') continue;
      const world = state.world;
      const grid = world.floor.grid;
      const at = playerOf(world).at;
      const taps = presentScene(state).taps;

      for (const dir of DIRECTIONS) {
        const to = neighbourOf(at, dir);
        if (!inBounds(grid, to.x, to.y)) continue;
        const tap = tapAt(taps, to.x, to.y);
        const legal = canBump(world, PLAYER_ID, to);

        expect(tap.kind !== 'blocked', `(${to.x},${to.y}) ${tap.kind} vs canBump ${legal}`).toBe(
          legal,
        );

        const occupant = occupantAt(world, to);
        const living = occupant !== null && occupant.id !== PLAYER_ID && isAlive(occupant);
        if (legal) expect(tap.kind, `(${to.x},${to.y})`).toBe(living ? 'attack' : 'move');

        if (tap.kind === 'move') moves += 1;
        if (tap.kind === 'attack') attacks += 1;
        if (tap.kind === 'blocked') blocked += 1;
      }
    }

    // The guard. All three branches must actually occur, or the loop above proves only that the
    // corpus never met a wall.
    expect({ noMoves: moves === 0, noAttacks: attacks === 0, noWalls: blocked === 0 }).toEqual({
      noMoves: false,
      noAttacks: false,
      noWalls: false,
    });
  });

  it('is a board-sized answer: the same five tiles, wherever the player is', () => {
    // Two properties at once, over every state: the target list never grows past §9's five, and the
    // self-tap is always the player's own tile. A tap plan that drifted off the player — by using a
    // stale position, say — would still be five entries and would move the player from nowhere.
    for (const state of CORPUS) {
      if (state.status.kind !== 'running') continue;
      const scene = presentScene(state);
      const at = playerOf(state.world).at;
      expect(scene.taps.length).toBeLessThanOrEqual(5);
      expect(tapAt(scene.taps, at.x, at.y).kind).toBe('wait');
      expect(scene.grid.width).toBe(FLOOR_WIDTH);
      expect(scene.grid.height).toBe(FLOOR_HEIGHT);
    }
  });
});
