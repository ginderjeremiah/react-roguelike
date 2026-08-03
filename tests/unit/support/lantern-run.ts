/**
 * Scripted play styles, for measuring GDD §4's light economy.
 *
 * ```ts
 * const run = playRun('seed-3', STALKER, 8);
 * run.floors[0].income / run.floors[0].spend   // what a well-played floor earns per fuel spent
 * ```
 *
 * ## Why the styles are a 2×2 and not three ad-hoc scripts
 *
 * §4's three invariants are all *comparative* — a pacifist runs dry, a floodlit run runs dry
 * **faster**, a floor played well nets positive. Comparisons need a control, so the styles vary
 * exactly two things, independently:
 *
 * ```
 *            |  flashes and shutters  |  holds the shutter open
 *   fights   |  STALKER               |  FLOODLIT
 *   pacifist |  PACIFIST              |  FLOODLIT_PACIFIST
 * ```
 *
 * `STALKER` vs `PACIFIST` isolates *combat* — same route, same light policy, one of them kills.
 * `STALKER` vs `FLOODLIT` isolates *light* — same route, same kills, one of them pays 4/turn.
 * That is what makes the assertions bite: in an economy where nothing meaningful is ever spent or
 * earned, all four cells are equal, and equality fails every comparison. A suite of "fuel never goes
 * negative" and "burn is 4 when open" would pass on that economy happily.
 *
 * ## What the scripts are allowed to know
 *
 * Only what the player knows, because the whole claim under test is about the *cost of information*:
 *
 *   - **Terrain**: `vision.remembered` only. Routes are planned over remembered passable tiles, so
 *     an unexplored floor genuinely has to be explored — at the touch radius if unlit. A script that
 *     pathed over the real grid would cross a floor in a fraction of the turns and would make the
 *     economy look far kinder than it is.
 *   - **Creatures**: this turn's `perceive` — seen in the lit region, or felt through walls within
 *     the *current* ember-sense radius. Never the actor list.
 *   - **Caches**: only once the **lantern** has lit the tile (`hasBeenLit`), which is §4's "a cache
 *     is terrain the lantern has to have shown you" (#31/#41). Perceiving the tile by touch is not
 *     enough and never was: under the rule the script would be routing to a `·`.
 *
 * ## What they are not
 *
 * Not optimal play, and not an AI. They are legal, plausible command sequences, and the invariants
 * are asserted as the *direction of the differences between them* rather than as absolute numbers,
 * precisely because a script cannot be optimal. Where an absolute number is asserted
 * (`economy.test.ts`), it is anchored to something the GDD states independently — §5's "~40-70 turns
 * per floor" is the anchor for whether these scripts play at a believable pace at all.
 *
 * ## Two harness liberties, both deliberate and both marked
 *
 * 1. **The player does not die.** `IMMORTAL_HP` replaces the player's HP pool. The claim under test
 *    is about *fuel*: a pacifist beaten to death by a Cinder has demonstrated a different kind of
 *    unsustainability, and if the floodlit style died first, "runs dry faster" would be
 *    unmeasurable. Survival is exercised in `game/systems/floorplay.test.ts` and what a dead player
 *    *means* is #18's.
 * 2. **Descending is done here, not by the simulation.** Floor transitions are #18's. The harness
 *    generates the next floor and carries the fuel across — the only part of a descent the economy
 *    cares about — and deliberately invents nothing else about it.
 */

import { CACHE_FUEL, CINDER } from '@/game/content';
import {
  createActorWorld,
  isAlive,
  PLAYER_ID,
  playerOf,
  withActor,
  type ActorWorld,
  type CreatureActor,
} from '@/game/entities';
import {
  EMBER_SENSE_RADIUS,
  hasBeenLit,
  hasTile,
  perceive,
  tileSetPositions,
  type ShutterState,
  type TileSet,
} from '@/game/fov';
import {
  chebyshevDistance,
  generateFloor,
  inBounds,
  isPassableAt,
  manhattanDistance,
  ORTHOGONAL_STEPS,
  samePosition,
  tileAt,
  tileIndex,
  type Floor,
  type Grid,
  type Position,
} from '@/game/map';
import { createRng } from '@/game/rng';
import {
  bump,
  burnRate,
  canOpen,
  chargeActor,
  createLantern,
  isDry,
  lanternPhases,
  resolveTurn,
  setShutterTurn,
  type ActorId,
  type LanternWorld,
} from '@/game/systems';

