/**
 * The HUD, as values. GDD §9's minimum, plus the two things a control needs to know about itself.
 *
 * §9: "HUD, minimum: HP, fuel, floor number, shutter state, **ember-sense radius** (because dark
 * adaptation is invisible otherwise)." The fifth is the one that gets dropped, and §4 says why it
 * cannot be: during the four turns after shuttering, the containment guarantee — *everything a flash
 * can wake, you can already feel* — is suspended, and "it stays legible because the HUD shows the
 * number." A HUD without it turns the game's tensest deliberate gamble into an ambush.
 *
 * ## Two fields that are not readouts
 *
 * `shutter.canOpen` and `onStairs` exist because §9 gives each of them a *control*:
 *
 *   - §4 at 0 fuel: "the shutter can no longer be opened". `game/systems/lantern.ts` already stated
 *     that the renderer needs this — "a control that silently does nothing is worse than one that is
 *     visibly dead".
 *   - §9: "**Descend: its own control, present only while you are standing on the stairs.** ... The
 *     control appearing is also unambiguous confirmation that you are on the stairs, which is worth
 *     something in the dark."
 *
 * Both are read from `game/systems/` (`canOpen`, `isOnStairs`) rather than recomputed. A component
 * asking "is the tile under the player a `stairs` tile" would be a game rule in `components/`, and
 * one that drifted from `descend`'s own refusal check would offer a control that does nothing.
 *
 * ## Levels, and why they are not colour
 *
 * `MeterLevel` is a severity, and it is **always accompanied by the number it describes**. That is
 * what keeps §11 satisfied: the level may drive colour in `components/`, but the digits are the
 * carrier. The thresholds below are presentation tuning — they change what looks urgent, never what
 * is true — and they are stated as constants so the change is one line and one test.
 */

import { LAST_FLOOR } from '../game/content';
import { assertNever, floorNumberOf, worldOf, type GameState } from '../game/core';
import { playerOf } from '../game/entities';
import { EMBER_SENSE_RADIUS, type ShutterState } from '../game/fov';
import { burnRate, canOpen, isDry, isOnStairs } from '../game/systems';
import type { MeterLevel } from './colors';

/** At or below a quarter of maximum, a meter is `critical`. Presentation tuning. */
export const CRITICAL_FRACTION = 0.25;

/** At or below half of maximum, a meter is `low`. Presentation tuning. */
export const LOW_FRACTION = 0.5;

/**
 * Fuel is measured in **turns**, not in a fraction of a maximum, and that is not a stylistic choice:
 * there is no maximum. `refuel` has no ceiling (`game/systems/lantern.ts`: "§4 gives none"), so a
 * percentage would be a percentage of a number the game does not have.
 *
 * §4 says how to read it instead — "read it as a number of *turns*" — and at the current burn rate
 * that is exactly `floor(fuel / rate)`. Thresholds are in turns for the same reason.
 */
export const CRITICAL_TURNS_OF_FUEL = 5;

/** Below this many turns of fuel at the current rate, the reserve is `low`. */
export const LOW_TURNS_OF_FUEL = 15;

/** §3's HP, and how loud to be about it. */
export type HealthHud = {
  readonly hp: number;
  readonly maxHp: number;
  /** `hp / maxHp`, `0`..`1`. For a bar; the numbers above are for reading. */
  readonly fraction: number;
  readonly level: MeterLevel;
};

/** §4's reserve, the rate it is draining at, and how long that leaves. */
export type FuelHud = {
  readonly fuel: number;
  /** What **this** turn costs: 4 lit, 1 shuttered (§4). The number that makes a flash legible. */
  readonly burnRate: number;
  /** §4: "read it as a number of turns". `floor(fuel / burnRate)` at the current setting. */
  readonly turnsRemaining: number;
  /** §4: 0 fuel is a desperate state, **not a loss state**. The shutter is stuck shut. */
  readonly dry: boolean;
  readonly level: MeterLevel;
};

/** §9's shutter control: what it reads, and whether it can be pressed. */
export type ShutterHud = {
  readonly state: ShutterState;
  /** §4: false at 0 fuel. The control must show itself dead rather than do nothing. */
  readonly canOpen: boolean;
};

