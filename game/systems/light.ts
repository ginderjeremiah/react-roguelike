/**
 * Where the lantern meets the floor: the real `LightQuery`, and five of GDD §2's six phases.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * `LightQuery`, AND WHY IT IS THE PLAYER'S LIT FIELD READ BACKWARDS
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * One question — *"is the player's lantern-light visible from this tile?"* — with one answer:
 *
 *     shuttered  ->  false, from everywhere. Darkness is the mechanic; a query that said otherwise
 *                    would delete the game's central decision rather than change a number.
 *     open       ->  the tile is in `computeLitField(grid, playerAt)` — GDD §4's Chebyshev radius 4,
 *                    line-of-sight blocked by walls and pillars.
 *
 * **The type used to live in `game/entities/contact.ts`, injected**, because the entity layer needed
 * to know whether a creature could see the lantern and refused to decide what "see" meant. #123
 * deleted the rule that asked — the eight-turn re-dormancy clock — and with it the last consumer in
 * `game/entities/`, so both the question and its answer live here now. **That is a simplification
 * and not a layering regression**: the one remaining reader is §2 phase 3's waking (`wakeInLight`),
 * which is this directory's own rule and always resolved light from the lit radius rather than from
 * the deleted `hasContact`.
 *
 * **The `open` line is only correct because `game/fov/shadowcast.ts` is symmetric**, and that is not
 * an incidental property — it is why that variant was chosen (see its header, and the FOV journal
 * entry). The lit field is computed from the *player's* eye; the question asked here is from the
 * *creature's*. Those are the same set only if visibility is symmetric. Under the classic Bergström
 * shadowcaster they are not, and the difference is exactly the bug this repo's journal format warns
 * about in its example: a creature that sees the player through a wall the player cannot see
 * through. `light.test.ts` asserts the two directions agree over every passable pair on generated
 * floors, so a future "generous FOV" tweak fails here rather than in play.
 *
 * The field is computed **once** and closed over, not recomputed per call. The query is asked once
 * per sleeper per turn in `wakeInLight`, so it must not be expensive — and it **must never consume a
 * random number**, because it is asked a variable number of times per turn and a query with a side
 * effect would make the run depend on how many creatures happened to be asleep.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## The free action: which of the six phases a shutter command runs
 *
 * §2: "Toggling the shutter is a free action — it does not consume a turn", now settled as the list
 * "a free action runs 1, 2, 3 and 5 and skips 4 and 6". All four answers below are read off the GDD
 * rather than chosen, because each one is worth fuel or tempo to the player.
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
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT A FREE ACTION DOES *NOT* BUY, AND THE PARAGRAPH THAT USED TO SAY OTHERWISE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A creature woken by a free action resolves its declared action in phase 4 of the **next paid
 * command** — the same as one woken by a paid command. Skipping phase 4 costs the floor a turn; it
 * does not hand the player an extra one. That falls out of the scheduling rule and needs no case
 * here: `setMind` joins a woken creature at the instant the **player** is next due to act, and a
 * command the player was not charged for leaves the player due at `now` (ADR-0014, §2 phase 3).
 *
 * **This header used to say the opposite, and it said it for three milestones:** *"a creature woken
 * during a free action sees two player commands before its declared action resolves. That is more
 * conservative than §2 requires and is legible in play."* It was an accurate description of the
 * build and a wrong reading of the rule. **More conservative** priced the extra command as safety
 * margin, when §4 prices a wake in HP and the margin *is* the price — two commands is two strikes,
 * and two strikes is exactly a 5 HP Cinder, so 56 of `STALKER`'s 386 woken kills cost nothing
 * (#125). The sentence sat here and in GDD §2 and nobody multiplied it by §3's damage. §2 marks it
 * **do not restore**; it is recorded rather than deleted because a wrong sentence that survived
 * three milestones is worth being able to recognise.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

import { CACHE_FUEL } from '../content';
import { assertNever } from '../core/assert';
import { createActorWorld, PLAYER_ID, playerOf, type ActorWorld } from '../entities';
import {
  adaptVision,
  computeLitField,
  hasBeenLit,
  hasTile,
  perceive,
  rememberPerception,
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
import { actorPhase, isRunOver, wakeInLight, type TurnCost } from './actors';
import { bump, resolveDeaths } from './combat';
import { burn, createLantern, refuel, setLanternShutter, type Lantern } from './lantern';
import { chargeActor } from './schedule';
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
 * `shutter` has no default — §4 says a *run* starts open (`game/systems/run.ts` owns that), but a
 * floor is arrived on seven more times after that and the answer there is "whatever you were
 * carrying". `fuel` does have one, because §4 gives it.
 *
 * **This is not the whole of arriving.** §13's carries — fuel, shutter, sense radius, HP + 2 — and
 * §4's "the entrance room is already perceived" both live in `run.ts`. This is the empty floor
 * underneath them.
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
 * What §2 phase 3 can learn about the player's lantern, as one boolean question.
 *
 * Named for what it is — a *query*, not a lighting model — because `wakeInLight` takes it as an
 * argument rather than computing it: the rule ("every dormant creature in the lit radius wakes") and
 * the lighting it is resolved against are separate concerns, and a test can hand the rule a
 * floodlit, shuttered or hand-drawn field without building a `Vision`.
 *
 * ## What an implementation must guarantee
 *
 *   - **Pure.** Same tile, same answer, no state of its own, **no draws from the RNG**. It is called
 *     a variable number of times per turn (once per sleeper), so a query with a side effect —
 *     including consuming a random number — would make the run depend on how many creatures happened
 *     to be asleep.
 *   - **Total.** Any in-bounds tile is a legal question, including one the player cannot see.
 */