/** See liberty 1 in the header. Large enough that no run of this length can exhaust it. */
const IMMORTAL_HP = 100_000;

/**
 * Give up on a floor rather than loop forever. A pacifist can be walled in by a creature it will
 * not fight, and a floodlit style with no fuel left cannot open the shutter it wants open.
 */
const TURN_CAP_PER_FLOOR = 200;

/** Tiles inside the lit radius a flash would newly reveal, above which flashing is worth 4 fuel. */
const FLASH_THRESHOLD = 8;

/** How a style works the shutter. */
export type LightPolicy =
  /** Never opens it. The cheapest possible crawl, and blind to every cache. */
  | 'never'
  /** Opens it to read an unmapped room, shuts it again. §4's "flash and crawl". */
  | 'flash'
  /** Holds it open for the whole floor. §4's second invariant, as a play style. */
  | 'always';

export type Style = {
  readonly name: string;
  /** Does it ever attack? `false` is §4's pacifist. */
  readonly fights: boolean;
  readonly light: LightPolicy;
};

export const STALKER: Style = { name: 'stalker', fights: true, light: 'flash' };
export const PACIFIST: Style = { name: 'pacifist', fights: false, light: 'flash' };
export const FLOODLIT: Style = { name: 'floodlit', fights: true, light: 'always' };
export const FLOODLIT_PACIFIST: Style = {
  name: 'floodlit-pacifist',
  fights: false,
  light: 'always',
};
/**
 * Outside the 2×2: the cheapest crawl the rules permit, and the floor under every fuel curve.
 *
 * **It is blind to caches, and that is now the rules rather than the script.** It used to take 119
 * of the 121 caches in this corpus: a shuttered crawler reads the Chebyshev-1 touch field into
 * `vision.remembered`, so frontier exploration maps the whole floor and walks within one tile of
 * nearly everything, and `collectFuelUnderfoot` paid on the tile kind. §4 said the opposite the
 * whole time, and #31/#41 enforced it — a cache pays only where the lantern has lit its tile, and
 * this style never opens the shutter. Every floor it plays here arrives shuttered (`arriveOn`), so
 * its `revealed` plane stays empty and its cache income is exactly **zero**, not merely small. In a
 * real run it would keep floor 1's entrance room, which `beginRun` lights before the first command.
 */
export const DARK_PACIFIST: Style = { name: 'dark-pacifist', fights: false, light: 'never' };

/**
 * §4's desperate state, as a style: a lantern with nothing in it. Never opens the shutter — it
 * cannot — and fights whatever stands between it and the stairs. Run with `startFuel` 0.
 */
export const DRY_CRAWL: Style = { name: 'dry-crawl', fights: true, light: 'never' };

/**
 * One creature that was woken and then killed, and what the player spent on it.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT `hpSpentWhileAwake` IS, AND THE ONE WAY IT CAN LIE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * GDD §4 keeps a **regression guard** — *no run may bank ember from a creature it woke without
 * paying HP for it* — and says outright that nothing in this harness could assert it, because it
 * recorded per-floor fuel and nothing per creature. This is that attribution, built by #123.
 *
 * It is the player's HP loss summed over every command on which this creature was **awake and
 * alive**, from the first such command to the one that killed it. Exact attribution is not
 * available and cannot be: §2 has a creature mark a *tile*, and two adjacent creatures mark the
 * **same** tile (GDD §4's *as implemented the threat set is one tile*), so when the player loses 2
 * HP with two hunters adjacent there is no observable in the state that says which one swung.
 *
 * **So the error runs one way and it is worth naming.** Overlapping hunters *over-credit*: a
 * creature killed for nothing while a second one was landing blows reports a non-zero spend. The
 * guard is therefore a claim about every woken kill in the corpus having *some* HP against it, and
 * a re-tune that made free kills the norm would still be caught — a free-kill route reopened by a
 * 3 HP creature produces lone woken kills as well as crowded ones, and the lone ones report 0. It
 * would *not* catch a free kill that only ever happened in a crowd. Written down rather than
 * hedged: this instrument is a tripwire, not a measurement, which is exactly what §4 asks it to be.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */
