import { describe, expect, it } from 'vitest';
import { creatureCount, expectedDrawCount, findSoundnessProblems, generateFloor } from '../map';
import { createRng, next } from '../rng';
import { FIRST_FLOOR, LAST_FLOOR } from './run';

/**
 * The run's length, and the claim that every floor in it can actually be built.
 *
 * Two constants is a thin table, so the test is not "is 8 equal to 8" — it is the property those
 * constants are load-bearing for: **a run of `FIRST_FLOOR..LAST_FLOOR` is playable end to end.**
 * `LAST_FLOOR` is the one number in the game that decides how many times `generateFloor` is called
 * with a number nothing else has ever passed it, and §8's creature count is a function of it.
 */

describe('the length of a run', () => {
  it('is a range of positive integers, starting where generateFloor starts', () => {
    // `generateFloor` throws below 1, so a `FIRST_FLOOR` of 0 would make `createInitialState` throw
    // on the first launch of the app rather than fail here.
    expect(Number.isSafeInteger(FIRST_FLOOR)).toBe(true);
    expect(Number.isSafeInteger(LAST_FLOOR)).toBe(true);
    expect(FIRST_FLOOR).toBe(1);
    expect(LAST_FLOOR).toBeGreaterThan(FIRST_FLOOR);
    expect(() => generateFloor(createRng('bounds'), FIRST_FLOOR - 1)).toThrow(/positive integer/);
  });

  it('generates a sound floor for every floor number a run can reach', () => {
    // The floors a run visits are 1..8, and floors 4-8 are numbers no other test passes to the
    // generator in a loop. A creature count that outgrew the legal spawn tiles, or a floor that came
    // out disconnected, would present as an unwinnable run rather than as a failure here.
    for (let floorNumber = FIRST_FLOOR; floorNumber <= LAST_FLOOR; floorNumber += 1) {
      for (let seed = 0; seed < 8; seed += 1) {
        const floor = generateFloor(createRng(`run-length-${seed}`), floorNumber).value;
        expect(findSoundnessProblems(floor.grid), `floor ${floorNumber}, seed ${seed}`).toEqual([]);
        expect(floor.creatures).toHaveLength(creatureCount(floorNumber));
      }
    }
  });

  it('costs a known, floor-dependent number of draws for the whole run', () => {
    // The draw-budget contract's premise, at the scale a run uses it: the count depends on the
    // floor number and on nothing else, so a command log's budget is computable from the floors it
    // visited (`game/core/replay.test.ts`). Asserted here because §8's creature curve is what makes
    // the count vary at all, and it is a content number.
    for (let floorNumber = FIRST_FLOOR; floorNumber <= LAST_FLOOR; floorNumber += 1) {
      for (const seed of ['a', 'b', 'c']) {
        const start = createRng(seed);
        let advanced = start;
        for (let i = 0; i < expectedDrawCount(floorNumber); i += 1) advanced = next(advanced).rng;
        expect(generateFloor(start, floorNumber).rng, `floor ${floorNumber}, seed ${seed}`).toEqual(
          advanced,
        );
      }
    }
    // §8 caps the curve at 6, so the last three floors cost the same to generate — the shape of the
    // curve, not just its existence.
    expect(expectedDrawCount(LAST_FLOOR)).toBe(expectedDrawCount(LAST_FLOOR - 1));
    expect(expectedDrawCount(2)).toBeGreaterThan(expectedDrawCount(1));
  });
});
