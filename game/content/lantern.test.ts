import { describe, expect, it } from 'vitest';
import { CACHE_FUEL, CINDER, FUEL_BURN_LIT, FUEL_BURN_SHUTTERED, STARTING_FUEL } from './index';

/**
 * The light economy's table, checked two ways — the same split `creatures.test.ts` uses.
 *
 *   - **Shape and relation.** These survive a retune, which is explicitly allowed (§4: everything
 *     here is *(tuning)*). They are the statements that stay true whatever the numbers are, and each
 *     one names a rule that would be silently deleted by a bad edit — a zero burn rate makes light
 *     free, a lit rate at or below the dark rate deletes the wager entirely.
 *   - **The GDD's numbers, literally.** These *do* fail on a retune, on purpose: they are the paired
 *     edit that stops the code and the design document drifting apart. A failure here means updating
 *     §4 and its change log in the same commit, not deleting the assertion.
 *
 * What is deliberately *not* here is whether the numbers make a good economy. No table test can see
 * that — it needs a run. `game/systems/economy.test.ts` is where §4's three invariants live, and it
 * is what moved two of these numbers.
 */

const TUNABLES = [
  ['FUEL_BURN_LIT', FUEL_BURN_LIT],
  ['FUEL_BURN_SHUTTERED', FUEL_BURN_SHUTTERED],
  ['STARTING_FUEL', STARTING_FUEL],
  ['CACHE_FUEL', CACHE_FUEL],
] as const;

describe('the lantern table', () => {
  it.each(TUNABLES)('%s is a positive whole number of ember', (_name, value) => {
    expect(Number.isSafeInteger(value)).toBe(true);
    // Zero is the interesting failure, not negative: a zero burn rate makes light free and deletes
    // the whole of §4, and a zero cache makes §5's off-route wager pay nothing.
    expect(value).toBeGreaterThan(0);
  });

  it('makes light cost strictly more per turn than darkness', () => {
    // The single relation the entire mechanic rests on (§1). If these were equal, or inverted,
    // there would be no reason to ever shutter and no decision left to make — and every property in
    // `economy.test.ts` about a floodlit run would still pass, because it would be comparing a
    // style against itself.
    expect(FUEL_BURN_LIT).toBeGreaterThan(FUEL_BURN_SHUTTERED);
  });

  it('starts the run with enough fuel to reach the first cache', () => {
    // Not a GDD sentence — a floor on any future retune. §5 puts 1-2 caches on a floor and §5's
    // pacing gives a floor 40-70 turns; a starting reserve that cannot outlast a floor of shuttered
    // crawling would make floor 1 a coin flip on where the generator put the cache.
    expect(STARTING_FUEL).toBeGreaterThanOrEqual(40 * FUEL_BURN_SHUTTERED);
  });

  it('keeps kills the larger half of the income, per §1', () => {
    // §1: "Fuel comes from kills ... it is a currency you must go and earn, in the dark, from things
    // that will fight back", and §4 places 1-2 caches against `min(2 + floor, 6)` creatures. A cache
    // worth several kills would quietly make exploration the income side of the economy and combat
    // the garnish. Stated as a bound on one cache against two kills, which is the weakest form that
    // still forbids that inversion.
    expect(CACHE_FUEL).toBeLessThan(CINDER.emberDrop * 2);
    expect(CACHE_FUEL).toBeGreaterThan(CINDER.emberDrop);
  });

  it('matches GDD §4', () => {
    // Pinned literally. `CACHE_FUEL` moved from 40 to 25 with the Cinder's drop (30 -> 20) when
    // §4's third invariant failed measurement — see the change log entry for 2026-08-02.
    expect(FUEL_BURN_LIT).toBe(4);
    expect(FUEL_BURN_SHUTTERED).toBe(1);
    expect(STARTING_FUEL).toBe(80);
    expect(CACHE_FUEL).toBe(25);
  });

  it('keeps §4 prose true: light is roughly four times a shuttered turn', () => {
    // §4 is written in terms of this *ratio*, not the two numbers: "dark is four times cheaper for
    // travelling through space you have already seen", "light is roughly three times cheaper in
    // fuel ... for exploring". Retuning one of the pair without the other rewrites those sentences,
    // so the ratio gets its own assertion rather than being implied by the two literals above.
    expect(FUEL_BURN_LIT / FUEL_BURN_SHUTTERED).toBe(4);
  });
});