export type WokenKill = {
  readonly id: ActorId;
  /** Player HP lost across the commands this creature spent awake and alive. Never negative. */
  readonly hpSpentWhileAwake: number;
  /**
   * How many player commands it was awake for before it died.
   *
   * A bound on *when* a free kill happens, never on *why*: it counts commands, not mechanisms, and
   * cannot tell #125's free-action window from its `beginRun` one. `economy.test.ts` asserts it as
   * "soon after the wake" and pins the mechanisms with hand-built reproductions instead.
   *
   * A third field — `actedWhileAwake` — was here and is deleted. It was computed, exported and
   * asserted by nothing, which this file's own rule forbids; worse, it did not measure what its name
   * said, because a creature can spend its one action resolving a *stale move* and still never swing.
   * That is exactly the `beginRun` shape, so the field would have mis-attributed the case it looked
   * built for.
   */
  readonly commandsAwake: number;
};

/** What one floor cost and paid. */
export type FloorResult = {
  readonly floorNumber: number;
  /** Turns consumed. Free actions are not turns and are not counted here. */
  readonly turns: number;
  /** Commands issued, free ones included. Always >= `turns`. */
  readonly commands: number;
  /** Shutter toggles that opened the lantern — one per flash. */
  readonly flashes: number;
  /** Paid turns taken with the shutter already open: light *held*, rather than flashed. */
  readonly litTurns: number;
  readonly kills: number;
  /**
   * The subset of `kills` that had been **woken** at some point before they died, in ascending
   * actor id, each with the HP the player spent while it was awake.
   *
   * `kills - wokenKills.length` is therefore the floor's free kills: creatures the run never lit
   * and struck in their sleep, which §3 pays double for and §4 calls the reward for having played
   * dark. The split is the quantity GDD §4's regression guard is stated in.
   */
  readonly wokenKills: readonly WokenKill[];
  readonly cachesTaken: number;
  /**
   * Caches on the floor when the player arrived — §5 places 1-2.
   *
   * The denominator for "what fraction of a floor's caches did this style take", which is the
   * measurement §4's cache rule (#31/#41) is judged on and which cannot be recovered from
   * `cachesTaken` alone: a style that takes 1 of 1 and a style that takes 1 of 2 report the same
   * number and mean opposite things.
   */
  readonly cachesOnFloor: number;
  readonly fuelBefore: number;
  readonly fuelAfter: number;
  /** Fuel added by kills and caches — counted from the events, not inferred from the total. */
  readonly income: number;
  /** Fuel actually burned. `income - (fuelAfter - fuelBefore)`, which is exact even on the turns
   * a dry lantern is asked for more than it has and burns less than its rate. */
  readonly spend: number;
  /**
   * Fuel the lantern was *asked* for: the sum of the burn rate over every command, ignoring the
   * clamp at 0.
   *
   * The measure the economy has to be judged on. `spend` is clamped, so a run that spends its
   * whole floor dry reports `income === spend` and a net of exactly zero — which reads as a
   * break-even floor when it is in fact a floor the player could not pay for. On a floor that never
   * ran dry the two are equal, and `economy.test.ts` asserts that as the instrument's self-check.
   */
  readonly demand: number;
  readonly reachedStairs: boolean;
  /** The lantern hit 0 at some point on this floor. */
  readonly ranDry: boolean;
  /**
   * Turns played on **this floor** before the lantern first hit 0, or `null` if it never did.
   *
   * Recorded at the moment, not reconstructed from the floor's totals: a floor is played to the
   * stairs or to `TURN_CAP_PER_FLOOR` whichever comes first, so a run that dries on turn 12 still
   * accrues the rest of the floor and the floor's `turns` says nothing about when it happened.
   */
  readonly driedOnTurn: number | null;
};

export type RunResult = {
  readonly style: Style;
  readonly floors: readonly FloorResult[];
  readonly fuelAfter: number;
  /** 1-based floor on which fuel first reached 0, or `null` if the run never ran dry. */
  readonly driedOnFloor: number | null;
  /**
   * Turns played before the lantern first reached 0, or `null` if it never did.
   *
   * **This is now the moment, not the end of the floor containing it.** An earlier version summed
   * whole floors, which was labelled "turns before the lantern died", was not, and was documented
   * as safe for *ordering* only. That caveat stopped being safe the day #31/#41 landed: every
   * pacifist style now dries on floor 1, so the old number was the length of floor 1 and separated
   * the styles by how long they wandered rather than by how long they stayed solvent. `driedOnTurn`
   * is recorded at the moment fuel hits 0, so this is a duration and can be read as one.
   */
  readonly driedAfterTurns: number | null;
};

