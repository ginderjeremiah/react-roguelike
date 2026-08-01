import { describe, expect, it } from 'vitest';
import { drawTileSet, origin, parseScene } from '@/tests/unit/support/ascii-grid';
import { tileAt } from '../map';
import { perceive } from './perceive';
import { hasTile, tileSetOf, tileSetPositions, tileSetSize } from './tileset';
import { computeTouchField } from './touch';
import {
  createVision,
  DARK_TOUCH_RADIUS,
  hasBeenLit,
  perceivedTileAt,
  remember,
  revealByLight,
} from './vision';

/**
 * GDD §4's dark terrain rule is "the 8 tiles you can touch, no line-of-sight check". The number 8
 * is the load-bearing part: it is the evidence the metric ruling used to conclude the game had
 * already committed to Chebyshev, since Manhattan and Euclidean radius 1 are both 4 tiles.
 */

describe('computeTouchField feels the 8 tiles around you', () => {
  it('is the tile you stand on plus its eight neighbours', () => {
    expect(DARK_TOUCH_RADIUS).toBe(1);
    const scene = parseScene(['.....', '.....', '..@..', '.....', '.....']);
    const felt = computeTouchField(scene.grid, origin(scene));

    expect(tileSetSize(felt)).toBe(9);
    expect(tileSetPositions(felt)).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 1, y: 3 },
      { x: 2, y: 3 },
      { x: 3, y: 3 },
    ]);
  });

  it('feels the diagonal between two walls — you can feel a corner', () => {
    // The case a line-of-sight pass would take away, and the reason there is no such pass here.
    // The diagonal tile is wedged behind a corner: no ray from the origin reaches it.
    const scene = parseScene(['@#.', '#..', '...']);
    const felt = computeTouchField(scene.grid, origin(scene));

    expect(hasTile(felt, 1, 1)).toBe(true);
    expect(hasTile(felt, 1, 0)).toBe(true);
    expect(hasTile(felt, 0, 1)).toBe(true);
    expect(tileSetSize(felt)).toBe(4);
  });

  it('feels walls, which is what makes the dark navigable', () => {
    const scene = parseScene(['###', '#@#', '###']);
    const felt = computeTouchField(scene.grid, origin(scene));
    expect(drawTileSet(scene.grid, felt.flags)).toEqual(['###', '#.#', '###']);
    expect(tileSetSize(felt)).toBe(9);
  });

  it('feels nothing two tiles away, however open the ground is', () => {
    const scene = parseScene(['.....', '.....', '..@..', '.....', '.....']);
    const felt = computeTouchField(scene.grid, origin(scene));
    for (const at of [
      { x: 0, y: 2 },
      { x: 4, y: 2 },
      { x: 2, y: 0 },
      { x: 2, y: 4 },
      { x: 0, y: 0 },
    ]) {
      expect(hasTile(felt, at.x, at.y)).toBe(false);
    }
  });

  it('clips at the grid corner', () => {
    const scene = parseScene(['@..', '...', '...']);
    const felt = computeTouchField(scene.grid, origin(scene));
    expect(tileSetSize(felt)).toBe(4);
    expect(tileSetPositions(felt)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
  });

  it('throws rather than returning an empty field for a bad call', () => {
    const scene = parseScene(['...', '.@.', '...']);
    expect(() => computeTouchField(scene.grid, { x: 5, y: 0 })).toThrow(/outside the 3x3/);
    expect(() => computeTouchField(scene.grid, { x: 1, y: 1 }, -1)).toThrow(/non-negative/);
    expect(() => computeTouchField(scene.grid, { x: 1, y: 1 }, 1.5)).toThrow(/non-negative/);
  });
});

