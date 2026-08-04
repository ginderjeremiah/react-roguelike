/**
 * The player's vision state and the GDD §4 numbers that drive it.
 *
 * Every radius here is **Chebyshev** — `max(|dx|, |dy|) <= r`, a square (issue #25, §4). One metric
 * for the lit radius, the touch radius, ember-sense, and every value the adaptation ramp passes
 * through. There is no second metric in this module and there should never be one.
 *
 * ## What is state and what is derived
 *
 * `Vision` is the four things that survive a turn: which way the shutter is set, how far
 * ember-sense currently reaches, what terrain has ever been seen, and what terrain the *lantern*
 * has ever shown you. Everything else — the lit field, the felt creatures — is recomputed from the
 * map every turn by `perceive`, because storing it would mean a second copy of the truth that can
 * disagree with the first.
 *
 * The last of the four is new and is §4's cache rule; see *WHAT THE LANTERN HAS SHOWN YOU* below.
 *
 * ## The transitions are the rules
 *
 * `closeShutter` is the only thing that resets the adaptation ramp, and it does so only on an
 * actual open-to-shut transition. Shuttering an already-shut shutter is not a shuttering event, and
 * if it reset the ramp, a stray no-op command would blind the player for four turns.
 */

import { FLOOR, tileAt, type Grid, type Tile } from '../map';
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
  /**
   * Every tile the **lantern** has ever lit — a subset of `remembered`, and the other monotone
   * plane. §4's cache rule reads this one and nothing else reads it; see the block below.
   */
  readonly revealed: TileSet;
};

/**
 * The vision a run starts with: **at the adaptation floor, never at the ceiling.**
 *
 * §4: "*Full adaptation is always earned.* Ember-sense reaches 5 only after four turns spent
 * shuttered, so a run's sense radius starts at the floor, 1, not at the ceiling." This function
 * used to hand out `EMBER_SENSE_RADIUS`, on the reasoning that the ramp is triggered by the *act*
 * of shuttering and no shuttering has happened yet. That reasoning is not wrong so much as
 * irrelevant: it makes `createVision(grid, 'shuttered')` a free radius-5 wall-piercing sense on
 * turn 1, which is the most generous available reading of a rule §4 states as a cost.
 *
 * It is unobservable in play at M1 — shuttering resets to the floor regardless — but §9 puts the
 * number on the HUD, and a HUD reading 5 before the player has ever been dark is a lie they will
 * act on. Stating it here rather than at the start-of-run call site is what stops the next
 * start-state (a descent, a debug mode) reintroducing the gift.
 *
 * §4 does not say which way the shutter starts, so the caller has to; that decision belongs with
 * whoever owns the start of a run, not with FOV. (`game/systems/run.ts` answers it: open.)
 */
export function createVision(grid: Grid, shutter: ShutterState): Vision {
  return {
    shutter,
    senseRadius: ADAPTATION_FLOOR,
    remembered: emptyTileSet(grid),
    // Empty even when the shutter starts open: the lantern has not *lit* anything yet. §2 phase 3
    // is what fills this in, and `run.ts` runs it once before the first command precisely so that
    // the opening room is revealed by the same rule every other room is.
    revealed: emptyTileSet(grid),
  };
}

/**
 * Shutter the lantern: ember-sense collapses to `ADAPTATION_FLOOR` and starts climbing again.
 *
 * A no-op on an already-shuttered vision — the ramp resets on the transition, not on the command.
 */
