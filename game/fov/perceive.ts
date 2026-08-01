/**
 * What the player perceives this turn — GDD §4's vision table, as one function.
 *
 * | | Lit (shutter open) | Dark (shuttered) |
 * | --- | --- | --- |
 * | Terrain | Chebyshev 4, line of sight | Chebyshev 1, no line of sight |
 * | Creatures | seen in the lit region, identified | felt through walls, position only |
 * | Ember caches | revealed, and takeable from then on | felt as ordinary floor, and pay nothing |
 *
 * The two columns are two branches of one switch, which is the point: reading this file should be
 * reading the table. There is no third state and no way to be half-shuttered.
 *
 * The third row is not resolved here — a `TurnPerception` says what was perceived, never what it
 * looked like. It is resolved by `terrainFrom` plus `rememberPerception` at the bottom of this
 * file, and by `perceivedTileAt` in `vision.ts`, which is where the ruling is written down.
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
import { remember, revealByLight, type Vision } from './vision';

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

/**
 * One turn's worth of what the player perceived: the terrain, and the creatures.
 *
 * Named for the turn because that is its whole lifetime — it is derived from the map and `Vision`
 * every turn and **never stored**, and the one part of it that outlives the turn does so by being
 * folded into `Vision.remembered` rather than by being kept (`vision.ts`).
 */
export type TurnPerception = {
  /** Terrain perceived this turn: the lit field, or the tiles within touch. */
  readonly terrain: TileSet;
  /**
   * **Which column of the table produced `terrain`** — the lantern, or a hand on the stone.
   *
   * Carried rather than re-derived from `vision.shutter` by the caller, because §4's cache rule
   * (`vision.ts`) turns "was this ground *lit* or merely *felt*" into a thing the simulation
   * records, and a second site deciding it is a second site that can decide it differently. It is
   * the discriminant of this whole type in everything but name; `terrain` and `creatures` both
   * mean something different under each value.
   */
  readonly terrainFrom: 'light' | 'touch';
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
): TurnPerception {
  switch (vision.shutter) {
    case 'open': {
      const terrain = computeLitField(grid, origin);
      return { terrain, terrainFrom: 'light', creatures: seenIn(terrain, creatures) };
    }
    case 'shuttered': {
      const terrain = computeTouchField(grid, origin);
      const felt = senseCreatures(origin, vision.senseRadius, creatures);
      return {
        terrain,
        terrainFrom: 'touch',
        creatures: felt.map((at) => ({ kind: 'felt', at }) as const),
      };
    }
    default:
      return assertNever(vision.shutter, 'perceive');
  }
}

/**
 * Fold one turn's perception into the vision that outlives it — GDD §2 phase 3's whole memory half.
 *
 * Two monotone planes, and `terrainFrom` is what separates them:
 *
 *   - **`remembered` always grows.** Felt ground is mapped ground; §4's "permanent once seen" makes
 *     no distinction, and a rule that items are invisible may not make the item's tile the only
 *     unknown cell on the board.
 *   - **`revealed` grows only under light.** That is §4's cache rule (`vision.ts`), and it is
 *     stated here — once, at the seam where the turn's perception becomes state — rather than at
 *     the call site, so that no phase can grow the wrong plane by reading the shutter itself.
 *
 * Returns the same `Vision` when nothing new was perceived, so an ordinary turn allocates nothing.
 */
export function rememberPerception(vision: Vision, perception: TurnPerception): Vision {
  const seen = remember(vision, perception.terrain);
  switch (perception.terrainFrom) {
    case 'light':
      return revealByLight(seen, perception.terrain);
    case 'touch':
      return seen;
    default:
      return assertNever(perception.terrainFrom, 'rememberPerception');
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
