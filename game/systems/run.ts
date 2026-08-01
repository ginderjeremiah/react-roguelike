/**
 * The rules that span floors: where a run starts, and what a descent carries. GDD §13 (and §4).
 *
 * §5 owns what a floor *is*; `light.ts` owns one turn on one floor. This owns the two moments that
 * are neither — arriving, and starting.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * DOWN THE STAIRS YOU TAKE YOUR LANTERN, YOUR EYES AND YOUR WOUNDS. YOU LEAVE THE MAP BEHIND
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * §13's table, item for item, and each "does not" is a deletion this file has to perform rather
 * than a thing it can simply forget:
 *
 * | Carries | Does not |
 * | --- | --- |
 * | Fuel — the reserve is run-long (§4) | **Remembered terrain**, and with it **what the lantern has revealed** (§4's cache rule). Memory is of a place, and you have never been to this one — so `remembered` and `revealed` are both *fresh* `TileSet`s, sized to the new grid |
 * | Shutter state — walking downstairs does not touch a setting on a lamp you are holding | Ember on the ground you did not pick up. Fuel you did not collect is fuel you did not earn |
 * | Ember-sense radius. The ramp is triggered by the *act* of shuttering (§4); descending is not shuttering | The creatures, all of them. A new floor's are dormant, and re-dormancy is per creature |
 * | HP, plus §3's +2 (`restoreOnDescent`, the only function in the game that raises HP) | |
 *
 * Two things that are not in the table because nothing observable depends on them, written down so
 * that "nothing depends on it" stays a decision rather than an accident:
 *
 *   - **The schedule's clock restarts at 0 on the new floor.** Carrying `now` across would be
 *     equally deterministic; nothing reads absolute time (re-dormancy is counted per creature, in
 *     the creature's own mind), so the smaller number is chosen. Anything that ever *does* read
 *     absolute time must not assume it is run-long.
 *   - **The player arrives already charged `ACTION_COST`.** §13 pays the descent's turn on the
 *     floor below, so phase 1 has already happened by the time the new floor exists; if the arriving
 *     player were still due, phase 4 would throw "the player was due in phase 4".
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## Why the turn is paid below
 *
 * §13: "The creatures on the floor you left get no parting shot ... **the stairs are the one escape
 * nothing follows you down**." A creature adjacent to you had declared an attack on your tile and
 * you are not on that tile any more — descending *is* §2's "step off the marked tile". It is not
 * free: you forfeit the floor's remaining kills and caches, which is §3's "clear this floor, or dive
 * now" wager. Mechanically it falls out of running phases 2-6 against the *new* world.
 */

import { STARTING_FUEL } from '../content';
import { playerOf, withActor, type ActorWorld } from '../entities';
import { type Vision } from '../fov';
import { tileAt, type Floor } from '../map';
import { restoreOnDescent } from './combat';
import {
  chargePlayer,
  createLanternWorld,
  lanternPhases,
  lightingAndWakingPhase,
  type LanternWorld,
} from './light';
import { resolveTurn, type TurnPhase } from './turn';

/**
 * The state a run begins in, on floor 1. GDD §4's "Where a run starts".
 *
 * > "A run begins at the entrance with the lantern **open** and 80 fuel, and the entrance room is
 * > already on screen — the opening perception is not something the first command pays for."
 *
 * Three parts, all of them read off §4 rather than chosen:
 *
 *   - **Open**, not shuttered. §5 step 7 puts no creature in the entrance room or in the room merged
 *     with it, so this is the one flash in the game whose safety the *generator* guarantees. Starting
 *     shuttered would make the correct opening four turns of `wait` while the adaptation ramp climbs
 *     — an obvious optimal sequence at the most visible moment of the run (Pillar 1).
 *   - **Sense radius at the floor, 1.** "Full adaptation is always earned." `createVision` does this;
 *     nothing here re-states it, so there is one place for it to be wrong.
 *   - **The entrance room already perceived**, by running §2's phase 3 once and *only* phase 3. No
 *     fuel is burned for it (§4: not something the first command pays for), no creature is charged,
 *     and the clock does not move — but light still wakes what light wakes, because that is phase 3
 *     and inventing a version of it that does not wake would be a fifth vision state.
 */
export function beginRun(floor: Floor): LanternWorld {
  return lightingAndWakingPhase(createLanternWorld(floor, 'open', STARTING_FUEL));
}

