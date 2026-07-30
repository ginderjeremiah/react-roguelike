import { describe, expect, it } from 'vitest';
import { createRng, next, type Rng } from './xoshiro128';
import { float, int, mulhi32, pick, shuffle, weighted, type WeightedEntry } from './draw';

/**
 * Tests for the draw helpers.
 *
 * Three things are being defended here, in order of how expensive they would be to discover later:
 *
 *   1. The draw-count contract (see the header of draw.ts). Every helper must advance the
 *      generator by a number of steps fixed by the shape of its arguments. These are the tests
 *      that would catch someone "improving" `int` with rejection sampling.
 *   2. The 64-bit arithmetic in `mulhi32`, checked against BigInt. Getting this wrong produces
 *      out-of-range values only for large spans — i.e. not on any small test case you would think
 *      to write.
 *   3. Bounds and distribution, so `int(rng, 1, 6)` really is a d6.
 */

// --- Helpers -----------------------------------------------------------------------------------

/** The state after `count` raw draws. The yardstick for every draw-count assertion below. */
function advance(rng: Rng, count: number): Rng {
  let current = rng;
  for (let i = 0; i < count; i += 1) current = next(current).rng;
  return current;
}

/** Collect `count` samples from a helper, threading state properly. */
function sample<T>(seed: string, count: number, draw: (rng: Rng) => { value: T; rng: Rng }): T[] {
  const out: T[] = [];
  let rng = createRng(seed);
  for (let i = 0; i < count; i += 1) {
    const drawn = draw(rng);
    out.push(drawn.value);
    rng = drawn.rng;
  }
  return out;
}

function chiSquare(counts: readonly number[], expectedEach: number): number {
  return counts.reduce((acc, observed) => {
    const diff = observed - expectedEach;
    return acc + (diff * diff) / expectedEach;
  }, 0);
}

// --- mulhi32 -----------------------------------------------------------------------------------

describe('mulhi32', () => {
  it('matches BigInt ground truth across the full uint32 range', () => {
    // The reason this function is exported. `Math.floor(a * b / 2 ** 32)` written naively is
    // correct for small operands and silently off by one for large ones, because the intermediate
    // product exceeds 2^53. The failure would surface as a rare out-of-bounds map coordinate,
    // months from now, on one seed.
    const cases: [number, number][] = [
      [0, 0],
      [0, 6],
      [4294967295, 1],
      [4294967295, 6],
      [4294967295, 4294967295],
      [4294967295, 4294967296],
      [1, 4294967296],
      [4294967295, 2],
      [2147483648, 4294967295],
      [65535, 4294967295],
      [65536, 4294967295],
      [4294901760, 4294967295],

      // Adversarial pairs, found by searching for products that sit just below a multiple of
      // 2^32. These are the ones that matter: the naive formula is correct for all of the round
      // numbers above and wrong for every pair here, by exactly one. A random sweep finds such a
      // pair roughly once in a million tries, which is to say: never, in a test suite, until it
      // happens in a real run.
      [2147483649, 2147483647],
      [2147483651, 3579139413],
      [2147483653, 3006477107],
      [2147483655, 3374617161],
      [2147483657, 1193046471],
      [2147483659, 3318838365],
      [2147483661, 3138629947],
      [2147483663, 2433814801],
    ];

    // Plus a broad pseudo-random sweep, using our own generator to pick the operands.
    let rng = createRng('mulhi-sweep');
    for (let i = 0; i < 20_000; i += 1) {
      const a = next(rng);
      const b = next(a.rng);
      rng = b.rng;
      cases.push([a.value, b.value]);
    }

    for (const [a, b] of cases) {
      const expected = Number((BigInt(a) * BigInt(b)) >> 32n);
      expect(mulhi32(a, b), `mulhi32(${a}, ${b})`).toBe(expected);
    }
  });
});

// --- int ---------------------------------------------------------------------------------------