/**
 * A floor at the moment of arrival: everything dormant, nothing seen, shuttered, carrying `fuel`.
 *
 * Shuttered because you descend into a lightless ruin and because it is the only starting state the
 * rules can express at 0 fuel; §4 does not say, and this is a harness, not a ruling.
 */
export function arriveOn(floor: Floor, fuel?: number): LanternWorld {
  const world = createActorWorld(floor);
  const player = playerOf(world);
  return {
    // Liberty 1: the fuel economy is the subject here, not survival.
    world: withActor(world, { ...player, hp: IMMORTAL_HP, maxHp: IMMORTAL_HP }),
    lantern: createLantern(floor.grid, 'shuttered', fuel),
  };
}

/** Play `floors` floors of one run, carrying fuel across. §5: a run is 8 floors. */
export function playRun(seed: string, style: Style, floors: number, startFuel?: number): RunResult {
  const results: FloorResult[] = [];
  let fuel = startFuel;
  let driedOnFloor: number | null = null;
  let driedAfterTurns: number | null = null;
  let turnsSoFar = 0;

  for (let floorNumber = 1; floorNumber <= floors; floorNumber += 1) {
    const floor = generateFloor(createRng(`${seed}-${floorNumber}`), floorNumber).value;
    const result = playFloor(arriveOn(floor, fuel), style);
    results.push(result);
    fuel = result.fuelAfter;
    if (driedOnFloor === null && result.ranDry) {
      driedOnFloor = floorNumber;
      // `driedOnTurn` is non-null exactly when `ranDry` is true, so there is no fallback here and
      // deliberately no `?? result.turns`. An earlier draft had one, and it was worse than dead
      // code: `result.turns` is the *whole floor's* length, which is precisely the quantity this
      // instrument was rewritten to stop using (#31/#41 — once every pacifist style dried on floor
      // 1, summing whole floors ranked styles by how far they wandered rather than by how long
      // their fuel lasted, and invariant 2 went red for a reason that had nothing to do with the
      // rule under test). A fallback to it would read as if that quantity can still leak back in.
      //
      // So the pairing is asserted rather than defaulted. If it ever breaks, this throws in the
      // harness — which is the right failure, because the alternative is an invariant silently
      // measured with the wrong quantity, and that has already cost this file one false red.
      if (result.driedOnTurn === null) {
        throw new Error('lantern-run: ranDry without driedOnTurn — the two are set together');
      }
      driedAfterTurns = turnsSoFar + result.driedOnTurn;
    }
    turnsSoFar += result.turns;
  }

  return { style, floors: results, fuelAfter: fuel ?? 0, driedOnFloor, driedAfterTurns };
}

/**
 * Play one floor to the stairs, or until the cap.
 *
 * The loop issues exactly one command per iteration. A free command advances neither the clock nor
 * the turn count — that is the property under test — so `commands` and `turns` are counted
 * separately and both are reported.
 */
