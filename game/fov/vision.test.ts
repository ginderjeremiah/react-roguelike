import { describe, expect, it } from 'vitest';
import { creatures, origin, parseScene } from '@/tests/unit/support/ascii-grid';
import { senseCreatures } from './embersense';
import { computeLitField } from './light';
import { computeTouchField } from './touch';
import { emptyTileSet, hasTile, tileSetOf, tileSetSize } from './tileset';
import {
  ADAPTATION_FLOOR,
  ADAPTATION_STEP,
  adaptVision,
  closeShutter,
  createVision,
  DARK_TOUCH_RADIUS,
  EMBER_SENSE_RADIUS,
  hasBeenLit,
  LIT_RADIUS,
  openShutter,
  remember,
  revealByLight,
  setShutter,
  tileKnowledge,
  TURNS_TO_FULL_ADAPTATION,
  type Vision,
} from './vision';

const ROOM = parseScene([
  '...........',
  '...........',
  '...........',
  '...........',
  '...........',
  '.....@ccccc',
  '...........',
  '...........',
  '...........',
  '...........',
  '...........',
]);

describe('the §4 numbers', () => {
  it('are the ones the metric ruling settled on', () => {
    // Pinned because #25 moved two of them, and a silent drift back to the pre-ruling values
    // (ember-sense 6, adaptation floor 2) would make the ramp three turns and the top of it a
    // no-op. If a designer changes these, this test is the place that says so out loud.
    expect(LIT_RADIUS).toBe(4);
    expect(DARK_TOUCH_RADIUS).toBe(1);
    expect(EMBER_SENSE_RADIUS).toBe(5);
    expect(ADAPTATION_FLOOR).toBe(1);
    expect(ADAPTATION_STEP).toBe(1);
  });

  it('give an adaptation ramp of exactly four turns', () => {
    expect(TURNS_TO_FULL_ADAPTATION).toBe(4);
  });

  it('leave the lit radius inside the sense radius, which containment depends on', () => {
    expect(LIT_RADIUS).toBeLessThanOrEqual(EMBER_SENSE_RADIUS);
  });
});

describe('createVision', () => {
  it('starts at the adaptation floor with nothing remembered — full adaptation is earned', () => {
    // §4: "Full adaptation is always earned. Ember-sense reaches 5 only after four turns spent
    // shuttered, so a run's sense radius starts at the floor, 1, not at the ceiling." The old
    // behaviour was the ceiling, on the reasoning that no *shuttering* had happened yet — which
    // handed `createVision(grid, 'shuttered')` a free radius-5 wall-piercing sense on turn 1.
    // Unobservable in play; §9 puts the number on the HUD, and a HUD that lies is worse.
    for (const shutter of ['shuttered', 'open'] as const) {
      const vision = createVision(ROOM.grid, shutter);
      expect(vision.shutter).toBe(shutter);
      expect(vision.senseRadius).toBe(ADAPTATION_FLOOR);
      expect(vision.senseRadius).not.toBe(EMBER_SENSE_RADIUS);
      expect(tileSetSize(vision.remembered)).toBe(0);
    }
  });

  it('sizes memory to the grid it was given', () => {
    const vision = createVision(ROOM.grid, 'open');
    expect(vision.remembered.width).toBe(ROOM.grid.width);
    expect(vision.remembered.height).toBe(ROOM.grid.height);
    expect(vision.remembered.flags).toHaveLength(ROOM.grid.tiles.length);
  });
});

