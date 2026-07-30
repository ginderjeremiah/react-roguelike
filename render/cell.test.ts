import { describe, expect, it } from 'vitest';
import { LIT_RADIUS } from '@/game/fov';
import {
  ATTACK_TELEGRAPH,
  CELL_OPACITY,
  CELL_STATES,
  LAMP_TINT_EDGE,
  MOVE_TELEGRAPH,
  NO_TINT,
  lampTint,
  sameCell,
  type Cell,
} from './cell';

/** A cell with every field set to something distinguishable, for the field-by-field sweep below. */
const REFERENCE: Cell = {
  x: 3,
  y: 4,
  state: 'visible',
  glyph: '#',
  fg: 'wall',
  bg: 'surface',
  bgAlpha: 0,
  opacity: 1,
  tint: 0.8,
  telegraph: null,
};

describe('the four cell states (GDD §10)', () => {
  it('names exactly four, and CELL_OPACITY covers all of them', () => {
    expect(CELL_STATES).toHaveLength(4);
    expect(new Set(CELL_STATES).size).toBe(4);
    for (const state of CELL_STATES) {
      expect(typeof CELL_OPACITY[state], state).toBe('number');
    }
    // No opacity for a state that does not exist: a stray key would be a state someone added to the
    // table and forgot to add to the union, which type-checks and renders as nothing.
    expect(Object.keys(CELL_OPACITY).sort()).toEqual([...CELL_STATES].sort());
  });

  it('gives each state its own opacity, so one non-colour channel separates all four', () => {
    // THE §10/§11 CONSTRAINT, at its source. If two states shared an opacity they would be
    // distinguishable only by glyph or by colour, and for `visible` versus `remembered` — which have
    // the same glyph — that leaves colour alone. No choice in `components/` could recover it.
    const opacities = CELL_STATES.map((state) => CELL_OPACITY[state]);
    expect(new Set(opacities).size).toBe(4);
  });

  it('orders the states by how live the information is', () => {
    // Not decoration: a `*` felt in the dark is the only warning §4 ever gives, so it must not be
    // dimmer than the stone the player is merely recalling. This assertion is what stops a future
    // palette pass from "tidying" the four numbers into an evenly spaced ramp.
    expect(CELL_OPACITY.visible).toBeGreaterThan(CELL_OPACITY.sensed);
    expect(CELL_OPACITY.sensed).toBeGreaterThan(CELL_OPACITY.remembered);
    expect(CELL_OPACITY.remembered).toBeGreaterThan(CELL_OPACITY.unknown);
    expect(CELL_OPACITY.unknown).toBe(0);
  });
});

describe('light falloff (GDD §10, and §4 says it is binary)', () => {
  it('runs from full underfoot to LAMP_TINT_EDGE at the edge of the lit field', () => {
    expect(lampTint(0)).toBe(1);
    expect(lampTint(LIT_RADIUS)).toBe(LAMP_TINT_EDGE);
  });

  it('never dips to or below the tint of an unlit cell', () => {
    // The rule that stops an invented gradient from lying. §4's lit field is binary — in or out —
    // so the dimmest lit cell must still be unambiguously brighter than everything outside, or the
    // falloff starts reading as "partly visible" and the countable square edge §4 chose Chebyshev
    // for stops being countable.
    for (let distance = 0; distance <= LIT_RADIUS; distance += 1) {
      expect(lampTint(distance), `distance ${distance}`).toBeGreaterThan(NO_TINT);
      expect(lampTint(distance), `distance ${distance}`).toBeGreaterThanOrEqual(LAMP_TINT_EDGE);
    }
    expect(NO_TINT).toBe(0);
  });

  it('takes one discrete step per tile, and the step at the light edge is the largest of all', () => {
    // Discreteness is the other half of "it must not read as fading out of view": there are exactly
    // LIT_RADIUS + 1 values and no ramp between them. And the drop off the edge (LAMP_TINT_EDGE to
    // 0) must exceed every interior step, or the boundary is the *least* visible transition on a
    // board whose whole geometry the player is supposed to be reading.
    const values = Array.from({ length: LIT_RADIUS + 1 }, (_, d) => lampTint(d));
    expect(new Set(values).size).toBe(LIT_RADIUS + 1);

    let largestInteriorStep = 0;
    for (let d = 1; d <= LIT_RADIUS; d += 1) {
      const step = values[d - 1] - values[d];
      expect(step, `step at ${d}`).toBeGreaterThan(0);
      largestInteriorStep = Math.max(largestInteriorStep, step);
    }
    expect(LAMP_TINT_EDGE - NO_TINT).toBeGreaterThan(largestInteriorStep);
  });

  it('refuses a distance outside the lit field rather than extrapolating', () => {
    // Extrapolating would answer 0.5 for distance 5 — a plausible number for a tile that is not lit
    // at all, which is exactly the lie this module exists to avoid.
    expect(() => lampTint(LIT_RADIUS + 1)).toThrow(/lamp tint/);
    expect(() => lampTint(-1)).toThrow(/lamp tint/);
    expect(() => lampTint(1.5)).toThrow(/lamp tint/);
  });

  it('is the ramp §4’s radius implies, value for value', () => {
    // Pinned rather than recomputed from the same formula, which would assert only that the function
    // equals itself. If `LIT_RADIUS` or `LAMP_TINT_EDGE` moves, this is the test that says so — and
    // says whether the new values are still the short exact numbers the DOM wants.
    expect([0, 1, 2, 3, 4].map(lampTint)).toEqual([1, 0.9, 0.8, 0.7, 0.6]);
    expect(LIT_RADIUS).toBe(4);
  });
});