export function playFloor(start: LanternWorld, style: Style): FloorResult {
  let state = start;
  const memory: ScriptMemory = { flashedFrom: [] };
  let turns = 0;
  let commands = 0;
  let flashes = 0;
  let litTurns = 0;
  let income = 0;
  let demand = 0;
  let kills = 0;
  let cachesTaken = 0;
  let ranDry = isDry(start.lantern);
  let driedOnTurn: number | null = ranDry ? 0 : null;
  let reachedStairs = false;
  const attribution = new WakeLedger();

  while (turns < TURN_CAP_PER_FLOOR && commands < TURN_CAP_PER_FLOOR * 2) {
    const before = state;
    const action = chooseAction(state, style, memory);
    if (action.kind === 'descend') {
      reachedStairs = true;
      break;
    }

    const wasOpen = before.lantern.vision.shutter === 'open';
    // What phase 2 will charge: the burn is read off the shutter *after* the command phase, so a
    // toggle pays at its new setting. Reconstructed here rather than observed because a phase
    // between two others cannot be watched from outside `resolveTurn`; the reconstruction is
    // checked against the simulation by the `demand === spend` assertion in `economy.test.ts`.
    demand += burnRate(shutterAfter(before, action));
    if (action.kind === 'toggle' && !wasOpen) {
      flashes += 1;
      memory.flashedFrom.push(playerOf(before.world).at);
    }
    state = apply(state, action);
    commands += 1;
    if (state.world.schedule.now > before.world.schedule.now) {
      turns += 1;
      if (wasOpen) litTurns += 1;
    }

    attribution.record(before.world, state.world);

    const killedNow = countLiving(before.world) - countLiving(state.world);
    const cachesNow = before.world.floor.caches.length - state.world.floor.caches.length;
    kills += killedNow;
    cachesTaken += cachesNow;
    income += killedNow * CINDER.emberDrop + cachesNow * CACHE_FUEL;
    if (isDry(state.lantern)) {
      if (!ranDry) driedOnTurn = turns;
      ranDry = true;
    }
  }

  return {
    floorNumber: start.world.floor.floorNumber,
    turns,
    commands,
    flashes,
    litTurns,
    kills,
    wokenKills: attribution.wokenKills(),
    cachesTaken,
    cachesOnFloor: start.world.floor.caches.length,
    fuelBefore: start.lantern.fuel,
    fuelAfter: state.lantern.fuel,
    income,
    // Exact, and correct even on the turn the lantern clamps at 0 and burns less than its rate.
    spend: income - (state.lantern.fuel - start.lantern.fuel),
    demand,
    reachedStairs,
    ranDry,
    driedOnTurn,
  };
}

/**
 * Per-creature wake and HP attribution, accumulated one command at a time.
 *
 * The instrument GDD §4's regression guard needs and this harness did not have. See `WokenKill` for
 * what the number means and the one way it can over-credit.
 *
 * **Ordering:** ids are collected in a `Map` for the accumulation and **sorted before they leave**,
 * so `wokenKills()` is a function of the run and never of insertion order. Nothing in the harness
 * feeds this back into the simulation, but ADR-0004's rule is cheaper to keep than to reason about
 * an exception to.
 */
class WakeLedger {
  private readonly hpWhileAwake = new Map<ActorId, number>();
  private readonly commandsAwake = new Map<ActorId, number>();
  private readonly killed: WokenKill[] = [];

  /** Fold one resolved command into the ledger. */
  record(before: ActorWorld, after: ActorWorld): void {
    // Who was awake *before* the command. That is who could have resolved an action during it: a
    // creature declares one turn and resolves it the next, so the actor that swung was already
    // awake when the turn began.
    const awakeNow: ActorId[] = [];
    for (const actor of before.actors) {
      if (actor.kind !== 'creature' || !isAlive(actor) || actor.mind.kind !== 'awake') continue;
      this.commandsAwake.set(actor.id, (this.commandsAwake.get(actor.id) ?? 0) + 1);
      awakeNow.push(actor.id);
    }

    const spent = playerOf(before).hp - playerOf(after).hp;
    if (spent > 0) {
      for (const id of awakeNow) {
        this.hpWhileAwake.set(id, (this.hpWhileAwake.get(id) ?? 0) + spent);
      }
    }

    // Deaths: an id in `before` and gone from `after`. Phase 5 removes the body, so this is the one
    // frame in which a creature's whole history is still available.
    const survivors = new Set<ActorId>(after.actors.map((actor) => actor.id));
    for (const actor of before.actors) {
      if (actor.kind !== 'creature' || survivors.has(actor.id)) continue;
      const commandsAwake = this.commandsAwake.get(actor.id) ?? 0;
      if (commandsAwake === 0) continue; // a free kill on something never lit (§3, §4)
      this.killed.push({
        id: actor.id,
        hpSpentWhileAwake: this.hpWhileAwake.get(actor.id) ?? 0,
        commandsAwake,
      });
    }
  }

  /** Every creature killed after having been awake, in ascending id. */
  wokenKills(): readonly WokenKill[] {
    return [...this.killed].sort((a, b) => a.id - b.id);
  }
}

