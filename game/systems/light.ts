/**
 * Where the lantern meets the floor: the real `Perception`, and five of GDD §2's six phases.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE REAL `Perception`, AND WHY IT IS THE PLAYER'S LIT FIELD READ BACKWARDS
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `game/entities/perception.ts` asks one question — *"is the player's lantern-light visible from
 * this tile?"* — and refuses to answer it, because what "visible" means is a lighting decision. This
 * is the answer:
 *
 *     shuttered  ->  false, from everywhere. Darkness is the mechanic; a query that said otherwise
 *                    would delete the game's central decision rather than change a number.
 *     open       ->  the tile is in `computeLitField(grid, playerAt)` — GDD §4's Chebyshev radius 4,
 *                    line-of-sight blocked by walls and pillars.
 *
 * **The second line is only correct because `game/fov/shadowcast.ts` is symmetric**, and that is not
 * an incidental property — it is why that variant was chosen (see its header, and the FOV journal
 * entry). The lit field is computed from the *player's* eye; the question asked here is from the
 * *creature's*. Those are the same set only if visibility is symmetric. Under the classic Bergström
 * shadowcaster they are not, and the difference is exactly the bug this repo's journal format warns
 * about in its example: a creature that sees the player through a wall the player cannot see
 * through. `light.test.ts` asserts the two directions agree over every passable pair on generated
 * floors, so a future "generous FOV" tweak fails here rather than in play.
 *
 * The field is computed **once** and closed over, not recomputed per call. The query is asked a
 * variable number of times per turn (once per creature that declares, plus once per sleeper in
 * `wakeInLight`), and `perception.ts` requires it to be pure and total — so it must not be
 * expensive, and it must never consume a random number.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## The free action: which of the six phases a shutter toggle runs
 *
 * §2: "Toggling the shutter is a free action — it does not consume a turn." `turn.ts` settled one
 * phase and explicitly left two to #17. All four answers below are read off the GDD rather than
 * chosen, because each one is worth fuel or tempo to the player.
 *
 *   - **Phase 4, actors: SKIPPED.** `turn.ts` and `actors.ts` both explain this at length — a free
 *     command that merely declines to charge itself still gets charged by phase 4 and hands every
 *     creature on the floor a free turn. This is what "does not consume a turn" *means*.
 *   - **Phase 2, fuel: RUNS.** §2 lists the burn as part of resolving one player *command*, and §4's
 *     exploration arithmetic depends on it: "One lit turn inside a 5×4 or 5×5 room reveals the
 *     entire room ... **for 4 fuel** ... Feeling the same room out by touch is 10-15 turns at 1 fuel
 *     each ... Light is roughly **three times cheaper in fuel** ... Neither dominates, and the
 *     reason is arithmetic rather than a special rule." A shutter that could be opened, read, and
 *     shut for nothing makes light *infinitely* cheaper than touch and deletes that arithmetic —
 *     light would simply dominate exploring. So a flash costs its 4. `turn.ts` guessed the same:
 *     "the shutter toggle plausibly should still burn the turn's fuel."
 *
 *     This is **not** the fuel tax §4 rules out. §4 says the *brake on strobing* is not a fuel tax,
 *     and it is not: there is no surcharge for toggling. The lantern simply burns at the rate the
 *     shutter is set to, every time it is asked what it costs.
 *   - **Phase 6, dark adaptation: SKIPPED.** §4: ember-sense "recovers **+1 per turn**". A free
 *     action is not a turn, and if it ticked, `shutter -> toggle -> toggle` would buy ramp progress
 *     without spending turns. §4 builds the tensest state in the game out of those four turns.
 *   - **Phase 3, lighting and waking: RUNS.** Non-negotiable, and the point of the whole issue:
 *     opening the shutter wakes every dormant creature in the lit radius *immediately*, and they
 *     declare there and then. A toggle whose light arrived a command later would make "flash and
 *     deal with what you woke" unreadable.
 *
 * So the shape of it: **a free action resolves and is paid for; it just does not hand the floor a
 * turn.** Free of tempo, not free of consequence (§2).
 *
 * A consequence already recorded in the journal, restated because it lives here now: a creature
 * woken *during* a free action sees two player commands before its declared action resolves. That is
 * more conservative than §2 requires and is legible in play.
 */

