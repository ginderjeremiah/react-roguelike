/**
 * Content tables — the numbers, not the rules.
 *
 * ```ts
 * import { CINDER, creatureDefinition, PLAYER_MAX_HP } from '@/game/content';
 * ```
 *
 * Everything here is plain data with a table test behind it (`creatures.test.ts`), so a malformed
 * definition fails at test time rather than as `NaN` HP in a fight. Nothing in this directory
 * imports a system, and no system needs changing to add a row.
 */

export {
  CINDER,
  CREATURES,
  creatureDefinition,
  EMBER_SENSE_GLYPH,
  type CreatureDefinition,
  type CreatureKind,
} from './creatures';
export {
  CACHE_FUEL,
  FUEL_BURN_LIT,
  FUEL_BURN_SHUTTERED,
  STARTING_FUEL,
} from './lantern';
export { DESCENT_HEAL, PLAYER_ATTACK, PLAYER_MAX_HP } from './player';
