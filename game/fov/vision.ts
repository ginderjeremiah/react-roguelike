/**
 * The player's vision state and the GDD §4 numbers that drive it.
 *
 * Every radius here is **Chebyshev** — `max(|dx|, |dy|) <= r`, a square (issue #25, §4). One metric
 * for the lit radius, the touch radius, ember-sense, and every value the adaptation ramp passes
 * through. There is no second metric in this module and there should never be one.
 *
 * ## What is state and what is derived
 *
 * `Vision` is the three things that survive a turn: which way the shutter is set, how far
 * ember-sense currently reaches, and what terrain has ever been seen. Everything else — the lit
 * field, the felt creatures — is recomputed from the map every turn by `perceive`, because storing
 * it would mean a second copy of the truth that can disagree with the first.
 *
 * ## The transitions are the rules
 *
 * `closeShutter` is the only thing that resets the adaptation ramp, and it does so only on an
 * actual open-to-shut transition. Shuttering an already-shut shutter is not a shuttering event, and
 * if it reset the ramp, a stray no-op command would blind the player for four turns.
 */

import type { Grid } from '../map';
import { assertNever } from '../core/assert';
import { emptyTileSet, hasTile, tileSetContains, unionTileSets, type TileSet } from './tileset';

/** GDD §4. Lit terrain, line-of-sight blocked. Exactly the corner-to-corner span of the largest room. */
export const LIT_RADIUS = 4;

/** GDD §4. Shuttered terrain: the 8 tiles you can touch, plus the one you stand on. No line of sight. */
export const DARK_TOUCH_RADIUS = 1;

/** GDD §4 (tuning). Ember-sense at full dark adaptation. Through walls. */
export const EMBER_SENSE_RADIUS = 5;

/**
 * GDD §4. Where ember-sense drops to the instant the shutter closes.
 *
 * The same 1 as `DARK_TOUCH_RADIUS`, deliberately: shuttered, you know only what you can touch,
 * stone and ember alike. It is also what makes the ramp exactly four turns long — see
 * `TURNS_TO_FULL_ADAPTATION`.
 */
export const ADAPTATION_FLOOR = 1;

/** GDD §4. Recovery is +1 per turn. */
export const ADAPTATION_STEP = 1;

/**
 * How many turns after shuttering until ember-sense is back to full: 1 -> 2 -> 3 -> 4 -> 5.
 *
 * Derived rather than written down, so that changing a radius cannot leave the documented ramp
 * length behind as a lie. §4 calls these "the four turns after you shutter", and they are the
 * tensest state in the game because the containment guarantee is suspended for all of them.
 */
export const TURNS_TO_FULL_ADAPTATION = (EMBER_SENSE_RADIUS - ADAPTATION_FLOOR) / ADAPTATION_STEP;

/**
 * Where the shutter is.
 *
 * A bare string union rather than the object union `map/grid.ts` argues for, because there is no
 * payload waiting in the wings: everything a shutter state carries is already a field of `Vision`
 * (the adaptation radius) or a rule elsewhere (fuel burn per turn, §4). If one ever arrives, this
 * is a two-line change in one file.
 */
export type ShutterState = 'open' | 'shuttered';

/** The player's vision, across turns. Plain JSON-shaped data; see `tileset.ts` on the array. */
export type Vision = {
  readonly shutter: ShutterState;
  /**
   * Chebyshev reach of ember-sense **right now**, between `ADAPTATION_FLOOR` and
   * `EMBER_SENSE_RADIUS`. §9 requires the HUD to show this number: the adaptation gamble is only
   * fair if the player can read how blind they currently are.
   */
  readonly senseRadius: number;
  /** Every tile ever perceived. Permanent, and never shrinks. The renderer dims these. */
  readonly remembered: TileSet;
};

/**
 * The vision a run starts with.
 *
 * Starts fully dark-adapted whichever way the shutter is set, because the ramp is triggered by the
 * *act* of shuttering (§4: "on shuttering") and no shuttering has happened yet. §4 does not say
 * which way the shutter starts, so the caller has to; that decision belongs with whoever owns the
 * start of a run, not with FOV.
 */
export function createVision(grid: Grid, shutter: ShutterState): Vision {
  return { shutter, senseRadius: EMBER_SENSE_RADIUS, remembered: emptyTileSet(grid) };
}

/**
 * Shutter the lantern: ember-sense collapses to `ADAPTATION_FLOOR` and starts climbing again.
 *
 * A no-op on an already-shuttered vision — the ramp resets on the transition, not on the command.
 */
export function closeShutter(vision: Vision): Vision {
  if (vision.shutter === 'shuttered') return vision;
  return { shutter: 'shuttered', senseRadius: ADAPTATION_FLOOR, remembered: vision.remembered };
}

/**
 * Open the lantern.
 *
 * The adaptation radius is left where it is. It is not readable while the shutter is open — light
 * shows creatures, ember-sense does not (§4's vision table) — and closing the shutter resets it to
 * the floor regardless, so it cannot be laundered by flicking the shutter.
 */
export function openShutter(vision: Vision): Vision {
  if (vision.shutter === 'open') return vision;
  return { shutter: 'open', senseRadius: vision.senseRadius, remembered: vision.remembered };
}

/** Set the shutter either way. The command layer's entry point; dispatches to the two transitions. */
export function setShutter(vision: Vision, shutter: ShutterState): Vision {
  switch (shutter) {
    case 'open':
      return openShutter(vision);
    case 'shuttered':
      return closeShutter(vision);
    default:
      return assertNever(shutter, 'setShutter');
  }
}

/**
 * One turn of dark adaptation: `+ADAPTATION_STEP`, capped at `EMBER_SENSE_RADIUS`.
 *
 * Only while shuttered. Eyes do not dark-adapt with the lantern open, and since `closeShutter`
 * resets to the floor anyway, ramping while open would be unobservable — an unobservable rule is
 * one nobody can reason about later, so this module does not have one.
 */
export function adaptVision(vision: Vision): Vision {
  if (vision.shutter === 'open') return vision;
  if (vision.senseRadius >= EMBER_SENSE_RADIUS) return vision;
  return {
    shutter: vision.shutter,
    senseRadius: Math.min(vision.senseRadius + ADAPTATION_STEP, EMBER_SENSE_RADIUS),
    remembered: vision.remembered,
  };
}

/**
 * Fold this turn's perceived terrain into permanent memory.
 *
 * Union only — memory never shrinks, which is the whole of §4's "permanent once seen". Returns the
 * same vision when nothing new was perceived, so a turn spent in a room you have already mapped
 * allocates nothing.
 */
export function remember(vision: Vision, perceived: TileSet): Vision {
  if (tileSetContains(vision.remembered, perceived)) return vision;
  return {
    shutter: vision.shutter,
    senseRadius: vision.senseRadius,
    remembered: unionTileSets(vision.remembered, perceived),
  };
}

/** How much the player knows about one tile. The three states the renderer draws (§4, §10). */
export type TileKnowledge = 'unknown' | 'remembered' | 'perceived';

/**
 * Classify a tile for the renderer: perceived this turn, remembered from an earlier one, or never
 * seen at all.
 *
 * Perceived wins over remembered, so a tile does not lose its highlight by being familiar.
 */
export function tileKnowledge(
  perceived: TileSet,
  remembered: TileSet,
  x: number,
  y: number,
): TileKnowledge {
  if (hasTile(perceived, x, y)) return 'perceived';
  if (hasTile(remembered, x, y)) return 'remembered';
  return 'unknown';
}