/**
 * §9's required fifth readout: how far ember-sense currently reaches.
 *
 * `adapting` is the four-turn window §4 calls the tensest state in the game — shuttered and not yet
 * back to full. It is derived rather than left to `components/` to compare two numbers, because the
 * comparison is a rule (§4's ramp) and not a display decision.
 */
export type SenseHud = {
  readonly radius: number;
  readonly max: number;
  /** Shuttered and still climbing the ramp. The containment guarantee is suspended (§4). */
  readonly adapting: boolean;
};

/** Where you are in the descent. §8/§13: eight floors, and there is no floor 9. */
export type FloorHud = {
  readonly number: number;
  readonly last: number;
};

/**
 * How the run ended, or that it has not. §13: **exactly two endings**, and they are different states
 * a summary screen has to tell apart — one is a win.
 *
 * The union mirrors `RunStatus` rather than flattening it to `over: boolean`, for the reason
 * `game/core/state.ts` gives: `{ over: true }` with no cause is a state that would compile. The
 * headline is presentation copy and lives here, where it is testable, rather than in `components/`.
 */
export type OutcomeHud =
  | { readonly kind: 'running' }
  | { readonly kind: 'died'; readonly headline: string }
  | { readonly kind: 'reachedBottom'; readonly headline: string };

/** Everything the frame around the board shows. Flat values; no state, no rules. */
export type Hud = {
  readonly health: HealthHud;
  readonly fuel: FuelHud;
  readonly floor: FloorHud;
  readonly shutter: ShutterHud;
  readonly sense: SenseHud;
  /** §13's summary number: turns the player has spent. Not a count of `step` calls. */
  readonly turnsElapsed: number;
  /** §9: the descend control exists only while this is true. */
  readonly onStairs: boolean;
  readonly outcome: OutcomeHud;
};

function meterLevel(fraction: number): MeterLevel {
  if (fraction <= CRITICAL_FRACTION) return 'critical';
  if (fraction <= LOW_FRACTION) return 'low';
  return 'ok';
}

function fuelLevel(turnsRemaining: number): MeterLevel {
  if (turnsRemaining <= CRITICAL_TURNS_OF_FUEL) return 'critical';
  if (turnsRemaining <= LOW_TURNS_OF_FUEL) return 'low';
  return 'ok';
}

function outcomeOf(state: GameState): OutcomeHud {
  switch (state.status.kind) {
    case 'running':
      return { kind: 'running' };
    case 'died':
      return { kind: 'died', headline: 'The lantern goes out.' };
    case 'reachedBottom':
      return { kind: 'reachedBottom', headline: 'You reach the bottom.' };
    default:
      return assertNever(state.status, 'outcomeOf');
  }
}

/**
 * The HUD for one state. Pure, total, and allocating a fresh object every call — it is eight small
 * records and it changes on nearly every turn, so there is nothing here worth memoising.
 */
export function presentHud(state: GameState): Hud {
  const player = playerOf(state.world);
  const lantern = state.lantern;
  const rate = burnRate(lantern.vision.shutter);
  const turnsRemaining = Math.floor(lantern.fuel / rate);

  return {
    health: {
      hp: player.hp,
      maxHp: player.maxHp,
      fraction: player.hp / player.maxHp,
      level: meterLevel(player.hp / player.maxHp),
    },
    fuel: {
      fuel: lantern.fuel,
      burnRate: rate,
      turnsRemaining,
      dry: isDry(lantern),
      level: fuelLevel(turnsRemaining),
    },
    floor: { number: floorNumberOf(state), last: LAST_FLOOR },
    shutter: { state: lantern.vision.shutter, canOpen: canOpen(lantern) },
    sense: {
      radius: lantern.vision.senseRadius,
      max: EMBER_SENSE_RADIUS,
      adapting:
        lantern.vision.shutter === 'shuttered' && lantern.vision.senseRadius < EMBER_SENSE_RADIUS,
    },
    turnsElapsed: state.turnsElapsed,
    onStairs: isOnStairs(worldOf(state)),
    outcome: outcomeOf(state),
  };
}