/**
 * §9/§13: descent is legal only while standing on the stairs.
 *
 * Asked of the tile rather than of `floor.stairs`, so that it agrees with what the player can see —
 * the grid is the single source of truth about what is on a tile (`light.ts` on collected caches).
 */
export function isOnStairs(state: LanternWorld): boolean {
  const at = playerOf(state.world).at;
  return tileAt(state.world.floor.grid, at.x, at.y).kind === 'stairs';
}

/**
 * The new floor, at the instant the player steps onto it: §13's table, applied.
 *
 * Everything not listed as carrying is simply absent, because the world is built fresh from the
 * `Floor` — `createActorWorld` puts the player on the new entrance, spawns every creature dormant,
 * and starts with no embers on the ground. That is the shape this function is written in on purpose:
 * a *replacement* rather than an edit, so a field added to `ActorWorld` later defaults to not
 * crossing the stairs, which is the conservative direction.
 *
 * @param previous the floor being left, at the moment `descend` resolves.
 */
export function arriveOnFloor(previous: LanternWorld, floor: Floor): LanternWorld {
  // The two carried lantern fields are handed *to* the constructor rather than patched on after it,
  // so the lantern below is the one `createLantern` built and checked — the argument is load-bearing
  // rather than a value passed and then thrown away.
  //
  // What that check buys: `createLantern` refuses to build a lit lantern with no fuel to burn. **No
  // run can reach that state today** — `burn` closes the shutter on the turn fuel hits 0, and `open`
  // refuses at 0 — so this is a latent invariant, deliberately kept rather than an active guard. It
  // is kept *here* because a descent is the only place a lantern is rebuilt from carried values, so
  // a break in either of those two rules surfaces on the next descent instead of as a lantern that
  // is lit and dry at once.
  const arrived = createLanternWorld(floor, previous.lantern.vision.shutter, previous.lantern.fuel);

  // HP crosses, then §3's +2 is applied on the far side. `restoreOnDescent` is the only function in
  // the simulation that raises HP, which is what makes "no healing within a floor" testable rather
  // than aspirational — so the heal goes through it rather than being open-coded here.
  const wounded = withActor(arrived.world, {
    ...playerOf(arrived.world),
    hp: playerOf(previous.world).hp,
  });
  const healed: ActorWorld = restoreOnDescent(wounded);

  // The eyes cross; the map does not. Only the adaptation ramp is carried onto the new floor's
  // vision, because that is the one §13 field `createVision` cannot know: it starts every sense
  // radius at the adaptation *floor* (§4), and §13 says descending is not shuttering. `remembered`
  // and `revealed` are left as the fresh `TileSet`s `createVision` built — sized to the *new* grid,
  // where the old floor's would index every tile a row out if grid sizes ever varied. A cache lit
  // upstairs is not a cache you have found down here, and a plane carried across would pay out on
  // whatever the new generator happened to put on that index.
  //
  // Spread-then-override rather than a field-by-field literal, for the same reason the world is
  // rebuilt rather than edited: a field added to `Vision` later defaults to the new floor's value,
  // which is the conservative direction.
  const vision: Vision = {
    ...arrived.lantern.vision,
    senseRadius: previous.lantern.vision.senseRadius,
  };

  // The descent's turn is paid here (§13), and phase 1 is where a turn is paid for.
  return chargePlayer({ world: healed, lantern: { ...arrived.lantern, vision } });
}

/**
 * Phase 1 of a descent: the whole old floor is replaced by the new one.
 *
 * `floor` is generated by the caller rather than here, because generating draws from the RNG and
 * this layer holds none — `game/core/step.ts` owns the generator and threads it. That split is also
 * what keeps the draw-count contract legible: a descent draws exactly `expectedDrawCount(n + 1)`
 * and every other command draws nothing.
 */
export function descendCommand(floor: Floor): TurnPhase<LanternWorld> {
  return (state) => arriveOnFloor(state, floor);
}

/**
 * A whole descent, as one resolved turn: arrive, then run phases 2-6 **on the new floor**.
 *
 * The turn costs a turn (§13) and the cost is not a parameter, for the same reason `setShutterTurn`
 * takes none.
 */
export function descendTurn(state: LanternWorld, floor: Floor): LanternWorld {
  return resolveTurn(state, lanternPhases('costsATurn', descendCommand(floor)));
}
