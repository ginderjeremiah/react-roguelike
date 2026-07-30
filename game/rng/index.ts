/**
 * The single source of randomness for the entire project.
 *
 * ```ts
 * import { createRng, int, shuffle } from '@/game/rng';
 *
 * const rng = createRng('emberdepth');       // seed strings are human-shareable
 * const roll = int(rng, 1, 6);               // { value, rng } — thread the new state forward
 * const order = shuffle(roll.rng, monsters); // never mutates its input
 * ```
 *
 * `Math.random()` is a lint error inside `game/`. Everything random flows from here, and the
 * generator state lives in `GameState` so that a run is fully described by its seed and its
 * command log. See ADR-0004 and `docs/ARCHITECTURE.md`.
 *
 * Before adding a helper, read the draw-count contract at the top of `draw.ts`. It is the
 * invariant that keeps replays legible.
 */

export { createRng, next, rngFromWords, type Draw, type Rng } from './xoshiro128';
export { float, int, pick, shuffle, weighted, type WeightedEntry } from './draw';
export { hashString, seedWords } from './seed';
