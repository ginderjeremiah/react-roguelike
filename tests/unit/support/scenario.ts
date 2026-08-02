/**
 * Hand-built floors for entity and combat tests, written as ASCII.
 *
 * ```ts
 * const { world, ids } = scenario([
 *   '#####',
 *   '#@.c#',
 *   '#####',
 * ]);
 * ```
 *
 * ## Why not just generate a floor
 *
 * Both, for different jobs. A rule — "a dormant strike deals double damage", "a blocked move spends
 * the turn" — is a statement about a *situation*, and the situation has to be constructible in one
 * screenful or the test stops being readable and starts being a puzzle. Generated floors are used
 * where the point is that something holds over the whole space of floors (`floorplay.test.ts`), and
 * they cannot be used to set up a Cinder at exactly two tiles from the player behind a pillar.
 *
 * This lives under `tests/` rather than in `game/` on purpose: it is not production code, and a
 * scenario builder sitting in `game/entities/` would be dead weight that the next session has to
 * work out is dead.
 *
 * The `Floor` it produces is **partial by design** — no rooms, no doorway list, no merge. Nothing
 * in `game/entities/` or the combat rules reads those; they exist for level generation and for
 * placement. If something here ever starts reading them, this builder should start filling them in
 * rather than growing a special case. `caches` **is** filled in, because phase 5 reads it.
 */

import {
  CACHE,
  DOORWAY,
  ENTRANCE,
  FLOOR,
  NO_MERGE,
  PILLAR,
  STAIRS,
  WALL,
  type CreatureSpawn,
  type Floor,
  type Grid,
  type Position,
  type Tile,
} from '@/game/map';
import {
  createActorWorld,
  creatureById,
  creatureIdAt,
  PLAYER_ID,
  withActor,
  type ActorWorld,
  type Intent,
  type LightQuery,
} from '@/game/entities';
import {
  ACTION_COST,
  actorPhase,
  addActor,
  bump,
  chargeActor,
  hasActor,
  reschedule,
  resolveDeaths,
  resolveTurn,
  wakeInLight,
  type ActorId,
  type TurnCost,
} from '@/game/systems';

/** What each character means. Creature glyphs follow GDD §6: `c` dormant, `C` awake. */
const TERRAIN: Record<string, Tile> = {
  '#': WALL,
  '.': FLOOR,
  o: PILLAR,
  '+': DOORWAY,
  '>': STAIRS,
  '♦': CACHE,
  '@': ENTRANCE,
  c: FLOOR,
  C: FLOOR,
};

export type Scenario = {
  readonly world: ActorWorld;
  /** Creature ids in the order they appear row-major, which is the order ids are assigned in. */
  readonly ids: readonly ActorId[];
  /** Where each character sits, for asserting against a tile rather than a literal pair. */
  readonly at: (glyph: string) => Position;
};

/**
 * Build a world from an ASCII map. Exactly one `@` (the player); any number of `c`/`C`.
 *
 * Creatures start dormant, as they do on a real floor; a `C` is woken afterwards with a declared
 * wait, so a test that needs a specific intent says so explicitly rather than inheriting one.
 */
export function scenario(lines: readonly string[]): Scenario {
  const height = lines.length;
  const width = lines[0]?.length ?? 0;
  for (const line of lines) {
    if (line.length !== width) throw new Error(`scenario: ragged map row "${line}"`);
  }

  const tiles: Tile[] = [];
  const spawns: CreatureSpawn[] = [];
  const caches: Position[] = [];
  const awake: number[] = [];
  let entrance: Position | null = null;
  let stairs: Position | null = null;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const glyph = lines[y][x];
      const tile = TERRAIN[glyph];
      if (tile === undefined) throw new Error(`scenario: unknown glyph "${glyph}"`);
      tiles.push(tile);
      if (glyph === '@') entrance = { x, y };
      if (glyph === '>') stairs = { x, y };
      // Row-major by construction, which is the order `generateFloor` sorts its list into. This
      // list used to be left empty while the grid held `cache` tiles, so every test that wanted a
      // real cache had to rebuild the floor by hand — and `generate.test.ts` asserts of a *real*
      // floor that the two agree, so leaving them disagreeing here made scenarios a shape the game
      // cannot produce.
      if (glyph === '♦') caches.push({ x, y });
      if (glyph === 'c' || glyph === 'C') {
        if (glyph === 'C') awake.push(spawns.length);
        spawns.push({ kind: 'cinder', at: { x, y } });
      }
    }
  }

  if (entrance === null) throw new Error('scenario: no player (@) on the map');

  const grid: Grid = { width, height, tiles };
  const floor: Floor = {
    floorNumber: 1,
    grid,
    rooms: [],
    doorways: [],
    merge: NO_MERGE,
    entrance,
    stairs: stairs ?? entrance,
    caches,
    creatures: spawns,
  };

  let world = createActorWorld(floor);
  for (const index of awake) world = awaken(world, creatureIdAt(index), { kind: 'wait' });

  return {
    world,
    ids: spawns.map((_, index) => creatureIdAt(index)),
    at: (glyph) => {
      for (let y = 0; y < height; y += 1) {
        const x = lines[y].indexOf(glyph);
        if (x >= 0) return { x, y };
      }
      throw new Error(`scenario: no "${glyph}" on the map`);
    },
  };
}