/**
 * The little the script remembers between commands.
 *
 * One thing: which tiles it has already flashed from. Without it the flash condition is a function
 * of the state alone, and since a flash can never reveal the tiles a wall hides, a room with an
 * unreachable corner would be flashed from the same tile forever — burning fuel and taking no turns.
 * "I have already looked from here" is also just what a player knows.
 */
type ScriptMemory = { readonly flashedFrom: Position[] };

/** Where the shutter will be when phase 2 reads it — a toggle has already resolved by then. */
function shutterAfter(state: LanternWorld, action: Action): ShutterState {
  const open = state.lantern.vision.shutter === 'open';
  if (action.kind !== 'toggle') return open ? 'open' : 'shuttered';
  if (open) return 'shuttered';
  return canOpen(state.lantern) ? 'open' : 'shuttered';
}

function livingCreatures(world: ActorWorld): CreatureActor[] {
  return world.actors.filter(
    (actor): actor is CreatureActor => actor.kind === 'creature' && isAlive(actor),
  );
}

function countLiving(world: ActorWorld): number {
  return livingCreatures(world).length;
}

// --- the script ---------------------------------------------------------------------------------

type Action =
  | { readonly kind: 'toggle' }
  | { readonly kind: 'wait' }
  | { readonly kind: 'bump'; readonly to: Position }
  | { readonly kind: 'descend' };

/** Resolve one command through the real pipeline — `lanternPhases`, in GDD §2 order. */
function apply(state: LanternWorld, action: Action): LanternWorld {
  if (action.kind === 'toggle') {
    return setShutterTurn(state, state.lantern.vision.shutter === 'open' ? 'shuttered' : 'open');
  }

  return resolveTurn(
    state,
    lanternPhases('costsATurn', (current) => {
      // Charged before the action resolves, exactly as `runActorPhase` charges a creature before
      // its action resolves, so a kill made by this command stays out of the queue.
      const charged: LanternWorld = {
        lantern: current.lantern,
        world: { ...current.world, schedule: chargeActor(current.world.schedule, PLAYER_ID) },
      };
      if (action.kind !== 'bump') return charged;
      return {
        lantern: charged.lantern,
        world: bump(charged.world, PLAYER_ID, action.to),
      };
    }),
  );
}

/** What the player currently perceives — the only creature information a script may use. */
function perceivedCreatures(state: LanternWorld): Position[] {
  const world = state.world;
  return perceive(
    world.floor.grid,
    state.lantern.vision,
    playerOf(world).at,
    livingCreatures(world).map((creature) => creature.at),
  ).creatures.map((sense) => sense.at);
}

function chooseAction(state: LanternWorld, style: Style, memory: ScriptMemory): Action {
  const shutterMove = chooseShutter(state, style, memory);
  if (shutterMove !== null) return shutterMove;

  const grid = state.world.floor.grid;
  const known = state.lantern.vision.remembered;
  const at = playerOf(state.world).at;
  const creatures = perceivedCreatures(state);

  if (style.fights) {
    const adjacent = creatures.find((creature) => manhattanDistance(at, creature) === 1);
    if (adjacent !== undefined) return { kind: 'bump', to: adjacent };
  }

  const errands = [
    ...knownCaches(state),
    ...state.world.embers.map((drop) => drop.at),
    ...(style.fights ? creatures : []),
    ...frontierTiles(grid, known),
  ];
  const toErrand = firstStepToward(state, errands, style.fights);
  if (toErrand !== null) return { kind: 'bump', to: toErrand };

  // Nothing left worth doing on this floor. Leave.
  const stairs = knownStairs(grid, known);
  if (stairs === null) return { kind: 'wait' };
  if (samePosition(stairs, at)) return { kind: 'descend' };
  const toStairs = firstStepToward(state, [stairs], style.fights);
  return toStairs === null ? { kind: 'wait' } : { kind: 'bump', to: toStairs };
}

