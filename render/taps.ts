/**
 * What a tap on a tile does. GDD §9's control scheme, as data.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * TAP LEGALITY IS A GAME RULE, SO IT CANNOT BE DECIDED IN A `.tsx`
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * §9 gives the whole scheme in four lines, and the last of them is the one with teeth:
 *
 * > Tap an adjacent tile to move; tap an adjacent occupied tile to attack. Tap your own tile to
 * > wait. **An impassable neighbour is not a tap target**, and a refused tap still gives feedback.
 *
 * "Impassable" is `blocksMovement`, "occupied" is a living actor on the tile, and "adjacent" is four
 * tiles rather than eight (§3). All three are rules, and a component that answered them itself would
 * be a second copy of `game/systems/combat.ts`'s `canBump` — one that drifts the first time a tile
 * kind is added, and whose drift shows up as a control that lies about what it will do.
 *
 * It also cannot arrive as a new `GameState`-taking function, because **nothing above `session/` can
 * hold a `GameState`** (ADR-0010) — so it rides on `Scene`, which `sceneOf(run)` already hands over,
 * and `session/` needs no new function to carry it.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## Five kinds for §9's four cases, and the fifth is the one to read carefully
 *
 * | kind | the tile | what a component does with it |
 * | --- | --- | --- |
 * | `move` | a passable, empty neighbour | `move(run, tap.dir)` |
 * | `attack` | a neighbour with a living thing on it | `move(run, tap.dir)` — §3, bump-to-attack |
 * | `wait` | the player's own tile | `wait(run)` |
 * | `blocked` | an impassable neighbour | **nothing**, plus §2's feedback |
 * | `unbound` | anything else | **nothing** — no action is bound to this tile *yet* |
 *
 * `move` and `attack` emit the same intent, and that is not redundancy: §3 settled bump-to-attack and
 * there is no `attack` command, so the pair exists to let a component *draw* the difference — a
 * player about to strike should see that they are about to strike — without ever deciding it.
 *
 * **`blocked` and `unbound` are different answers and must stay different.** Both mean "this tap does
 * nothing", and collapsing them would be the easy simplification. `blocked` is a tile the player
 * plainly aimed at and §2 requires feedback for (a dead tap on a phone reads as a missed touch);
 * `unbound` is a tile that no gesture claims *today*, which is a statement about this milestone
 * rather than about the tile. ADR-0009's `travel(to)` lands exactly there in M2, and when it does,
 * the distant-but-remembered case becomes a sixth kind carrying the `Position` it already carries —
 * one more `case` in the component's `switch`, not a restructuring. That is the whole reason
 * **every variant carries `at`** even where the intent needs only a `Direction`.
 *
 * ## Where "occupied" comes from
 *
 * From what the player **perceives**, not from `world.actors`. A presentation model may not draw a
 * distinction its player cannot see, and §4 makes the two answers identical here anyway: *you always
 * know your own four neighbours* — touch reaches them for stone and ember-sense reaches them for the
 * living, "even at the bottom of the ramp". So a felt `*` and a seen `c` are both `attack`, which is
 * what the player would expect from a tile they can see something standing on.
 *
 * This is the **loose** read of `scene.ts`'s contact map (`has`, not `get(i) === 'seen'`), and
 * deliberately so — the strict form there exists to keep a felt creature's *identity and intent*
 * hidden, and a tap target reveals neither. It says "something is there", which is the thing the
 * player is already looking at.
 *
 * ## A run that has ended has no tap targets
 *
 * §13 refuses every command once a run is over, so a board that still offered `wait` would be a
 * control that does nothing — the failure `hud.ts` names for the shutter, applied to the whole board.
 * Every tile answers `unbound` instead, which is exactly true: nothing is bound to it any more.
 */

import { DIRECTIONS, neighbourOf, type Direction } from '../game/core';
import {
  blocksMovement,
  inBounds,
  tileAt,
  tileIndex,
  type Grid,
  type Position,
} from '../game/map';

/**
 * What a tap on one tile does. **Every variant carries the tile it is about** — see the header for
 * why that is a requirement rather than convenience.
 */