/**
 * Wake a creature with a specific declared intent, joining the schedule for next turn — the state a
 * creature is in after `wakeCreature`, but with the intent chosen by the test rather than by the
 * behaviour rules.
 *
 * Deliberately *not* built on `wakeCreature`: a test for what happens when an attack on tile X
 * resolves must be able to state "it declared an attack on X" without the behaviour that would have
 * chosen X being part of the setup, or the test passes for the wrong reason when that behaviour
 * changes.
 */
export function awaken(
  world: ActorWorld,
  id: ActorId,
  intent: Intent,
  turnsSinceContact = 0,
): ActorWorld {
  const creature = creatureById(world, id);
  const updated = withActor(world, {
    ...creature,
    mind: { kind: 'awake', intent, turnsSinceContact },
  });
  if (hasActor(updated.schedule, id)) return updated;
  return {
    ...updated,
    schedule: addActor(updated.schedule, id, updated.schedule.now + ACTION_COST),
  };
}

/**
 * Make every creature due now, so a single `actorPhase` gives all of them a turn.
 *
 * Goes through `reschedule` rather than rewriting `entries`, so the queue stays in its canonical
 * `(nextActAt, actorId)` order — a hand-built schedule that is merely *nearly* canonical would make
 * `peek` return the wrong actor and quietly test a different ordering than the game uses.
 */
export function allDueNow(world: ActorWorld): ActorWorld {
  let schedule = world.schedule;
  for (const entry of [...schedule.entries]) {
    if (entry.actorId === PLAYER_ID) continue;
    schedule = reschedule(schedule, entry.actorId, schedule.now);
  }
  return { ...world, schedule };
}

/**
 * What the player did this turn. A stand-in for #18's `Command` union — deliberately the smallest
 * thing that exercises all three shapes a command can have: one that costs a turn and touches the
 * world, one that costs a turn and does not, and one that is free (§2: the shutter toggle).
 */
export type PlayerAction =
  | { readonly kind: 'wait' }
  | { readonly kind: 'bump'; readonly to: Position }
  | { readonly kind: 'free' };

/**
 * One whole turn, wired the way `step()` is expected to be wired (see the header of
 * `game/systems/turn.ts` and the sketch in `game/systems/index.ts`).
 *
 * Fuel and dark adaptation are `identity` **here, at the call site**, because #17 and #14 own them —
 * the same discipline `turn.ts` used when it refused to stub them internally. Everything else is the
 * real thing, in the real GDD §2 order, so a test that drives this is testing the game's turn and
 * not a convenient approximation of it.
 */
export function playTurn(
  world: ActorWorld,
  action: PlayerAction,
  light: LightQuery,
): ActorWorld {
  const identity = (current: ActorWorld): ActorWorld => current;
  const cost: TurnCost = action.kind === 'free' ? 'free' : 'costsATurn';

  return resolveTurn(world, {
    command: (current) => {
      if (action.kind === 'free') return current;
      // Charged before the action resolves, exactly as `runActorPhase` charges a creature before
      // its action resolves — so a kill made by this action stays out of the queue.
      const charged = { ...current, schedule: chargeActor(current.schedule, PLAYER_ID) };
      return action.kind === 'wait' ? charged : bump(charged, PLAYER_ID, action.to, light);
    },
    fuelBurn: identity,
    lightingAndWaking: (current) => wakeInLight(current, light),
    actors: actorPhase(cost, light),
    deaths: resolveDeaths,
    darkAdaptation: identity,
  });
}

/** The shutter is closed: no tile sees the lantern. GDD §4's dark column. */
export const SHUTTERED: LightQuery = { isPlayerLightVisibleFrom: () => false };

/** The shutter is open and the whole floor is lit. The crudest possible "light exists". */
export const FLOODLIT: LightQuery = { isPlayerLightVisibleFrom: () => true };

/** Light on exactly these tiles — for testing the edge of contact without a lighting model. */
export function litTiles(positions: readonly Position[]): LightQuery {
  return {
    isPlayerLightVisibleFrom: (at) =>
      positions.some((position) => position.x === at.x && position.y === at.y),
  };
}
