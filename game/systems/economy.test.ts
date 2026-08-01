import { describe, expect, it } from 'vitest';
import {
  DARK_PACIFIST,
  DRY_CRAWL,
  FLOODLIT,
  FLOODLIT_PACIFIST,
  PACIFIST,
  playRun,
  STALKER,
  type FloorResult,
  type RunResult,
  type Style,
} from '@/tests/unit/support/lantern-run';
import { STARTING_FUEL } from '../content';
import { isAlive, PLAYER_ID, playerOf } from '../entities';
import { ADAPTATION_FLOOR, EMBER_SENSE_RADIUS, perceive } from '../fov';
import { generateFloor } from '../map';
import { createRng } from '../rng';
import { canOpen, toggleShutter } from './lantern';
import { createLanternWorld, lanternPhases, type LanternWorld } from './light';
import { resolveTurn } from './turn';
import { chargeActor } from './schedule';

/**
 * GDD §4's three economy invariants, over a corpus of scripted runs.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE INVARIANTS ARE THE DESIGN. THE NUMBERS ARE NOT — AND THIS FILE HAS ALREADY MOVED TWO
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * §4: "The three tuning invariants (these are design; the numbers above are not):
 *
 *   1. Avoiding all combat must be **unsustainable** — a pacifist run runs dry.
 *   2. Keeping the shutter open must be **unsustainable** — a floodlit run runs dry faster.
 *   3. A floor played well nets **slightly positive** fuel, so competence is rewarded and greed is
 *      the thing that kills you."
 *
 * At §4's original numbers — Cinder 30, cache 40 — invariant 3 failed badly: a scripted competent
 * run netted about **+85 fuel per floor** against a starting reserve of 80, so fuel stopped being a
 * resource somewhere on floor one and the entire lantern mechanic was decorative. The Cinder's drop
 * moved to 20 and the cache to 25, together so that §1's "fuel comes from kills" survives. Both are
 * recorded in the GDD change log for 2026-08-02.
 *
 * ## Why this suite is comparative
 *
 * The trap this file exists to avoid is a suite of "fuel never goes negative" and "burn is 4 when
 * open" — both of which are satisfied by an economy where nothing meaningful is ever spent or
 * earned, which is exactly the economy that ships when nobody checks. Every assertion below is
 * therefore a *difference between play styles*: a pacifist against a fighter on the same floors, a
 * floodlit run against a shuttered one with the same fighting. In a degenerate economy every style
 * behaves identically and every one of those comparisons fails.
 *
 * The scripts are in `tests/unit/support/lantern-run.ts`, along with what they are allowed to know
 * (only what the player knows) and the two liberties they take.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

const SEEDS = 10;
const FLOORS = 8;

function runs(style: Style, startFuel?: number): RunResult[] {
  const out: RunResult[] = [];
  for (let seed = 0; seed < SEEDS; seed += 1) out.push(playRun(`econ-${seed}`, style, FLOORS, startFuel));
  return out;
}

function floorsOf(results: readonly RunResult[]): FloorResult[] {
  return results.flatMap((result) => [...result.floors]);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * The median floor's net fuel, measured against what the lantern was **asked** for.
 *
 * `demand` rather than `spend`, because `spend` is clamped by the fuel that was there: a style that
 * spends a whole floor at zero reports `income === spend` and a net of exactly zero, which reads as
 * a break-even floor when it is a floor the player could not pay for. That clamp is what made the
 * pacifist's net read 0 in the first draft of this file, and it would have hidden the invariant
 * rather than asserted it.
 */
function netPerFloor(results: readonly RunResult[]): number {
  return median(floorsOf(results).map((floor) => floor.income - floor.demand));
}

/** Turns played before the lantern first hit 0, or `Infinity` for a run that never did. */
function turnsToDry(result: RunResult): number {
  return result.driedAfterTurns ?? Number.POSITIVE_INFINITY;
}

const stalker = runs(STALKER);
const pacifist = runs(PACIFIST);
const floodlit = runs(FLOODLIT);
const floodlitPacifist = runs(FLOODLIT_PACIFIST);
const darkPacifist = runs(DARK_PACIFIST);

