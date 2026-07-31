import { describe, expect, it } from 'vitest';
import { tapAt, type TapAction } from '@/render';
import { beginRun, sceneOf } from '@/session';
import { TOUCH_TARGET, tileAtPoint } from '@/components/play/hit-test';

/**
 * The arithmetic between a thumb and a tile.
 *
 * This is the half of touch a browser test cannot pin down precisely — Playwright can tap the middle
 * of a tile and check the player moved, but it cannot ask what happens 3pt outside the tile's edge
 * without a screenful of geometry. So the edges are asserted here and the wiring is asserted end to
 * end, which is the split those two tiers are for.
 *
 * A 34pt cell is the real case: eleven columns on a 390pt phone. Every distance below is in points.
 */

const CELL = 34;

/** §9's five, around a player at (5, 7): a wall north, a Cinder east, floor west and south. */
const TAPS: readonly TapAction[] = [
  { kind: 'wait', at: { x: 5, y: 7 } },
  { kind: 'attack', at: { x: 6, y: 7 }, dir: 'east' },
  { kind: 'blocked', at: { x: 5, y: 6 } },
  { kind: 'move', at: { x: 5, y: 8 }, dir: 'south' },
  { kind: 'move', at: { x: 4, y: 7 }, dir: 'west' },
];

/** The centre of a tile, in points. */
function centre(x: number, y: number) {
  return { x: (x + 0.5) * CELL, y: (y + 0.5) * CELL };
}

describe('a press inside a tile hits that tile', () => {
  it('resolves the centre of every target to its own tile', () => {
    // The floor of the whole thing. If this is wrong, every tap in the game is off by a tile and
    // nothing else in this file matters.
    for (const tap of TAPS) {
      expect(tileAtPoint(centre(tap.at.x, tap.at.y), CELL, TAPS), tap.kind).toEqual(tap.at);
    }
  });

  it('does not snap a press that is already on a target, even near its edge', () => {
    // You get what you aimed at. A snap that fired inside a legitimate tile would mean the widened
    // targets could *steal* presses from each other, which is a mis-move rather than a near-miss.
    expect(tileAtPoint({ x: 5 * CELL + 1, y: 7 * CELL + 1 }, CELL, TAPS)).toEqual({ x: 5, y: 7 });
    expect(tileAtPoint({ x: 6 * CELL + CELL - 1, y: 7 * CELL + 1 }, CELL, TAPS)).toEqual({
      x: 6,
      y: 7,
    });
  });

  it('keeps a press on the exact boundary in the tile it landed in', () => {
    // The edge case that gives "already on a target, stop here" its teeth. Inside a square grid the
    // nearest centre is always your own tile — except **exactly** on a boundary, where two centres
    // are equidistant and the tie would be broken by list order. So a press on the left edge of the
    // Cinder's tile would resolve to the player's own tile and spend a turn standing still instead of
    // striking. One column of pixels wide, and it is the column between "attack" and "wait".
    const boundary = { x: 6 * CELL, y: (7 + 0.5) * CELL };
    expect(tileAtPoint(boundary, CELL, TAPS)).toEqual({ x: 6, y: 7 });
    expect(tapAt(TAPS, 6, 7).kind).toBe('attack');
  });

  it('maps an arbitrary point to the tile containing it', () => {
    // Not a target, not near one: plain division. This is the case ADR-0009's `travel(to)` will read.
    expect(tileAtPoint({ x: 0, y: 0 }, CELL, TAPS)).toEqual({ x: 0, y: 0 });
    expect(tileAtPoint({ x: CELL * 2.5, y: CELL * 3.9 }, CELL, TAPS)).toEqual({ x: 2, y: 3 });
    expect(tapAt(TAPS, 2, 3).kind).toBe('unbound');
  });
});

