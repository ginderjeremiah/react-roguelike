import { describe, expect, it } from 'vitest';
import { findFieldDivergence } from '@/game/core/divergence';
import { creatures, origin, parseScene } from '@/tests/unit/support/ascii-grid';
import { perceive, rememberPerception } from './perceive';
import { tileSetContains, tileSetSize, tileSetsEqual } from './tileset';
import { adaptVision, closeShutter, createVision } from './vision';

/**
 * `Vision` is headed for `GameState`, and `GameState` has a shape rule that is load-bearing rather
 * than stylistic: **plain JSON-shaped data, no `Map`, no `Set`, no class instances**.
 * `game/core/divergence.ts` throws on any of those, because comparing them by own-enumerable-keys
 * silently reports different values as identical — and the replay tripwire is built on that
 * comparison.
 *
 * The journal's own warning about this names `game/fov/` as the likely place a `Set<TileIndex>`
 * would enter state. It did not, and these tests are what would notice if one ever did.
 */

/**
 * Wide enough that a lit field from `@` does **not** reach the far end — 15 columns against a lit
 * radius of 4 — so a shuttered turn over there adds tiles no light ever touched. That is what makes
 * `livedVision`'s two planes genuinely different, and it is the only reason the room is this shape.
 */
const scene = parseScene([
  '###############',
  '#..c..........#',
  '#.............#',
  '#...@........c#',
  '#.............#',
  '###############',
]);

/** The far end, out of every lit field this file builds. Where the dark half of the crawl happens. */
const FAR_END = { x: 12, y: 3 };

/**
 * A vision that has actually been played: both monotone planes non-empty, and non-*equal*.
 *
 * Two lit turns at the entrance and one shuttered turn at the far end, so `revealed` ends up a
 * **strict** subset of `remembered`. That is not decoration: a plane that is never populated — or
 * one that is a copy of its neighbour — is a plane the round-trip and divergence assertions below
 * cannot see, and the whole point of this file is that what FOV puts into `GameState` survives the
 * comparator. The first assertion in the suite checks this function rather than the module.
 */
function livedVision() {
  let vision = createVision(scene.grid, 'open');
  for (let turn = 0; turn < 3; turn += 1) {
    const dark = turn === 2;
    if (dark) vision = closeShutter(vision);
    const at = dark ? FAR_END : origin(scene);
    vision = rememberPerception(vision, perceive(scene.grid, vision, at, creatures(scene)));
    vision = adaptVision(vision);
  }
  return closeShutter(vision);
}

describe('everything FOV puts in state is plain data', () => {
  it('is built from a vision with both planes populated and distinct', () => {
    // The instrument test. Every assertion below is about `livedVision()`, so a `livedVision` whose
    // `revealed` was empty — or identical to `remembered` — would leave the round-trip and
    // divergence checks blind to the plane #31/#41 added, which is the field most likely to be got
    // wrong because it is the newest.
    const vision = livedVision();
    expect(tileSetSize(vision.remembered)).toBeGreaterThan(0);
    expect(tileSetSize(vision.revealed)).toBeGreaterThan(0);
    expect(tileSetContains(vision.remembered, vision.revealed)).toBe(true);
    expect(tileSetsEqual(vision.remembered, vision.revealed)).toBe(false);
  });

  it('survives the comparator the replay tests depend on', () => {
    // findFieldDivergence throws on a Map, Set, or class instance rather than comparing it.
    const vision = livedVision();
    expect(findFieldDivergence(vision, vision)).toBeNull();
  });

  it('survives a JSON round trip unchanged', () => {
    const vision = livedVision();
    const restored = JSON.parse(JSON.stringify(vision));
    expect(findFieldDivergence(vision, restored)).toBeNull();
    // Non-vacuity: the comparator must be able to see a difference in these shapes at all.
    const altered = JSON.parse(JSON.stringify(vision));
    altered.remembered.flags[0] = !altered.remembered.flags[0];
    expect(findFieldDivergence(vision, altered)?.path).toBe('remembered.flags[0]');
    // The same, one field over: `revealed` is compared too, or the replay tripwire is blind to the
    // one plane a cache payout reads.
    const shifted = JSON.parse(JSON.stringify(vision));
    shifted.revealed.flags[0] = !shifted.revealed.flags[0];
    expect(findFieldDivergence(vision, shifted)?.path).toBe('revealed.flags[0]');
  });

  it('holds for a perception as well as for the vision it came from', () => {
    // Both creature variants, since `CreatureSense` is the one union FOV puts in front of state.
    let vision = livedVision();
    for (let turn = 0; turn < 4; turn += 1) vision = adaptVision(vision);

    const felt = perceive(scene.grid, vision, origin(scene), creatures(scene));
    const seen = perceive(scene.grid, createVision(scene.grid, 'open'), origin(scene), creatures(scene));

    for (const perception of [felt, seen]) {
      expect(findFieldDivergence(perception, JSON.parse(JSON.stringify(perception)))).toBeNull();
      expect(perception.creatures.length).toBeGreaterThan(0);
    }
    expect(felt.creatures[0].kind).toBe('felt');
    expect(seen.creatures[0].kind).toBe('seen');
  });

  it('reports a divergence when two visions really differ', () => {
    // The other half: a comparator that never reports anything would pass every test above.
    const a = createVision(scene.grid, 'open');
    const b = closeShutter(a);
    expect(findFieldDivergence(a, b)).not.toBeNull();
  });
});
