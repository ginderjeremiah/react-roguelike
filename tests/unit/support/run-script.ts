/**
 * Scripted players that drive the **real** `step()` with real `Command`s.
 *
 * ```ts
 * const record = diveToTheBottom('emberdepth');   // a full eight-floor run, as a command log
 * replay(record).status;                          // { kind: 'reachedBottom' }
 * ```
 *
 * ## Why a script and not random commands
 *
 * A log of random moves never descends. The stairs are one tile out of 165 and a random walk over a
 * remembered-terrain frontier will not find them inside a test's patience, so a `descend` arm in a
 * command generator that is not deliberately steered is **always a refusal** — which means the one
 * command in the game that draws from the generator would never be exercised by the property suite,
 * and the draw-budget assertion would be vacuous. These scripts exist to make descent reachable.
 *
 * ## The liberty these scripts take, stated once
 *
 * **They route over the real grid and read the real actor list**, rather than over
 * `vision.remembered` and `perceive` the way `lantern-run.ts` does. That is deliberate and it is
 * the opposite trade to the economy harness's: there, what a player *knows* is the thing under
 * measurement, so the script must be blind. Here the thing under measurement is that a command log
 * replays identically, and an omniscient router produces the same kind of log a blind one does —
 * just shorter, and without the 200-turn wander that would make an eight-floor run a slow test.
 *
 * Nothing here is a rule and nothing here is in `game/`. Every command produced is one the player
 * could have issued.
 */

import {
  createInitialState,
  floorNumberOf,
  recordRun,
  runStates,
  step,
  type Command,
  type Direction,
  type GameState,
  type RunRecord,
} from '@/game/core';
import { isAlive, playerOf, type ActorWorld } from '@/game/entities';
import {
  blocksMovement,
  inBounds,
  ORTHOGONAL_STEPS,
  samePosition,
  tileAt,
  tileIndex,
  type Grid,
  type Position,
} from '@/game/map';
import { LAST_FLOOR } from '@/game/content';

/** Give up rather than loop forever if a script cannot make progress. */
const TURN_CAP_PER_FLOOR = 400;

/** The four directions, paired with the step each one is. The inverse of `neighbourOf`. */
const HEADINGS: readonly (readonly [Direction, Position])[] = [
  ['north', { x: 0, y: -1 }],
  ['east', { x: 1, y: 0 }],
  ['south', { x: 0, y: 1 }],
  ['west', { x: -1, y: 0 }],
];

/** Which direction takes you from `from` to the orthogonally adjacent `to`, or `null`. */
export function headingTo(from: Position, to: Position): Direction | null {
  for (const [dir, step] of HEADINGS) {
    if (from.x + step.x === to.x && from.y + step.y === to.y) return dir;
  }
  return null;
}

/** Tiles a living creature is standing on. A route that avoids these never starts a fight. */
function occupied(world: ActorWorld): (index: number) => boolean {
  const grid = world.floor.grid;
  const taken = new Array<boolean>(grid.tiles.length).fill(false);
  for (const actor of world.actors) {
    if (actor.kind === 'creature' && isAlive(actor)) taken[tileIndex(grid, actor.at.x, actor.at.y)] = true;
  }
  return (index) => taken[index];
}

/**
 * One step toward `goal` along a shortest route, or `null` if there is none.
 *
 * Breadth-first, neighbours visited in the fixed `ORTHOGONAL_STEPS` order, so the route is a pure
 * function of the grid and the two positions — never of anything's insertion order.
 */
export function stepTowardOnGrid(
  grid: Grid,
  from: Position,
  goal: Position,
  blocked: (index: number) => boolean,
): Position | null {
  if (samePosition(from, goal)) return null;

  const start = tileIndex(grid, from.x, from.y);
  const cameFrom = new Array<number>(grid.tiles.length).fill(-1);
  const seen = new Array<boolean>(grid.tiles.length).fill(false);
  seen[start] = true;

  const queue: Position[] = [from];
  for (let head = 0; head < queue.length; head += 1) {
    const here = queue[head];
    const index = tileIndex(grid, here.x, here.y);
    if (samePosition(here, goal)) {
      let walk = index;
      while (cameFrom[walk] !== start && cameFrom[walk] !== -1) walk = cameFrom[walk];
      return { x: walk % grid.width, y: (walk - (walk % grid.width)) / grid.width };
    }

    for (const offset of ORTHOGONAL_STEPS) {
      const x = here.x + offset.x;
      const y = here.y + offset.y;
      if (!inBounds(grid, x, y) || blocksMovement(tileAt(grid, x, y))) continue;
      const next = tileIndex(grid, x, y);
      if (seen[next] || blocked(next)) continue;
      seen[next] = true;
      cameFrom[next] = index;
      queue.push({ x, y });
    }
  }
  return null;
}