export type TapAction =
  /** Step there. `move(run, dir)`. */
  | { readonly kind: 'move'; readonly at: Position; readonly dir: Direction }
  /** Strike what is standing there. Also `move(run, dir)` — §3, bump-to-attack. */
  | { readonly kind: 'attack'; readonly at: Position; readonly dir: Direction }
  /** The player's own tile. `wait(run)`, and on the stairs that is a real decision (§9). */
  | { readonly kind: 'wait'; readonly at: Position }
  /** §9: an impassable neighbour is not a tap target. §2 still wants the tap acknowledged. */
  | { readonly kind: 'blocked'; readonly at: Position }
  /** No gesture claims this tile yet. Distant tiles, diagonals, and every tile once a run ends. */
  | { readonly kind: 'unbound'; readonly at: Position };

/**
 * Every kind, in a fixed order. Exported so a component's `switch` can be checked for completeness by
 * a test rather than by whoever last read it — the same job `CUE_KINDS` does for cues.
 */
export const TAP_KINDS: readonly TapAction['kind'][] = [
  'move',
  'attack',
  'wait',
  'blocked',
  'unbound',
];

/**
 * What `presentTaps` needs, gathered by the caller that already has it.
 *
 * Taking these rather than a `GameState` keeps this function testable against a hand-built situation
 * and — the reason that matters — stops it recomputing `perceive`, which `scene.ts` has already run
 * for the board. FOV is one of the two places this project's performance historically goes wrong
 * (ARCHITECTURE.md), and running it twice per turn to answer five questions would be exactly that.
 */
export type TapInputs = {
  readonly grid: Grid;
  readonly playerAt: Position;
  /**
   * Tile indices (`tileIndex`) the player perceives a living thing on. See the header: this is
   * perception's answer, not `world.actors`', and §4 guarantees the two agree for the four
   * neighbours — which are the only tiles read out of it.
   */
  readonly occupied: ReadonlySet<number>;
  /** §13. False once the run has ended, and then nothing on the board is a target. */
  readonly running: boolean;
};

/** A finished run's targets. Shared, so the identity is stable across turns. */
const NO_TAPS: readonly TapAction[] = [];

/**
 * The tiles a tap means something on: the player's own, then its four orthogonal neighbours.
 *
 * Everything else is `unbound` and is **not** in the list — 165 entries of "nothing happens" would be
 * a per-turn allocation the size of the board to express one default. `tapAt` supplies it.
 *
 * Ordered as `self, ...DIRECTIONS`, which is a sorted list rather than whatever a `Map` yielded
 * (ADR-0004). Nothing downstream should depend on the order, and stating it is what makes that
 * checkable.
 *
 * The order of the two rejections *inside* the loop is the one thing here that mirrors the
 * simulation rather than choosing: **impassability is tested before occupancy**, exactly as `step`
 * tests `canBump` before `bump` looks at the tile. A creature cannot stand in a wall, so the two
 * orders are indistinguishable today; the day one can, this answers what the game would answer.
 */
export function presentTaps(inputs: TapInputs): readonly TapAction[] {
  if (!inputs.running) return NO_TAPS;

  const targets: TapAction[] = [{ kind: 'wait', at: inputs.playerAt }];

  for (const dir of DIRECTIONS) {
    const at = neighbourOf(inputs.playerAt, dir);
    // Off the grid is not a tile, so there is nothing to tap and nothing to acknowledge. §2 refuses
    // the move for the same reason; this just never offers it.
    if (!inBounds(inputs.grid, at.x, at.y)) continue;

    if (blocksMovement(tileAt(inputs.grid, at.x, at.y))) {
      targets.push({ kind: 'blocked', at });
    } else if (inputs.occupied.has(tileIndex(inputs.grid, at.x, at.y))) {
      targets.push({ kind: 'attack', at, dir });
    } else {
      targets.push({ kind: 'move', at, dir });
    }
  }

  return targets;
}

/**
 * What a tap at `(x, y)` does, for a hit test that has a coordinate and needs a verb.
 *
 * Linear over a list of at most five, which is smaller than the map that would index it.
 *
 * **Out-of-range coordinates are not an error here**, unlike `cellAt`'s: this has no grid to check
 * against, and `unbound` — *nothing happens* — is both the honest answer and the safe one for a hit
 * test whose arithmetic has drifted. A tap that lands nowhere does nothing rather than moving the
 * player somewhere they did not aim.
 */
export function tapAt(taps: readonly TapAction[], x: number, y: number): TapAction {
  for (const tap of taps) {
    if (tap.at.x === x && tap.at.y === y) return tap;
  }
  return { kind: 'unbound', at: { x, y } };
}