export type LightQuery = {
  /**
   * Is the player's light visible from `at`? `false` whenever the shutter is closed — darkness is
   * the whole point of the mechanic, so a query that answered `true` while shuttered would delete
   * the game's central decision rather than change a number.
   */
  readonly isPlayerLightVisibleFrom: (at: Position) => boolean;
};

/**
 * The shuttered answer: nothing sees the lantern, from anywhere.
 *
 * A shared immutable value — the query holds no state, so there is nothing to alias.
 */
const DARK: LightQuery = { isPlayerLightVisibleFrom: () => false };

/**
 * The real `LightQuery`, built from the lit field. See the header.
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

/** The lighting as it stands in this state. Phase 3's question, asked at phase 3's moment. */
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
 *     with the shutter open, the 8 touchable tiles with it shut — and `rememberPerception` folds it
 *     in. Memory is the *only* part of a `TurnPerception` that is stored; the creature list and the
 *     lit field itself are recomputed by whoever needs them, because a second copy can disagree
 *     with the first (`fov/vision.ts`).
 *
 *     **Two planes grow, not one, and only one of them grows in the dark.** `remembered` takes
 *     whatever was perceived; `revealed` takes it only under light, which is §4's cache rule
 *     (#31/#41). The branch is `rememberPerception`'s and not this function's on purpose: it reads
 *     `perception.terrainFrom`, so the shutter is consulted once, by `perceive`, rather than twice.
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

  const vision = rememberPerception(
    state.lantern.vision,
    perceive(grid, state.lantern.vision, origin, []),
  );
  const lantern = { fuel: state.lantern.fuel, vision };

  // Built from `lantern` rather than `state.lantern` so that a shutter opened by this turn's command
  // wakes the room this turn. The two differ only in `remembered` and `revealed`, neither of which
  // `lanternLight` reads, so this is an equivalent mutant and a mutation run will not kill it —
  // noted so a later run does not spend time re-deriving that. It is written this way because the
  // next thing to enter `Vision` may well be something the query does read.
  const light = lanternLight(grid, lantern, origin);
  return { world: wakeInLight(world, light), lantern };
}

// --- phase 5: deaths, embers, caches ------------------------------------------------------------

