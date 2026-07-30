/**
 * Turning a human-typed seed string into generator state.
 *
 * Seeds are strings because they have to be shareable: typed into a text field, pasted into a bug
 * report, printed on a daily-challenge screen. "emberdepth" is a seed a person can relay over the
 * phone; 0x8f2a91c3 is not.
 *
 * The pipeline is deliberately two-stage:
 *
 *   1. `hashString` collapses arbitrary text to one well-mixed 32-bit word.
 *   2. `seedWords` expands that word to the four words xoshiro128** needs, via splitmix32.
 *
 * Stage 2 is not optional. Feeding a raw hash into three of the four state words (or padding with
 * constants) gives xoshiro a low-entropy start, and xoshiro is an xor/shift generator: it takes a
 * while to wash out a sparse initial state, so the first several outputs of nearby seeds would be
 * visibly related. splitmix32 is the seeding routine the xoshiro authors specify for exactly this
 * reason.
 *
 * All arithmetic here is explicit 32-bit integer work — `Math.imul`, `>>>`, `^`. No floats, so the
 * result is bit-identical on V8, JavaScriptCore, and Hermes. See ADR-0004.
 *
 * NOT a cryptographic hash and not collision-resistant in any adversarial sense. It is a seed
 * derivation function; two different seed strings colliding would mean two different typed seeds
 * producing the same run, which is harmless.
 */

/** No normalization. `"Cave"`, `"cave"`, and `" cave"` are three different seeds — trimming or
 * case-folding is a UI concern, and doing it here would silently make distinct typed seeds
 * identical. */

/**
 * MurmurHash3's 32-bit finalizer. Pure avalanche: it adds no new entropy, it just spreads the bits
 * that are already there so that a one-character seed change moves roughly half the output bits.
 */
function fmix32(input: number): number {
  let h = input;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * splitmix32's mixing function. Given consecutive inputs (a counter stepped by the golden-ratio
 * constant) it emits a well-distributed, decorrelated stream — which is precisely what we need to
 * fill four state words from one hash.
 */
function splitmix32(input: number): number {
  let z = input;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  return (z ^ (z >>> 15)) >>> 0;
}

/**
 * FNV-1a over the UTF-16 bytes of the string, finalized with fmix32.
 *
 * Bytes, not code units: canonical FNV-1a is byte-wise, and its avalanche is poor enough on its
 * own that feeding it 16-bit chunks (where the high byte of ASCII text is always zero) wastes half
 * the rounds. The fmix32 finalizer is what actually makes the result look random; FNV-1a's job is
 * only to absorb arbitrary-length input in a defined order.
 *
 * Operates on UTF-16 code units via `charCodeAt`, which is how every JavaScript engine represents
 * strings, so an emoji or an accented character hashes identically everywhere.
 *
 * @returns an unsigned 32-bit integer
 */
export function hashString(text: string): number {
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    h = Math.imul(h ^ (unit & 0xff), 0x01000193); // FNV prime
    h = Math.imul(h ^ (unit >>> 8), 0x01000193);
  }
  return fmix32(h >>> 0);
}

/**
 * Expand a seed string into the four 32-bit words of xoshiro128** state.
 *
 * Note that this can, in principle, return all zeros — that state is a fixed point for xoshiro and
 * would make the generator emit a constant forever. `rngFromWords` rejects it. The probability is
 * 2^-128; the guard exists because "impossible" and "catastrophic and silent" is a bad pairing.
 */
export function seedWords(seed: string): readonly [number, number, number, number] {
  let counter = hashString(seed);
  const words: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    counter = (counter + 0x9e3779b9) >>> 0; // golden-ratio increment, per splitmix32
    words.push(splitmix32(counter));
  }
  return [words[0], words[1], words[2], words[3]];
}
