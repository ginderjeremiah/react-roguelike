/**
 * Hand-built `GameState`s for `render/`'s tests.
 *
 * ```ts
 * const state = scenarioState(['#####', '#@.c#', '#####'], { shutter: 'shuttered' });
 * presentScene(state).grid;
 * ```
 *
 * ## Why this exists next to `scenario.ts` rather than inside it
 *
 * `scenario.ts` builds an `ActorWorld`, which is the slice the entity and combat rules take. The
 * presentation model takes a whole `GameState` — it needs the lantern for the shutter, the fuel and
 * the vision, and the run fields for the HUD. Wrapping a scenario world in the four run-level fields
 * is mechanical, and doing it inline in five test files is five chances to construct a state the
 * rules could not reach.
 *
 * ## The liberty this takes, stated once
 *
 * A state built here has **`turnsElapsed: 0`, `commandsResolved: 0` and a fresh generator**, so it is
 * not a state any command log could produce. That is fine for what these tests ask — *given this
 * board and this lantern, what is on screen* — and it is deliberately not fine for anything else:
 * every property about how the model behaves **across** a turn is tested against real states from
 * `runStates`, because a scripted run is the only thing that produces a genuine before/after pair.
 *
 * `perceiveNow` runs the real GDD §2 phase 3 (`lightingAndWakingPhase`) rather than reaching into
 * `remember` directly, so a scenario's terrain memory is the memory the game would have given it —
 * including waking anything standing in the light.
 */

import { RUNNING, withWorld, worldOf, type GameState } from '@/game/core';
import type { ActorWorld } from '@/game/entities';
import { adaptVision, EMBER_SENSE_RADIUS, type ShutterState, type Vision } from '@/game/fov';
import { createRng } from '@/game/rng';
import { createLantern, lightingAndWakingPhase } from '@/game/systems';
import { scenario, type Scenario } from './scenario';

export type StateOptions = {
  /** §4: which way the lantern is set. No default — every caller cares. */
  readonly shutter: ShutterState;
  /** Defaults to `STARTING_FUEL`. `0` is legal, and is only legal while shuttered. */
  readonly fuel?: number;
  /**
   * Where the dark-adaptation ramp has got to. Defaults to `ADAPTATION_FLOOR`, which is where a
   * freshly shuttered lantern sits (§4) — and which is radius **1**, so a creature three tiles away
   * is not felt. Most tests about ember-sense want the full radius and have to say so.
   *
   * Reached by running the real `adaptVision` the required number of times rather than by writing
   * the field, so a test cannot ask for a radius the ramp could not produce.
   */
  readonly senseRadius?: number;
  /** Whether to fold this turn's perception into memory, as GDD §2 phase 3 does. Defaults true. */
  readonly perceive?: boolean;
  readonly seed?: string;
};

/** A run-shaped `GameState` around a hand-built world. See the header for what it does not model. */
export function stateFrom(world: ActorWorld, options: StateOptions): GameState {
  const lantern = createLantern(world.floor.grid, options.shutter, options.fuel);
  const state: GameState = {
    world,
    lantern: { fuel: lantern.fuel, vision: adaptedTo(lantern.vision, options.senseRadius) },
    status: RUNNING,
    turnsElapsed: 0,
    commandsResolved: 0,
    rng: createRng(options.seed ?? 'render'),
  };
  return options.perceive === false ? state : perceiveNow(state);
}

/** Climb §4's ramp to `radius` using the real rule. @throws if the ramp cannot reach it. */
function adaptedTo(vision: Vision, radius: number | undefined): Vision {
  if (radius === undefined) return vision;
  if (!Number.isInteger(radius) || radius < vision.senseRadius || radius > EMBER_SENSE_RADIUS) {
    throw new Error(
      `presentation: the adaptation ramp cannot reach sense radius ${radius} from ` +
        `${vision.senseRadius} (ceiling ${EMBER_SENSE_RADIUS})`,
    );
  }
  let current = vision;
  for (let turns = 0; current.senseRadius < radius; turns += 1) {
    if (turns > EMBER_SENSE_RADIUS) {
      throw new Error('presentation: the adaptation ramp is not climbing — is the shutter open?');
    }
    current = adaptVision(current);
  }
  return current;
}

/**
 * GDD §2 phase 3, applied once: terrain memory grows and anything in the light wakes.
 *
 * The real phase, not a stand-in. A test that set `vision.remembered` by hand would be asserting
 * against a memory the game never builds.
 */
export function perceiveNow(state: GameState): GameState {
  return withWorld(state, lightingAndWakingPhase(worldOf(state)));
}

/** `scenario()` plus the run fields. Returns both, because tests need the ids and the `at` lookup. */
export function scenarioState(
  lines: readonly string[],
  options: StateOptions,
): { readonly state: GameState; readonly scenario: Scenario } {
  const built = scenario(lines);
  return { state: stateFrom(built.world, options), scenario: built };
}
