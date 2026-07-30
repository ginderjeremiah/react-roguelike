/**
 * The helpers everything else in `game/` actually calls: `int`, `float`, `pick`, `shuffle`,
 * `weighted`.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE DRAW-COUNT CONTRACT — read this before changing anything in this file
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * **Every helper here consumes a number of `next()` draws that depends only on the *shape* of its
 * arguments, never on the values drawn.**
 *
 *   int(rng, min, max)      exactly 1 draw, always — including when min === max
 *   float(rng)              exactly 1 draw
 *   pick(rng, items)        exactly 1 draw
 *   weighted(rng, entries)  exactly 1 draw
 *   shuffle(rng, items)     exactly max(0, items.length - 1) draws
 *
 * A corollary that is easy to break by accident: **all argument validation happens before the
 * first draw.** No helper here may consume entropy and then throw, because the caller's `Rng` is
 * the pre-call state — a partially consumed draw would be discarded along with the exception, and
 * whether that matters would depend on how the caller handles the error.
 *
 * ### Why this matters more than it looks like it does
 *
 * A variable draw count is still *deterministic* — replay the same code with the same seed and you
 * get the same answer. The problem is not reproducibility, it is fragility and legibility:
 *
 *   - Stream position becomes unpredictable. "This turn consumes four draws" is a statement you
 *     can hold in your head and assert in a test. "This turn consumes four draws, or five if the
 *     first one landed in the rejection zone" is not.
 *   - An accidental extra draw becomes undetectable. With a fixed contract, a test can assert that
 *     an operation advances the state by exactly N steps, and a stray conditional draw introduced
 *     by a later change fails that test immediately instead of silently shifting every subsequent
 *     value in the run.
 *   - It puts a data-dependent branch on the randomness path, which is precisely the pattern that
 *     produces "an unrelated bug days later": the symptom appears far from the change, in whatever
 *     system happened to be drawing next.
 *
 * ### The cost we accepted to get it: `int()` is very slightly biased
 *
 * The textbook way to map a uniform 32-bit word onto `n` outcomes without bias is rejection
 * sampling — draw, and if the value lands in the unusable remainder at the top of the range, throw
 * it away and draw again. That is exactly the variable draw count above. It is also unbounded in
 * the worst case, which sits badly with a 2ms/turn budget.
 *
 * We use the multiply-high (Lemire) map with the rejection step *removed*:
 *
 *     result = min + floor(u32 * n / 2^32)
 *
 * This partitions the 2^32 possible words into `n` buckets of size either floor(2^32/n) or
 * ceil(2^32/n). Every outcome is reachable and the maximum relative deviation from uniform is
 * below n / 2^32.
 *
 * Concretely, for the ranges this game will ever use:
 *
 *     n = 6      (a die)              bias < 1.4e-9
 *     n = 100    (a percentile roll)  bias < 2.4e-8
 *     n = 4000   (a tile on a 80x50 map) bias < 9.4e-7
 *
 * Detecting a 1e-9 bias needs on the order of 10^18 samples. A full run of this game will draw
 * perhaps 10^6 times. The bias is not merely acceptable, it is unobservable in principle — whereas
 * the fragility of a variable draw count is a thing that would actually have bitten us.
 *
 * Note also that the bias attaches to *bucket boundaries*, not to particular outcomes: which
 * outcomes get the extra word depends on n, so there is no systematic "low numbers are more
 * likely" artifact that a player could ever perceive.
 *
 * **If you ever need a genuinely unbiased draw** — and no game mechanic here does — add a
 * separate, clearly named `intUnbiased` with rejection sampling and document at its call site that
 * it breaks the draw-count contract. Do not change `int`.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

import { next, type Draw, type Rng } from './xoshiro128';

/** 2^32. The number of distinct values `next()` can return. */
const UINT32_RANGE = 4294967296;