import { CACHE_FUEL } from '../content';
import { assertNever } from '../core/assert';
import {
  createActorWorld,
  playerOf,
  type ActorWorld,
  type Perception as LightQuery,
} from '../entities';
import {
  adaptVision,
  computeLitField,
  hasTile,
  perceive,
  remember,
  type ShutterState,
  type TileSet,
} from '../fov';
import {
  FLOOR,
  samePosition,
  tileAt,
  tileIndex,
  type Floor,
  type Grid,
  type Position,
} from '../map';
import { actorPhase, wakeInLight, type TurnCost } from './actors';
import { resolveDeaths } from './combat';
import { burn, createLantern, refuel, toggleShutter, type Lantern } from './lantern';
import { resolveTurn, type TurnPhase, type TurnPhases } from './turn';

/**
 * A floor, everyone on it, and the lantern lighting it.
 *
 * The pair rather than one flat record, because the two halves have different owners and different
 * lifetimes: `ActorWorld` is `game/entities/`, `Lantern` is this directory, and #18 embeds the pair
 * into `GameState` without either learning about the other. Plain JSON-shaped data throughout.
 */
export type LanternWorld = {
  readonly world: ActorWorld;
  readonly lantern: Lantern;
};

/**
 * A floor at the moment the player arrives on it: everything dormant, nothing seen, a full lantern.
 *
 * `shutter` has no default — §4 never says which way the shutter starts a run, and `createVision`
 * and `createLantern` both refuse to guess for the same reason. `fuel` does, because §4 does say.
 */
export function createLanternWorld(
  floor: Floor,
  shutter: ShutterState,
  fuel?: number,
): LanternWorld {
  return {
    world: createActorWorld(floor),
    lantern: createLantern(floor.grid, shutter, fuel),
  };
}

/** The same state with a new world. One place, so a phase cannot drop the lantern by accident. */
function withWorld(state: LanternWorld, world: ActorWorld): LanternWorld {
  return { world, lantern: state.lantern };
}

/** The same state with a new lantern. */
function withLantern(state: LanternWorld, lantern: Lantern): LanternWorld {
  return { world: state.world, lantern };
}

/**
 * The shuttered answer: nothing sees the lantern, from anywhere.
 *
 * A shared immutable value — the query holds no state, so there is nothing to alias.
 */
const DARK: LightQuery = { isPlayerLightVisibleFrom: () => false };

/**
 * The real `Perception` (`game/entities/`), built from the lit field. See the header.
 *
 * @param origin the player's tile. Passed rather than read from a world so that this can be asked
 *   about a hypothetical position — which is what the symmetry test does.
 */
export function lanternLight(grid: Grid, lantern: Lantern, origin: Position): LightQuery {
  switch (lantern.vision.shutter) {
    case 'shuttered':
      return DARK;
    case 'open':
      return litQuery(computeLitField(grid, origin));
    default:
      return assertNever(lantern.vision.shutter, 'lanternLight');
  }
}

/** A query over an already-computed lit field. The field is closed over, never recomputed. */
function litQuery(lit: TileSet): LightQuery {
  return { isPlayerLightVisibleFrom: (at) => hasTile(lit, at.x, at.y) };
}

/** The lighting as it stands in this state. What phases 1, 3 and 4 each ask, at their own moment. */
export function lightOf(state: LanternWorld): LightQuery {
  return lanternLight(state.world.floor.grid, state.lantern, playerOf(state.world).at);
}

// --- phase 2: fuel ------------------------------------------------------------------------------

/**
 * GDD §2 phase 2: "Fuel burns at the current shutter rate."
 *
 * Runs on **every** command, including a free one — a flash costs its 4 fuel (§4). See the header.
 */
export function burnFuelPhase(state: LanternWorld): LanternWorld {
  return withLantern(state, burn(state.lantern));
}

// --- phase 3: lighting and waking ---------------------------------------------------------------

