/**
 * `GameState` — everything the simulation knows.
 *
 * ## What is deliberately NOT here
 *
 * The game's design is under review (ADR-0007 / #8 proposes reworking the central concept), so
 * this file models **no game rules at all**: no map, no actors, no light, no fuel, no inventory.
 * Anything invented here would be thrown away, and worse, a later session would find it and treat
 * it as a decision that had been made.
 *
 * What is here is the machinery that holds regardless of which design lands:
 *
 *   - a turn counter, because ADR-0004 says the simulation has turns rather than a clock;
 *   - the generator, because a run must be fully described by `(seed, commands)`;
 *   - one placeholder field so that a command can have an observable effect other than "the
 *     generator moved". It is marked as scaffolding and is expected to be deleted.
 *
 * ## Shape rules this type is meant to demonstrate
 *
 * - **Plain, JSON-round-trippable data.** No class instances, no `Map`/`Set`, no `undefined`
 *   values, no `NaN`, no `-0`. A save file is `(seed, commands)` today, but state is compared
 *   field-by-field by the replay tests and serialized by the debug tooling, and every one of those
 *   exclusions is a value that survives neither `JSON.stringify` nor a structural comparison
 *   intact. `game/core/replay.test.ts` asserts the round-trip.
 * - **Discriminated unions, not optional fields.** `lastOutcome` is a two-variant union rather than
 *   `number | null` so that reading it requires handling both cases. Optional fields multiply:
 *   six of them describe 64 states, of which perhaps four are reachable, and nothing tells you
 *   which four.
 * - **`readonly` everywhere.** It does not make the object immutable at runtime — the tests
 *   deep-freeze for that — but it makes an accidental in-place update a type error at the point it
 *   is written rather than a replay divergence a fortnight later.
 */

import { createRng, type Rng } from '../rng';

/**
 * SCAFFOLDING — replaced along with the `Command` union when the real design lands.
 *
 * The outcome of the **most recently resolved command**, whatever it was: `wait` has no outcome
 * and clears this, `roll` records what it rolled.
 *
 * Two things this exists for, both of which the machinery would be untested without:
 *
 *   1. A field whose *value* depends on a drawn number. Without one, a bug that consumed the right
 *      number of draws but used the wrong value would be invisible — the generator would have
 *      advanced identically either way.
 *   2. A field that makes **command order observable**. This is subtler and was found by mutation
 *      testing: when `wait` merely passed the previous outcome through, reordering an entire
 *      command log was *completely* semantics-preserving, because a `roll` consumes the same draw
 *      whatever position it sits in and `turn` counts commands regardless of order. A replay
 *      machinery that cannot notice its command log being shuffled is not testing much.
 *
 * A union rather than `number | null`, so `kind` has to be inspected before `value` can be read,
 * and so the replay differ has a nested tagged union to report paths through.
 */
export type LastOutcome =
  | { readonly kind: 'none' }
  | { readonly kind: 'rolled'; readonly value: number };

/**
 * The "nothing happened" outcome, shared by every state that has one.
 *
 * Structural sharing between immutable states is normal and desirable — it is what keeps `step`
 * cheap once state is large. It is also the shape of the aliasing bug the purity suite hunts for:
 * if anything ever wrote *through* this reference, every state in the run would change at once,
 * retroactively. Sharing it deliberately here means that test has a real target.
 */
export const NO_OUTCOME: LastOutcome = { kind: 'none' };

/** The complete state of a run. Immutable; `step` returns a new one. */
export type GameState = {
  /** Commands resolved so far. Starts at 0 and increases by exactly one per `step`. */
  readonly turn: number;

  /**
   * The generator. Lives in state, per ADR-0004, so that a run is a pure function of its seed and
   * its command log — a generator held outside state is a hidden input, and hidden inputs are
   * exactly what makes replays diverge.
   */
  readonly rng: Rng;

  /** SCAFFOLDING. See `LastOutcome`. */
  readonly lastOutcome: LastOutcome;
};

/**
 * The state a run begins in, derived entirely from the seed.
 *
 * Pure and total: any string is a valid seed, including the empty string. This is the only place
 * a run's starting state is constructed, which is what makes `replay` able to rebuild it from a
 * `RunRecord` containing nothing but a seed.
 */
export function createInitialState(seed: string): GameState {
  return {
    turn: 0,
    rng: createRng(seed),
    lastOutcome: NO_OUTCOME,
  };
}