describe('non-square grids, origin off the diagonal', () => {
  /**
   * Found in review, and the gap was systematic rather than a single missing case: **every grid
   * this suite pinned positively was square, or had the origin on `x == y`.** Both conditions make
   * a coordinate transposition invisible — a 3×3 block centred on the diagonal transposes onto
   * itself, and on a square grid `tileIndex(g, x, y)` and `tileIndex(g, y, x)` are both in bounds.
   *
   * With `flags[tileIndex(grid, y, x)] = true` substituted, all 629 tests passed. On the real
   * 11×15 floor a shuttered player at (2, 9) was handed a 3×3 block at the opposite end of the
   * map — and dark is the state the player spends most turns in, with the touch field the only
   * terrain they get.
   *
   * The grid below is 7 wide × 4 tall and the origin is at (5, 2): non-square, off-diagonal, and
   * the transposed index (2, 5) is out of bounds vertically so it silently writes nothing.
   */
  it('feels the right nine tiles on a wide grid', () => {
    const scene = parseScene([
      '#######',
      '#.....#',
      '#....@#',
      '#######',
    ]);

    const felt = computeTouchField(scene.grid, origin(scene), DARK_TOUCH_RADIUS);

    expect(tileSetPositions(felt)).toEqual([
      { x: 4, y: 1 },
      { x: 5, y: 1 },
      { x: 6, y: 1 },
      { x: 4, y: 2 },
      { x: 5, y: 2 },
      { x: 6, y: 2 },
      { x: 4, y: 3 },
      { x: 5, y: 3 },
      { x: 6, y: 3 },
    ]);
  });

  it('feels the right nine tiles on a tall grid', () => {
    // The transpose of the case above: 4 wide × 7 tall, origin (1, 5). Both orientations, because
    // a bug that clamps rather than transposes would survive only one of them.
    const scene = parseScene([
      '####',
      '#..#',
      '#..#',
      '#..#',
      '#..#',
      '#@.#',
      '####',
    ]);

    const felt = computeTouchField(scene.grid, origin(scene), DARK_TOUCH_RADIUS);

    expect(tileSetPositions(felt)).toEqual([
      { x: 0, y: 4 },
      { x: 1, y: 4 },
      { x: 2, y: 4 },
      { x: 0, y: 5 },
      { x: 1, y: 5 },
      { x: 2, y: 5 },
      { x: 0, y: 6 },
      { x: 1, y: 6 },
      { x: 2, y: 6 },
    ]);
  });
});

/**
 * GDD §4, ruled 2026-08-01 (#31, #41): **an unlit ember cache is felt as ordinary floor.**
 *
 * The ruling has two clauses and this file owns both, because they pull against each other and a
 * test for either one alone is satisfied by the wrong implementation of the other:
 *
 *   - it must not read as a cache — that is the leak §4's exploration arithmetic is priced on;
 *   - it must not read as **nothing** — a permanent blank cell in ground the player has crawled is a
 *     *better* cache detector than the `♦` would have been, since nothing else on the board is ever
 *     skipped, and it would break §4's "you always know your own four neighbours", which §2 spends
 *     to refuse an illegal move for free.
 *
 * The cache glyph here is `$`, which is `map/debug.ts`'s and `ascii-grid.ts`'s.
 */
