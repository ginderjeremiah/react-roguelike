import { describe, expect, it } from 'vitest';
import { generateFloor, isPassable, positionOf, type Floor, type Position } from '@/game/map';
import { createRng } from '@/game/rng';
import { origin as originOf, parseScene } from '@/tests/unit/support/ascii-grid';
import { computeSensedField, senseCreatures } from './embersense';
import { computeLitField } from './light';
import { tileSetContains, tileSetDifference, tileSetSize } from './tileset';
import {
  ADAPTATION_FLOOR,
  adaptVision,
  closeShutter,
  createVision,
  EMBER_SENSE_RADIUS,
  LIT_RADIUS,
} from './vision';

/**
 * **Everything a flash can wake, you can already feel.**
 *
 * GDD §4 rests on this. Ember-sense (Chebyshev 5, through walls) always covers the lit region
 * (Chebyshev 4, line of sight) because 4 <= 5 under a *shared* metric — so before opening the
 * shutter, the player knows how many creatures the flash is about to wake. Randomness decides what
 * is in the room; it never decides whether flashing was a mistake (Pillar 2).
 *
 * The guarantee is deliberately **suspended during dark adaptation**, and that is what makes the
 * four turns after shuttering the tensest state in the game. Both halves are tested here: it holds
 * at radius 4 and 5, and it genuinely fails at 1, 2 and 3. A test that only asserted the first half
 * would still pass if the ramp had been quietly removed.
 */

/** Every tile an actor could stand on, row-major. */
function passablePositions(floor: Floor): Position[] {
  const out: Position[] = [];
  for (let index = 0; index < floor.grid.tiles.length; index += 1) {
    if (isPassable(floor.grid.tiles[index])) out.push(positionOf(floor.grid, index));
  }
  return out;
}

function floors(count: number, label: string): Floor[] {
  return Array.from(
    { length: count },
    (_, i) => generateFloor(createRng(`${label}-${i}`), (i % 8) + 1).value,
  );
}

describe('containment holds at full dark adaptation', () => {
  it('puts every lit tile inside the sensed region, from every standable tile of ten floors', () => {
    let checked = 0;
    for (const floor of floors(10, 'containment')) {
      for (const at of passablePositions(floor)) {
        const lit = computeLitField(floor.grid, at);
        const sensed = computeSensedField(floor.grid, at, EMBER_SENSE_RADIUS);
        const escaped = tileSetDifference(lit, sensed);
        expect(
          escaped,
          `flashing from (${at.x}, ${at.y}) lights tiles ember-sense cannot reach`,
        ).toEqual([]);
        checked += 1;
      }
    }
    // Non-vacuity: containment is trivially true if nothing is ever lit.
    expect(checked).toBeGreaterThan(1000);
  });

  it('still holds at the exact radius the guarantee needs, not just at full reach', () => {
    // §4's guard is `senseRadius >= 4`, i.e. sense >= lit. Radius 4 is the boundary case and the
    // one that breaks first if the lit square ever grows a tile.
    for (const floor of floors(4, 'containment-boundary')) {
      for (const at of passablePositions(floor)) {
        const lit = computeLitField(floor.grid, at);
        const sensed = computeSensedField(floor.grid, at, LIT_RADIUS);
        expect(tileSetContains(sensed, lit), `from (${at.x}, ${at.y})`).toBe(true);
      }
    }
  });

  it('means every creature a flash could wake was already felt', () => {
    // The same guarantee stated the way the player experiences it: everything the light shows you
    // was in the felt list on the turn before you opened the shutter.
    for (const floor of floors(8, 'containment-creatures')) {
      const spawns = floor.creatures.map((creature) => creature.at);
      for (const at of passablePositions(floor)) {
        const lit = computeLitField(floor.grid, at);
        const wouldWake = spawns.filter((spawn) => lit.flags[spawn.y * lit.width + spawn.x]);
        const felt = senseCreatures(at, EMBER_SENSE_RADIUS, spawns);
        for (const woken of wouldWake) {
          expect(felt, `a flash from (${at.x}, ${at.y}) wakes an unfelt creature`).toContainEqual(
            woken,
          );
        }
      }
    }
  });
});

describe('containment is suspended during the adaptation ramp', () => {
  it('is broken at every radius below the lit radius, on a real floor', () => {
    // If this ever passes, the ramp has stopped mattering and the tensest four turns in the game
    // have quietly become four ordinary ones.
    const floor = generateFloor(createRng('ramp-breaks'), 3).value;
    const standable = passablePositions(floor);

    for (const radius of [ADAPTATION_FLOOR, 2, 3]) {
      const breached = standable.filter((at) => {
        const lit = computeLitField(floor.grid, at);
        return !tileSetContains(computeSensedField(floor.grid, at, radius), lit);
      });
      // Not just "at least one" — at a radius this short, almost anywhere you stand can wake
      // something you cannot feel.
      expect(breached.length, `radius ${radius}`).toBeGreaterThan(standable.length / 2);
    }
  });

  it('names the turn on which the guarantee comes back', () => {
    // Open ground, so the arithmetic is exact and nothing depends on where the generator put a
    // wall: the flash lights a 9x9 square, and ember-sense covers a (2r+1) square.
    const open = parseScene(Array.from({ length: 11 }, (_, y) => (y === 5 ? '.....@.....' : '.'.repeat(11))));
    const at = originOf(open);
    const lit = computeLitField(open.grid, at);

    let vision = closeShutter(createVision(open.grid, 'open'));
    const guaranteed: boolean[] = [];
    const sensedSizes: number[] = [];
    for (let turn = 0; turn <= 4; turn += 1) {
      const sensed = computeSensedField(open.grid, at, vision.senseRadius);
      guaranteed.push(tileSetContains(sensed, lit));
      sensedSizes.push(tileSetSize(sensed));
      vision = adaptVision(vision);
    }

    // Radius 1, 2, 3 are blind spots; radius 4 is where "everything a flash can wake, you can
    // already feel" becomes true again — on the fourth turn after shuttering.
    expect(guaranteed).toEqual([false, false, false, true, true]);
    // And each of those turns is a materially different amount of blindness.
    expect(sensedSizes).toEqual([9, 25, 49, 81, 121]);
    expect(tileSetSize(lit)).toBe(81);
  });

  it('shrinks the sensed region far below the lit region while blind', () => {
    // The shape of the gamble, in numbers: at the adaptation floor you feel 9 tiles, and a flash
    // can light dozens.
    const floor = generateFloor(createRng('ramp-size'), 1).value;
    for (const at of passablePositions(floor)) {
      expect(
        tileSetSize(computeSensedField(floor.grid, at, ADAPTATION_FLOOR)),
        `from (${at.x}, ${at.y})`,
      ).toBeLessThan(tileSetSize(computeLitField(floor.grid, at)));
    }
  });
});