describe('the corpus is playing the game it claims to be playing', () => {
  it('produces four genuinely different styles', () => {
    // Every invariant below is a comparison, so all of them are vacuous if the styles are the same
    // sequence of commands wearing different names. This is the instrument test for the instrument.
    const kills = (results: RunResult[]): number =>
      floorsOf(results).reduce((total, floor) => total + floor.kills, 0);
    const litTurns = (results: RunResult[]): number =>
      floorsOf(results).reduce((total, floor) => total + floor.litTurns, 0);
    const flashes = (results: RunResult[]): number =>
      floorsOf(results).reduce((total, floor) => total + floor.flashes, 0);

    // The pacifists kill nothing. Not "few" — nothing, or they are not pacifists.
    expect(kills(pacifist)).toBe(0);
    expect(kills(darkPacifist)).toBe(0);
    expect(kills(floodlitPacifist)).toBe(0);
    // The fighters clear real floors.
    expect(kills(stalker)).toBeGreaterThan(SEEDS * FLOORS * 2);
    expect(kills(floodlit)).toBeGreaterThan(SEEDS * FLOORS * 2);
    // The floodlit styles hold the light; the flashing styles buy it a command at a time and the
    // dark one never buys it at all.
    expect(litTurns(floodlit)).toBeGreaterThan(SEEDS * FLOORS * 20);
    expect(litTurns(stalker)).toBe(0);
    expect(flashes(stalker)).toBeGreaterThan(SEEDS * FLOORS * 3);
    expect(flashes(darkPacifist)).toBe(0);
  });

  it('accounts for the fuel exactly, so the numbers below are the simulation’s and not the harness’s', () => {
    // The instrument test. `demand` is reconstructed by the harness — it sums the burn rate over the
    // commands it issued — and on any floor where the lantern never hit 0 the simulation must have
    // burned precisely that. If the two disagree, every fuel figure in this file is the harness's
    // opinion rather than the game's.
    const solvent = [...floorsOf(stalker), ...floorsOf(pacifist), ...floorsOf(floodlit)].filter(
      (floor) => !floor.ranDry,
    );
    expect(solvent.length).toBeGreaterThan(20);
    for (const floor of solvent) expect(floor.demand).toBe(floor.spend);
    // And on a dry floor the lantern must have burned *less* than it was asked for — the clamp is
    // real, which is the other half of why `demand` is the measure used below.
    const broke = floorsOf(pacifist).filter((floor) => floor.ranDry && floor.demand !== floor.spend);
    expect(broke.length).toBeGreaterThan(0);
    for (const floor of broke) expect(floor.spend).toBeLessThan(floor.demand);
  });

  it('crosses a floor at something like the pace §5 predicts', () => {
    // §5: "~40-70 turns per floor". The anchor that says these scripts are a believable player at
    // all — without it, every fuel number below could be an artefact of a script that wanders for
    // 300 turns or teleports across the floor in 12. The band is widened at the top because the
    // stalker also hunts every creature on the floor, which §5's estimate does not assume.
    const turns = median(floorsOf(stalker).map((floor) => floor.turns));
    console.log(`stalker: ${turns} turns per floor (§5 predicts 40-70 for crossing one)`);
    expect(turns).toBeGreaterThan(35);
    expect(turns).toBeLessThan(110);
    // And it gets where it is going: a script that never found the stairs would make "per floor"
    // meaningless.
    const arrived = floorsOf(stalker).filter((floor) => floor.reachedStairs).length;
    expect(arrived).toBeGreaterThan(floorsOf(stalker).length * 0.9);
  });
});