/**
 * The high 32 bits of the 64-bit product `a * b`, where both are unsigned 32-bit integers.
 * Equivalently: `floor(a * b / 2^32)`.
 *
 * Computed by splitting `a` into 16-bit halves, because the full product reaches 2^64 and doubles
 * only carry 53 bits of integer precision — `Math.floor(a * b / 2 ** 32)` would silently round for
 * large operands and produce an off-by-one at bucket boundaries. Every intermediate below stays
 * under 2^53 and is therefore exact:
 *
 *     hi = a >>> 16                   < 2^16
 *     lo = a & 0xffff                 < 2^16
 *     hi * b                          < 2^48   exact
 *     floor(lo * b / 2^16)            < 2^32   exact (lo * b < 2^48)
 *     their sum                       < 2^49   exact
 *
 * Dropping `lo * b`'s own low 16 bits is not an approximation: they contribute less than 1 to the
 * final division by 2^16, and adding a fraction below 1 to an integer cannot change its floor.
 *
 * Exported so the arithmetic can be checked directly against BigInt ground truth in the tests;
 * `mulhi32` being subtly wrong for large `b` is the kind of thing that would otherwise only show
 * up as a rare out-of-bounds map coordinate.
 *
 * @param b may be up to 2^32 inclusive, which is what lets `int` span the full uint32 range
 */
export function mulhi32(a: number, b: number): number {
  const hi = a >>> 16;
  const lo = a & 0xffff;
  return Math.floor((hi * b + Math.floor((lo * b) / 0x10000)) / 0x10000);
}

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`rng: ${label} must be a safe integer, got ${String(value)}`);
  }
}

/**
 * A uniform integer in `[min, max]` — **both ends inclusive**.
 *
 * Inclusive at both ends because the overwhelming majority of call sites are "roll a d6" and
 * "pick a tile between 0 and width - 1", and a half-open upper bound turns every one of those
 * into an off-by-one waiting to happen. `int(rng, 1, 6)` returns 1 through 6.
 *
 * Consumes exactly one draw, even when `min === max` and the answer is a foregone conclusion.
 * Skipping the draw in that case would make consumption depend on the arguments' values, and a
 * level generator whose ranges collapse to a single value on some seeds would then shift the whole
 * downstream stream. See the draw-count contract at the top of this file.
 *
 * @throws if the bounds are not safe integers, if `max < min`, or if the span exceeds 2^32
 */
export function int(rng: Rng, min: number, max: number): Draw<number> {
  assertSafeInteger(min, 'min');
  assertSafeInteger(max, 'max');
  if (max < min) {
    throw new Error(`rng: int() requires max >= min, got min=${min} max=${max}`);
  }
  const span = max - min + 1;
  if (span > UINT32_RANGE) {
    throw new Error(`rng: int() span must be at most 2^32, got ${span}`);
  }

  const drawn = next(rng);
  return { value: min + mulhi32(drawn.value, span), rng: drawn.rng };
}

/**
 * A uniform float in `[0, 1)`.
 *
 * One draw, so the resolution is 2^-32 rather than the 2^-53 a double could hold. That is a
 * deliberate trade: 53-bit precision costs two draws, and nothing in a turn-based roguelike needs
 * to distinguish probabilities finer than one in four billion.
 *
 * The division is by 2^32, a power of two, so it is exact on any IEEE-754 implementation — this
 * does not smuggle host float behavior into the simulation. The core step remains integer-only.
 *
 * Prefer `int` or `weighted` for game rules. A float is the right tool for a continuous quantity;
 * most randomness in a roguelike is discrete, and integers are far easier to reason about in a
 * balance discussion.
 */
export function float(rng: Rng): Draw<number> {
  const drawn = next(rng);
  return { value: drawn.value / UINT32_RANGE, rng: drawn.rng };
}

/**
 * One element chosen uniformly from `items`. One draw.
 *
 * The input must be an array — an ordered structure. Never pass the result of iterating a `Set` or
 * `Object.keys`; the order of those is not part of the simulation's definition, and picking from
 * them makes the outcome depend on insertion history. Sort by a stable key first.
 *
 * @throws on an empty array. Returning `undefined` would let a mis-specified content table
 *   propagate a hole into the simulation and surface somewhere unrelated.
 */
