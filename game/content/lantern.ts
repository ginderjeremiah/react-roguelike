/**
 * The light economy's numbers. GDD §4.
 *
 * ## Every number here is (tuning). The three invariants are not
 *
 * §4 states three things about the economy and calls them design:
 *
 *   1. Avoiding all combat must be **unsustainable** — a pacifist run runs dry.
 *   2. Keeping the shutter open must be **unsustainable** — a floodlit run runs dry faster.
 *   3. A floor played well nets **slightly positive** fuel.
 *
 * Those are properties of the *system*, and `game/systems/economy.test.ts` asserts all three over a
 * corpus of scripted runs. The five numbers below are the free variables that make them true. If an
 * invariant fails, the number moves and the GDD change log gets a row — never the other way round.
 *
 * ## Where the rest of the economy's numbers live
 *
 * Deliberately not all here. The Cinder's `emberDrop` is a field of its row in `creatures.ts`,
 * because "fuel comes from kills" is priced per species and a second creature will price differently
 * (§4). The vision *radii* are in `game/fov/vision.ts`, because they are geometry rather than
 * economy — they say how far you see, not what it costs. What belongs in this file is exactly the
 * fuel: what a turn costs, what the world gives back, and what you start with.
 */

/**
 * §4 (tuning): fuel burned per turn with the shutter open.
 *
 * §4's prose is written in terms of this number and the ratio it forms with `FUEL_BURN_SHUTTERED` —
 * "the information exists and is purchasable for 4 fuel", "light is roughly three times cheaper in
 * fuel and ten times cheaper in turns for exploring; dark is four times cheaper for travelling".
 * Changing either number without the other rewrites those sentences, so retune the pair and the
 * prose together.
 */
export const FUEL_BURN_LIT = 4;

/** §4 (tuning): fuel burned per turn while shuttered. The floor under every turn of the game. */
export const FUEL_BURN_SHUTTERED = 1;

/**
 * §4 (tuning): the fuel a run starts with.
 *
 * Read it as a number of *turns*: at `FUEL_BURN_SHUTTERED` it is how long the player can crawl
 * having earned nothing at all, which is the length of the rope invariant 1 gives a pacifist.
 */
export const STARTING_FUEL = 80;

/**
 * §4 (tuning): fuel in one ember cache. §5 places 1-2 per floor, biased toward leaf rooms.
 *
 * **25, not the 40 §4 first wrote down.** Moved with the Cinder's ember drop (30 -> 20) and for the
 * same measured reason — see `creatures.ts` and GDD's change log for 2026-08-02. The pair moved
 * together on purpose: a cache is worth 1.25 kills at these numbers and was worth 1.33 at the
 * originals, so §1's "fuel comes from kills" survives. Shrinking only the kill would have made
 * exploration the income side of the economy and combat the garnish, which is the opposite of the
 * design.
 *
 * Not a field of the `cache` tile. `map/grid.ts` anticipates one ("`cache` will carry an ember
 * amount") and the day two cache sizes exist that is the change to make; one uniform value does not
 * need a payload on 165 tiles to express, and a payload would let the generator and this table
 * disagree about what a cache is worth.
 */
export const CACHE_FUEL = 25;