describe('§4 invariant 1: avoiding all combat is unsustainable', () => {
  it('runs a pacifist dry, on every seed, well inside a run', () => {
    // The claim, at its strongest available form: not "a pacifist is worse off" but "a pacifist's
    // lantern empties", every time, on every seed.
    for (const result of pacifist) {
      expect(result.driedOnFloor).not.toBeNull();
      expect(result.driedOnFloor ?? 99).toBeLessThanOrEqual(3);
    }
  });

  it('runs even the cheapest possible pacifist dry', () => {
    // The floor under the whole economy. `DARK_PACIFIST` never opens the shutter at all, so it pays
    // the minimum the rules permit — 1 a turn. If *this* style could sustain itself, avoiding
    // combat would be a viable strategy and §4's first invariant would be decoration.
    //
    // MEASURED, #31/#41 (this PR): this style used to collect **119 of the 121 caches** in this
    // corpus — ~37 fuel a floor, and its entire income — because `collectFuelUnderfoot` paid on the
    // tile kind while §4 said caches are terrain the lantern has to have shown you. The rule is now
    // enforced, and its take is **0 of 121**. It survives 80 turns from a full reserve, which is
    // 80 fuel at 1 a turn and no income at all: the arithmetic of a style with nothing coming in.
    for (const result of darkPacifist) expect(result.driedOnFloor).not.toBeNull();
  });

  it('gives the dark none of the light’s income, which is the rule §4 spent a milestone unenforced', () => {
    // ═══ §4's cache rule, at the corpus tier (#31/#41, ruled 2026-08-01) ═══
    //
    // The unit suites pin the rule on one tile; this pins it on 80 played floors, which is where
    // "the dark walks over caches anyway, because it is crossing the floor to find the stairs"
    // was measured in the first place. It is the assertion the ruling was actually about.
    //
    // Stated as a **comparison between styles** rather than as an absolute, for the reason this
    // whole file gives: the claim is that light has a product darkness cannot buy (§4 invariant 4),
    // and that is a difference or it is nothing.
    const take = (results: RunResult[]): { taken: number; available: number } => {
      const floors = floorsOf(results);
      return {
        taken: floors.reduce((total, floor) => total + floor.cachesTaken, 0),
        available: floors.reduce((total, floor) => total + floor.cachesOnFloor, 0),
      };
    };
    const dark = take(darkPacifist);
    const flashing = take(stalker);
    console.log(
      `cache take — stalker ${flashing.taken}/${flashing.available}, ` +
        `dark pacifist ${dark.taken}/${dark.available} (was 121/121 and 119/121 before #31/#41)`,
    );

    // The corpus has caches in it at all. Without this, "the dark took none" is satisfied by a
    // generator that placed none, and every number above and below would be about an empty ruin.
    expect(dark.available).toBeGreaterThan(SEEDS * FLOORS);
    expect(dark.available).toBe(flashing.available); // same seeds, same floors, same caches

    // The dark takes **none**, and the flashing fighter takes nearly all of them. Not "fewer":
    // `DARK_PACIFIST` never opens the shutter, so no tile it stands on has ever been lit, and there
    // is no seed on which the rule can leak. A single leaked cache here is a rule with a hole.
    expect(dark.taken).toBe(0);
    expect(flashing.taken).toBeGreaterThan(flashing.available * 0.7);

    // And the whole of the dark style's *income* is gone with it, not merely reduced — a pacifist
    // has no kills either, so cache fuel was all of it.
    expect(floorsOf(darkPacifist).reduce((total, floor) => total + floor.income, 0)).toBe(0);
  });

  it('is combat that makes the difference, not the route', () => {
    // The controlled comparison: `STALKER` and `PACIFIST` share a light policy and an exploration
    // rule and differ in exactly one thing. If income from kills were negligible, these two would
    // net the same and this fails.
    const fighting = netPerFloor(stalker);
    const not = netPerFloor(pacifist);
    console.log(`net fuel per floor — stalker ${fighting}, pacifist ${not}`);
    expect(not).toBeLessThan(0);
    expect(fighting).toBeGreaterThan(not);
  });
});

describe('§4 invariant 2: keeping the shutter open is unsustainable, and faster', () => {
  it('empties a floodlit lantern sooner than a shuttered one doing the same thing', () => {
    // The controlled comparison for *light*: `FLOODLIT_PACIFIST` and `PACIFIST` fight the same
    // amount (never) and explore the same way; one holds the shutter open. Measured in turns
    // survived rather than floors, because turns are what the burn rate is charged against.
    //
    // ═══ THE INSTRUMENT UNDER THIS MOVED IN #31/#41, AND IT IS THE INSTRUMENT THAT MOVED ═══
    //
    // `driedAfterTurns` used to sum whole *floors* — its own docstring said so, and said to use it
    // for ordering only. That was tolerable while the styles dried on different floors. It stopped
    // being tolerable the moment the cache rule landed: every pacifist style now dries on floor 1,
    // so the number became the length of floor 1 and the ordering below inverted (163 flashing
    // against 117 dark) while measuring how far each style *wandered*, not how long it stayed
    // solvent. The field now records the turn fuel actually hit 0, which is what the sentence above
    // has always claimed it was, and the ordering is back: **26 floodlit, 65 flashing, 80 dark**.
    //
    // That is instrument calibration and not a threshold move (#105): the assertions are unchanged
    // and the quantity now matches its label. The dark pacifist's 80 is worth reading — 80 fuel at
    // 1 a turn, income zero — which is the cache rule's whole effect in one number.
    const held = median(floodlitPacifist.map(turnsToDry));
    const flashed = median(pacifist.map(turnsToDry));
    const never = median(darkPacifist.map(turnsToDry));
    console.log(`turns before the lantern dies — floodlit ${held}, flashing ${flashed}, dark ${never}`);

    expect(held).toBeLessThan(flashed);
    // ...and the ordering is monotone in how much light the style buys, which is the shape of the
    // rule rather than one comparison that could hold by accident.
    expect(flashed).toBeLessThan(never);
  });

  it('runs a floodlit fighter dry even though it kills everything', () => {
    // The sharp version. `FLOODLIT` takes the same kills and the same caches as `STALKER` — the
    // whole income side of the economy — and still cannot pay for the light. §4: "greed is the thing
    // that kills you."
    for (const result of floodlit) expect(result.driedOnFloor).not.toBeNull();
    expect(median(floodlit.map((result) => result.driedOnFloor ?? 99))).toBeLessThanOrEqual(2);
    expect(netPerFloor(floodlit)).toBeLessThan(netPerFloor(stalker));
  });
});

