/**
 * How long a run is. GDD §8 and §13.
 *
 * A number rather than a rule, so it lives here: §8 says "target 15-30 minutes, **8 floors**" and
 * §13 pins the ending to it — "the player takes the stairs on the last floor (**8, tuning** — §5)".
 * Changing it changes the length of a run and nothing else; **there is no floor 9 and no boss**, so
 * the rule reading this constant (`game/systems/run.ts`) does not change shape when it moves.
 */

/** Floors are 1-based, and `generateFloor` rejects anything below this. */
export const FIRST_FLOOR = 1;

/**
 * The floor whose stairs end the run as a win (§13). **(tuning)**
 *
 * Descending from here is the only way to win; no floor beyond it is ever generated, which is what
 * makes "there is no floor 9" a property of the code rather than a promise in a document.
 */
export const LAST_FLOOR = 8;