describe('dark adaptation', () => {
  it('drops to the floor on shuttering and climbs one tile a turn to full', () => {
    let vision = closeShutter(createVision(ROOM.grid, 'open'));
    const ramp = [vision.senseRadius];
    for (let turn = 0; turn < TURNS_TO_FULL_ADAPTATION + 2; turn += 1) {
      vision = adaptVision(vision);
      ramp.push(vision.senseRadius);
    }
    // 1 -> 2 -> 3 -> 4 -> 5, then held. Spelled out rather than derived from the constants, so a
    // change to a constant has to be acknowledged here.
    expect(ramp).toEqual([1, 2, 3, 4, 5, 5, 5]);
  });

  it('changes what can be felt at every single step of the ramp', () => {
    // The ramp is only tense if each turn of it is a different amount of blindness. Creatures sit
    // at Chebyshev 1, 2, 3, 4 and 5, so each step must reveal exactly one more.
    const at = origin(ROOM);
    const all = creatures(ROOM);
    expect(all).toHaveLength(5);

    let vision = closeShutter(createVision(ROOM.grid, 'open'));
    const felt: number[] = [];
    for (let turn = 0; turn <= TURNS_TO_FULL_ADAPTATION; turn += 1) {
      felt.push(senseCreatures(at, vision.senseRadius, all).length);
      vision = adaptVision(vision);
    }
    expect(felt).toEqual([1, 2, 3, 4, 5]);
  });

  it('does not restart the ramp when the shutter is already shut', () => {
    // A no-op "shutter" command must not blind the player for four turns.
    let vision = closeShutter(createVision(ROOM.grid, 'open'));
    vision = adaptVision(adaptVision(vision));
    expect(vision.senseRadius).toBe(3);

    const again = closeShutter(vision);
    expect(again.senseRadius).toBe(3);
    expect(again).toBe(vision);
  });

  it('holds the radius while the shutter is open, and resets it when it closes again', () => {
    let vision = closeShutter(createVision(ROOM.grid, 'open'));
    vision = adaptVision(vision);
    expect(vision.senseRadius).toBe(2);

    const opened = openShutter(vision);
    expect(opened.senseRadius).toBe(2);
    // Eyes do not dark-adapt with the lantern open.
    expect(adaptVision(opened).senseRadius).toBe(2);
    // And flicking the shutter cannot launder the ramp.
    expect(closeShutter(opened).senseRadius).toBe(ADAPTATION_FLOOR);
  });

  it('never exceeds the full radius however many turns pass', () => {
    let vision = closeShutter(createVision(ROOM.grid, 'open'));
    for (let turn = 0; turn < 50; turn += 1) vision = adaptVision(vision);
    expect(vision.senseRadius).toBe(EMBER_SENSE_RADIUS);
  });

  it('never mutates the vision it was handed', () => {
    const vision = Object.freeze(closeShutter(createVision(ROOM.grid, 'open')));
    expect(() => adaptVision(vision)).not.toThrow();
    expect(vision.senseRadius).toBe(ADAPTATION_FLOOR);
  });
});

describe('setShutter', () => {
  it('dispatches to both transitions', () => {
    const open = createVision(ROOM.grid, 'open');
    const shut = setShutter(open, 'shuttered');
    expect(shut.shutter).toBe('shuttered');
    expect(shut.senseRadius).toBe(ADAPTATION_FLOOR);
    expect(setShutter(shut, 'open').shutter).toBe('open');
  });

  it('throws on a state that is not one of the two', () => {
    const open = createVision(ROOM.grid, 'open');
    expect(() => setShutter(open, 'half' as 'open')).toThrow(/setShutter/);
  });
});

describe('remembered terrain', () => {
  const grid = ROOM.grid;

  it('accumulates everything ever perceived', () => {
    let vision = createVision(grid, 'shuttered');
    vision = remember(vision, computeTouchField(grid, { x: 1, y: 1 }));
    expect(tileSetSize(vision.remembered)).toBe(9);

    vision = remember(vision, computeTouchField(grid, { x: 8, y: 8 }));
    expect(tileSetSize(vision.remembered)).toBe(18);
    expect(hasTile(vision.remembered, 1, 1)).toBe(true);
    expect(hasTile(vision.remembered, 8, 8)).toBe(true);
  });

  it('never forgets a tile, even after a turn that perceives somewhere else', () => {
    let vision = remember(createVision(grid, 'shuttered'), computeTouchField(grid, { x: 1, y: 1 }));
    for (let turn = 0; turn < 5; turn += 1) {
      vision = remember(vision, computeTouchField(grid, { x: 9, y: 9 }));
      expect(hasTile(vision.remembered, 0, 0)).toBe(true);
    }
  });

  it('overlapping turns do not double-count', () => {
    let vision = remember(createVision(grid, 'shuttered'), computeTouchField(grid, { x: 5, y: 5 }));
    vision = remember(vision, computeTouchField(grid, { x: 6, y: 5 }));
    // Two overlapping 3x3 blocks one tile apart: 12 distinct tiles.
    expect(tileSetSize(vision.remembered)).toBe(12);
  });

  it('returns the same vision when nothing new was perceived', () => {
    const first = remember(createVision(grid, 'shuttered'), computeTouchField(grid, { x: 5, y: 5 }));
    expect(remember(first, computeTouchField(grid, { x: 5, y: 5 }))).toBe(first);
  });

  it('does not mutate the vision or the field it was given', () => {
    const before = createVision(grid, 'shuttered');
    const perceived = computeTouchField(grid, { x: 5, y: 5 });
    const perceivedSnapshot = [...perceived.flags];

    const after = remember(before, perceived);

    expect(tileSetSize(before.remembered)).toBe(0);
    expect(perceived.flags).toEqual(perceivedSnapshot);
    expect(after.remembered).not.toBe(before.remembered);
  });

  it('carries the rest of the vision through unchanged', () => {
    const before = adaptVision(closeShutter(createVision(grid, 'open')));
    const after = remember(before, computeTouchField(grid, { x: 5, y: 5 }));
    expect(after.shutter).toBe(before.shutter);
    expect(after.senseRadius).toBe(before.senseRadius);
  });
});

