/**
 * What the player perceives this turn — GDD §4's vision table, as one function.
 *
 * | | Lit (shutter open) | Dark (shuttered) |
 * | --- | --- | --- |
 * | Terrain | Chebyshev 4, line of sight | Chebyshev 1, no line of sight |
 * | Creatures | seen in the lit region, identified | felt through walls, position only |
 *
 * The two columns are two branches of one switch, which is the point: reading this file should be
 * reading the table. There is no third state and no way to be half-shuttered.
 *
 * ## Why creatures are a union
 *
 * `seen` and `felt` are different kinds of knowledge, not the same knowledge at different
 * confidence. A `felt` creature is a position and *nothing else* — no identity, no health, no
 * intent (§4). Making that a variant rather than a flag means the renderer and the AI cannot read a
 * field that was never sensed, because there is no field to read.
 *
 * ## Ember-sense does not operate through an open shutter
 *
 * §4's table assigns creature perception per vision state: lit shows creatures in the lit region,
 * shuttered gives ember-sense. So opening the shutter trades the wall-piercing sense for an
 * identifying one. That is what makes the containment guarantee mean something — you feel what is
 * there *before* you flash, and pay for the flash knowing.
 */

import { assertNever } from '../core/assert';
import { comparePositions, type Grid, type Position } from '../map';
import { senseCreatures } from './embersense';
import { computeLitField } from './light';
import { computeTouchField } from './touch';
import { hasTile, type TileSet } from './tileset';
import type { Vision } from './vision';

/**
 * A creature the player is aware of.
 *
 * `at` is all ember-sense may ever carry. `seen` carries no more here either — identity belongs to
 * the entity layer, which knows which creature stands on that tile; this module's job is only to
 * say *whether* and *how* the player perceives it.
 */
export type CreatureSense =
  | { readonly kind: 'seen'; readonly at: Position }
  | { readonly kind: 'felt'; readonly at: Position };

/** One turn's perception. Derived from the map and `Vision`; never stored. */
export type Perception = {
  /** Terrain perceived this turn: the lit field, or the tiles within touch. */
  readonly terrain: TileSet;
  /** Row-major. Empty is a perfectly ordinary answer. */
  readonly creatures: readonly CreatureSense[];
};

/**
 * Resolve the vision table for one turn.
 *
 * @param creatures every creature on the floor, as positions. Order is irrelevant: the result is
 *   row-major either way, so spawn order cannot leak into what the player perceives.
 */
export function perceive(
  grid: Grid,
  vision: Vision,
  origin: Position,
  creatures: readonly Position[],
): Perception {
  switch (vision.shutter) {
    case 'open': {
      const terrain = computeLitField(grid, origin);
      return { terrain, creatures: seenIn(terrain, creatures) };
    }
    case 'shuttered': {
      const terrain = computeTouchField(grid, origin);
      const felt = senseCreatures(origin, vision.senseRadius, creatures);
      return { terrain, creatures: felt.map((at) => ({ kind: 'felt', at }) as const) };
    }
    default:
      return assertNever(vision.shutter, 'perceive');
  }
}

/**
 * Creatures standing on lit terrain, row-major.
 *
 * "In the lit radius" is exactly "on a lit tile" — a creature behind the pillar in your own room is
 * not lit and is not seen, which is the same rule the player reads off the screen.
 */
function seenIn(lit: TileSet, creatures: readonly Position[]): CreatureSense[] {
  return creatures
    .filter((at) => hasTile(lit, at.x, at.y))
    .map((at) => ({ x: at.x, y: at.y }))
    .sort(comparePositions)
    .map((at) => ({ kind: 'seen', at }) as const);
}