/**
 * GDD §2 phase 3: "Lighting and vision recompute. Any dormant creature now inside the lit radius
 * **wakes** and immediately declares."
 *
 * Two things happen and only one of them is visible in the state:
 *
 *   - **Terrain memory grows.** `perceive` resolves §4's vision table for this turn — the lit field
 *     with the shutter open, the 8 touchable tiles with it shut — and `remember` folds it in.
 *     Memory is the *only* part of perception that is stored; the creature list and the lit field
 *     itself are recomputed by whoever needs them, because a second copy can disagree with the
 *     first (`fov/vision.ts`).
 *   - **Sleepers wake.** `wakeInLight` asks the injected light query and nothing else — light wakes
 *     things, proximity does not, or the dormant strike would not exist.
 *
 * **`perceive` is handed no creatures on purpose.** Its creature half is the renderer's business and
 * is recomputed there; nothing in the simulation reads it, so passing the real list would be a
 * computation whose result is discarded — and mutation testing confirmed exactly that: filtering
 * that list by `isAlive` or not made no difference to any test, because there was no observable to
 * make a difference to. An unkillable line is a line that should not exist.
 *
 * Runs on a free action too, and must: opening the shutter waking the room *immediately* is what
 * makes the toggle expensive without costing a turn.
 */
export function lightingAndWakingPhase(state: LanternWorld): LanternWorld {
  const world = state.world;
  const grid = world.floor.grid;
  const origin = playerOf(world).at;

  const vision = remember(state.lantern.vision, perceive(grid, state.lantern.vision, origin, []).terrain);
  const lantern = { fuel: state.lantern.fuel, vision };

  // Built from `lantern` rather than `state.lantern` so that a shutter opened by this turn's command
  // wakes the room this turn. The two differ only in `remembered`, which `lanternLight` does not
  // read, so this is an equivalent mutant and a mutation run will not kill it — noted so a later run
  // does not spend time re-deriving that. It is written this way because the next thing to enter
  // `Vision` may well be something the query does read.
  const light = lanternLight(grid, lantern, origin);
  return { world: wakeInLight(world, light), lantern };
}

// --- phase 5: deaths, embers, caches ------------------------------------------------------------

/**
 * Everything on the player's tile that is fuel, taken.
 *
 * §2 phase 5: "Deaths resolve; embers drop and are collected by walking over them." §4 adds the
 * other source: "ember caches in the level". Both are collected the same way — by being
 * stood on — so they are collected in the same place.
 *
 * **A collected cache stops being a cache.** The tile becomes floor and the position leaves
 * `floor.caches`, rather than being tracked in a parallel "already taken" list somewhere in run
 * state. A second source of truth about what is on a tile is the thing this codebase keeps refusing
 * (`fov/vision.ts` on why the lit field is not stored), and every consumer — the renderer, terrain
 * memory, `perceive` — reads the grid. The cost is rebuilding a 165-entry array on the handful of
 * turns a cache is taken.
 *
 * Order between the two sources cannot matter — they are disjoint and the gains are summed — so
 * there is no sort here and nothing for a sort to fix.
 */
export function collectFuelUnderfoot(state: LanternWorld): LanternWorld {
  const at = playerOf(state.world).at;
  const embers = state.world.embers.filter((drop) => samePosition(drop.at, at));
  const cache = tileAt(state.world.floor.grid, at.x, at.y).kind === 'cache';
  if (embers.length === 0 && !cache) return state;

  let gained = 0;
  for (const drop of embers) gained += drop.amount;
  if (cache) gained += CACHE_FUEL;

  const world = cache ? withCacheTaken(state.world, at) : state.world;
  return {
    world: {
      ...world,
      embers: world.embers.filter((drop) => !samePosition(drop.at, at)),
    },
    lantern: refuel(state.lantern, gained),
  };
}

/** Replace a cache tile with floor and drop it from the floor's cache list. */
function withCacheTaken(world: ActorWorld, at: Position): ActorWorld {
  const grid = world.floor.grid;
  const tiles = grid.tiles.slice();
  tiles[tileIndex(grid, at.x, at.y)] = FLOOR;
  return {
    ...world,
    floor: {
      ...world.floor,
      grid: { width: grid.width, height: grid.height, tiles },
      caches: world.floor.caches.filter((cache) => !samePosition(cache, at)),
    },
  };
}

