import { describe, expect, it } from 'vitest';
import { CACHE_FUEL, FUEL_BURN_LIT, FUEL_BURN_SHUTTERED, STARTING_FUEL } from '../content';
import { findFieldDivergence, formatFieldDivergence } from '../core';
import { ADAPTATION_FLOOR, EMBER_SENSE_RADIUS, type ShutterState } from '../fov';
import { generateFloor, type Grid } from '../map';
import { createRng, int, type Rng } from '../rng';
import {
  burn,
  burnRate,
  canOpen,
  createLantern,
  isDry,
  open,
  refuel,
  setLanternShutter,
  shutter,
  toggleShutter,
  type Lantern,
} from './lantern';

/**
 * The lantern in isolation: fuel arithmetic, the shutter transitions, and the rule that binds them.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * "FUEL IS NEVER NEGATIVE" IS NOT A TEST OF ANYTHING
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * It is satisfied by a lantern that never burns. So is "the burn is 4 when open", by a lantern that
 * is never open. The assertions that can actually fail on a broken economy are the *relations*:
 * fuel strictly decreases when it is burned, the shutter is never open on an empty lantern, a dry
 * lantern refuses to open and a refuelled one does not, and running dry shuts the light off on the
 * turn it happens rather than the turn after.
 *
 * The whole-economy claims — a pacifist runs dry, a floodlit run runs dry faster, a floor played
 * well nets slightly positive — cannot be asserted here at all, because they are properties of a
 * run. They live in `economy.test.ts`.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

const grid: Grid = generateFloor(createRng('lantern'), 1).value.grid;

function lantern(fuel: number, state: ShutterState = 'shuttered'): Lantern {
  return createLantern(grid, state, fuel);
}

describe('the burn rate', () => {
  it('is GDD §4s table and nothing else', () => {
    expect(burnRate('open')).toBe(FUEL_BURN_LIT);
    expect(burnRate('shuttered')).toBe(FUEL_BURN_SHUTTERED);
  });

  it('charges strictly more for an open shutter', () => {
    // The relation, separately from the two literals. A retune that made them equal would pass both
    // assertions above by changing the content table and would delete the game.
    expect(burnRate('open')).toBeGreaterThan(burnRate('shuttered'));
  });
});

describe('burning fuel', () => {
  it('takes exactly the shutter rate, every turn, in both states', () => {
    expect(burn(lantern(50, 'open')).fuel).toBe(50 - FUEL_BURN_LIT);
    expect(burn(lantern(50, 'shuttered')).fuel).toBe(50 - FUEL_BURN_SHUTTERED);
  });

  it('shuts the shutter on the turn the fuel reaches zero, not the turn after', () => {
    // `turn.ts`'s header states this as the reason GDD §2 burns fuel (phase 2) *before* lighting
    // recomputes (phase 3): "the turn you run dry is the turn the shutter shuts". A lantern that
    // stayed nominally open at 0 fuel would light a room it has no fuel to light, and `canOpen`
    // and the actual shutter state would disagree about the same lantern.
    const spent = burn(lantern(FUEL_BURN_LIT, 'open'));
    expect(spent.fuel).toBe(0);
    expect(spent.vision.shutter).toBe('shuttered');
  });

  it('costs the four blind turns as well, because running dry is a shuttering', () => {
    // §4: closing resets ember-sense to the adaptation floor. Running dry is the most dramatic
    // shuttering in the game and must not be a quieter one than pressing the button.
    const full = { ...lantern(FUEL_BURN_LIT, 'open'), fuel: FUEL_BURN_LIT };
    expect(full.vision.senseRadius).toBe(EMBER_SENSE_RADIUS);
    expect(burn(full).vision.senseRadius).toBe(ADAPTATION_FLOOR);
  });

  it('clamps at zero rather than going negative', () => {
    expect(burn(lantern(1, 'open')).fuel).toBe(0);
    expect(burn(lantern(0)).fuel).toBe(0);
  });

  it('does not restart the adaptation ramp every turn once dry', () => {
    // A dry lantern burns 0 and is already shuttered, so `closeShutter` must be the no-op it claims
    // to be on an already-shut shutter. If it were not, the sense radius would be pinned at 1 for
    // the rest of the run and §4's "you can still crawl with ember-sense" would be a lie: the ramp
    // would reset every single turn and never climb.
    let dry = lantern(0);
    dry = { fuel: dry.fuel, vision: { ...dry.vision, senseRadius: 3 } };
    expect(burn(dry).vision.senseRadius).toBe(3);
  });
});

describe('the shutter', () => {
  it('opens while there is fuel', () => {
    expect(open(lantern(1)).vision.shutter).toBe('open');
  });

  it('cannot be opened at zero fuel — §4', () => {
    const dry = lantern(0);
    expect(canOpen(dry)).toBe(false);
    expect(open(dry).vision.shutter).toBe('shuttered');
    expect(toggleShutter(dry).vision.shutter).toBe('shuttered');
    expect(setLanternShutter(dry, 'open').vision.shutter).toBe('shuttered');
  });

  it('can always be shut, fuel or no fuel', () => {
    // Going dark costs nothing and needs nothing. The asymmetry is the rule: only one direction is
    // ever refused, and a guard on both would strand a lit player with no fuel.
    expect(shutter(lantern(3, 'open')).vision.shutter).toBe('shuttered');
    expect(toggleShutter(lantern(3, 'open')).vision.shutter).toBe('shuttered');
  });

  it('opens again the moment a kill or a cache refuels it', () => {
    // §4: 0 fuel is "a desperate state, not a loss state". The recovery has to work, and it has to
    // work through the ordinary refuel path rather than through a special resurrection rule.
    const dry = lantern(0);
    expect(canOpen(dry)).toBe(false);
    const paid = refuel(dry, CACHE_FUEL);
    expect(canOpen(paid)).toBe(true);
    expect(open(paid).vision.shutter).toBe('open');
  });

  it('does not restart dark adaptation when shuttering an already-shut lantern', () => {
    const partly = lantern(10);
    const mid = { fuel: partly.fuel, vision: { ...partly.vision, senseRadius: 4 } };
    expect(shutter(mid).vision.senseRadius).toBe(4);
  });

  it('collapses ember-sense when it actually shuts', () => {
    expect(shutter(lantern(10, 'open')).vision.senseRadius).toBe(ADAPTATION_FLOOR);
  });
});

describe('refuelling', () => {
  it('adds a kill or a cache to the tank, with no ceiling', () => {
    // §4 gives no cap, and one would silently discard the back half of a cache the player went
    // off-route for — which is the wager §5 step 8 exists to create.
    expect(refuel(lantern(STARTING_FUEL), CACHE_FUEL).fuel).toBe(STARTING_FUEL + CACHE_FUEL);
  });

  it('returns the same lantern for nothing at all', () => {
    const before = lantern(12);
    expect(refuel(before, 0)).toBe(before);
  });

  it('refuses a negative or fractional gain', () => {
    // A negative "gain" is a fuel leak wearing the name of income, and its symptom in play — a run
    // that gets harder when you kill things — reads as a balance problem rather than a bug.
    expect(() => refuel(lantern(10), -5)).toThrow(/non-negative integer/);
    expect(() => refuel(lantern(10), 2.5)).toThrow(/non-negative integer/);
  });
});

describe('creating a lantern', () => {
  it('starts at GDD §4s reserve, fully dark-adapted, however the shutter is set', () => {
    expect(createLantern(grid, 'shuttered').fuel).toBe(STARTING_FUEL);
    expect(createLantern(grid, 'shuttered').vision.senseRadius).toBe(EMBER_SENSE_RADIUS);
    expect(createLantern(grid, 'open').vision.shutter).toBe('open');
  });

  it('refuses a state the rules could never reach', () => {
    // Open and dry at once. The rules cannot produce it (burning to 0 shuts the shutter) and cannot
    // leave it (`open` is refused), so accepting it would mean a lantern lit by nothing.
    expect(() => createLantern(grid, 'open', 0)).toThrow(/no fuel/);
    expect(() => createLantern(grid, 'shuttered', -1)).toThrow(/non-negative integer/);
  });

  it('is plain JSON-shaped data', () => {
    // `game/core/divergence.ts` throws on a Map, a Set or a class instance, and a `GameState`
    // holding one compares as equal to a different one. A `Lantern` is headed for `GameState` (#18).
    const before = refuel(shutter(createLantern(grid, 'open')), 7);
    const divergence = findFieldDivergence(before, JSON.parse(JSON.stringify(before)) as Lantern);
    if (divergence) throw new Error(`not JSON round-trippable: ${formatFieldDivergence(divergence)}`);
  });
});

// --- properties ----------------------------------------------------------------------------------

/**
 * A long, arbitrary sequence of the things that can happen to a lantern.
 *
 * Weighted so that burning outpaces refuelling — one gain of 0-4 for every five other actions —
 * because a driver whose expected income exceeds its expected burn never reaches 0, and the
 * interesting half of every property below is what happens at 0.
 */
