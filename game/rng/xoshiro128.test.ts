import { describe, expect, it } from 'vitest';
import { createRng, next, rngFromWords, type Rng } from './xoshiro128';
import { hashString, seedWords } from './seed';

/**
 * Tests for the core generator: the step function, seeding, and the properties the rest of the
 * project's determinism guarantee rests on.
 *
 * The centrepiece is `referenceNext` below — a second, independent implementation of xoshiro128**
 * written in BigInt. The production code uses `Math.imul` and `>>>`; the reference uses arbitrary
 * -precision integers with explicit masking. They share no arithmetic. If a rotate is off by a
 * bit, an operation is applied in the wrong order, or a `>>> 0` is missing, the two disagree.
 *
 * This is deliberately not "assert the first N outputs match some constants I pasted from
 * somewhere." Pasted vectors prove the implementation matches whatever produced them, which,
 * absent a reference to check against, is often itself.
 */

// --- An independent reference implementation ---------------------------------------------------

const MASK = 0xffffffffn;

function referenceRotl(x: bigint, k: bigint): bigint {
  return ((x << k) | (x >> (32n - k))) & MASK;
}

/** Direct transcription of the reference C for xoshiro128**, in BigInt. */
function referenceNext(state: readonly bigint[]): { value: bigint; state: bigint[] } {
  const s = [...state];
  const value = (referenceRotl((s[1] * 5n) & MASK, 7n) * 9n) & MASK;

  const t = (s[1] << 9n) & MASK;
  s[2] = (s[2] ^ s[0]) & MASK;
  s[3] = (s[3] ^ s[1]) & MASK;
  s[1] = (s[1] ^ s[2]) & MASK;
  s[0] = (s[0] ^ s[3]) & MASK;
  s[2] = (s[2] ^ t) & MASK;
  s[3] = referenceRotl(s[3], 11n);

  return { value, state: s };
}

// --- Helpers -----------------------------------------------------------------------------------

function words(rng: Rng): [number, number, number, number] {
  return [rng.s0, rng.s1, rng.s2, rng.s3];
}

function take(rng: Rng, count: number): number[] {
  const out: number[] = [];
  let current = rng;
  for (let i = 0; i < count; i += 1) {
    const drawn = next(current);
    out.push(drawn.value);
    current = drawn.rng;
  }
  return out;
}

const UINT32_MAX = 4294967295;

function isUint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= UINT32_MAX;
}

// --- The step function -------------------------------------------------------------------------

describe('xoshiro128** step', () => {
  it('matches an independent BigInt reference for 10,000 consecutive draws', () => {
    // The load-bearing test in this file. Catches: a wrong rotation constant, the ** scrambler
    // applied to the new state instead of the old, the four linear-step assignments reordered,
    // Math.imul misused, a missing unsigned normalization.
    for (const seed of ['emberdepth', '', 'a', '99999', 'seed with spaces']) {
      const start = createRng(seed);
      let mine = start;
      let reference: bigint[] = words(start).map((w) => BigInt(w));

      for (let i = 0; i < 10_000; i += 1) {
        const mineDrawn = next(mine);
        const referenceDrawn = referenceNext(reference);

        expect(BigInt(mineDrawn.value)).toBe(referenceDrawn.value);
        expect(words(mineDrawn.rng).map((w) => BigInt(w))).toEqual(referenceDrawn.state);

        mine = mineDrawn.rng;
        reference = referenceDrawn.state;
      }
    }
  });

  it('always returns an unsigned 32-bit integer', () => {
    // Catches a missing `>>> 0`, which would leak negative int32 values into every helper and turn
    // `int(rng, 1, 6)` into a source of negative numbers.
    let rng = createRng('range-check');
    for (let i = 0; i < 50_000; i += 1) {
      const drawn = next(rng);
      expect(isUint32(drawn.value)).toBe(true);
      rng = drawn.rng;
    }
  });

  it('keeps every state word an unsigned 32-bit integer', () => {
    // State is persisted as part of GameState. A negative word would still function bitwise but
    // would break structural equality against a JSON round-trip, which is how replay fixtures are
    // compared.
    let rng = createRng('state-check');
    for (let i = 0; i < 20_000; i += 1) {
      rng = next(rng).rng;
      for (const word of words(rng)) expect(isUint32(word)).toBe(true);
    }
  });

  it('does not mutate the state it is given', () => {
    const rng = createRng('purity');
    const before = words(rng);
    next(rng);
    next(rng);
    expect(words(rng)).toEqual(before);
  });

  it('is a pure function of its input state', () => {
    // Calling next() on the same state twice must give the same answer — no hidden accumulator.
    const rng = createRng('purity');
    expect(next(rng)).toEqual(next(rng));
  });

  it('never revisits its starting state within 100,000 draws', () => {
    // A crude but effective degeneracy check. A step function broken into a short cycle (say, by a
    // rotation that is effectively a no-op) would return home almost immediately while still
    // producing plausible-looking output.
    const start = createRng('cycle');
    let rng = start;
    for (let i = 0; i < 100_000; i += 1) {
      rng = next(rng).rng;
      if (rng.s0 === start.s0 && rng.s1 === start.s1 && rng.s2 === start.s2 && rng.s3 === start.s3) {
        throw new Error(`generator returned to its initial state after ${i + 1} draws`);
      }
    }
  });

  it('sets every output bit close to half the time', () => {
    // Catches a stuck or heavily biased bit position — the kind of flaw that leaves `int(0, 1)`
    // returning the same value forever while a coarse distribution test still looks fine.
    const samples = 100_000;
    const counts = new Array<number>(32).fill(0);
    let rng = createRng('bits');

    for (let i = 0; i < samples; i += 1) {
      const drawn = next(rng);
      for (let bit = 0; bit < 32; bit += 1) {
        if ((drawn.value >>> bit) & 1) counts[bit] += 1;
      }
      rng = drawn.rng;
    }

    for (let bit = 0; bit < 32; bit += 1) {
      const ratio = counts[bit] / samples;
      // +/- 1% is ~6.3 standard deviations at this sample size, so a healthy generator passes
      // deterministically and a broken one has no way through.
      expect(ratio, `bit ${bit} set ${ratio * 100}% of the time`).toBeGreaterThan(0.49);
      expect(ratio, `bit ${bit} set ${ratio * 100}% of the time`).toBeLessThan(0.51);
    }
  });
});