/**
 * GDD §2 phase 5, whole: bodies leave the world and drop their ember, then the player picks up
 * whatever they are standing on.
 *
 * Deaths first, so an ember dropped this turn is collectable this turn. That case is currently
 * unreachable — a creature dies on its own tile and two living actors never share one — but the
 * order is the one that stays right if a shove, a swap or a death-on-your-tile effect ever exists,
 * and the reverse order would fail silently rather than loudly.
 *
 * **Swapping the two is therefore an equivalent mutant today** and a mutation run will not kill it.
 * Confirmed, and written down here so a later run does not re-investigate. A test that could kill it
 * would have to construct a state the rules cannot produce, which would be a test of the test.
 */
export function deathsAndCollectionPhase(state: LanternWorld): LanternWorld {
  return collectFuelUnderfoot(withWorld(state, resolveDeaths(state.world)));
}

// --- phase 6: dark adaptation -------------------------------------------------------------------

/**
 * GDD §2 phase 6 / §4: ember-sense recovers +1 per turn, back to 5, while shuttered.
 *
 * Runs on a turn, not on a free action — see the header for why that one is not cosmetic.
 */
export function darkAdaptationPhase(state: LanternWorld): LanternWorld {
  return withLantern(state, {
    fuel: state.lantern.fuel,
    vision: adaptVision(state.lantern.vision),
  });
}

// --- the whole turn -----------------------------------------------------------------------------

/**
 * The five phases this directory owns, plus the caller's command phase, in GDD §2 order.
 *
 * `cost` is explicit and has no default, exactly as `actorPhase`'s is: #18 cannot wire a command
 * without saying whether it costs a turn, and getting it wrong is a failing test rather than a
 * player who silently loses a turn every time they touch the shutter.
 *
 * The command phase belongs to the caller because the `Command` union does (`game/core/`, #18). Its
 * only obligation is the one `actors.ts` states: **a command that costs a turn must charge the
 * player**, or phase 4 throws.
 */
export function lanternPhases(
  cost: TurnCost,
  command: TurnPhase<LanternWorld>,
): TurnPhases<LanternWorld> {
  return {
    command,
    // Runs on a free action too: §4 prices a flash at 4 fuel. See the header.
    fuelBurn: burnFuelPhase,
    lightingAndWaking: lightingAndWakingPhase,
    actors: actorsPhase(cost),
    deaths: deathsAndCollectionPhase,
    darkAdaptation: perTurn(cost, darkAdaptationPhase),
  };
}

/** A phase that happens once per *turn*, and therefore not at all on a free action. */
function perTurn(cost: TurnCost, phase: TurnPhase<LanternWorld>): TurnPhase<LanternWorld> {
  switch (cost) {
    case 'free':
      return (state) => state;
    case 'costsATurn':
      return phase;
    default:
      return assertNever(cost, 'perTurn');
  }
}

/**
 * Phase 4, lifted to a `LanternWorld`.
 *
 * The light query is built **inside** the phase rather than passed in, so creatures declare against
 * the lighting phase 3 just recomputed rather than against the lighting the turn started with. The
 * free case still goes through `actorPhase`, which is the one function allowed to know what a free
 * action does to the schedule.
 */
function actorsPhase(cost: TurnCost): TurnPhase<LanternWorld> {
  return (state) => withWorld(state, actorPhase(cost, lightOf(state))(state.world));
}

/**
 * The player's half of a shutter toggle: flip it, charge nobody, take no turn.
 *
 * Refused when dry (§4), and a refusal is still a legal, free, no-op turn — the player pressed the
 * button and the lantern had nothing to give.
 */
export function toggleShutterCommand(state: LanternWorld): LanternWorld {
  return withLantern(state, toggleShutter(state.lantern));
}

/**
 * The whole shutter toggle, as one resolved turn.
 *
 * Shipped as a function rather than as instructions, because "free" is a property of *this command*
 * and not of the call site: there is no parameter here for #18 to get wrong. The wrong wiring costs
 * the player a turn **and** hands every creature on the floor a free one (`turn.test.ts`).
 */
export function toggleShutterTurn(state: LanternWorld): LanternWorld {
  return resolveTurn(state, lanternPhases('free', toggleShutterCommand));
}