function drive(
  seed: string,
  steps: number,
): { lantern: Lantern; burns: number; gains: number; everDry: boolean } {
  let rng: Rng = createRng(seed);
  let current = createLantern(grid, 'shuttered');
  let burns = 0;
  let gains = 0;
  let everDry = false;

  for (let step = 0; step < steps; step += 1) {
    const choice = int(rng, 0, 5);
    rng = choice.rng;
    switch (choice.value) {
      case 0:
      case 1:
        current = toggleShutter(current);
        break;
      case 2: {
        const amount = int(rng, 0, 4);
        rng = amount.rng;
        current = refuel(current, amount.value);
        gains += amount.value;
        break;
      }
      default:
        current = burn(current);
        burns += 1;
        break;
    }
    if (isDry(current)) everDry = true;
  }
  return { lantern: current, burns, gains, everDry };
}

describe('properties that hold however the lantern is driven', () => {
  it('never goes negative and never lights an empty lantern', () => {
    // The second half is the one with teeth. "Fuel >= 0" holds for a lantern nobody ever burns;
    // "the shutter is never open at 0 fuel" is §4's actual rule, and it is violated by *either* a
    // missing guard in `open` or a `burn` that forgets to shut the shutter as it empties.
    for (let seed = 0; seed < 40; seed += 1) {
      const { lantern: end } = drive(`drive-${seed}`, 300);
      expect(end.fuel).toBeGreaterThanOrEqual(0);
      if (isDry(end)) expect(end.vision.shutter).toBe('shuttered');
    }
  });

  it('spends real fuel over a long run rather than hovering', () => {
    // The positive half, and the one that fails on an economy where nothing is ever spent: over 200
    // arbitrary actions the lantern must actually reach zero at least sometimes, and must have
    // burned a meaningful amount. Without this, a `burn` that returned its input unchanged would
    // satisfy every assertion above.
    let everDry = 0;
    let totalBurned = 0;
    for (let seed = 0; seed < 40; seed += 1) {
      const run = drive(`drive-${seed}`, 300);
      if (run.everDry) everDry += 1;
      totalBurned += STARTING_FUEL + run.gains - run.lantern.fuel;
    }
    expect(totalBurned).toBeGreaterThan(40 * 100);
    // Every one of these runs should end dry: the driver burns faster than it earns by design, and
    // 300 actions is far more than the reserve can absorb. A `burn` that no-opped would leave all
    // forty full.
    expect(everDry).toBe(40);
  });

  it('is a pure function of the sequence, not of anything else', () => {
    for (let seed = 0; seed < 8; seed += 1) {
      const a = drive(`same-${seed}`, 150).lantern;
      const b = drive(`same-${seed}`, 150).lantern;
      const divergence = findFieldDivergence(a, b);
      if (divergence) throw new Error(`diverged: ${formatFieldDivergence(divergence)}`);
    }
  });

  it('never mutates the lantern it is given', () => {
    const before = Object.freeze(createLantern(grid, 'open'));
    Object.freeze(before.vision);
    expect(() => burn(before)).not.toThrow();
    expect(() => refuel(before, 10)).not.toThrow();
    expect(() => toggleShutter(before)).not.toThrow();
    expect(before.fuel).toBe(STARTING_FUEL);
    expect(before.vision.shutter).toBe('open');
  });
});