// --- Seeding -----------------------------------------------------------------------------------

describe('seeding from a string', () => {
  it('produces an identical sequence for the same seed, every time', () => {
    // The single most important property in the project. If this fails, nothing else is testable.
    for (const seed of ['emberdepth', '', 'x', '日本語', 'a'.repeat(500)]) {
      expect(take(createRng(seed), 200)).toEqual(take(createRng(seed), 200));
    }
  });

  it('diverges immediately for seeds differing in one character', () => {
    // A weak seed derivation (raw hash splatted into the state words, or no avalanche step) leaves
    // near-identical seeds producing near-identical early output. Early output is exactly what a
    // level generator consumes, so "seed-1" and "seed-2" would generate the same first room.
    const pairs: [string, string][] = [
      ['a', 'b'],
      ['seed-1', 'seed-2'],
      ['emberdepth', 'emberdepth '],
      ['', '\u0000'],
      ['run-0000000', 'run-0000001'],
      ['AAAA', 'AAAB'],
    ];

    for (const [left, right] of pairs) {
      const a = take(createRng(left), 8);
      const b = take(createRng(right), 8);
      expect(a[0], `"${left}" vs "${right}" agreed on the first draw`).not.toBe(b[0]);
      expect(a, `"${left}" vs "${right}"`).not.toEqual(b);
    }
  });

  it('gives 1,000 sequential seeds 1,000 distinct starting states and first draws', () => {
    const states = new Set<string>();
    const firsts = new Set<number>();
    for (let i = 0; i < 1000; i += 1) {
      const rng = createRng(`run-${i}`);
      states.add(words(rng).join(','));
      firsts.add(next(rng).value);
    }
    expect(states.size).toBe(1000);
    expect(firsts.size).toBe(1000);
  });

  it('treats seeds as exact strings, with no normalization', () => {
    // Documented behaviour: trimming or case-folding is the UI's job. Asserting it here so a
    // future "helpful" normalization step has to break a test rather than silently merge seeds.
    expect(take(createRng('Cave'), 4)).not.toEqual(take(createRng('cave'), 4));
    expect(take(createRng('cave'), 4)).not.toEqual(take(createRng(' cave'), 4));
  });

  it('handles an empty seed without degenerating', () => {
    const drawn = take(createRng(''), 100);
    expect(new Set(drawn).size).toBeGreaterThan(90);
  });

  it('handles astral-plane characters deterministically', () => {
    // Surrogate pairs are two UTF-16 code units. `charCodeAt` sees them identically on every
    // engine, so this must be stable — but it is the kind of input that breaks a hash that
    // assumes single-byte characters.
    expect(take(createRng('\u{1F525}depth'), 4)).toEqual(take(createRng('\u{1F525}depth'), 4));
    expect(take(createRng('\u{1F525}'), 4)).not.toEqual(take(createRng('\u{1F526}'), 4));
  });
});

