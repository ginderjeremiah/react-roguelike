/**
 * The creature table. GDD §6 — for M1 that is exactly one row, the Cinder.
 *
 * ## Why this is data and not a class
 *
 * ARCHITECTURE.md: "content/ — data tables. data, not logic." The test of whether that holds is
 * simple: **adding a second creature must touch this file and the spawn kind in `game/map/`, and
 * nothing in `game/systems/`.** Every stat a system reads is a field here, and the one place a
 * system asks about a species is `creatureDefinition`, which is an exhaustive switch — so adding a
 * kind to `CreatureSpawn` fails to compile here rather than falling through to a default row.
 *
 * ## Numbers versus rules
 *
 * Everything in this file is **(tuning)**, per GDD §3's tuning table and §6: 5 HP, 2 attack, 30
 * ember. Change them from playtest evidence without an ADR. What is *not* tuning is the shape:
 * a creature has flat integer HP and a flat integer attack, because §3 forbids damage ranges and
 * to-hit rolls outright (Pillar 2). The dormant-strike multiplier is a rule and lives with combat,
 * not here.
 *
 * ## The glyphs
 *
 * §11 is a design constraint, not a rendering detail: **case and shape carry dormancy, never colour
 * alone.** Keeping the pair here — rather than letting `render/` pick a glyph per state — means a
 * creature that is legible only by colour is a failing content test rather than a thing an
 * accessibility pass discovers later.
 *
 * `EMBER_SENSE_GLYPH` is deliberately *not* a per-creature field. §4: ember-sense gives "position
 * only. Not identity, not health, not intent." A per-species sense glyph would leak identity
 * through the dark, which is the exact information the design cut.
 */

import { assertNever } from '../core/assert';
import type { CreatureSpawn } from '../map';

/**
 * Which creature. Derived from the map's spawn union rather than declared separately, so the
 * generator and the content table cannot drift apart: a spawn kind with no row here is a type
 * error in `creatureDefinition`.
 */
export type CreatureKind = CreatureSpawn['kind'];

/** One row of the creature table. */
export type CreatureDefinition = {
  readonly kind: CreatureKind;
  /** For messages and debugging. Never parsed. */
  readonly name: string;
  /** §3: flat integer HP. Also the HP a spawn starts at — nothing heals within a floor (§3). */
  readonly maxHp: number;
  /** §3: flat integer damage, doubled against a dormant target by the combat rules. */
  readonly attack: number;
  /** §4: fuel comes from kills. Dropped where the creature died. */
  readonly emberDrop: number;
  /** §6/§11: seen in light while dormant. Lowercase half of the case pair. */
  readonly glyphDormant: string;
  /** §6/§11: seen in light while awake. Uppercase half of the case pair. */
  readonly glyphAwake: string;
};

/** GDD §6. Every number here is tuning. */
export const CINDER: CreatureDefinition = {
  kind: 'cinder',
  name: 'Cinder',
  maxHp: 5,
  attack: 2,
  /**
   * 20, not the 30 §4 first wrote down. **Moved by measurement, not by taste** — §4's third
   * invariant ("a floor played well nets *slightly* positive fuel") failed at 30: a scripted
   * competent run netted about +85 fuel a floor against a starting reserve of 80, so the lantern
   * stopped being a resource after the first floor. See `game/systems/economy.test.ts`, which is
   * what caught it and what will catch it again. GDD change log, 2026-08-02.
   */
  emberDrop: 20,
  glyphDormant: 'c',
  glyphAwake: 'C',
};

/**
 * Every creature, in a fixed source order. Iterate this — never `Object.keys` of a table object,
 * whose order is not part of the simulation's definition (ADR-0004).
 */
export const CREATURES: readonly CreatureDefinition[] = [CINDER];

/**
 * §4/§10: what ember-sense shows. One glyph for every living thing, because ember-sense reports
 * position and nothing else.
 */
export const EMBER_SENSE_GLYPH = '*';

/**
 * The row for a species.
 *
 * An exhaustive switch rather than a lookup, so that adding a creature to the map's spawn union is
 * a compile error here. A `find` returning `undefined` would let a species with no stats reach the
 * simulation and surface as `NaN` HP three systems away.
 */
export function creatureDefinition(kind: CreatureKind): CreatureDefinition {
  switch (kind) {
    case 'cinder':
      return CINDER;
    default:
      return assertNever(kind, 'creatureDefinition');
  }
}