describe('what the lantern has revealed (§4s cache rule, #31/#41)', () => {
  const grid = ROOM.grid;
  const litHere = computeLitField(grid, { x: 5, y: 5 });

  it('starts empty even with the shutter open — light has to fall somewhere first', () => {
    // `createVision(grid, 'open')` describes a lantern that is *set* to open, not one that has lit
    // anything. Seeding this from the shutter would hand a fresh run the whole floor, and §2 phase
    // 3 — which is what actually lights the entrance room — would have nothing left to do.
    for (const shutter of ['open', 'shuttered'] as const) {
      const vision = createVision(grid, shutter);
      expect(tileSetSize(vision.revealed)).toBe(0);
      expect(vision.revealed.flags).toHaveLength(grid.tiles.length);
    }
  });

  it('accumulates, and never forgets, exactly like remembered terrain', () => {
    let vision = revealByLight(createVision(grid, 'open'), litHere);
    const first = tileSetSize(vision.revealed);
    expect(first).toBeGreaterThan(9); // a lit field is bigger than a touch field, or nothing is

    vision = revealByLight(vision, computeLitField(grid, { x: 1, y: 1 }));
    expect(tileSetSize(vision.revealed)).toBeGreaterThan(first);
    expect(hasBeenLit(vision, 5, 5)).toBe(true);
    expect(hasBeenLit(vision, 1, 1)).toBe(true);
  });

  it('returns the same vision when the light falls where it has fallen before', () => {
    const first = revealByLight(createVision(grid, 'open'), litHere);
    expect(revealByLight(first, litHere)).toBe(first);
  });

  it('does not mutate the vision or the field it was given', () => {
    const before = createVision(grid, 'open');
    const snapshot = [...litHere.flags];
    const after = revealByLight(before, litHere);

    expect(tileSetSize(before.revealed)).toBe(0);
    expect(litHere.flags).toEqual(snapshot);
    expect(after.revealed).not.toBe(before.revealed);
  });

  it('survives every shutter transition and every turn of the ramp', () => {
    // The property the *ever lit* reading rests on: nothing in this module may narrow it. Each
    // transition is applied in turn and the plane is re-checked, because "monotone" is a claim
    // about the transitions rather than about the union function.
    let vision = revealByLight(createVision(grid, 'open'), litHere);
    const lit = tileSetSize(vision.revealed);

    for (const transition of [closeShutter, adaptVision, adaptVision, openShutter, closeShutter]) {
      vision = transition(vision);
      expect(tileSetSize(vision.revealed)).toBe(lit);
      expect(hasBeenLit(vision, 5, 5)).toBe(true);
    }
    vision = remember(vision, computeTouchField(grid, { x: 9, y: 9 }));
    expect(tileSetSize(vision.revealed)).toBe(lit);
  });

  it('is a strictly separate plane from remembered terrain', () => {
    // The two must not be aliased. A `revealByLight` that grew `remembered` — or a `remember` that
    // grew `revealed` — would compile, would pass every accumulation test above, and would hand a
    // shuttered crawl every cache on the floor, which is the bug the rule exists to fix.
    const felt = remember(createVision(grid, 'shuttered'), computeTouchField(grid, { x: 9, y: 9 }));
    expect(tileSetSize(felt.remembered)).toBe(9);
    expect(tileSetSize(felt.revealed)).toBe(0);

    const shown = revealByLight(createVision(grid, 'open'), litHere);
    expect(tileSetSize(shown.remembered)).toBe(0);
    expect(tileSetSize(shown.revealed)).toBeGreaterThan(0);
  });

  it('reports false off the edge of the grid rather than throwing', () => {
    const vision = revealByLight(createVision(grid, 'open'), litHere);
    expect(hasBeenLit(vision, -1, 5)).toBe(false);
    expect(hasBeenLit(vision, 5, 99)).toBe(false);
  });
});

describe('tileKnowledge', () => {
  const grid = ROOM.grid;
  const perceived = tileSetOf(grid, [{ x: 1, y: 1 }]);
  const remembered = tileSetOf(grid, [
    { x: 1, y: 1 },
    { x: 2, y: 2 },
  ]);

  it('reports the three states the renderer draws', () => {
    expect(tileKnowledge(perceived, remembered, 1, 1)).toBe('perceived');
    expect(tileKnowledge(perceived, remembered, 2, 2)).toBe('remembered');
    expect(tileKnowledge(perceived, remembered, 3, 3)).toBe('unknown');
  });

  it('prefers perceived over remembered, so familiarity does not dim a lit tile', () => {
    const everything = tileSetOf(grid, [{ x: 1, y: 1 }]);
    expect(tileKnowledge(everything, everything, 1, 1)).toBe('perceived');
  });

  it('reports unknown off the edge of the grid', () => {
    expect(tileKnowledge(perceived, remembered, -1, 0)).toBe('unknown');
    expect(tileKnowledge(perceived, remembered, 0, 99)).toBe('unknown');
  });

  it('reports unknown for everything when nothing has been seen', () => {
    const nothing = emptyTileSet(grid);
    const vision: Vision = createVision(grid, 'shuttered');
    expect(tileKnowledge(nothing, vision.remembered, 5, 5)).toBe('unknown');
  });
});