describe('int', () => {
  it('stays within its bounds, inclusive of both ends', () => {
    const values = sample('int-bounds', 20_000, (rng) => int(rng, 1, 6));
    for (const value of values) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(6);
    }
  });

  it('actually reaches both endpoints', () => {
    // The bug this catches is an exclusive upper bound — a d6 that never rolls 6. Broad range
    // checks pass happily while that is true.
    const values = new Set(sample('int-endpoints', 20_000, (rng) => int(rng, 1, 6)));
    expect([...values].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('handles negative and zero-crossing ranges', () => {
    const values = new Set(sample('int-negative', 20_000, (rng) => int(rng, -3, 3)));
    expect([...values].sort((a, b) => a - b)).toEqual([-3, -2, -1, 0, 1, 2, 3]);
  });

  it('handles a span of one, and still consumes a draw', () => {
    // Deliberate design choice, documented in draw.ts: consumption must not depend on argument
    // *values*, or a generator whose range collapses on some seeds shifts the whole stream.
    const rng = createRng('int-degenerate');
    const drawn = int(rng, 7, 7);
    expect(drawn.value).toBe(7);
    expect(drawn.rng).toEqual(advance(rng, 1));
    expect(drawn.rng).not.toEqual(rng);
  });

  it('spans the full uint32 range correctly', () => {
    const rng = createRng('int-full-span');
    const raw = next(rng);
    expect(int(rng, 0, 4294967295).value).toBe(raw.value);
  });

  it('consumes exactly one draw, for every span', () => {
    // The draw-count test for int. Catches an extra draw for large spans, or an early return that
    // skips the draw. It does NOT catch rejection sampling for small spans — see the next test.
    const rng = createRng('int-draw-count');
    for (const [min, max] of [
      [0, 0],
      [1, 6],
      [0, 1],
      [-100, 100],
      [0, 4294967295],
      [0, 1000000],
      [5, 5],
    ] as [number, number][]) {
      expect(int(rng, min, max).rng, `int(rng, ${min}, ${max})`).toEqual(advance(rng, 1));
    }
  });

  it('consumes one draw even for spans where rejection sampling would resample', () => {
    // THE test the issue is really about, and it took a deliberate mutation to get right.
    //
    // Asserting "one draw" on a d6 does not catch rejection sampling. A rejection implementation
    // resamples when the drawn word lands in the unusable remainder at the top of the range, and
    // for span 6 that remainder is 4 words out of 2^32 — it would not trigger once in the lifetime
    // of this project's test suite, so the test would pass and the contract would be silently
    // broken.
    //
    // The remainder is largest for spans just above 2^31, where floor(2^32 / span) is 1 and
    // therefore roughly half of all draws are rejected. At those spans a rejection implementation
    // fails within a handful of samples.
    for (const span of [2147483649, 3000000000, 4000000000]) {
      const start = createRng(`int-rejection-${span}`);
      let rng = start;
      const samples = 200;
      for (let i = 0; i < samples; i += 1) rng = int(rng, 0, span - 1).rng;
      // P(a rejection implementation survives this) < 0.7^200, i.e. about 1e-31.
      expect(rng, `span ${span}`).toEqual(advance(start, samples));
    }
  });

  it('does not mutate the state it is given', () => {
    const rng = createRng('int-purity');
    const before = { ...rng };
    int(rng, 1, 100);
    expect(rng).toEqual(before);
  });

  it('rejects malformed bounds', () => {
    const rng = createRng('int-errors');
    expect(() => int(rng, 6, 1)).toThrow(/max >= min/);
    expect(() => int(rng, 1.5, 6)).toThrow(/safe integer/);
    expect(() => int(rng, 1, 6.5)).toThrow(/safe integer/);
    expect(() => int(rng, Number.NaN, 6)).toThrow(/safe integer/);
    expect(() => int(rng, 0, Number.POSITIVE_INFINITY)).toThrow(/safe integer/);
    expect(() => int(rng, 0, 4294967296)).toThrow(/span/);
  });

  it('is not visibly biased over a large sample', () => {
    // Chi-square goodness of fit, df = 5, alpha = 0.001 => critical value 20.515. The generator is
    // deterministic, so this either passes for every listed seed forever or the implementation is
    // wrong — there is no flakiness to manage.
    for (const seed of ['dist-a', 'dist-b', 'dist-c', 'dist-d']) {
      const counts = new Array<number>(6).fill(0);
      for (const value of sample(seed, 60_000, (rng) => int(rng, 0, 5))) counts[value] += 1;
      expect(chiSquare(counts, 10_000), `seed ${seed}: ${counts.join(',')}`).toBeLessThan(20.515);
    }
  });

  it('is not visibly biased for a span that does not divide 2^32', () => {
    // 2^32 mod 7 != 0, so this is where a modulo implementation's bias would live. Ours is
    // multiply-high, whose residual bias (< 7/2^32) is far below anything 140k samples can see —
    // but the test would catch a regression to plain `% span`, which for small spans is also
    // undetectable... and that is the honest point: at these sizes the two are statistically
    // indistinguishable. The real defence against `%` is the draw-count and endpoint tests plus
    // the pinned stream.
    const counts = new Array<number>(7).fill(0);
    for (const value of sample('dist-seven', 140_000, (rng) => int(rng, 0, 6))) counts[value] += 1;
    // df = 6, alpha = 0.001 => 22.458
    expect(chiSquare(counts, 20_000), counts.join(',')).toBeLessThan(22.458);
  });

  it('is uniform over a large span, bucketed', () => {
    // Exercises mulhi32 in the regime where the 16-bit split matters.
    const buckets = new Array<number>(16).fill(0);
    const span = 1_000_000;
    for (const value of sample('dist-large', 64_000, (rng) => int(rng, 0, span - 1))) {
      buckets[Math.floor((value / span) * 16)] += 1;
    }
    // df = 15, alpha = 0.001 => 37.697
    expect(chiSquare(buckets, 4_000), buckets.join(',')).toBeLessThan(37.697);
  });
});

// --- float -------------------------------------------------------------------------------------

describe('float', () => {
  it('stays in [0, 1)', () => {
    for (const value of sample('float-bounds', 50_000, float)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('consumes exactly one draw', () => {
    const rng = createRng('float-draw-count');
    expect(float(rng).rng).toEqual(advance(rng, 1));
  });

  it('divides the raw draw by exactly 2^32', () => {
    // Pins the divisor outright, rather than checking a range that many wrong divisors also
    // satisfy. Dividing by 2^32 - 1 lets float() return exactly 1.0 on the maximum draw, which
    // silently breaks every `Math.floor(f * n)` call site by producing an out-of-range index —
    // once in four billion draws, on one seed, months from now.
    let rng = createRng('float-divisor');
    for (let i = 0; i < 5_000; i += 1) {
      const raw = next(rng);
      const asFloat = float(rng);
      expect(asFloat.value).toBe(raw.value / 4294967296);
      expect(asFloat.value * 4294967296).toBe(raw.value); // exact: the divisor is a power of two
      rng = raw.rng;
    }

    // s1 === 0 makes the ** scrambler output 0, so this state produces the minimum draw.
    expect(float({ s0: 0, s1: 0, s2: 0, s3: 1 }).value).toBe(0);
  });

  it('is not visibly biased across ten buckets', () => {
    const buckets = new Array<number>(10).fill(0);
    for (const value of sample('float-dist', 50_000, float)) buckets[Math.floor(value * 10)] += 1;
    // df = 9, alpha = 0.001 => 27.877
    expect(chiSquare(buckets, 5_000), buckets.join(',')).toBeLessThan(27.877);
  });
});

// --- pick --------------------------------------------------------------------------------------

describe('pick', () => {
  const items = ['rat', 'bat', 'cat', 'gnat'] as const;

  it('returns an element of the array and consumes one draw', () => {
    const rng = createRng('pick-basic');
    const drawn = pick(rng, items);
    expect(items).toContain(drawn.value);
    expect(drawn.rng).toEqual(advance(rng, 1));
  });

  it('can return every element, including the last', () => {
    // Off-by-one on the upper index would make the final entry of every content table dead.
    const seen = new Set(sample('pick-coverage', 5_000, (rng) => pick(rng, items)));
    expect([...seen].sort()).toEqual([...items].sort());
  });

  it('is uniform across elements', () => {
    const counts = new Map<string, number>(items.map((item) => [item, 0]));
    for (const value of sample('pick-dist', 40_000, (rng) => pick(rng, items))) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    // Iterating in the declared array order, not the Map's, out of habit — the assertion does not
    // depend on order, but neither should any loop in this repo.
    const ordered = items.map((item) => counts.get(item) ?? 0);
    // df = 3, alpha = 0.001 => 16.266
    expect(chiSquare(ordered, 10_000), ordered.join(',')).toBeLessThan(16.266);
  });

  it('works on a single-element array', () => {
    const rng = createRng('pick-single');
    const drawn = pick(rng, ['only']);
    expect(drawn.value).toBe('only');
    expect(drawn.rng).toEqual(advance(rng, 1));
  });

  it('throws on an empty array rather than returning undefined', () => {
    // Returning undefined would let a mis-specified content table leak a hole into the simulation
    // and blow up somewhere unrelated.
    expect(() => pick(createRng('pick-empty'), [])).toThrow(/non-empty/);
  });

  it('does not mutate its inputs', () => {
    const rng = createRng('pick-purity');
    const before = { ...rng };
    const copy = [...items];
    pick(rng, copy);
    expect(rng).toEqual(before);
    expect(copy).toEqual([...items]);
  });
});

// --- shuffle -----------------------------------------------------------------------------------

describe('shuffle', () => {
  it('consumes exactly length - 1 draws', () => {
    // THE test the issue is really about. If `int` ever becomes variable-draw — rejection
    // sampling being the obvious way that happens — this fails immediately, at the source, instead
    // of surfacing weeks later as an unexplained replay divergence in some unrelated system.
    for (const length of [0, 1, 2, 3, 5, 10, 50, 100]) {
      const rng = createRng(`shuffle-count-${length}`);
      const items = Array.from({ length }, (_, i) => i);
      const expectedDraws = Math.max(0, length - 1);
      expect(shuffle(rng, items).rng, `length ${length}`).toEqual(advance(rng, expectedDraws));
    }
  });

  it('leaves the generator untouched for arrays of 0 or 1 elements', () => {
    const rng = createRng('shuffle-trivial');
    expect(shuffle(rng, []).rng).toEqual(rng);
    expect(shuffle(rng, ['x']).rng).toEqual(rng);
    expect(shuffle(rng, []).value).toEqual([]);
    expect(shuffle(rng, ['x']).value).toEqual(['x']);
  });

  it('is a genuine permutation: same multiset, every time', () => {
    // Catches a swap that overwrites instead of exchanging — the classic Fisher-Yates typo, which
    // duplicates one element and drops another while still looking shuffled.
    const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'a', 'b'];
    const expected = [...items].sort();
    let rng = createRng('shuffle-permutation');
    for (let i = 0; i < 2_000; i += 1) {
      const drawn = shuffle(rng, items);
      expect([...drawn.value].sort()).toEqual(expected);
      expect(drawn.value).toHaveLength(items.length);
      rng = drawn.rng;
    }
  });

  it('preserves the multiset for arrays of every length up to 40', () => {
    let rng = createRng('shuffle-lengths');
    for (let length = 0; length <= 40; length += 1) {
      const items = Array.from({ length }, (_, i) => i);
      const drawn = shuffle(rng, items);
      expect([...drawn.value].sort((a, b) => a - b), `length ${length}`).toEqual(items);
      rng = drawn.rng;
    }
  });

  it('does not mutate the input array', () => {
    // The input is often a content table. Mutating it would corrupt shared data and produce a bug
    // that depends on how many times the game has been played this session.
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const before = [...items];
    shuffle(createRng('shuffle-purity'), items);
    expect(items).toEqual(before);
  });

  it('returns a fresh array, not the input', () => {
    const items = [1, 2, 3];
    expect(shuffle(createRng('shuffle-identity'), items).value).not.toBe(items);
  });

  it('actually reorders things', () => {
    // A no-op shuffle satisfies "is a permutation" perfectly.
    let rng = createRng('shuffle-nontrivial');
    const items = [0, 1, 2, 3, 4, 5, 6, 7];
    let identical = 0;
    for (let i = 0; i < 200; i += 1) {
      const drawn = shuffle(rng, items);
      if (drawn.value.every((v, index) => v === items[index])) identical += 1;
      rng = drawn.rng;
    }
    // 1/8! of shuffles are the identity, so expect ~0 out of 200.
    expect(identical).toBeLessThan(3);
  });

  it('produces all 24 permutations of 4 elements at roughly equal rates', () => {
    // Catches the other classic Fisher-Yates bug: drawing `int(0, n - 1)` instead of `int(0, i)`,
    // which produces a permutation every time but with a distinctly non-uniform distribution.
    const counts = new Map<string, number>();
    for (const value of sample('shuffle-uniform', 48_000, (rng) => shuffle(rng, [0, 1, 2, 3]))) {
      const key = value.join('');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(24);
    // Sorted so the loop order does not depend on Map insertion order, per the project's rules.
    const ordered = [...counts.keys()].sort().map((key) => counts.get(key) ?? 0);
    // df = 23, alpha = 0.001 => 49.728
    expect(chiSquare(ordered, 2_000), ordered.join(',')).toBeLessThan(49.728);
  });
});

// --- weighted ----------------------------------------------------------------------------------

describe('weighted', () => {
  const table: WeightedEntry<string>[] = [
    { value: 'common', weight: 6 },
    { value: 'uncommon', weight: 3 },
    { value: 'rare', weight: 1 },
  ];

  it('consumes exactly one draw regardless of table size', () => {
    const rng = createRng('weighted-count');
    expect(weighted(rng, table).rng).toEqual(advance(rng, 1));
    expect(weighted(rng, [{ value: 'x', weight: 1 }]).rng).toEqual(advance(rng, 1));
    const big = Array.from({ length: 100 }, (_, i) => ({ value: i, weight: i + 1 }));
    expect(weighted(rng, big).rng).toEqual(advance(rng, 1));
  });

  it('selects in proportion to the weights', () => {
    const counts = new Map<string, number>(table.map((entry) => [entry.value, 0]));
    const samples = 100_000;
    for (const value of sample('weighted-dist', samples, (rng) => weighted(rng, table))) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    const total = table.reduce((acc, entry) => acc + entry.weight, 0);
    const ordered = table.map((entry) => counts.get(entry.value) ?? 0);
    const expectedEach = table.map((entry) => (entry.weight / total) * samples);

    for (let i = 0; i < table.length; i += 1) {
      // Within 3% relative of the expected count; the true sampling error here is well under 1%.
      expect(
        Math.abs(ordered[i] - expectedEach[i]) / expectedEach[i],
        `${table[i].value}: got ${ordered[i]}, expected ~${expectedEach[i]}`,
      ).toBeLessThan(0.03);
    }
  });

  it('never selects a zero-weight entry', () => {
    // The bug: an off-by-one in the cumulative comparison (`<=` instead of `<`) lets a
    // zero-weight entry win exactly when the roll lands on the preceding boundary. That is roughly
    // one draw in `total`, so it would show up as a "never spawns" enemy spawning once a month.
    const withZeroes: WeightedEntry<string>[] = [
      { value: 'never-a', weight: 0 },
      { value: 'always', weight: 5 },
      { value: 'never-b', weight: 0 },
    ];
    const seen = new Set(sample('weighted-zero', 50_000, (rng) => weighted(rng, withZeroes)));
    expect([...seen]).toEqual(['always']);
  });

  it('selects a zero-weight entry never, even when it is first and the roll is minimal', () => {
    // Targeted at the boundary the statistical test above can only reach by luck: force the
    // smallest possible roll and confirm the leading zero-weight entry still loses.
    const minimalRoll = { s0: 0, s1: 0, s2: 0, s3: 1 } as const;
    expect(int(minimalRoll, 0, 999).value).toBe(0); // precondition: this really is roll 0
    expect(
      weighted(minimalRoll, [
        { value: 'zero', weight: 0 },
        { value: 'one', weight: 1000 },
      ]).value,
    ).toBe('one');
  });

  it('returns the only entry when the table has one', () => {
    const rng = createRng('weighted-single');
    expect(weighted(rng, [{ value: 'sole', weight: 1 }]).value).toBe('sole');
  });

  it('is uniform when all weights are equal', () => {
    const equal = ['a', 'b', 'c', 'd'].map((value) => ({ value, weight: 1 }));
    const counts = new Map<string, number>(equal.map((entry) => [entry.value, 0]));
    for (const value of sample('weighted-uniform', 40_000, (rng) => weighted(rng, equal))) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    const ordered = equal.map((entry) => counts.get(entry.value) ?? 0);
    // df = 3, alpha = 0.001 => 16.266
    expect(chiSquare(ordered, 10_000), ordered.join(',')).toBeLessThan(16.266);
  });

  it('rejects malformed tables loudly', () => {
    // A content bug should fail in the table test that loads it, not quietly roll a default.
    const rng = createRng('weighted-errors');
    expect(() => weighted(rng, [])).toThrow(/non-empty/);
    expect(() => weighted(rng, [{ value: 'x', weight: 0 }])).toThrow(/positive weight/);
    expect(() =>
      weighted(rng, [
        { value: 'x', weight: 0 },
        { value: 'y', weight: 0 },
      ]),
    ).toThrow(/positive weight/);
    expect(() => weighted(rng, [{ value: 'x', weight: -1 }])).toThrow(/non-negative/);
    expect(() => weighted(rng, [{ value: 'x', weight: 1.5 }])).toThrow(/safe integer/);
    expect(() => weighted(rng, [{ value: 'x', weight: Number.NaN }])).toThrow(/safe integer/);
    expect(() => weighted(rng, [{ value: 'x', weight: 4294967297 }])).toThrow(/total weight/);
  });

  it('does not mutate its inputs', () => {
    const rng = createRng('weighted-purity');
    const before = { ...rng };
    const copy = table.map((entry) => ({ ...entry }));
    weighted(rng, copy);
    expect(rng).toEqual(before);
    expect(copy).toEqual(table);
  });
});

// --- The whole thing together --------------------------------------------------------------------

describe('replay', () => {
  /**
   * A scripted mixture of every helper, which is the closest thing this module has to a turn of
   * the simulation. Running it twice from the same seed must produce identical values AND an
   * identical final state — the latter being the part that matters, since it is what the next
   * turn continues from.
   */
  function script(seed: string): { log: string[]; rng: Rng } {
    let rng = createRng(seed);
    const log: string[] = [];

    for (let turn = 0; turn < 250; turn += 1) {
      const roll = int(rng, 1, 20);
      rng = roll.rng;
      log.push(`roll:${roll.value}`);

      const chance = float(rng);
      rng = chance.rng;
      log.push(`chance:${chance.value}`);

      const chosen = pick(rng, ['fire', 'ice', 'shadow', 'stone']);
      rng = chosen.rng;
      log.push(`pick:${chosen.value}`);

      const order = shuffle(rng, [0, 1, 2, 3, 4, 5, 6]);
      rng = order.rng;
      log.push(`order:${order.value.join('')}`);

      const loot = weighted(rng, [
        { value: 'torch', weight: 5 },
        { value: 'oil', weight: 3 },
        { value: 'relic', weight: 1 },
      ]);
      rng = loot.rng;
      log.push(`loot:${loot.value}`);

      // A branch whose draw count varies with the drawn value. This is legitimate — game rules
      // branch — and it is precisely why the *helpers* must not also vary: two sources of
      // variability compound into something nobody can reason about.
      if (roll.value === 20) {
        const crit = int(rng, 1, 6);
        rng = crit.rng;
        log.push(`crit:${crit.value}`);
      }
    }

    return { log, rng };
  }

  it('reproduces identical values and final state from the same seed', () => {
    for (const seed of ['emberdepth', 'run-1', '']) {
      const first = script(seed);
      const second = script(seed);
      expect(second.log).toEqual(first.log);
      expect(second.rng).toEqual(first.rng);
    }
  });

  it('diverges between different seeds', () => {
    // Guards against the opposite failure: a "deterministic" implementation that ignores the seed
    // entirely would pass every replay test in the repo.
    expect(script('run-1').log).not.toEqual(script('run-2').log);
    expect(script('run-1').rng).not.toEqual(script('run-2').rng);
  });

  it('advances the generator by a predictable number of draws', () => {
    // Per turn: int(1) + float(1) + pick(1) + shuffle over 7 elements(6) + weighted(1) = 10,
    // plus one more on a natural 20. Asserting the total against raw draws proves no helper is
    // secretly consuming extra entropy.
    const seed = 'draw-budget';
    const { log, rng } = script(seed);
    const crits = log.filter((line) => line.startsWith('crit:')).length;
    expect(rng).toEqual(advance(createRng(seed), 250 * 10 + crits));
  });
});