/** The next command a diver would issue, or `null` if it is stuck. */
function diveCommand(state: GameState): Command | null {
  const world = state.world;
  const at = playerOf(world).at;
  const stairs = world.floor.stairs;

  if (samePosition(at, stairs)) return { kind: 'descend' };

  // Around living creatures first; through them (which `bump` resolves as an attack) only if the
  // floor gives no other way, which a doorway occupied by a Cinder can genuinely do.
  const around = stepTowardOnGrid(world.floor.grid, at, stairs, occupied(world));
  const through = around ?? stepTowardOnGrid(world.floor.grid, at, stairs, () => false);
  if (through === null) return null;
  const dir = headingTo(at, through);
  return dir === null ? null : { kind: 'move', dir };
}

/**
 * A run that goes straight down, in the dark, all the way to the bottom.
 *
 * **Shutters on the very first command and never opens again**, which is why it survives: §4 says
 * nothing wakes in the dark, and a dormant creature is not a threat — it is a tile to walk around.
 * The lantern runs dry somewhere around floor three, which is not an ending (§4, §13) and is part of
 * what makes this a useful fixture rather than a sanitized one.
 *
 * @param through how many floors to descend from. `LAST_FLOOR` produces a winning run.
 */
export function diveToTheBottom(seed: string, through: number = LAST_FLOOR): RunRecord {
  const commands: Command[] = [{ kind: 'setShutter', to: 'shuttered' }];
  let state = step(createInitialState(seed), commands[0]);

  // Bounded on the number of *floors* as well as on the turns within one. Found by mutation
  // testing: a `descend` that regenerated the current floor number instead of the next one left
  // this loop descending forever, and the mutant was killed by the test runner timing out rather
  // than by an assertion — which is a survivor wearing a red X. A loud throw names the rule.
  for (let floors = 0; floorNumberOf(state) <= through; floors += 1) {
    if (floors > LAST_FLOOR) {
      throw new Error(
        `run-script: descended ${floors} times without passing floor ${through} — descent is not ` +
          `advancing the floor number`,
      );
    }
    let guard = 0;
    for (;;) {
      const command = diveCommand(state);
      if (command === null) throw new Error(`run-script: stuck on floor ${floorNumberOf(state)}`);
      const before = state;
      commands.push(command);
      state = step(state, command);
      if (command.kind === 'descend') break;
      if (state === before) throw new Error(`run-script: ${JSON.stringify(command)} was refused`);
      guard += 1;
      if (guard > TURN_CAP_PER_FLOOR) {
        throw new Error(`run-script: floor ${floorNumberOf(state)} took more than ${TURN_CAP_PER_FLOOR} turns`);
      }
    }
    if (state.status.kind !== 'running') break;
  }

  return recordRun(seed, commands);
}

/**
 * The state of a dark dive at the moment it is standing on floor `floorNumber`'s stairs.
 *
 * The one situation that is genuinely awkward to construct by hand — it needs a *generated* floor,
 * because a hand-built scenario's stairs are not the ones a descent is taken from — and it is the
 * precondition of every descent test.
 */
export function atTheStairs(seed: string, floorNumber: number = 1): GameState {
  const record = diveToTheBottom(seed, floorNumber);
  const states = runStates(record.seed, record.commands);
  // The log ends with the descent off that floor, so the state before it is the one standing there.
  const state = states[states.length - 2];
  if (floorNumberOf(state) !== floorNumber) {
    throw new Error(`run-script: expected to be on floor ${floorNumber}, got ${floorNumberOf(state)}`);
  }
  return state;
}

