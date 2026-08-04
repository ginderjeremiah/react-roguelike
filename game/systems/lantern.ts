/**
 * The lantern: fuel, the shutter, and the one rule that binds them. GDD §4.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * EMBER-SENSE IS NOT THE LAMP — AND FUEL AT 0 IS THE END OF THE RUN
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * §4, ruled 2026-08-04 (*The dark can take nothing*, #144/#149): **fuel reaching 0 ends the run.**
 * §13 lists it beside HP death. Nothing in *this* file implements that — the ending is one condition
 * in `game/core/state.ts`'s `statusAfterTurn`, evaluated after the whole phase list so that ember
 * collected on the same command still counts. What this file owns is unchanged: the reserve, the
 * shutter, the burn, and the clamp.
 *
 * **What survives the ruling, whole, is the rule this banner was really about: ember-sense is the
 * player's dark-adapted eyes and not the lamp.** It does not shrink with the fuel. A shuttered player
 * at 1 fuel senses at the radius the ramp has earned them, touch still reaches one tile, and the
 * dormant strike still works. The alternative — that ember-sense is powered by the lantern and
 * collapses to 1 as it empties — would make the last turns of a run a state in which the player can
 * neither see a destination nor reach one, which is the *unplayable rather than desperate* failure §4
 * has guarded against from the beginning. That guard is why the ending had to be short rather than
 * survivable, and it is why it is stated over the *run* rather than over the vision table.
 *
 * > **This banner read `FUEL AT 0 IS NOT A LOSS STATE` for three milestones, and argued that a dry
 * > lantern was "the shuttered column of §4's vision table, permanently".** It was right about the
 * > failure it was guarding against and wrong about the cure: measured, a dry crawl reached the
 * > stairs on **80 of 80** corpus floors, and *a state a corpus survives 80 times out of 80 is not a
 * > desperate state, it is the absence of a clock*. §4 carries the argument, the runner-up and the
 * > cost. Recorded rather than deleted because the half that survives is the half that is easy to
 * > delete by accident.
 *
 * **`canOpen` and `isDry` are now true of nothing a live run can reach**, since 0 fuel cannot persist
 * across a command. They stay: `createLantern` guards the same state at the other end, a fixture or a
 * test can still construct one, and `isDry` is what `statusAfterTurn` asks.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## Running dry shuts the shutter
 *
 * `game/systems/turn.ts` already wrote this rule down, as the justification for GDD §2's phase
 * order: "Fuel burns (2) *before* lighting recomputes (3), so the turn you run dry is the turn the
 * shutter shuts, not the turn after." A lantern with no fuel is not lit — so `burn` closes the
 * shutter on the command the fuel reaches 0, which is why a flash asked for with 4 fuel or less
 * produces no light at all. **That is the lantern going out mid-command and it is not a bug**: it
 * costs one line, it is what the phase order is for, and since #149 the same command is the last one
 * the run resolves unless phase 5 finds fuel underfoot.
 *
 * ## What is state and what is a rule
 *
 * A `Lantern` is two fields: how much fuel is left, and the `Vision` the shutter drives. `Vision`
 * is owned by `game/fov/` and is not re-implemented here — the shutter transitions are its
 * `openShutter` / `closeShutter`, and this module's only addition is the fuel guard in front of one
 * of them.
 */

import { assertNever } from '../core/assert';
import { FUEL_BURN_LIT, FUEL_BURN_SHUTTERED, STARTING_FUEL } from '../content';
import {
  closeShutter,
  createVision,
  openShutter,
  type ShutterState,
  type Vision,
} from '../fov';
import type { Grid } from '../map';

/**
 * The lantern, across turns. Plain JSON-shaped data — `Vision`'s tile set is a `boolean[]`, not a
 * `Set`, for the reason `fov/tileset.ts` gives.
 */
export type Lantern = {
  /**
   * Ember remaining. Never negative, and **0 is the end of the run** (§4, §13) rather than a state
   * to be played from — though it is a legal *intermediate* value, reached in phase 2 and possibly
   * left behind by phase 5 on the same command.
   */
  readonly fuel: number;
  /** Where the shutter is, how far ember-sense currently reaches, and what has been seen. */
  readonly vision: Vision;
};

/**
 * The lantern a run starts with.
 *
 * `shutter` has no default for the same reason `createVision` has none: §4 never says which way the
 * shutter starts a run, so whoever owns the start of a run has to say. The fuel does have one,
 * because §4 does say — 80 (tuning).
 *
 * @throws if asked for an open shutter with no fuel. That is a state the rules cannot reach and
 *   `open` cannot leave, so accepting it would mean a lantern that is lit and dry at the same time.
 */
export function createLantern(
  grid: Grid,
  shutter: ShutterState,
  fuel: number = STARTING_FUEL,
): Lantern {
  assertFuel(fuel, 'createLantern');
  if (shutter === 'open' && fuel === 0) {
    throw new Error('lantern: a run cannot start with the shutter open and no fuel to burn');
  }
  return { fuel, vision: createVision(grid, shutter) };
}