/**
 * §4's "flash and crawl", as a policy.
 *
 * Two conditions on opening, and both are things a player would actually reason about:
 *
 *   - **Only at full ember-sense.** §4's containment guarantee holds only while the sense radius is
 *     at least the lit radius — "everything a flash can wake, you can already feel". Flashing
 *     mid-ramp is the gamble the ramp exists to create, and a script that took it would be modelling
 *     a *reckless* player, not a competent one.
 *   - **Never twice from the same tile.** A flash reveals what the walls allow and no more; looking
 *     again from where you already looked buys nothing.
 *
 * Closing is unconditional on the very next command, and that is not a shortcut: phase 3 has already
 * folded the whole lit room into terrain memory, so there is nothing further to buy by holding the
 * shutter open — except enemy intent, which is what `FLOODLIT` is for. A flash therefore costs
 * 4 fuel (the open command burns at the lit rate) plus the 1 the closing command burns, and no turns.
 *
 * A toggle that would be refused is never issued: at 0 fuel `open` is a no-op (§4), and asking for
 * it every iteration would spin forever without ever spending a turn.
 */
function chooseShutter(state: LanternWorld, style: Style, memory: ScriptMemory): Action | null {
  const open = state.lantern.vision.shutter === 'open';
  const couldOpen = canOpen(state.lantern);

  switch (style.light) {
    case 'never':
      return open ? { kind: 'toggle' } : null;
    case 'always':
      return !open && couldOpen ? { kind: 'toggle' } : null;
    case 'flash': {
      if (open) return { kind: 'toggle' };
      const at = playerOf(state.world).at;
      if (memory.flashedFrom.some((seen) => samePosition(seen, at))) return null;
      const unknown = unknownNearby(state.world.floor.grid, state.lantern.vision.remembered, at);
      const adapted = state.lantern.vision.senseRadius >= EMBER_SENSE_RADIUS;
      return unknown >= FLASH_THRESHOLD && adapted && couldOpen ? { kind: 'toggle' } : null;
    }
    default:
      return null;
  }
}

function unknownNearby(grid: Grid, known: TileSet, at: Position): number {
  let count = 0;
  for (let y = at.y - 4; y <= at.y + 4; y += 1) {
    for (let x = at.x - 4; x <= at.x + 4; x += 1) {
      if (!inBounds(grid, x, y)) continue;
      if (chebyshevDistance(at, { x, y }) > 4) continue;
      if (!hasTile(known, x, y)) count += 1;
    }
  }
  return count;
}

/**
 * Caches the **lantern** has shown the player. Anything else is a `·` they have walked over (§4,
 * #31/#41) and routing to one would be the script using knowledge the player does not have.
 *
 * Keyed on `hasBeenLit` rather than on `remembered` — the two differ by exactly the caches a
 * shuttered crawl feels underfoot, which is the entire subject of the ruling.
 */
function knownCaches(state: LanternWorld): Position[] {
  const vision = state.lantern.vision;
  return state.world.floor.caches.filter((cache) => hasBeenLit(vision, cache.x, cache.y));
}

function knownStairs(grid: Grid, known: TileSet): Position | null {
  for (const at of tileSetPositions(known)) {
    if (tileAt(grid, at.x, at.y).kind === 'stairs') return at;
  }
  return null;
}

/** Remembered passable tiles with an unremembered neighbour — where exploring happens. */
function frontierTiles(grid: Grid, known: TileSet): Position[] {
  const out: Position[] = [];
  for (const at of tileSetPositions(known)) {
    if (!isPassableAt(grid, at.x, at.y)) continue;
    for (const step of ORTHOGONAL_STEPS) {
      const x = at.x + step.x;
      const y = at.y + step.y;
      if (inBounds(grid, x, y) && !hasTile(known, x, y)) {
        out.push(at);
        break;
      }
    }
  }
  return out;
}

/**
 * One step toward the nearest goal, routed only through **remembered** passable terrain.
 *
 * A single breadth-first sweep from the player with predecessor tracking, so the route and the step
 * cost one pass. Neighbours are visited in the fixed `ORTHOGONAL_STEPS` order and goals are compared
 * by breadth-first distance, so the step is a pure function of the grid, what is remembered, and
 * where the goals are — never of the order the caller listed them in.
 *
 * A goal the player cannot stand on (a creature felt through a wall) is approached via its
 * neighbours, which is why the goal test is "adjacent to or on".
 *
 * @param fights whether a creature's tile counts as somewhere the route may go. It must, for a
 *   fighter — `bump` resolves a step onto an occupied tile as an attack, and that is how a fighter
 *   reaches a creature at all. It must **not** for a pacifist: the pacifist is defined by never
 *   attacking, and a route that walked into a Cinder would quietly make it a fighter. That was a
 *   real bug in this harness — the "pacifist" was killing four creatures a floor, which would have
 *   made §4's first invariant meaningless while looking green.
 */