describe('a near miss snaps to the target it missed', () => {
  it('widens each target to 44pt, which is 5pt of dead space on each side of a 34pt cell', () => {
    // THE 44pt REQUIREMENT, as arithmetic. A press 4pt above the western neighbour's cell is on a
    // diagonal — dead space, no gesture — and a thumb that produced it plainly meant "west".
    const west = centre(4, 7);
    const justOutside = { x: west.x, y: west.y - CELL / 2 - 4 };
    expect(tapAt(TAPS, 4, 6).kind).toBe('unbound');
    expect(tileAtPoint(justOutside, CELL, TAPS)).toEqual({ x: 4, y: 7 });
  });

  it('stops at the edge of the widened square rather than snapping across the board', () => {
    // The other half: a target that pulls presses from anywhere is a board where a tap two rooms away
    // moves you. `TOUCH_TARGET / 2` from the centre is the boundary, and one point past it is not.
    const west = centre(4, 7);
    const far = { x: west.x, y: west.y - TOUCH_TARGET / 2 - 1 };
    expect(tileAtPoint(far, CELL, TAPS)).toEqual({ x: 4, y: 6 });
    expect(tapAt(TAPS, 4, 6).kind).toBe('unbound');
  });

  it('gives the press to the nearest target when two widened squares overlap', () => {
    // Where contention actually happens: a **diagonal** tile, which is dead space reachable from the
    // two targets flanking it. (4,6) sits below the west neighbour and left of the north wall, and
    // both widened squares reach into it. Distance decides — not z-order, which is what a stack of
    // oversized `Pressable`s would have used, and which is a rendering accident rather than a
    // statement about what the thumb meant.
    expect(tapAt(TAPS, 4, 6).kind).toBe('unbound');

    // Low in the tile: nearer the west neighbour's centre.
    expect(tileAtPoint({ x: 166, y: 236 }, CELL, TAPS)).toEqual({ x: 4, y: 7 });
    // Right of it: nearer the wall to the north.
    expect(tileAtPoint({ x: 170, y: 234 }, CELL, TAPS)).toEqual({ x: 5, y: 6 });
  });

  it('breaks an exact tie by `Scene.taps` order rather than by chance', () => {
    // A press equidistant from two targets is reachable (their centres are a knight's move apart, so
    // the diagonal midpoint is exactly between them) and must not depend on iteration luck. `taps` is
    // ordered — the self-tap, then `DIRECTIONS` — so this resolves the same way on every run, which
    // is the same ADR-0004 argument the layers below make about `Map` iteration.
    expect(tileAtPoint({ x: 168, y: 236 }, CELL, TAPS)).toEqual({ x: 5, y: 6 });
  });

  it('widens a blocked neighbour too, so a near miss on a wall is still acknowledged', () => {
    // §9 says a wall is not a tap target; §2 says the tap must produce feedback. A near miss that
    // fell through to `unbound` would be silent, which is the dead tap §2 is written against.
    const north = centre(5, 6);
    expect(tileAtPoint({ x: north.x, y: north.y - CELL / 2 - 4 }, CELL, TAPS)).toEqual({
      x: 5,
      y: 6,
    });
  });

  it('never widens anything when the cell is already larger than the minimum', () => {
    // On a desktop viewport a cell can exceed 44pt, and a snap radius smaller than the cell would
    // carve a dead ring out of the middle of a legitimate target.
    const big = 60;
    const point = { x: (4 + 0.5) * big, y: (7 + 0.5) * big - big / 2 + 1 };
    expect(tileAtPoint(point, big, TAPS)).toEqual({ x: 4, y: 7 });
    expect(TOUCH_TARGET).toBe(44);
  });
});

describe('against a real scene', () => {
  it('resolves the player’s own tile from its own centre', () => {
    // End to end through `session/` and `render/`: the tap list is the real one, not a hand-built
    // five. If `Scene.taps` ever stopped putting the self-tap on the player, this is where it shows.
    const scene = sceneOf(beginRun('hit-test'));
    const self = scene.taps.find((tap) => tap.kind === 'wait');
    expect(self).toBeDefined();

    const tile = tileAtPoint(centre(self!.at.x, self!.at.y), CELL, scene.taps);
    expect(tapAt(scene.taps, tile.x, tile.y).kind).toBe('wait');
  });

  it('answers a tile off the board for a point off the board, which is unbound', () => {
    // The safe failure. A hit test whose origin has drifted produces nonsense coordinates, and
    // nonsense coordinates must do nothing rather than something.
    const scene = sceneOf(beginRun('hit-test'));
    const tile = tileAtPoint({ x: -50, y: -50 }, CELL, scene.taps);
    expect(tile.x).toBeLessThan(0);
    expect(tapAt(scene.taps, tile.x, tile.y).kind).toBe('unbound');
  });
});