describe('§4 invariant 3: a floor played well nets slightly positive', () => {
  const net = netPerFloor(stalker);
  const ratios = floorsOf(stalker)
    .filter((floor) => floor.demand > 0)
    .map((floor) => floor.income / floor.demand);

  it('is positive', () => {
    // ═══ #105: WHAT #31/#41 DID TO THIS NUMBER, AND WHICH OF THE TWO FINDINGS IT WAS ═══
    //
    // #105 was filed before the cache rule was implemented, predicting that `STALKER` might lose
    // 5-10 of an 11-fuel margin here and take this assertion red on a PR behaving as designed. It
    // did not. Measured across this corpus, before and after:
    //
    //     cache take     121/121 (100%)  ->  114/121 (94%)
    //     cache income   37.8/floor      ->  35.6/floor
    //     median net     +8/floor        ->  +7/floor
    //
    // **`STALKER` barely moved, which is the ruling's own prediction and not its falsifier.** The
    // falsifier was a *collapse* in the flashing style's take, which would have meant the
    // intervention was mis-aimed and the real fault was §5's leaf-room bias. It flashes more than
    // three times a floor across ~6 rooms, so nearly every cache is still inside something it lit;
    // the 7 it loses are the ones on floors it crossed without ever lighting that room.
    //
    // Meanwhile a style that never opens the shutter went from 119/121 to **0**, which is the whole
    // point: `CACHE_FUEL` is now light's exclusive income and therefore an actual dial for §4's
    // invariant 4. **No game constant moved in this PR**, per the roadmap's build order — the
    // re-derivation of `CINDER.emberDrop` and `CACHE_FUEL` is a later step and would otherwise be
    // calibrated against the contaminated corpus this rule exists to clean.
    console.log(`stalker: net ${net} per floor, income/spend ${median(ratios).toFixed(2)}`);
    expect(net).toBeGreaterThan(0);
    expect(median(ratios)).toBeGreaterThan(1);
  });

  it('is *slightly* positive — the half that fails on a trivially winnable economy', () => {
    // The assertion that moved two numbers. At Cinder 30 / cache 40 this read +85 a floor against a
    // starting reserve of 80: one competent floor bought the next two, and the lantern stopped
    // mattering. Both bounds are relative — to the reserve, and to what the floor cost — so a future
    // retune of the burn rates does not silently invalidate them.
    expect(net).toBeLessThan(STARTING_FUEL / 3);
    expect(median(ratios)).toBeLessThan(1.4);
  });

  it('does not promise a competent player a positive floor, only a positive tendency', () => {
    // "Slightly" has to mean the margin is thin enough that a bad floor is a real loss. If every
    // floor were positive the player would never feel the wager, and the invariant above could be
    // satisfied by an economy that is merely small rather than tight.
    const losses = floorsOf(stalker).filter((floor) => floor.income < floor.demand).length;
    expect(losses).toBeGreaterThan(floorsOf(stalker).length / 10);
    // Nor is it a guarantee across a whole run: a competent player still runs dry sometimes.
    expect(stalker.some((result) => result.driedOnFloor !== null)).toBe(true);
  });

  it('leaves a competent run with a reserve that grew, not one that exploded', () => {
    // The run-level shape of "slightly": after eight floors the fuel is above where it started but
    // not by an order of magnitude. This is what a trivially winnable economy fails.
    const ends = stalker.map((result) => result.fuelAfter);
    console.log(`stalker: ${median(ends)} fuel after ${FLOORS} floors (started with ${STARTING_FUEL})`);
    expect(median(ends)).toBeGreaterThan(0);
    expect(median(ends)).toBeLessThan(STARTING_FUEL * 4);
  });
});

