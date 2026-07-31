/**
 * A point on the board -> the tile it means. The arithmetic half of touch, kept pure so it can fail
 * a test.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 44pt TARGETS ON A 34pt CELL, WITHOUT OVERLAPPING VIEWS
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Eleven columns on a 390pt phone is a ~34pt cell, and the board cannot be widened, zoomed or panned
 * — a pan gesture would claim exactly the taps ADR-0009's auto-travel needs. So the *cells* stay
 * 34pt and the *targets* are widened here, in arithmetic, rather than by stacking oversized
 * `Pressable`s on top of the grid:
 *
 *   - **A press inside a tile that is already a target hits that tile.** You get what you aimed at,
 *     always, with no snapping to argue with.
 *   - **A press that lands on nothing snaps to the nearest of §9's five targets** whose 44pt square
 *     contains it — which is exactly what a 44pt target centred on a 34pt cell means, minus the
 *     ambiguity. Overlapping views resolve by z-order, which is a rendering accident; this resolves
 *     by distance, which is what the thumb meant.
 *   - **Everything else is left alone**, and answers `unbound` through `tapAt`.
 *
 * Doing it here rather than with five absolutely-positioned `Pressable`s is what makes the whole
 * touch path testable — both in Vitest, against this function, and end to end, because there is one
 * handler and every tap in the game goes through it. The overlay version shipped a bug (React Native
 * Web does not populate `nativeEvent.locationX`, so the board's own handler never ran) that its E2E
 * test could not see, because the only presses that reached that handler were ones whose correct
 * outcome was "do nothing".
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

import { tapAt, type TapAction } from '@/render';

/** Apple's minimum, and the DoD's. The side of a widened target, in points. */
export const TOUCH_TARGET = 44;

/** A point in board space: points from the board's top-left corner. */
export type BoardPoint = { readonly x: number; readonly y: number };

/** A tile, as column and row. */
export type Tile = { readonly x: number; readonly y: number };

/**
 * The tile a press at `point` means, given the cell size and §9's targets.
 *
 * Total: every point answers *some* tile, and a tile no gesture is bound to answers `unbound` when
 * the caller asks `tapAt`. Points outside the board answer a tile outside the board, which is also
 * `unbound` — the safe answer for a hit test whose arithmetic has drifted, since a tap that lands
 * nowhere does nothing rather than moving the player somewhere they did not aim.
 */
export function tileAtPoint(
  point: BoardPoint,
  cellSize: number,
  taps: readonly TapAction[],
): Tile {
  const raw: Tile = { x: Math.floor(point.x / cellSize), y: Math.floor(point.y / cellSize) };
  if (tapAt(taps, raw.x, raw.y).kind !== 'unbound') return raw;

  const reach = Math.max(TOUCH_TARGET, cellSize) / 2;
  let best: Tile | null = null;
  let bestDistance = Infinity;

  // `taps` is ordered — the self-tap, then the four directions in `DIRECTIONS` order (`render/
  // taps.ts`) — so a genuine tie resolves to the earlier entry rather than to whatever the array
  // happened to hold. Ties are possible: a press exactly between two centres.
  for (const tap of taps) {
    const centre = { x: (tap.at.x + 0.5) * cellSize, y: (tap.at.y + 0.5) * cellSize };
    const dx = point.x - centre.x;
    const dy = point.y - centre.y;
    if (Math.abs(dx) > reach || Math.abs(dy) > reach) continue;

    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = tap.at;
    }
  }

  return best ?? raw;
}