export function pick<T>(rng: Rng, items: readonly T[]): Draw<T> {
  if (items.length === 0) {
    throw new Error('rng: pick() requires a non-empty array');
  }
  const index = int(rng, 0, items.length - 1);
  return { value: items[index.value], rng: index.rng };
}

/**
 * A shuffled copy of `items`. The input is never mutated.
 *
 * Fisher-Yates, back to front, consuming **exactly `items.length - 1` draws** (zero for an array
 * of 0 or 1 elements). That fixed count is the whole reason `int` is fixed-draw; see the contract
 * at the top of this file.
 *
 * A note on reachability, since it is the sort of thing that looks like a bug when discovered
 * later: the generator has 2^128 states, so at most 2^128 permutations are reachable from a given
 * seed. 34! is already larger than that, meaning for arrays beyond ~34 elements some permutations
 * can never be produced. This is true of every practical PRNG shuffle and is irrelevant at the
 * scale of anything this game shuffles (room lists, loot tables, spawn slots).
 */
export function shuffle<T>(rng: Rng, items: readonly T[]): Draw<T[]> {
  const out = items.slice();
  let current = rng;
  for (let i = out.length - 1; i > 0; i -= 1) {
    const roll = int(current, 0, i);
    current = roll.rng;
    const j = roll.value;
    const swap = out[i];
    out[i] = out[j];
    out[j] = swap;
  }
  return { value: out, rng: current };
}

/**
 * An entry in a weighted table. Weights are **non-negative integers**.
 *
 * Integers, not floats, for two reasons. Determinism: summing floats is order-dependent in its
 * rounding, and while array order is fixed here, integer totals remove the question entirely and
 * keep `weighted` on the same all-integer footing as the rest of this module. Legibility: a
 * content table reading `{ weight: 3 }` next to `{ weight: 1 }` states its intent more plainly
 * than `0.75` and `0.25`, and rescaling is free. A weight of 0 is allowed and means "never".
 */
export type WeightedEntry<T> = {
  readonly value: T;
  readonly weight: number;
};

/**
 * Choose one entry with probability proportional to its weight. One draw.
 *
 * The result depends on the order of `entries` only in the sense that any two tables with the same
 * multiset of (value, weight) pairs give the same *distribution* — but a given seed maps to
 * different entries under different orderings. Keep content tables in a stable, source-controlled
 * order; never build one by iterating a `Map`.
 *
 * @throws if the table is empty, if any weight is not a non-negative safe integer, or if the total
 *   is zero or exceeds 2^32. A malformed table is a content bug and should fail in the table test
 *   that loads it, not roll a silent default.
 */
export function weighted<T>(rng: Rng, entries: readonly WeightedEntry<T>[]): Draw<T> {
  if (entries.length === 0) {
    throw new Error('rng: weighted() requires a non-empty table');
  }

  let total = 0;
  for (const entry of entries) {
    assertSafeInteger(entry.weight, 'weight');
    if (entry.weight < 0) {
      throw new Error(`rng: weighted() requires non-negative weights, got ${entry.weight}`);
    }
    total += entry.weight;
  }
  if (total === 0) {
    throw new Error('rng: weighted() requires at least one entry with a positive weight');
  }
  if (total > UINT32_RANGE) {
    throw new Error(`rng: weighted() total weight must be at most 2^32, got ${total}`);
  }

  const roll = int(rng, 0, total - 1);

  // Zero-weight entries can never win: they leave `cumulative` unchanged, so the comparison that
  // was already false stays false.
  let cumulative = 0;
  for (const entry of entries) {
    cumulative += entry.weight;
    if (roll.value < cumulative) {
      return { value: entry.value, rng: roll.rng };
    }
  }

  // Unreachable: `roll.value < total`, and `cumulative === total` after the final iteration. Kept
  // as a throw rather than a non-null assertion so that a future edit which breaks the invariant
  // fails loudly instead of returning a silently wrong entry.
  throw new Error('rng: weighted() failed to select an entry, which should be impossible');
}