// --- §4's desperate state ------------------------------------------------------------------------

describe('fuel at 0 is a desperate state, not a loss state', () => {
  const dry = runs(DRY_CRAWL, 0);

  it('still gets the player to the stairs, from an empty lantern, on every floor', () => {
    // §4: "you can still crawl at radius 1 with ember-sense, and the stairs are still findable." A
    // run that becomes *unplayable* rather than desperate is the bug this is here to catch, and the
    // only honest way to check it is to play a whole run with nothing in the tank.
    const played = floorsOf(dry);
    const arrived = played.filter((floor) => floor.reachedStairs).length;
    console.log(`dry crawl: reached the stairs on ${arrived}/${played.length} floors`);
    expect(arrived).toBeGreaterThan(played.length * 0.9);
  });

  it('lets a dry player still find, fight and be paid by the living', () => {
    // The recovery path, end to end: at 0 fuel the player can still feel creatures (ember-sense is
    // the player's dark-adapted eyes, not the lamp), still kill them, and the ember still pays. If
    // any link in that chain were broken, 0 fuel would be a loss state wearing a different name.
    const played = floorsOf(dry);
    expect(played.reduce((total, floor) => total + floor.kills, 0)).toBeGreaterThan(SEEDS);
    expect(dry.filter((result) => result.fuelAfter > 0).length).toBeGreaterThan(SEEDS / 2);
  });

  it('will not light the lantern, however hard the player leans on the control', () => {
    // The rule itself, driven through a whole turn rather than through `open` alone: the shutter
    // stays shut, no fuel appears from nowhere, and the floor stays asleep.
    let state = createLanternWorld(generateFloor(createRng('dry-toggle'), 3).value, 'shuttered', 0);
    for (let press = 0; press < 10; press += 1) {
      state = { world: state.world, lantern: toggleShutter(state.lantern) };
      expect(state.lantern.vision.shutter).toBe('shuttered');
      expect(state.lantern.fuel).toBe(0);
    }
    expect(canOpen(state.lantern)).toBe(false);
  });

  it('gives a dry player their ember-sense back on the usual ramp', () => {
    // §4's dark column, permanently. A dry lantern is not a fifth vision state: touch still reaches
    // one tile, and the sense of the living still climbs +1 a turn back to five. If ember-sense were
    // powered by the lantern, a dry player could not find anything to kill and could not recover.
    const floor = generateFloor(createRng('dry-sense'), 5).value;
    const arrived = createLanternWorld(floor, 'shuttered', 0);
    // Mid-ramp, as if the player had just been plunged into the dark by the lantern dying.
    let state: LanternWorld = {
      world: arrived.world,
      lantern: {
        fuel: 0,
        vision: { ...arrived.lantern.vision, senseRadius: ADAPTATION_FLOOR },
      },
    };

    const radii: number[] = [state.lantern.vision.senseRadius];
    for (let step = 0; step < 5; step += 1) {
      state = wait(state);
      radii.push(state.lantern.vision.senseRadius);
    }
    expect(radii).toEqual([1, 2, 3, 4, 5, 5]);
    expect(state.lantern.vision.senseRadius).toBe(EMBER_SENSE_RADIUS);
    expect(state.lantern.fuel).toBe(0);

    // ...and that sense reports something: the creatures on the floor are felt, through walls.
    const felt = perceive(
      floor.grid,
      state.lantern.vision,
      playerOf(state.world).at,
      state.world.actors.filter((actor) => actor.kind === 'creature' && isAlive(actor)).map((a) => a.at),
    );
    expect(felt.creatures.every((sense) => sense.kind === 'felt')).toBe(true);
  });
});

/** One waiting turn, wired the way #18 must wire a command that costs a turn. */
function wait(state: LanternWorld): LanternWorld {
  return resolveTurn(
    state,
    lanternPhases('costsATurn', (current) => ({
      lantern: current.lantern,
      world: { ...current.world, schedule: chargeActor(current.world.schedule, PLAYER_ID) },
    })),
  );
}
