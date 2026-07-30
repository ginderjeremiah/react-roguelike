import { describe, expect, it } from 'vitest';
import { createRng, int, next, type Rng } from '../rng';
import { COMMAND_KINDS, type Command } from './command';
import { createInitialState, type GameState } from './state';
import { step } from './step';

/**
 * Unit tests for one turn of resolution.
 *
 * The replay suite proves that whatever `step` does, it does the same way twice. That is not the
 * same as doing the right thing — a `step` that ignored its command entirely would satisfy every
 * determinism property in the repo. These tests pin what it actually does, with particular
 * attention to the generator, because "consumed a draw it should not have" is invisible in the
 * visible state and shifts every subsequent value in the run.
 */

const SEED = 'emberdepth';

/** The generator state after `count` raw draws — the yardstick for every draw-count assertion. */
function advance(rng: Rng, count: number): Rng {
  let current = rng;
  for (let i = 0; i < count; i += 1) current = next(current).rng;
  return current;
}

describe('createInitialState', () => {
  it('derives the generator from the seed', () => {
    // Catches: an initial state that ignores the seed. Every replay test in the repo would still
    // pass, because a constant generator is perfectly reproducible — and every run would be
    // identical, which nobody would notice until someone typed a seed and got the same map.
    expect(createInitialState(SEED).rng).toEqual(createRng(SEED));
    expect(createInitialState('other').rng).not.toEqual(createRng(SEED));
  });

  it('starts at turn zero with no outcome recorded', () => {
    expect(createInitialState(SEED)).toEqual({
      turn: 0,
      rng: createRng(SEED),
      lastOutcome: { kind: 'none' },
    });
  });

  it('accepts the empty seed', () => {
    // Catches: a guard that rejects '' as falsy. The seed comes from a text field, and an empty
    // one must be a valid run rather than a crash on first launch.
    expect(() => createInitialState('')).not.toThrow();
  });
});

describe('step — every command kind', () => {
  /**
   * One representative command per kind. `Record<Command['kind'], Command>` requires every kind
   * and permits no others, so adding a `Command` variant without adding it here is a compile
   * error — which is the point. A table test that has to be remembered is a table test that gets
   * forgotten.
   */
  const SAMPLES: Record<Command['kind'], Command> = {
    roll: { kind: 'roll', sides: 6 },
    wait: { kind: 'wait' },
  };

  it('covers exactly the declared command kinds', () => {
    // Catches: COMMAND_KINDS drifting out of sorted order, which would make anything iterating it
    // order-dependent on declaration order.
    expect(COMMAND_KINDS).toEqual([...COMMAND_KINDS].sort());
    expect([...COMMAND_KINDS].sort()).toEqual(Object.keys(SAMPLES).sort());
  });

  for (const kind of COMMAND_KINDS) {
    it(`resolves '${kind}' into a new state, advancing exactly one turn`, () => {
      const before = createInitialState(SEED);
      const after = step(before, SAMPLES[kind]);

      expect(after.turn).toBe(1);
      // Catches: a command handled by returning the input. Every command resolves a turn, so the
      // returned state is always a different object.
      expect(after).not.toBe(before);
      expect(before.turn).toBe(0);
    });
  }
});

describe("step — 'wait'", () => {
  it('advances the turn by exactly one', () => {
    let state = createInitialState(SEED);
    for (let i = 1; i <= 5; i += 1) {
      state = step(state, { kind: 'wait' });
      expect(state.turn).toBe(i);
    }
  });

  it('leaves the generator byte-identical', () => {
    // THE test for this command. A stray draw here produces no visible change and shifts every
    // subsequent value in the run — the failure would surface much later, in whatever system
    // happened to draw next, looking like a bug in that system.
    const before = createInitialState(SEED);
    const after = step(before, { kind: 'wait' });
    expect(after.rng).toEqual(before.rng);
  });

  it('clears the previous outcome', () => {
    // `lastOutcome` is the result of the command just resolved, and waiting has no result.
    //
    // This is what makes command *order* observable: found by mutation testing, because when
    // `wait` passed the previous outcome through instead, shuffling an entire command log changed
    // nothing at all — a `roll` consumes the same draw wherever it sits, and `turn` counts
    // commands regardless of order. See state.ts.
    const rolled = step(createInitialState(SEED), { kind: 'roll', sides: 6 });
    expect(rolled.lastOutcome.kind).toBe('rolled');
    expect(step(rolled, { kind: 'wait' }).lastOutcome).toEqual({ kind: 'none' });
  });

  it('makes a reordered command log produce a different state', () => {
    // The property the clearing above buys. Guards it directly, so that anyone who "simplifies"
    // `wait` back to passing the outcome through sees why it was written that way.
    const rollThenWait = [{ kind: 'roll' as const, sides: 6 }, { kind: 'wait' as const }];
    const waitThenRoll = [{ kind: 'wait' as const }, { kind: 'roll' as const, sides: 6 }];
    const left = rollThenWait.reduce(step, createInitialState(SEED));
    const right = waitThenRoll.reduce(step, createInitialState(SEED));
    expect(left.lastOutcome).not.toEqual(right.lastOutcome);
  });
});