describe('a cache the lantern has not lit is felt as ordinary floor (§4, #41)', () => {
  /** A cache one step east of the player, and a second one two steps away, out of reach. */
  const SCENE = ['#####', '#@$$#', '#####'];
  const NEAR = { x: 2, y: 1 };
  const FAR = { x: 3, y: 1 };

  /** The vision of someone who has felt their way here in the dark: shuttered, nothing ever lit. */
  function crawled() {
    const scene = parseScene(SCENE);
    const at = origin(scene);
    const perception = perceive(scene.grid, createVision(scene.grid, 'shuttered'), at, []);
    return { scene, at, vision: remember(createVision(scene.grid, 'shuttered'), perception.terrain) };
  }

  it('reports the tile as floor, and the tile really is a cache', () => {
    const { scene, vision } = crawled();
    // The control first: without it this test passes on a scene where the parser never made a cache.
    expect(tileAt(scene.grid, NEAR.x, NEAR.y).kind).toBe('cache');
    expect(perceivedTileAt(scene.grid, vision, NEAR.x, NEAR.y).kind).toBe('floor');
  });

  it('still perceives the tile — the ruling refuses to leave a hole', () => {
    // The half that is easy to lose. `computeTouchField` must keep returning the cache tile, and
    // phase 3 must keep folding it into memory, or the board grows a permanent blank at exactly the
    // tile with the fuel in it. Asserted through `perceive` rather than `computeTouchField` alone,
    // because the cheap wrong fix (a predicate in `touch.ts`) would leave the raw field intact only
    // if it were applied here instead.
    const { scene, at, vision } = crawled();
    const perception = perceive(scene.grid, vision, at, []);
    expect(hasTile(perception.terrain, NEAR.x, NEAR.y)).toBe(true);
    expect(hasTile(vision.remembered, NEAR.x, NEAR.y)).toBe(true);
    // §4's four-neighbour guarantee, stated as the whole 3×3 rather than as the one tile: every
    // in-bounds neighbour is perceived, cache or not, so no neighbour is ever `unknown`.
    expect(tileSetSize(perception.terrain)).toBe(9);
  });

  it('leaves every other tile kind exactly as it is', () => {
    // The rule is one kind, one way. A `perceivedTileAt` that disguised terrain generally — or that
    // returned FLOOR for anything unlit — would pass both tests above and erase the walls the dark
    // is navigated by (§4: "feeling your way along a wall is the point").
    const scene = parseScene(['#<o+', '.>$#']);
    const vision = createVision(scene.grid, 'shuttered');
    const kinds = scene.grid.tiles.map((_, index) =>
      perceivedTileAt(scene.grid, vision, index % scene.grid.width, Math.floor(index / scene.grid.width))
        .kind,
    );
    expect(kinds).toEqual(['wall', 'entrance', 'pillar', 'doorway', 'floor', 'stairs', 'floor', 'wall']);
    // ...and the one substitution really is a substitution: `$` is a cache in the grid underneath.
    expect(scene.grid.tiles.map((tile) => tile.kind)).toContain('cache');
  });

  it('shows the ♦ on the tile the player already walked over, once the lantern lights it', () => {
    // The moment §4 says teaches the rule with no text: you crawled over this tile, and a flash puts
    // a cache on it. Both caches are in the scene and only one is lit, so this is also the assertion
    // that the disguise is per tile rather than per run.
    const { scene, vision } = crawled();
    const lantern = revealByLight(vision, tileSetOf(scene.grid, [NEAR]));

    expect(hasBeenLit(lantern, NEAR.x, NEAR.y)).toBe(true);
    expect(perceivedTileAt(scene.grid, lantern, NEAR.x, NEAR.y).kind).toBe('cache');
    expect(perceivedTileAt(scene.grid, lantern, FAR.x, FAR.y).kind).toBe('floor');
  });

  it('keeps showing it after the shutter closes again — the plane is what is read, not the shutter', () => {
    // The state the collection rule keys on (#31): revealed, and dark right now. A `perceivedTileAt`
    // that consulted `vision.shutter` instead of `vision.revealed` would make the `♦` blink out
    // every time the player shuttered, which is *currently lit* wearing the wrong rule's clothes.
    const { scene, vision } = crawled();
    const lantern = revealByLight(vision, tileSetOf(scene.grid, [NEAR]));
    expect(lantern.shutter).toBe('shuttered');
    expect(perceivedTileAt(scene.grid, lantern, NEAR.x, NEAR.y).kind).toBe('cache');
  });

  it('throws off the grid, exactly as tileAt does', () => {
    const { scene, vision } = crawled();
    expect(() => perceivedTileAt(scene.grid, vision, 9, 0)).toThrow(/outside the 5x3/);
  });
});