export function closeShutter(vision: Vision): Vision {
  if (vision.shutter === 'shuttered') return vision;
  return {
    shutter: 'shuttered',
    senseRadius: ADAPTATION_FLOOR,
    remembered: vision.remembered,
    revealed: vision.revealed,
  };
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
  return {
    shutter: 'open',
    senseRadius: vision.senseRadius,
    remembered: vision.remembered,
    // Opening reveals nothing by itself. The light has to *fall* somewhere, which is phase 3.
    revealed: vision.revealed,
  };
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
    // The Math.min is unreachable defence: the `>= EMBER_SENSE_RADIUS` guard above already
    // bounds this, so dropping the cap is a third provably-equivalent mutant alongside the two
    // in the module headers. Kept because it makes the ceiling local and obvious, and noted here
    // so a later mutation run does not spend time re-deriving that it is harmless.
    senseRadius: Math.min(vision.senseRadius + ADAPTATION_STEP, EMBER_SENSE_RADIUS),
    remembered: vision.remembered,
    revealed: vision.revealed,
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
    revealed: vision.revealed,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// WHAT THE LANTERN HAS SHOWN YOU — GDD §4, ruled 2026-08-01 (#31, #41), widened 2026-08-04 (#144)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// > **The dark can take nothing. Fuel is taken only from a tile the lantern has lit. Until it has,
// > the tile is floor to you — you feel it, you walk over it, and nothing happens. Once it has, what
// > is on it is yours whenever you stand there, lit or not.**
//
// Both halves of that rule read one bit, which is why it is one plane and not two mechanisms:
//
//   - **Perception.** `perceivedTileAt` reports a cache the lantern has not lit as ordinary
//     `floor`. Not as *nothing*: the tile still enters `remembered` by the ordinary route, because
//     a permanent blank cell in ground you have crawled is a **better** cache detector than the `♦`
//     would have been, and because it would break §4's *"you always know your own four
//     neighbours"*, which §2 spends to refuse an illegal move for free.
//   - **Collection.** `game/systems/light.ts` phase 5 pays a cache **and a kill's drop** only where
//     `hasBeenLit`. Keyed on **ever** lit rather than *currently* lit, because the stricter reading
//     would manufacture an autopilot: the shutter is free and §2 runs phase 5 on free actions, so
//     `open`-`shut` **while standing on the tile** would take whatever is on it for 4 fuel and no
//     *further* turns. Phase 5 pays underfoot only, so this is not a reach onto adjacent tiles and
//     the turn spent getting there is charged either way.
//
//     *The other original argument for **ever** lit is spent, and is recorded rather than restated:*
//     it was that at 0 fuel the shutter cannot open, so *currently* lit would falsify §4's "a kill or
//     a cache re-opens the shutter the moment it lands" in exactly the desperate state that sentence
//     protects. §4's *The dark can take nothing* deletes the desperate state — fuel reaching 0 ends
//     the run — so that argument has lost its premise. The autopilot argument carries the clause
//     alone, and it never depended on the fuel rule at all.
//
// **A kill's drop used to be excluded from this and is now covered** (#144, ruled 2026-08-04). §4
// read *"ember you made is yours; ember the ruin hid belongs to the lantern"*; it now reads *"ember
// the ruin hid, the lantern finds; ember you made, the lantern claims; neither is yours in the
// dark"*. The drop is still **drawn** where its tile is perceived or remembered, which is #81 and is
// what keeps the uncollected drop a destination rather than a secret.
//
// This plane is **monotone and per floor**, exactly like `remembered`: it only grows, and §13 says
// a descent leaves the map behind, so `arriveOnFloor` rebuilds it from the new grid rather than
// carrying it. It is run state and a replay reproduces it — see `RULES_VERSION` 4.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Fold a lit field into the tiles the lantern has revealed.
 *
 * Union only, like `remember`, and the same identity shortcut: standing still in a room you have
 * already lit allocates nothing. The caller is §2 phase 3, and it calls this **only** with the
 * shutter open — touch reveals nothing, which is the whole rule.
 */
export function revealByLight(vision: Vision, lit: TileSet): Vision {
  if (tileSetContains(vision.revealed, lit)) return vision;
  return {
    shutter: vision.shutter,
    senseRadius: vision.senseRadius,
    remembered: vision.remembered,
    revealed: unionTileSets(vision.revealed, lit),
  };
}

/** Has the lantern ever lit `(x, y)`? Out of bounds is `false`, per `hasTile`. */
export function hasBeenLit(vision: Vision, x: number, y: number): boolean {
  return hasTile(vision.revealed, x, y);
}

/**
 * The tile as the **player** knows it, which is the tile any consumer above `game/` must draw.
 *
 * Exactly one kind diverges and it diverges one way only: an ember cache the lantern has never lit
 * reads as `floor`. Everything else — including a cache it *has* lit, lit or shuttered right now —
 * is itself. This is the function `render/` calls instead of indexing `grid.tiles`, so that the
 * §4 rule lives here rather than being re-decided by whichever layer happens to be drawing.
 *
 * @throws if `(x, y)` is off the grid — the same contract as `tileAt`, for the same reason.
 */
export function perceivedTileAt(grid: Grid, vision: Vision, x: number, y: number): Tile {
  const tile = tileAt(grid, x, y);
  if (tile.kind !== 'cache') return tile;
  return hasBeenLit(vision, x, y) ? tile : FLOOR;
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