/**
 * Everything on the player's tile that is fuel **and that the player can take**, taken.
 *
 * §2 phase 5: "Deaths resolve; embers drop and are collected by walking over them." §4 adds the
 * other source: "ember caches in the level". Both are collected the same way — by being
 * stood on — so they are collected in the same place.
 *
 * ## One predicate, one plane, both sources (§4, *The dark can take nothing*, ruled 2026-08-04)
 *
 * **The dark can take nothing.** Fuel is taken only from a tile the lantern has lit — `hasBeenLit`
 * over `Vision.revealed` — and standing on an unlit cache *or an unlit drop* in the dark does
 * nothing at all: no fuel, no cue, and the tile is untouched, so both are still there to be found
 * later. That is what makes the fuel left in the lantern a number of turns to reach a destination
 * rather than a countdown to nothing.
 *
 * **Ever lit, not currently lit.** The tile stays yours once the lantern has shown it to you; a drop
 * on ground you flashed ten turns ago pays the moment you stand on it, with the shutter shut. The
 * stricter reading would also manufacture an autopilot, since the shutter is free and §2 runs phase
 * 5 on a free action, so `open`-`shut` **while standing on the tile** would buy the pickup for 4 fuel
 * and no *further* turns. Be exact about that scope, because it is easy to over-read: phase 5 pays
 * **underfoot** — `samePosition(drop.at, at)`, below — so flashing *beside* a drop pays nothing and
 * only makes it takeable. The turn spent stepping onto the tile is charged either way, and a #145
 * playtest read this the wrong way round.
 *
 * **The drop used to be excluded from this rule, by name, and the exclusion is reversed (#144).**
 * §4 read *"ember you made is yours; ember the ruin hid belongs to the lantern"* for two milestones.
 * Measured, that asymmetry was half of why a never-flash line dominated: it banked 20 a kill with no
 * light, and nothing else in a shuttered floor could hurt a moving player. What replaces it is
 * *ember the ruin hid, the lantern finds; ember you made, the lantern claims; **neither is yours in
 * the dark***. The compensation is presentational and is #81: an uncollected drop is **drawn**
 * wherever its tile is perceived or remembered, lit or not, because its position is information the
 * player created.
 *
 * **A collected cache stops being a cache.** The tile becomes floor and the position leaves
 * `floor.caches`, rather than being tracked in a parallel "already taken" list somewhere in run
 * state. A second source of truth about what is on a tile is the thing this codebase keeps refusing
 * (`fov/vision.ts` on why the lit field is not stored), and every consumer — the renderer, terrain
 * memory, `perceive` — reads the grid. The cost is rebuilding a 165-entry array on the handful of
 * turns a cache is taken.
 *
 * Order between the two sources cannot matter — they are disjoint and the gains are summed — so
 * there is no sort here and nothing for a sort to fix. Nothing here draws from the generator on
 * either branch, so the unlit case cannot shift the stream.
 */