describe('hashString', () => {
  it('returns an unsigned 32-bit integer', () => {
    for (const text of ['', 'a', 'emberdepth', '\u{1F525}', 'z'.repeat(1000)]) {
      expect(isUint32(hashString(text))).toBe(true);
    }
  });

  it('avalanches: every bit position flips about half the time', () => {
    // Measured per bit position, not as an average over all 32. The average is the wrong statistic
    // and this test originally used it: FNV-1a without the fmix32 finalizer averages a
    // respectable ~16 flipped bits while individual positions flip anywhere from 8% to 95% of the
    // time, because FNV's multiply only propagates entropy leftward and the low bits stay tied to
    // the input's low bits. Averaging hides exactly the structure we care about.
    //
    // Empirically: with fmix32 the per-position rates span 0.484-0.513; without it, 0.081-0.953.
    const trials = 2048;
    const flips = new Array<number>(32).fill(0);

    for (let i = 0; i < trials; i += 1) {
      const a = hashString(`seed-${i}`);
      const b = hashString(`seed-${i + 1}`);
      for (let bit = 0; bit < 32; bit += 1) {
        if (((a >>> bit) & 1) !== ((b >>> bit) & 1)) flips[bit] += 1;
      }
    }

    for (let bit = 0; bit < 32; bit += 1) {
      const rate = flips[bit] / trials;
      expect(rate, `bit ${bit} flipped ${(rate * 100).toFixed(1)}% of the time`).toBeGreaterThan(0.4);
      expect(rate, `bit ${bit} flipped ${(rate * 100).toFixed(1)}% of the time`).toBeLessThan(0.6);
    }
  });

  it('does not collide at all across 20,000 sequential seeds', () => {
    // The birthday expectation for a 32-bit hash over 20k inputs is 20000*19999/(2*2^32) ~= 0.047
    // collisions, NOT ~46 — an earlier version of this test had that arithmetic wrong by a factor
    // of ~1000 and tolerated 99 collisions, which a 22-bit hash would have passed.
    //
    // FNV-1a is effectively injective on a short structured family like this (verified: zero
    // collisions even at 1e6 inputs), so the honest assertion is exact. This tests structure, not
    // randomness — the avalanche test above is what covers diffusion.
    const seen = new Set<number>();
    for (let i = 0; i < 20_000; i += 1) seen.add(hashString(`seed-${i}`));
    expect(seen.size).toBe(20_000);
  });
});

describe('seedWords', () => {
  it('returns four distinct unsigned 32-bit words', () => {
    for (const seed of ['', 'a', 'emberdepth']) {
      const w = seedWords(seed);
      expect(w).toHaveLength(4);
      for (const word of w) expect(isUint32(word)).toBe(true);
      // Catches filling the state by repeating one hash, which halves the effective entropy and
      // gives xoshiro a structured start.
      expect(new Set(w).size).toBe(4);
    }
  });
});

// --- Constructing state directly ----------------------------------------------------------------

describe('rngFromWords', () => {
  it('refuses the all-zero state', () => {
    // Zero is a fixed point of xoshiro's linear step: without this guard the generator would
    // return 0 forever, silently, and every "random" decision in the run would be identical.
    const rng = rngFromWords(0, 0, 0, 0);
    const drawn = take(rng, 50);
    expect(drawn.every((v) => v === 0)).toBe(false);
    expect(new Set(drawn).size).toBeGreaterThan(45);
  });

  it('accepts a state where only one word is nonzero', () => {
    const drawn = take(rngFromWords(0, 0, 0, 1), 200);
    expect(new Set(drawn).size).toBeGreaterThan(150);
  });

  it('normalizes words to unsigned 32-bit', () => {
    // Asserted against absolute values, not against another call to rngFromWords. Comparing two
    // calls of the same function passes happily if the function consistently stores signed int32s
    // — which would leave a rehydrated state structurally unequal to the one that was saved.
    expect(rngFromWords(-1, -2, -3, -4)).toEqual({
      s0: 4294967295,
      s1: 4294967294,
      s2: 4294967293,
      s3: 4294967292,
    });
    expect(rngFromWords(0x1_0000_0001, 2, 3, 4)).toEqual({ s0: 1, s1: 2, s2: 3, s3: 4 });
    for (const word of Object.values(rngFromWords(-1, -2, -3, -4))) {
      expect(isUint32(word)).toBe(true);
    }
  });

  it('round-trips through JSON unchanged', () => {
    // GameState is persisted; the RNG has to survive that intact or a resumed run diverges.
    const rng = createRng('persistence');
    const advanced = next(next(rng).rng).rng;
    const revived = JSON.parse(JSON.stringify(advanced)) as Rng;
    expect(revived).toEqual(advanced);
    expect(take(revived, 20)).toEqual(take(advanced, 20));
  });
});

// --- Pinned output ------------------------------------------------------------------------------

describe('pinned stream', () => {
  it('produces the recorded sequence for a known seed', () => {
    // A tripwire, not a correctness proof — correctness is the BigInt cross-check above. This
    // exists so that ANY change to the generator or to seed derivation fails loudly, because such
    // a change invalidates every stored replay fixture in the repo and must be a deliberate
    // RunRecord.version bump rather than an accident. If you are here because this test failed,
    // that is the question to answer.
    //
    // The constants were produced by the independent BigInt reference, not copied out of a failing
    // run of the implementation, so they pin the algorithm rather than pinning today's code.
    expect(take(createRng('emberdepth'), 8)).toEqual([
      3452555409, 2494450879, 3678066014, 4289616363, 3651940320, 303045988, 2136443308, 2348423106,
    ]);
    expect(createRng('emberdepth')).toEqual({
      s0: 69028929,
      s1: 3928704908,
      s2: 1922297424,
      s3: 2122795854,
    });
  });
});