/** Manhattan distance. The metric §4's radii are not measured in, and the one a router needs. */
function stepsApart(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** The living creature nearest the player, by distance then by id. `null` on an empty floor. */
function nearestCreature(world: ActorWorld): { readonly at: Position } | null {
  const at = playerOf(world).at;
  let best: { at: Position; distance: number } | null = null;
  // `world.actors` is in ascending id order, and `>` rather than `>=` keeps the first of a tie — so
  // the target is a pure function of the board and never of iteration order (ADR-0004).
  for (const actor of world.actors) {
    if (actor.kind !== 'creature' || !isAlive(actor)) continue;
    const distance = stepsApart(at, actor.at);
    if (best === null || distance < best.distance) best = { at: actor.at, distance };
  }
  return best;
}

/** How close the flasher walks before it opens up. Inside `LIT_RADIUS` (4) with room to spare. */
const FLASH_RANGE = 2;

/**
 * A run that walks in the dark, gets close to something asleep, and then opens the shutter.
 *
 * **This is the play pattern the light wager is about**, and neither of the two scripts above
 * contains it: `diveToTheBottom` shutters on command 1 and never opens again, and `standUntilDead`
 * stands in its own light from turn 0 and never moves. Between them they never produce a single
 * `dormant` → `awake` **transition** — the dive wakes nothing at all, and the lit run's creatures
 * were already woken by the opening state's phase 3 before the first command was issued. So the
 * corpus in `render/cues.test.ts` could assert every property about waking and be describing a cue
 * that never fires. This script exists to close that hole, and it is also the pattern #83 is about:
 * you approach unseen, you flash, and now something is coming.
 *
 * Deliberately stops at `FLASH_RANGE` rather than walking adjacent: a bump on an adjacent tile is an
 * attack (§3), which would make this a combat fixture instead of a lighting one.
 *
 * **Throws if the flash wakes nothing.** A fixture that quietly produced no wake would leave the
 * completeness test above passing for the wrong reason on some future seed, which is exactly the
 * failure this script was added to fix.
 *
 * @param after how many turns to keep waiting, in the light, once something is awake — which is what
 *   makes the *silence* of re-lighting an already-awake creature observable in the corpus.
 */
export function walkInTheDarkThenFlash(seed: string, after: number = 4): RunRecord {
  const commands: Command[] = [{ kind: 'setShutter', to: 'shuttered' }];
  let state = step(createInitialState(seed), commands[0]);

  for (let turns = 0; ; turns += 1) {
    if (turns > TURN_CAP_PER_FLOOR) {
      throw new Error(`run-script: seed ${JSON.stringify(seed)} never got within flash range`);
    }
    const target = nearestCreature(state.world);
    if (target === null) throw new Error(`run-script: seed ${JSON.stringify(seed)} has no creature`);
    if (stepsApart(playerOf(state.world).at, target.at) <= FLASH_RANGE) break;

    const at = playerOf(state.world).at;
    // Around every *other* creature, but not around the target — whose tile is the goal, and which a
    // blocked-goal search would refuse to reach at all. The walk stops two tiles short regardless.
    const taken = occupied(state.world);
    const grid = state.world.floor.grid;
    const goalIndex = tileIndex(grid, target.at.x, target.at.y);
    const next = stepTowardOnGrid(grid, at, target.at, (index) => index !== goalIndex && taken(index));
    const dir = next === null ? null : headingTo(at, next);
    if (dir === null) throw new Error(`run-script: seed ${JSON.stringify(seed)} cannot reach a sleeper`);

    commands.push({ kind: 'move', dir });
    const before = state;
    state = step(state, commands[commands.length - 1]);
    if (state === before) throw new Error(`run-script: the walk was refused on seed ${seed}`);
  }

  const dark = state;
  commands.push({ kind: 'setShutter', to: 'open' });
  state = step(state, commands[commands.length - 1]);
  if (!wokeBetween(dark, state)) {
    throw new Error(`run-script: the flash on seed ${JSON.stringify(seed)} woke nothing`);
  }

  for (let i = 0; i < after && state.status.kind === 'running'; i += 1) {
    commands.push({ kind: 'wait' });
    state = step(state, commands[commands.length - 1]);
  }
  return recordRun(seed, commands);
}

/** Did any creature go dormant → awake across this pair? Computed here, never read from `render/`. */
function wokeBetween(before: GameState, after: GameState): boolean {
  const wasDormant = new Set(
    before.world.actors.filter((a) => a.kind === 'creature' && a.mind.kind === 'dormant').map((a) => a.id),
  );
  return after.world.actors.some(
    (a) => a.kind === 'creature' && a.mind.kind === 'awake' && wasDormant.has(a.id),
  );
}

/**
 * A run that stands in its own light until something kills it.
 *
 * Holds the shutter open — which wakes every creature that comes into the lit radius (§4) — and
 * waits. The Cinders path in and attack; 12 HP at 2 a hit is six landed attacks. Returns as soon as
 * the player is dead, plus `after` further commands, which the caller uses to assert that a
 * finished run refuses everything it is handed (§13).
 */
export function standUntilDead(seed: string, after: number = 3): RunRecord {
  const commands: Command[] = [];
  let state = createInitialState(seed);

  for (let i = 0; i < TURN_CAP_PER_FLOOR && state.status.kind === 'running'; i += 1) {
    const command: Command = { kind: 'wait' };
    commands.push(command);
    state = step(state, command);
  }
  if (state.status.kind !== 'died') {
    throw new Error(`run-script: seed ${JSON.stringify(seed)} did not produce a death`);
  }

  for (let i = 0; i < after; i += 1) commands.push({ kind: 'wait' });
  return recordRun(seed, commands);
}

/**
 * A run that crawls to an ember cache in the dark, flashes it, shuts, and then walks onto it.
 *
 * **The play pattern §4's cache rule creates** (#31/#41), and the only script in this file that
 * collects one: *the lantern prospects, the dark hauls.* Every step of it is load-bearing —
 *
 *   1. shutter, and crawl to a tile **orthogonally adjacent** to the cache. Nothing about the cache
 *      is known yet; §4 says the tile is felt as ordinary floor, so this walk pays nothing.
 *   2. `setShutter open`. Free (§2), and phase 3 folds the lit field into `vision.revealed`. From
 *      adjacent there is no line-of-sight question to get wrong.
 *   3. `setShutter shuttered`, before taking a single step. This is what makes the fixture a test of
 *      **ever** lit rather than *currently* lit: the cache is collected with the lantern shut, on a
 *      turn during which no light falls on it at all.
 *   4. step onto it. Phase 5 pays, the tile becomes floor, and it leaves `floor.caches`.
 *
 * Steps 2 and 3 are one command each and cost no turn, so the whole detour is 5 fuel.
 *
 * **Throws if the cache is not collected.** The whole value of this fixture is the pickup, and a
 * seed on which the crawl gets walled in would otherwise leave every consumer of it green and
 * measuring a run in which nothing happened.
 */
export function takeACacheTheLanternFound(seed: string): RunRecord {
  const commands: Command[] = [{ kind: 'setShutter', to: 'shuttered' }];
  let state = step(createInitialState(seed), commands[0]);

  const cache = state.world.floor.caches[0];
  if (cache === undefined) throw new Error(`run-script: seed ${JSON.stringify(seed)} has no cache`);

  for (let turns = 0; stepsApart(playerOf(state.world).at, cache) > 1; turns += 1) {
    if (turns > TURN_CAP_PER_FLOOR) {
      throw new Error(`run-script: seed ${JSON.stringify(seed)} never reached its cache`);
    }
    const at = playerOf(state.world).at;
    const grid = state.world.floor.grid;
    // Around living creatures, then through them if the floor leaves no other way — the same
    // fallback `diveCommand` uses, and for the same reason (a Cinder can genuinely own a doorway).
    const next =
      stepTowardOnGrid(grid, at, cache, occupied(state.world)) ??
      stepTowardOnGrid(grid, at, cache, () => false);
    const dir = next === null ? null : headingTo(at, next);
    if (dir === null) throw new Error(`run-script: seed ${JSON.stringify(seed)} cannot reach its cache`);

    commands.push({ kind: 'move', dir });
    const before = state;
    state = step(state, commands[commands.length - 1]);
    if (state === before) throw new Error(`run-script: the crawl was refused on seed ${seed}`);
  }

  for (const to of ['open', 'shuttered'] as const) {
    commands.push({ kind: 'setShutter', to });
    state = step(state, commands[commands.length - 1]);
  }

  const dir = headingTo(playerOf(state.world).at, cache);
  if (dir === null) throw new Error(`run-script: seed ${JSON.stringify(seed)} stopped off-axis`);
  commands.push({ kind: 'move', dir });
  const before = state;
  state = step(state, commands[commands.length - 1]);

  if (state.world.floor.caches.length !== before.world.floor.caches.length - 1) {
    throw new Error(`run-script: seed ${JSON.stringify(seed)} never collected its cache`);
  }
  return recordRun(seed, commands);
}