export function collectFuelUnderfoot(state: LanternWorld): LanternWorld {
  const at = playerOf(state.world).at;
  // The whole of the rule, asked once, before anything is filtered or rebuilt: both branches below
  // are gated on it, and the early return is what keeps a dark crawler standing on its own kill from
  // allocating a fresh world every turn.
  if (!hasBeenLit(state.lantern.vision, at.x, at.y)) return state;

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
 * `cost` is explicit and has no default, exactly as `actorPhase`'s is: no command can be wired
 * without saying whether it costs a turn, and getting it wrong is a failing test rather than a
 * player who silently loses a turn every time they touch the shutter.
 *
 * The command phase is a parameter because the `Command` union lives in `game/core/`. Its only
 * obligation is the one `actors.ts` states: **a command that costs a turn must charge the player**,
 * or phase 4 throws. Every phase this file ships already does.
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
    // Runs on a free action too, and that is deliberate. Wrapping this in `perTurn(cost, ...)` is
    // a third provably-equivalent mutant — a free toggle can neither kill nor move the player, so
    // both halves of this phase are no-ops — but GDD §2 now explicitly promises phase 5 runs on
    // every command, and making it conditional would be a rule change disguised as symmetry with
    // the phases above. Documented here alongside the other two equivalents so a later mutation
    // run does not spend time re-deriving it.
    deaths: unlessTheRunEnded(deathsAndCollectionPhase),
    darkAdaptation: unlessTheRunEnded(perTurn(cost, darkAdaptationPhase)),
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
 * GDD §13: "A terminal state stops the turn where it happens. If the player dies in phase 4, the
 * actor sweep stops there and **phases 5 and 6 do not run** — the final state is the frame of the
 * killing blow."
 *
 * `actorPhase` stops the sweep; this stops what would come after it. Applied to phases 5 and 6 and
 * to nothing before phase 4, because the player cannot die in phases 1-3: the only thing in the
 * game that damages the player is a creature resolving a declared attack, which is phase 4.
 *
 * The visible consequence, and the reason this is not tidiness: without it, the Cinder that killed
 * you drops the ember of a creature *you* killed earlier in the same turn, that ember is collected
 * off the corpse's tile if you happen to be standing on it, and the run's final fuel figure counts
 * income earned after the run was over.
 */
function unlessTheRunEnded(phase: TurnPhase<LanternWorld>): TurnPhase<LanternWorld> {
  return (state) => (isRunOver(state.world) ? state : phase(state));
}

/**
 * Phase 4, lifted to a `LanternWorld`.
 *
 * **It no longer takes the lighting**, and that is #123 arriving here: a declaration is `attack the
 * player's tile if adjacent, otherwise step toward it`, which asks nothing about light. This phase
 * used to build the query so that creatures declared against the lighting phase 3 had just
 * recomputed rather than the lighting the turn started with — a real distinction that now has
 * nothing to distinguish. The free case still goes through `actorPhase`, which is the one function
 * allowed to know what a free action does to the schedule.
 */
function actorsPhase(cost: TurnCost): TurnPhase<LanternWorld> {
  return (state) => withWorld(state, actorPhase(cost)(state.world));
}

// --- phase 1: the player's commands --------------------------------------------------------------
//
// The `Command` union lives in `game/core/`, but what each command *does* is a rule and lives here.
// `game/core/step.ts` chooses among these and supplies nothing of its own.

/**
 * Charge the player for the turn they are about to take.
 *
 * Charged **before** the action resolves, exactly as `runActorPhase` charges a creature before its
 * action resolves, so a kill made by this command leaves the queue and stays out of it.
 *
 * Every command that costs a turn goes through here. Forgetting it leaves the player due in phase
 * 4, where `actOnce` throws "the player was due" — a loud failure standing in for the quiet one it
 * would otherwise be (the player acting twice, or a free action costing a turn).
 */
export function chargePlayer(state: LanternWorld): LanternWorld {
  return withWorld(state, {
    ...state.world,
    schedule: chargeActor(state.world.schedule, PLAYER_ID),
  });
}

/**
 * §9: "Tap your own tile to wait." The whole command: pay the turn, do nothing with it.
 *
 * Not a no-op — §9 calls out *waiting on the stairs* as a real move, and every other phase still
 * runs, so a wait burns fuel, hands the floor its turn, and ticks adaptation.
 */
export function waitCommand(state: LanternWorld): LanternWorld {
  return chargePlayer(state);
}

/**
 * §3/§9's one directional command: move, or attack whatever is standing there.
 *
 * `bump` decides which from what is on the tile *at this moment*, which is why there is no separate
 * attack command to get out of step with it. `to` must be an orthogonal neighbour and must be
 * bumpable (`canBump`) — a tap on a wall is refused by `step()` before any of this runs, and
 * reaching here with one is a bug rather than a blocked move.
 *
 * **No light is threaded through here since #123.** It used to be, for one thing: §3's "if the
 * target survives, it wakes", where waking declared and declaring consulted contact. Waking still
 * happens and still declares; what it declares no longer depends on the lantern, so there is nothing
 * to hand it. The two documented equivalent mutants that lived on that argument (building the query
 * from `charged` rather than from `state`) go with the argument.
 */
export function moveCommand(to: Position): TurnPhase<LanternWorld> {
  return (state) => {
    const charged = chargePlayer(state);
    return withWorld(charged, bump(charged.world, PLAYER_ID, to));
  };
}

/**
 * The player's half of a shutter command: set it, charge nobody, take no turn.
 *
 * **`setShutter(to)` rather than a toggle**, and that is a determinism decision as much as a design
 * one: a toggle's meaning depends on prior state, so a command log with one command dropped or
 * duplicated silently inverts the shutter for the rest of the run rather than failing. At 0 fuel a
 * toggle is additionally the *identity*, so a refusal is invisible in the log.
 *
 * Opening is refused when dry (§4) and the refusal is still a legal, resolved, free command — the
 * player pressed the control and the lantern had nothing to give. That is **not** the same thing as
 * §2's *refused action*, which runs no phases at all: this one burns its fuel and lights whatever
 * the shutter is set to. Asking for the setting the shutter already holds is the refusal; see
 * `step()`.
 */
export function setShutterCommand(to: ShutterState): TurnPhase<LanternWorld> {
  return (state) => withLantern(state, setLanternShutter(state.lantern, to));
}

/**
 * The whole shutter command, as one resolved free action.
 *
 * Shipped as a function rather than as instructions, because "free" is a property of *this command*
 * and not of the call site: there is no `TurnCost` parameter here for a caller to get wrong. The
 * wrong wiring costs the player a turn **and** hands every creature on the floor a free one
 * (`turn.test.ts`).
 */
export function setShutterTurn(state: LanternWorld, to: ShutterState): LanternWorld {
  return resolveTurn(state, lanternPhases('free', setShutterCommand(to)));
}
