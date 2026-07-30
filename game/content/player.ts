/**
 * The player's numbers. GDD §3's tuning table.
 *
 * All **(tuning)**, all changeable from playtest evidence without an ADR. The rules they sit inside
 * are not: one action per turn, deterministic damage, no healing within a floor, and a dormant
 * strike that doubles. Those live with the systems that enforce them.
 *
 * Separate from `creatures.ts` because the player is not a creature: it has no species row, no
 * dormancy, no ember drop, and nothing spawns it from a table. Merging the two would mean either a
 * creature definition full of fields the player does not have or a player row full of fields no
 * creature reads.
 */

/** §3: Player HP 12 (tuning). Also the cap `restoreOnDescent` heals toward. */
export const PLAYER_MAX_HP = 12;

/** §3: Player attack 3 (tuning) — "6 vs dormant" is this times the dormant-strike multiplier. */
export const PLAYER_ATTACK = 3;

/**
 * §3: "Descending restores 2 HP (tuning)." The **only** thing in the game that raises HP, which is
 * what makes "no healing within a floor" checkable: a test can assert the player's HP is
 * non-increasing across a floor and this constant is the single exception it has to know about.
 */
export const DESCENT_HEAL = 2;
