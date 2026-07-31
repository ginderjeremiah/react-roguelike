/**
 * The glyph set. GDD §10, as a table.
 *
 * > `@` player · `#` wall · `·` floor · `o` pillar · `>` stairs down · `♦` ember cache ·
 * > `c`/`C` Cinder dormant/awake · `*` ember-sense contact.
 *
 * ## Where each glyph comes from
 *
 * Three sources, and the split is deliberate rather than tidy:
 *
 *   - **Terrain and the player** are here, because §10 names them and nothing else needs them.
 *   - **Creature glyphs are not here.** They are fields of the creature's row in
 *     `game/content/creatures.ts` (`glyphDormant` / `glyphAwake`), because §11 makes the case pair a
 *     *content* constraint: "case and shape carry dormancy, never colour alone". A renderer that
 *     picked its own glyph per state could quietly drop that pairing, and adding a second creature
 *     would mean editing this file.
 *   - **The ember-sense contact is `EMBER_SENSE_GLYPH`**, also from content, and also not
 *     per-species on purpose: §4 gives ember-sense "position only. Not identity, not health, not
 *     intent", so one glyph for every living thing is the promise implemented.
 *
 * ## Two glyphs §10 does not give
 *
 * The doorway and the entrance have no §10 glyph. `+` and `<` are the roguelike conventions and are
 * what `game/map/debug.ts` already uses, so the ASCII dump a test failure prints and the board a
 * player looks at agree. If §10 ever names them, this is the one place to change.
 *
 * ## The ember drop shares the cache glyph
 *
 * §10 gives one ember glyph, `♦`, and calls it the cache. A drop left by a kill is the other half of
 * §4's "fuel comes from kills and caches" and §13 calls both of them "ember on the ground"; giving
 * the drop a second glyph would be inventing content §10 did not specify, and would ask the player
 * to learn two symbols for one action (walk onto it). One glyph, one meaning: *there is fuel here*.
 *
 * ## Encoding
 *
 * `·` and `♦` are not ASCII, and `game/map/debug.ts` deliberately avoids them so a pinned test
 * expectation cannot break on a platform's text encoding. That reasoning does not transfer here —
 * these are the glyphs a player sees, and §10 names them. `glyphs.test.ts` pins the codepoints with
 * `\u` escapes instead, which is encoding-proof *and* enforcing.
 */

import { creatureDefinition, EMBER_SENSE_GLYPH } from '../game/content';
import { assertNever } from '../game/core';
import type { CreatureActor } from '../game/entities';
import type { Tile } from '../game/map';

/** Every glyph this layer can draw. */
export const GLYPHS = {
  /** §10. The player, always drawn — you always know where you are. */
  player: '@',
  wall: '#',
  floor: '·',
  pillar: 'o',
  doorway: '+',
  entrance: '<',
  stairs: '>',
  /** §10's ember cache, and (see the header) an ember drop as well. */
  ember: '♦',
  /** §4/§10: a living thing felt through stone. Position and nothing else. */
  contact: EMBER_SENSE_GLYPH,
  /** An `unknown` cell. Not a dot, not a shade — nothing at all. See `cell.ts`. */
  blank: ' ',
} as const;

/**
 * The glyph for a tile. An exhaustive switch, so an eighth tile kind is a compile error here rather
 * than an `undefined` rendered as the string "undefined" across four cells.
 */
export function glyphForTile(tile: Tile): string {
  switch (tile.kind) {
    case 'wall':
      return GLYPHS.wall;
    case 'floor':
      return GLYPHS.floor;
    case 'pillar':
      return GLYPHS.pillar;
    case 'doorway':
      return GLYPHS.doorway;
    case 'entrance':
      return GLYPHS.entrance;
    case 'stairs':
      return GLYPHS.stairs;
    case 'cache':
      return GLYPHS.ember;
    default:
      return assertNever(tile, 'glyphForTile');
  }
}

/**
 * The glyph for a creature the player can **see** (§4's lit column: "visible in the lit radius,
 * identified").
 *
 * Never called for a felt contact — that is `GLYPHS.contact`, and the difference is the whole of §4's
 * promise. `scene.ts` reaches for this only from a `seen` `CreatureSense`, and `scene.test.ts`
 * asserts that a `felt` one cannot reach it.
 */
export function glyphForCreature(creature: CreatureActor): string {
  const definition = creatureDefinition(creature.species);
  return creature.mind.kind === 'awake' ? definition.glyphAwake : definition.glyphDormant;
}
