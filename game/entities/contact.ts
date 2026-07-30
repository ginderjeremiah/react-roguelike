/**
 * The seam between "the Cinder is drawn to light" and any actual model of light.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS IS AN INJECTED QUERY AND NOT A LIGHTING MODEL
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * GDD §6 makes the Cinder's whole behaviour depend on light, and **light does not exist yet**: the
 * shutter, the fuel that powers it, and field of view are #17 and #14. The wrong move is to stub a
 * lighting model here — `game/systems/turn.ts` refused the same temptation for fuel and said why:
 * "an empty `burnFuel` that returns its state unchanged is a lie that passes tests, and the next
 * session finds it and assumes fuel is done."
 *
 * So the entity layer asks a question and is handed the answer, exactly as `resolveTurn` is handed
 * its phases. `game/entities/` contains no radius, no shutter state, no line-of-sight, and exports
 * no default `LightQuery` — a caller must supply one, which means the day #17 lands there is
 * nothing here to delete.
 *
 * ## The question is deliberately one boolean
 *
 * "Is the player's lantern-light visible from this tile?" — and **what "visible" means is not this
 * layer's decision.** GDD §4 says an awake creature knows the player's tile "while the shutter is
 * open", §6 says it paths to "where it last saw your light", and §4's *Open* section records that
 * even the metric behind a radius is unsettled (issue #25). Whether the answer is "the shutter is
 * open at all", "the tile is inside the lit radius", or "the tile has line of sight to the lantern"
 * is a lighting question, and every one of those readings plugs into this signature unchanged.
 *
 * The second half of contact — adjacency — is *not* injected, because §3 settles it outright:
 * movement and attacks are 4-directional, so adjacency is one orthogonal step and has exactly one
 * meaning. That half is a rule this layer owns.
 *
 * ## What an implementation must guarantee
 *
 *   - **Pure.** Same tile, same answer, no state of its own, no draws from the RNG. It is called a
 *     variable number of times per turn (once per creature that declares), so a query with a side
 *     effect — including consuming a random number — would make the run depend on how many
 *     creatures happened to be awake.
 *   - **Total.** Any in-bounds tile is a legal question, including one the player cannot see.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

import type { Position } from '../map';
import { isAdjacent, isAlive, type CreatureActor } from './actor';
import { playerOf, type ActorWorld } from './world';

/**
 * What a creature can learn about the player's lantern. Supplied by the lighting system.
 *
 * Named for what it is — a *query*, not a lighting model — so that this directory's rule ("light is
 * injected; there is no radius, shutter or line-of-sight in here") is legible from the type alone.
 */
export type LightQuery = {
  /**
   * Is the player's light visible from `at`? `false` whenever the shutter is closed — darkness is
   * the whole point of the mechanic, so a query that answered `true` while shuttered would delete
   * the game's central decision rather than change a number.
   */
  readonly isPlayerLightVisibleFrom: (at: Position) => boolean;
};

/**
 * Does this creature have contact with the player *right now*?
 *
 * §4: "an awake creature knows the player's tile while the shutter is open **or** while adjacent."
 * Both halves matter and they fail differently: without the light half the lantern stops being a
 * combat control (§6), and without the adjacency half you could stand next to a woken Cinder in the
 * dark and be ignored, which would make shuttering strictly dominant in every fight.
 *
 * Adjacency is checked first only because it is the cheaper test; the injected query is required to
 * be pure, so the order is not observable.
 *
 * A dead player is nobody's contact. That case exists because the run does not end inside this
 * layer — #18 decides what a dead player means — and creatures must not spend the intervening turns
 * attacking a corpse.
 */
export function hasContact(
  world: ActorWorld,
  creature: CreatureActor,
  light: LightQuery,
): boolean {
  const player = playerOf(world);
  if (!isAlive(player)) return false;
  return isAdjacent(creature.at, player.at) || light.isPlayerLightVisibleFrom(creature.at);
}