describe("step — 'roll'", () => {
  it('consumes exactly one draw', () => {
    // Catches: drawing twice, or drawing and discarding the resulting generator state (which
    // would replay the same value forever).
    const before = createInitialState(SEED);
    const after = step(before, { kind: 'roll', sides: 6 });
    expect(after.rng).toEqual(advance(before.rng, 1));
  });

  it('records exactly the value int() would produce from the pre-step generator', () => {
    // Pins the mapping from generator to result, not just its range. Catches `float()` instead of
    // `int()`, `int(rng, 0, sides)`, or a different helper with the same draw count — all of which
    // preserve every property asserted elsewhere in this file while changing what a seed produces.
    for (const sides of [1, 2, 6, 20, 1000]) {
      const before = createInitialState(`roll-${sides}`);
      const expected = int(before.rng, 1, sides);
      const after = step(before, { kind: 'roll', sides });
      expect(after.lastOutcome).toEqual({ kind: 'rolled', value: expected.value });
      expect(after.rng).toEqual(expected.rng);
    }
  });

  it('stays within 1..sides and reaches both endpoints', () => {
    // Catches an off-by-one at either end: a d6 that never rolls 6, or one that can roll 0.
    let state: GameState = createInitialState('roll-range');
    const seen = new Set<number>();
    for (let i = 0; i < 2_000; i += 1) {
      state = step(state, { kind: 'roll', sides: 6 });
      if (state.lastOutcome.kind !== 'rolled') throw new Error('roll did not record a value');
      expect(state.lastOutcome.value).toBeGreaterThanOrEqual(1);
      expect(state.lastOutcome.value).toBeLessThanOrEqual(6);
      seen.add(state.lastOutcome.value);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('consumes one draw even for a one-sided die', () => {
    // The draw-count contract at the step level: consumption depends on the command's shape, never
    // on whether the outcome was a foregone conclusion.
    const before = createInitialState(SEED);
    const after = step(before, { kind: 'roll', sides: 1 });
    expect(after.lastOutcome).toEqual({ kind: 'rolled', value: 1 });
    expect(after.rng).toEqual(advance(before.rng, 1));
  });
});

describe('step — malformed commands', () => {
  const before = createInitialState(SEED);

  it.each([
    ['zero sides', { kind: 'roll', sides: 0 }],
    ['negative sides', { kind: 'roll', sides: -3 }],
    ['fractional sides', { kind: 'roll', sides: 2.5 }],
    ['NaN sides', { kind: 'roll', sides: Number.NaN }],
    ['unsafe integer sides', { kind: 'roll', sides: 2 ** 60 }],
  ])('rejects %s', (_label, command) => {
    expect(() => step(before, command as Command)).toThrow(/roll requires/);
  });

  it('rejects a malformed payload itself, rather than letting the RNG do it', () => {
    // A note on a test that is NOT here, because it looked valuable and is not: "a rejected
    // command consumes no entropy". With a threaded generator that cannot fail — the caller's
    // `Rng` is an immutable value they still hold, so a half-consumed draw is discarded with the
    // exception no matter where the throw happens. The assertion would be tautological.
    //
    // What is real is *which* error you get. Delete the validation in `step` and every rejection
    // above still throws, but from inside `int()`, with a message about spans and safe integers
    // and no mention of the command. Debugging a corrupt save file then starts in the RNG.
    for (const sides of [0, -3, 2.5, Number.NaN]) {
      const attempt = () => step(before, { kind: 'roll', sides } as Command);
      expect(attempt).toThrow(/^step: roll requires/);
      expect(attempt).not.toThrow(/^rng:/);
    }
  });

  it('throws on an unknown command kind rather than silently doing nothing', () => {
    // A record parsed from a save file is `unknown` whatever its declared type says. A default
    // case that returned the state unchanged would make a corrupt record replay as a plausible run
    // that never happened.
    const bogus = { kind: 'teleport' } as unknown as Command;
    expect(() => step(before, bogus)).toThrow(/unhandled variant/);
    expect(() => step(before, bogus)).toThrow(/teleport/);
  });
});
