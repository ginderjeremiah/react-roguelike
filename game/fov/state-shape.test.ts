import { describe, expect, it } from 'vitest';
import { findFieldDivergence } from '@/game/core/divergence';
import { creatures, origin, parseScene } from '@/tests/unit/support/ascii-grid';
import { perceive } from './perceive';
import { adaptVision, closeShutter, createVision, remember } from './vision';

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

const scene = parseScene([
  '#########',
  '#..c....#',
  '#.......#',
  '#...@...#',
  '#......c#',
  '#########',
]);

function livedVision() {
  let vision = createVision(scene.grid, 'open');
  for (let turn = 0; turn < 3; turn += 1) {
    const perception = perceive(scene.grid, vision, origin(scene), creatures(scene));
    vision = remember(vision, perception.terrain);
    vision = adaptVision(vision);
  }
  return closeShutter(vision);
}

describe('everything FOV puts in state is plain data', () => {
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