function firstStepToward(
  state: LanternWorld,
  goals: readonly Position[],
  fights: boolean,
): Position | null {
  if (goals.length === 0) return null;
  const grid = state.world.floor.grid;
  const known = state.lantern.vision.remembered;
  const from = playerOf(state.world).at;
  const blocked = fights ? () => false : occupiedTiles(state.world);

  const wanted = new Array<boolean>(grid.tiles.length).fill(false);
  for (const goal of goals) {
    markGoal(grid, wanted, goal);
  }

  const cameFrom = new Array<number>(grid.tiles.length).fill(-1);
  const start = tileIndex(grid, from.x, from.y);
  const seen = new Array<boolean>(grid.tiles.length).fill(false);
  seen[start] = true;

  const queue: Position[] = [from];
  for (let head = 0; head < queue.length; head += 1) {
    const here = queue[head];
    const index = tileIndex(grid, here.x, here.y);
    if (wanted[index] && index !== start) return firstStepOf(grid, cameFrom, start, index);

    for (const step of ORTHOGONAL_STEPS) {
      const x = here.x + step.x;
      const y = here.y + step.y;
      if (!inBounds(grid, x, y)) continue;
      if (!hasTile(known, x, y) || !isPassableAt(grid, x, y)) continue;
      const next = tileIndex(grid, x, y);
      if (seen[next] || blocked(next)) continue;
      seen[next] = true;
      cameFrom[next] = index;
      queue.push({ x, y });
    }
  }
  // Nothing reachable through what is known. A creature standing in the only route is not "unknown"
  // terrain, so a fighter tries again by swinging at whatever is in the way.
  return fights ? stepIntoBlocker(state, goals) : null;
}

/** Tile indices held by a living creature. A pacifist's routes may not pass through one. */
function occupiedTiles(world: ActorWorld): (index: number) => boolean {
  const grid = world.floor.grid;
  const taken = new Array<boolean>(grid.tiles.length).fill(false);
  for (const creature of livingCreatures(world)) {
    taken[tileIndex(grid, creature.at.x, creature.at.y)] = true;
  }
  return (index) => taken[index];
}

/** Mark a goal tile, or — if it is not somewhere the player could stand — its neighbours. */
function markGoal(grid: Grid, wanted: boolean[], goal: Position): void {
  if (!inBounds(grid, goal.x, goal.y)) return;
  if (isPassableAt(grid, goal.x, goal.y)) {
    wanted[tileIndex(grid, goal.x, goal.y)] = true;
    return;
  }
  for (const step of ORTHOGONAL_STEPS) {
    const x = goal.x + step.x;
    const y = goal.y + step.y;
    if (inBounds(grid, x, y) && isPassableAt(grid, x, y)) wanted[tileIndex(grid, x, y)] = true;
  }
}

/** Walk the predecessor chain back from `goal` to the tile the player should step onto. */
function firstStepOf(grid: Grid, cameFrom: readonly number[], start: number, goal: number): Position {
  let index = goal;
  while (cameFrom[index] !== start && cameFrom[index] !== -1) index = cameFrom[index];
  return { x: index % grid.width, y: (index - (index % grid.width)) / grid.width };
}

/** A creature adjacent to the player and in the way. Attacking it is how a fighter unblocks a route. */
function stepIntoBlocker(state: LanternWorld, goals: readonly Position[]): Position | null {
  const at = playerOf(state.world).at;
  const world = state.world;
  for (const step of ORTHOGONAL_STEPS) {
    const to = { x: at.x + step.x, y: at.y + step.y };
    if (!inBounds(world.floor.grid, to.x, to.y)) continue;
    const blocker = world.actors.find(
      (actor) => actor.id !== PLAYER_ID && isAlive(actor) && samePosition(actor.at, to),
    );
    if (blocker === undefined) continue;
    // Only worth swinging at if it is actually between the player and something wanted.
    if (goals.some((goal) => manhattanDistance(to, goal) < manhattanDistance(at, goal))) return to;
  }
  return null;
}
