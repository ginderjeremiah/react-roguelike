/**
 * Field of view, light propagation, and ember-sense — GDD §4.
 *
 * ```ts
 * import { createVision, closeShutter, adaptVision, perceive, remember } from '@/game/fov';
 *
 * let vision = closeShutter(createVision(floor.grid, 'open'));   // sense radius drops to 1
 * const perception = perceive(floor.grid, vision, playerAt, creaturePositions);
 * vision = remember(vision, perception.terrain);                 // terrain memory is permanent
 * vision = adaptVision(vision);                                  // +1 sense radius, end of turn
 * ```
 *
 * ## Two senses, and the asymmetry between them is the game
 *
 * - **Light** (`light.ts` -> `shadowcast.ts`): Chebyshev radius 4, stopped by walls and pillars.
 * - **Ember-sense** (`embersense.ts`): Chebyshev radius 5, stopped by nothing, positions only.
 *
 * They are deliberately not built from a shared visibility routine, and `senseCreatures` is not
 * even given a grid to consult. Conflating them is how the wall-piercing rule gets broken by
 * accident, and it is the rule that answers "why would I ever shutter the lantern".
 *
 * ## The property this module rests on
 *
 * **When `senseRadius >= 4`, every lit tile is inside the sensed region** — everything a flash can
 * wake, you can already feel. It is why 5 >= 4 under one metric matters, and it is suspended on
 * purpose during the four turns of dark adaptation, which is what makes them the tensest state in
 * the game. See `containment.test.ts`.
 */

export { computeSensedField, senseCreatures } from './embersense';
export { computeLitField } from './light';
export { perceive, type CreatureSense, type TurnPerception } from './perceive';
export { shadowcast } from './shadowcast';
export {
  emptyTileSet,
  hasTile,
  tileSetContains,
  tileSetDifference,
  tileSetOf,
  tileSetPositions,
  tileSetSize,
  tileSetsEqual,
  unionTileSets,
  type TileSet,
} from './tileset';
export { computeTouchField } from './touch';
export {
  ADAPTATION_FLOOR,
  ADAPTATION_STEP,
  adaptVision,
  closeShutter,
  createVision,
  DARK_TOUCH_RADIUS,
  EMBER_SENSE_RADIUS,
  LIT_RADIUS,
  openShutter,
  remember,
  setShutter,
  tileKnowledge,
  TURNS_TO_FULL_ADAPTATION,
  type ShutterState,
  type TileKnowledge,
  type Vision,
} from './vision';