describe('telegraphs (GDD §2: two non-colour channels)', () => {
  it('separates attack from move on both non-colour channels', () => {
    // `frame` is a shape and `fill` is an alpha; neither is a hue. If these ever collapse to one
    // channel, §2's "two non-color channels" is being satisfied by the *colour* token, which is the
    // failure the sentence was written to prevent.
    expect(ATTACK_TELEGRAPH.frame).not.toBe(MOVE_TELEGRAPH.frame);
    expect(ATTACK_TELEGRAPH.fill).not.toBe(MOVE_TELEGRAPH.fill);
  });

  it('makes a marked cell visibly filled, and an attack louder than a move', () => {
    expect(MOVE_TELEGRAPH.fill).toBeGreaterThan(0);
    expect(ATTACK_TELEGRAPH.fill).toBeGreaterThan(MOVE_TELEGRAPH.fill);
    expect(ATTACK_TELEGRAPH.fill).toBeLessThanOrEqual(1);
  });

  it('names the kind it marks, so a component never infers it from the frame', () => {
    expect(ATTACK_TELEGRAPH.kind).toBe('attack');
    expect(MOVE_TELEGRAPH.kind).toBe('move');
  });
});

describe('sameCell — the memoisation predicate', () => {
  it('is true for a structurally identical copy', () => {
    expect(sameCell(REFERENCE, { ...REFERENCE })).toBe(true);
  });

  it('is false when ANY single field differs', () => {
    // The sweep, and the reason it is a sweep: `presentScene` reuses the previous cell object
    // whenever this returns true, so a field this comparison forgets is a cell that never updates on
    // screen — a stale telegraph, a `*` that does not clear, a corpse that stays drawn. Picking two
    // fields by hand is how that ships.
    const changes: readonly Partial<Cell>[] = [
      { x: 9 },
      { y: 9 },
      { state: 'remembered' },
      { glyph: 'o' },
      { fg: 'floor' },
      { bg: 'void' },
      { bgAlpha: 0.35 },
      { opacity: 0.4 },
      { tint: 0.7 },
      { telegraph: ATTACK_TELEGRAPH },
    ];
    // Every field of Cell must appear above, or the sweep silently stops covering the type.
    expect(new Set(changes.flatMap((change) => Object.keys(change))).size).toBe(
      Object.keys(REFERENCE).length,
    );

    for (const change of changes) {
      const label = Object.keys(change)[0];
      expect(sameCell(REFERENCE, { ...REFERENCE, ...change }), label).toBe(false);
    }
  });

  it('compares the telegraph by value, not by identity', () => {
    const marked: Cell = { ...REFERENCE, telegraph: ATTACK_TELEGRAPH };
    expect(sameCell(marked, { ...REFERENCE, telegraph: { ...ATTACK_TELEGRAPH } })).toBe(true);
    expect(sameCell(marked, { ...REFERENCE, telegraph: MOVE_TELEGRAPH })).toBe(false);
    expect(sameCell(marked, REFERENCE)).toBe(false);
    expect(sameCell(REFERENCE, marked)).toBe(false);
  });

  it('separates two telegraphs that differ on only one of their fields', () => {
    const marked: Cell = { ...REFERENCE, telegraph: ATTACK_TELEGRAPH };
    for (const change of [{ kind: 'move' as const }, { frame: 'underline' as const }, { fill: 0.9 }]) {
      expect(
        sameCell(marked, { ...REFERENCE, telegraph: { ...ATTACK_TELEGRAPH, ...change } }),
        Object.keys(change)[0],
      ).toBe(false);
    }
  });
});