function assertFuel(fuel: number, context: string): void {
  if (!Number.isSafeInteger(fuel) || fuel < 0) {
    throw new Error(`lantern: ${context} needs a non-negative integer fuel, got ${String(fuel)}`);
  }
}

/**
 * §4's fuel table: 4 per turn open, 1 per turn shuttered (both tuning).
 *
 * An exhaustive switch rather than a lookup object, so a third shutter state would be a compile
 * error here rather than an `undefined` burn rate that silently makes light free.
 */
export function burnRate(shutter: ShutterState): number {
  switch (shutter) {
    case 'open':
      return FUEL_BURN_LIT;
    case 'shuttered':
      return FUEL_BURN_SHUTTERED;
    default:
      return assertNever(shutter, 'burnRate');
  }
}

/**
 * No fuel left — **the lamp is out, and the run with it** (§4, §13).
 *
 * Asked by `statusAfterTurn` once the whole phase list has run, which is the only place the answer
 * decides anything. Everywhere else it is a question about a hand-built lantern.
 */
export function isDry(lantern: Lantern): boolean {
  return lantern.fuel === 0;
}

/**
 * §4: at 0 fuel "the shutter can no longer be opened".
 *
 * Stated as its own predicate because the renderer needs it too — §9's thumb toggle has to be able
 * to show itself as unavailable, and a control that silently does nothing is worse than one that is
 * visibly dead.
 *
 * **No live run reaches the state it is false in**, since fuel reaching 0 ends the run. It is kept
 * rather than deleted for the reason `createLantern`'s guard is: the state is still constructible,
 * and the alternative to a guard is `open` returning a lantern that is lit and dry at once.
 */
export function canOpen(lantern: Lantern): boolean {
  return lantern.fuel > 0;
}

/**
 * Open the shutter, if there is anything left to burn.
 *
 * A refusal returns the lantern **unchanged** rather than throwing: at 0 fuel the player still has
 * the toggle under their thumb and pressing it is a perfectly ordinary thing to do. It is also why
 * this is not a `TurnCost`-carrying decision — refused or not, the toggle is free (§2).
 */
export function open(lantern: Lantern): Lantern {
  if (!canOpen(lantern)) return lantern;
  return { fuel: lantern.fuel, vision: openShutter(lantern.vision) };
}

/** Shutter the lantern. Always allowed — going dark costs nothing and needs nothing. */
export function shutter(lantern: Lantern): Lantern {
  return { fuel: lantern.fuel, vision: closeShutter(lantern.vision) };
}

/** Set the shutter either way. Dispatches to the two transitions; only `open` can be refused. */
export function setLanternShutter(lantern: Lantern, to: ShutterState): Lantern {
  switch (to) {
    case 'open':
      return open(lantern);
    case 'shuttered':
      return shutter(lantern);
    default:
      return assertNever(to, 'setLanternShutter');
  }
}

/**
 * Flip the shutter. §9's thumb control, and §2's free action.
 *
 * Toggling *toward* open is refused when dry, so at 0 fuel this function is the identity — which is
 * what makes "the shutter can no longer be opened" observable rather than a comment.
 */
export function toggleShutter(lantern: Lantern): Lantern {
  switch (lantern.vision.shutter) {
    case 'open':
      return shutter(lantern);
    case 'shuttered':
      return open(lantern);
    default:
      return assertNever(lantern.vision.shutter, 'toggleShutter');
  }
}

/**
 * GDD §2 phase 2: "Fuel burns at the current shutter rate."
 *
 * Clamped at 0 and, on reaching it, the shutter shuts — see the header. The clamp is not defensive
 * tidiness: a negative fuel value would make `canOpen` and `isDry` disagree about the same lantern
 * and would render as a negative number on the HUD.
 *
 * **Called once per resolved command, including a free one.** §4 prices a flash at 4 fuel, which is
 * only true if opening the shutter burns; `light.ts`'s header quotes the arithmetic.
 */
export function burn(lantern: Lantern): Lantern {
  const fuel = Math.max(0, lantern.fuel - burnRate(lantern.vision.shutter));
  if (fuel > 0) return { fuel, vision: lantern.vision };
  // Out of fuel: the flame goes out this turn, not next. `closeShutter` resets dark adaptation on
  // the open -> shuttered transition, so running dry while lit costs the four blind turns as well.
  return { fuel, vision: closeShutter(lantern.vision) };
}

/**
 * Add fuel — §4's two sources, a kill (the Cinder's ember) and a cache.
 *
 * No ceiling. §4 gives none, and one would silently discard the back half of a cache the player went
 * off-route for, which is the wager §5 step 8 exists to create.
 *
 * @throws on a negative or fractional amount. Both would be a fuel *leak* wearing the name of a
 *   gain, and the symptom — a run that gets harder when you kill things — would be read as balance.
 */
export function refuel(lantern: Lantern, amount: number): Lantern {
  assertFuel(amount, 'refuel');
  if (amount === 0) return lantern;
  return { fuel: lantern.fuel + amount, vision: lantern.vision };
}
