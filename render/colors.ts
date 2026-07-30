/**
 * Colour, as a **vocabulary of meanings** rather than as values.
 *
 * ## Why there are no hex codes in this layer
 *
 * Two reasons, and the second is the load-bearing one.
 *
 * GDD §10 defers palette and typography to M4. A palette written here now would be a set of
 * numbers nobody has looked at on a phone, and the first honest look at a screenshot would change
 * every one of them — which is a diff across `render/` for a decision that belongs to
 * `components/`'s theme.
 *
 * More importantly, **a hex code cannot be dark-mode aware and a token can.** `#c8c8c8` is one
 * colour; `'wall'` is a role that a light theme and a dark theme each answer differently, and GDD
 * §11 requires both to be honoured. The same argument covers the colourblind-safe palette: swapping
 * the palette must not require re-deriving what each cell *means*, and it does not, because the
 * meaning is what this layer emits.
 *
 * This is also what ADR-0003's seam is for. A Skia renderer would not want React Native colour
 * strings; it would want these same roles resolved against its own material.
 *
 * ## The rule that keeps this honest
 *
 * **Colour is never the sole carrier of meaning (§11).** Every distinction expressed by a token
 * here is *also* expressed by a non-colour field of the same `Cell` — the glyph, the opacity, or
 * the telegraph frame. `render/accessibility.test.ts` asserts that as a property over real runs,
 * because a comment saying it is true is not the same as a test that fails when it stops being.
 */

/**
 * Every colour role a cell can ask for. A closed union, so a component's theme is a total mapping
 * and a token with no colour behind it is a type error rather than a transparent cell.
 */
export type ColorToken =
  // --- surfaces -------------------------------------------------------------------------------
  /** The unlit background of the board. What an `unknown` cell is drawn on and in. */
  | 'void'
  /** The background of a cell the player knows something about. */
  | 'surface'
  // --- terrain (GDD §10's glyph set) ----------------------------------------------------------
  | 'wall'
  | 'floor'
  | 'pillar'
  | 'doorway'
  | 'entrance'
  | 'stairs'
  /** Ember on the ground — a cache tile, and a drop left by a kill. §4's two fuel sources. */
  | 'ember'
  // --- the living -----------------------------------------------------------------------------
  | 'player'
  /** A creature seen and identified in light (§4's lit column). */
  | 'creature'
  /** An ember-sense contact: a position and nothing else (§4). Never species-specific. */
  | 'contact'
  // --- telegraphs (§2) ------------------------------------------------------------------------
  /** The fill behind a declared attack's target tile. */
  | 'telegraphAttack'
  /** The fill behind a declared move's destination tile. */
  | 'telegraphMove';

/**
 * Every token, in a fixed order. Iterate this — never `Object.keys` of a theme table, and never a
 * set built from whatever a particular scene happened to use.
 *
 * Exported so a theme in `components/` can be checked for completeness by a test rather than by
 * whoever is looking at the screen that day.
 */
export const COLOR_TOKENS: readonly ColorToken[] = [
  'void',
  'surface',
  'wall',
  'floor',
  'pillar',
  'doorway',
  'entrance',
  'stairs',
  'ember',
  'player',
  'creature',
  'contact',
  'telegraphAttack',
  'telegraphMove',
];

/**
 * How urgent a HUD number is. Three levels, and **the number itself is always shown beside it** —
 * that is what stops this from being colour as the sole carrier (§11).
 *
 * Not a cell colour: a meter is not a tile, and giving them one union would let a cell ask for
 * `'critical'`.
 */
export type MeterLevel = 'ok' | 'low' | 'critical';
