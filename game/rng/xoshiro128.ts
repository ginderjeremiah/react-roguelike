/**
 * xoshiro128** — the only source of randomness in this project.
 *
 * ## Why this generator
 *
 * The brief was "PCG32 or xoshiro128**". Both are good; xoshiro128** wins here on one specific
 * ground, which is that its entire step is 32-bit integer arithmetic.
 *
 * PCG32's state advance is a 64-bit LCG. JavaScript has no 64-bit integer multiply, so a faithful
 * PCG32 needs either BigInt (allocating, slow, and a comparatively lightly-exercised code path in
 * Hermes) or a hand-rolled 64x64 multiply out of 32-bit halves. The second is maybe twenty lines
 * of shifting and carrying that must be exactly right, forever, on every engine, or replays
 * diverge between web and native. That is a lot of risk to accept in the module the entire testing
 * strategy is built on.
 *
 * xoshiro128** needs only xor, shift, rotate, and multiply-by-a-constant. `Math.imul` performs an
 * exact 32-bit multiply and `>>>` an exact unsigned shift; both are fully specified by ECMA-262
 * with no implementation latitude at all. The step is therefore identical on V8, JavaScriptCore,
 * and Hermes by construction rather than by hope.
 *
 * The statistical case is a wash — xoshiro128** passes BigCrush, has a period of 2^128 - 1, and is
 * the 32-bit output generator its authors (Blackman and Vigna) recommend. Its known weakness is
 * linearity in the lowest bits of the *plain* xoshiro128+ variant; the `**` scrambler exists to
 * fix that, and it is what we use. We never take low bits directly anyway (see `mulhi32` in
 * `draw.ts`).
 *
 * ## Why the state is a value, not an object with methods
 *
 * `Rng` is four numbers and nothing else. It lives inside `GameState`, so it must be plain,
 * immutable, structurally comparable, and JSON-round-trippable. Named fields rather than a
 * `number[]`: an array field would be a mutable object shared by reference between "immutable"
 * states, which is exactly the aliasing bug ARCHITECTURE.md warns about.
 *
 * ## Threading, not mutation
 *
 * Every operation takes an `Rng` and returns a `Draw<T>` — the value *and* the next `Rng`. The
 * caller threads the new state forward. This is the ergonomic choice the whole simulation lives
 * with, so the reasoning, including the rejected alternative, is written out in `Draw` below.
 *
 * See ADR-0004.
 */

import { seedWords } from './seed';

/**
 * Immutable xoshiro128** state: four unsigned 32-bit words. Never all zero.
 *
 * Construct with `createRng` (from a seed string) or `rngFromWords` (from persisted state). Do not
 * assemble one by hand — the all-zero state is a fixed point that emits a constant forever, and
 * only those two constructors rule it out.
 */
export type Rng = {
  readonly s0: number;
  readonly s1: number;
  readonly s2: number;
  readonly s3: number;
};

/**
 * The result of consuming randomness: a value, plus the generator state that produced it.
 *
 * ## Why `{ value, rng }` and not a mutable generator
 *
 * The alternative considered — and rejected — was a small cursor object with mutating draw
 * methods (`cursor.int(1, 6)`), created from an `Rng` and handed back at the end of a turn. It
 * reads better in draw-heavy code like level generation, and that is a real cost we are paying.
 *
 * It was rejected because it makes the pure form optional. Once both exist, some code threads and
 * some code mutates, and the boundary between them is where a state-reuse bug lives: a cursor
 * captured in a closure, or written back to state twice, produces *plausible* randomness that
 * happens to repeat. Determinism bugs of that shape do not announce themselves; they surface a
 * fortnight later as "the level generator makes symmetric rooms sometimes." One API, threaded
 * explicitly, means every place randomness is consumed is visible in the call site's data flow.
 *
 * Object with named fields rather than a `[value, rng]` tuple, because destructuring assignment
 * into pre-declared bindings (`[w, rng] = int(rng, 5, 12)`) is genuinely awkward in TypeScript and
 * positional pairs read badly when nested. `const size = int(rng, 5, 12); size.value; size.rng` is
 * plain.
 *
 * **Revisit if** level generation in M1 turns into an unreadable ladder of `rng1`, `rng2`, `rng3`.
 * The fix at that point is a *scoped* combinator (`sequence`, `chain`) that still returns a
 * `Draw`, not a mutable cursor.
 */
export type Draw<T> = {
  readonly value: T;
  readonly rng: Rng;
};

/** Rotate an unsigned 32-bit word left by `k` bits (0 < k < 32). */
function rotl32(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/**
 * Build an `Rng` from four raw words, normalizing each to unsigned 32-bit.
 *
 * Rejects the all-zero state by substituting a fixed nonzero state. Zero is a fixed point of
 * xoshiro's linear step: every subsequent output would be 0, forever, with no error and no
 * warning. This is the failure mode where a "seeded" generator silently produces no randomness at
 * all, so it gets a guard even though a seed string cannot realistically reach it.
 *
 * Use this to rehydrate persisted state. To start a run, use `createRng`.
 */
export function rngFromWords(a: number, b: number, c: number, d: number): Rng {
  const s0 = a >>> 0;
  const s1 = b >>> 0;
  const s2 = c >>> 0;
  const s3 = d >>> 0;
  if ((s0 | s1 | s2 | s3) === 0) {
    // Arbitrary but fixed, so the degenerate input stays deterministic rather than becoming an
    // error path that callers have to handle.
    return { s0: 0x9e3779b9, s1: 0x243f6a88, s2: 0xb7e15162, s3: 0x85a308d3 };
  }
  return { s0, s1, s2, s3 };
}

/**
 * Create a generator from a human-shareable seed string.
 *
 * Pure: the same string always yields the same starting state, on every platform and every run.
 * Any string is valid, including the empty string.
 */
export function createRng(seed: string): Rng {
  const [a, b, c, d] = seedWords(seed);
  return rngFromWords(a, b, c, d);
}

/**
 * Advance the generator by exactly one step.
 *
 * @returns the drawn value as an unsigned 32-bit integer (0 .. 4294967295), and the next state
 *
 * This is the only place the generator advances. Every helper in `draw.ts` is built on it, which
 * is what makes "how many draws does this operation consume" an answerable question.
 */
export function next(rng: Rng): Draw<number> {
  const { s0, s1, s2, s3 } = rng;

  // The ** scrambler: rotl(s1 * 5, 7) * 9. Applied to the *old* state, before it advances.
  const value = Math.imul(rotl32(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;

  // The linear step. Order matters: each line uses the values as updated by the lines above it,
  // exactly as in the reference C. Transcribed with intermediates rather than compound assignment
  // so that dependency is explicit and cannot be reordered by a well-meaning refactor.
  const t = s1 << 9;
  const a2 = s2 ^ s0;
  const a3 = s3 ^ s1;
  const n1 = (s1 ^ a2) >>> 0;
  const n0 = (s0 ^ a3) >>> 0;
  const n2 = (a2 ^ t) >>> 0;
  const n3 = rotl32(a3 >>> 0, 11);

  return { value, rng: { s0: n0, s1: n1, s2: n2, s3: n3 } };
}
