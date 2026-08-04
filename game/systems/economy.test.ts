import { describe, expect, it } from 'vitest';
import {
  DARK_PACIFIST,
  FLOODLIT,
  FLOODLIT_PACIFIST,
  HARVESTER,
  PACIFIST,
  playRun,
  STALKER,
  type FloorResult,
  type RunResult,
  type Style,
} from '@/tests/unit/support/lantern-run';
import { diveToTheBottom } from '@/tests/unit/support/run-script';
import { scenario } from '@/tests/unit/support/scenario';
import {
  CINDER,
  FUEL_BURN_SHUTTERED,
  LAST_FLOOR,
  PLAYER_ATTACK,
  PLAYER_MAX_HP,
  STARTING_FUEL,
} from '../content';
import { floorNumberOf, replay } from '../core';
import { creatureById, isAlive, PLAYER_ID, playerOf } from '../entities';
import { ADAPTATION_FLOOR, EMBER_SENSE_RADIUS, perceive } from '../fov';
import { generateFloor } from '../map';
import { createRng } from '../rng';
import { canOpen, createLantern } from './lantern';
import {
  createLanternWorld,
  lanternPhases,
  moveCommand,
  setShutterTurn,
  type LanternWorld,
} from './light';
import { beginRun, descendTurn } from './run';
import { resolveTurn } from './turn';
import { ACTION_COST, chargeActor } from './schedule';

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
const harvester = runs(HARVESTER);

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
    expect(kills(harvester)).toBeGreaterThan(SEEDS * FLOORS * 2);

    console.log(
      `light bought — floodlit ${litTurns(floodlit)} lit turns / ${flashes(floodlit)} flashes, ` +
        `stalker ${litTurns(stalker)} / ${flashes(stalker)}, harvester ${flashes(harvester)} flashes`,
    );
    // The floodlit styles hold the light for as long as they can pay for it; the flashing styles buy
    // it a command at a time and never hold it; the dark ones never buy it at all.
    //
    // ═══ THE FLOODLIT NUMBER FELL BY 84% UNDER #149, AND THAT IS THE RULE RATHER THAN A DEFECT ═══
    //
    // Measured, before and after §4's *The dark can take nothing*: `FLOODLIT` went from **2631** lit
    // turns to **413**, and from 339 re-opens to 26. It used to bank 20 a kill in the dark, which
    // bought it the fuel to re-open the shutter over and over; now a style whose kills land on
    // ground it can no longer light earns nothing, so **it holds the light until floor one empties
    // the lantern and then it is a dark fighter for the rest of the run**. That is the intended
    // shape — light is self-limiting when it is also the only income — and it is why the bound here
    // is *at least a lit turn a floor* rather than the twenty a floor the old economy paid for.
    // What the bound still catches is the thing that would make every light comparison below
    // vacuous: a `FLOODLIT` that never manages to open the shutter at all.
    expect(litTurns(floodlit)).toBeGreaterThan(SEEDS * FLOORS);
    expect(litTurns(stalker)).toBe(0);
    expect(flashes(stalker)).toBeGreaterThan(SEEDS * FLOORS * 3);
    expect(flashes(darkPacifist)).toBe(0);
    expect(flashes(harvester)).toBe(0);
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
    //
    // ── EXACTLY ZERO IS A FACT ABOUT THE HARNESS, NOT A CLAIM ABOUT THE GAME ────────────────────
    //
    // `arriveOn` builds every floor already shuttered and runs no lighting phase, so this style's
    // `revealed` plane is empty for the whole run *by construction*. A real run is not like that:
    // `beginRun` opens the lantern on arrival (§4), so floor 1's entrance room is lit before the
    // player touches anything. Measured over 200 generated floor 1s, that opening field covers
    // **65 of 305 caches (~21%)** — so a real never-flash player keeps roughly **0.2 caches a run**,
    // not none.
    //
    // The difference is small and it runs in the harmless direction — the rule is marginally
    // *looser* in play than this line reports, never stricter. But do not quote `toBe(0)` as a
    // statement about the game: the game's number is "almost none, and the exception is the room
    // you were standing in when the run began".
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

// --- §4's regression guard (#121, #123, enabled by #133) -----------------------------------------

describe('§4’s regression guard: no run banks ember from a creature it woke for nothing', () => {
  /**
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   * THE GUARD #123 WAS ASKED FOR, THE INSTRUMENT IT NEEDED, WHAT THE INSTRUMENT FOUND, AND THE
   * RULE THAT CLOSED IT
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   *
   * §4 keeps a **regression guard**: *"No run may bank ember from a creature it woke without paying
   * HP for it."* It is a guard rather than a watch because §4 believes it is zero by arithmetic — 5
   * HP against 3 damage is two strikes, and by #121's proof the player is adjacent at their own
   * decision point only once the creature has already declared on their tile, so the first strike
   * always eats 2.
   *
   * **#123 built the instrumentation** (`WokenKill` / `WakeLedger` in
   * `tests/unit/support/lantern-run.ts`) **and the guard came back red**: 56 of `STALKER`'s 386
   * woken kills and 22 of `FLOODLIT`'s 247 cost the player nothing. The cause was **#125**, and it
   * was a scheduling invariant rather than a fact about flashes:
   *
   * > `setMind` scheduled a woken creature at `now + ACTION_COST`. Its first action therefore
   * > resolved on the first command whose `now` had reached that instant — and whether that was the
   * > next command or the one after depended on whether the waking command's phase 4 swept past
   * > `now`. A **free action** (`actorPhase('free')` is `identity`) and **`beginRun`** (phase 3
   * > alone) do not sweep, so the player got two phase-1 actions before the creature resolved
   * > anything. Two actions is two strikes and two strikes is exactly a 5 HP Cinder.
   *
   * **Ruled and built 2026-08-03 — #125/#133, ADR-0014, GDD §4 *The grace turn is deleted*.** A
   * creature woken in phase 3 joins the schedule at the instant **the player is next due to act**,
   * which is `now + ACTION_COST` on a paid command and `now` on one the player was not charged for.
   * The observable form: **exactly one paid command stands between a wake and the creature's first
   * resolution — never two, never zero.**
   *
   * ## What this block was, and why its shape is worth keeping
   *
   * Until #133 this was a **characterisation** block asserting the defect was present, in three
   * tests that had to go red **together**: the corpus assertion and two hand-built reproductions.
   * They did (measured: 9 of 1167 red across four files, all enumerated in §4). The corpus went from
   * **56 of 386** free woken kills to **0 of 387**, and both reproductions from 12/12 HP to
   * **10/12** — §3's 2 HP, on both routes.
   *
   * The two reproductions survive **inverted**, as positive reproductions of the closed rule, and
   * that is deliberate. A guard over a corpus is only as good as what the corpus can reach, and
   * **`arriveOn` in `lantern-run.ts` starts every floor shuttered and never calls `beginRun`** — so
   * the corpus below sees the free-action route and is structurally blind to the run start. Under
   * the *old* rule that blindness was the trap: #125's opening proposal — *schedule a creature woken
   * by a free action at `now`* — turned the corpus assertion and the flash reproduction red and left
   * the `beginRun` one **passing**, which would have enabled the one-line guard over a corpus that
   * could not see the route still open. **A route the corpus cannot reach needs a reproduction, not
   * a statistic.** Both are kept for that reason, and so is the descent negative control, which is
   * the boundary of the claim.
   *
   * ## What the attribution can and cannot see
   *
   * `hpSpentWhileAwake` over-credits when two hunters overlap — §2 has a creature mark a *tile* and
   * two adjacent creatures mark the same one, so nothing in the state says which of them swung. The
   * error runs one way: a free kill in a crowd reports a cost it did not incur. That made the old
   * 56 a **lower bound**, and it means the guard below is the **weaker** of the two directions — it
   * can be fooled by a crowd but not by a lone creature, which is the shape #125 had. The
   * reproductions pin the lone case exactly.
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   */
  const wokenKills = (results: RunResult[]) =>
    floorsOf(results).flatMap((floor) => [...floor.wokenKills]);

  it('is measuring a corpus that actually wakes things and then kills them', () => {
    // The positive control, and it comes first because everything below is satisfied by a corpus in
    // which no creature is ever both woken and killed — which is precisely what the pre-#123 rules
    // produced, since a creature that was woken and then outwaited died **dormant** and would not
    // appear in this list at all.
    const woken = wokenKills(stalker);
    const onSleepers = floorsOf(stalker).reduce(
      (total, floor) => total + floor.kills - floor.wokenKills.length,
      0,
    );
    console.log(
      `stalker kills — ${woken.length} on creatures it woke, ${onSleepers} on sleepers it never ` +
        `lit; HP per woken kill: median ${median(woken.map((kill) => kill.hpSpentWhileAwake))}, ` +
        `free ${woken.filter((kill) => kill.hpSpentWhileAwake === 0).length}`,
    );
    expect(woken.length).toBeGreaterThan(SEEDS * FLOORS); // more than one a floor
    // ...and the split is real: a flashing fighter still gets free kills on what it never lit, which
    // is §4's "the dormant strike is the reward for never having lit it". If this were 0, a reopened
    // free-kill route on a *woken* creature would be indistinguishable from ordinary dark play.
    expect(onSleepers).toBeGreaterThan(0);
    // The rule the whole of #123 is about, at the corpus tier: **nothing goes back to sleep**, so a
    // creature that was ever awake and then died is a creature that died awake. Before #123 the
    // dominant free kill was exactly the other thing — outwait it, then strike the sleeper — and
    // those kills would land in `onSleepers` rather than in `woken`.
    expect(woken.length).toBeGreaterThan(onSleepers * 5);
  });

  it('charges HP for every woken kill in the corpus — §4’s guard, enabled by #133', () => {
    // ═══ §4's REGRESSION GUARD, AND IT IS ONE LINE ON PURPOSE ═══
    //
    // *"No run may bank ember from a creature it woke without paying HP for it."* This is the whole
    // of it. It replaced a 40-line characterisation block that asserted the **opposite** — that at
    // least one free woken kill existed — which is what #125 was, and which #133 closed.
    //
    // **This is a guard, not a watch.** §4's own rule: name the state of the world in which the
    // number comes back different. That state is a *rules* change — a re-tune that lets the player
    // one-shot an awake Cinder (`PLAYER_ATTACK` >= `CINDER.maxHp`), or a scheduling change that
    // hands a woken creature back the grace command. It is not a number to read for a trend, and
    // the console line is here to say *how much* HP a wake costs rather than whether it costs any.
    for (const [name, results] of [
      ['stalker', stalker],
      ['floodlit', floodlit],
    ] as const) {
      const woken = wokenKills(results);
      const free = woken.filter((kill) => kill.hpSpentWhileAwake === 0);
      console.log(
        `${name}: ${free.length}/${woken.length} woken kills cost 0 HP (§4's guard: must be 0); ` +
          `HP per woken kill: median ${median(woken.map((kill) => kill.hpSpentWhileAwake))}`,
      );

      for (const kill of woken) {
        expect(
          kill.hpSpentWhileAwake,
          `${name}: creature ${kill.id} was woken, killed and banked for 0 HP (§4, #125)`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('makes a flash-woken kill cost §3’s 2 HP, which is the half the corpus above measures', () => {
    // The corpus statistic with its mechanism attached: the whole route in three commands.
    //
    // Shuttered, standing next to a sleeper. The flash is **free** (§2), so phase 4 is `identity`
    // and `now` does not move — and **that is exactly why the creature is due at `now` and not at
    // `now + ACTION_COST`**: the player was not charged, so the player is still due at `now`, so the
    // creature is too. It therefore acts in phase 4 of the first paid command, *between* the two
    // strikes, and the kill costs §3's 2 HP like any other.
    //
    // This test used to assert the opposite (12/12 HP, `reproduces #125 from a flash`) and is
    // inverted rather than deleted: the route is the same three commands, and what changed is the
    // price.
    const built = scenario(['#####', '#@c.#', '#####']);
    let state: LanternWorld = {
      world: built.world,
      lantern: createLantern(built.world.floor.grid, 'shuttered', STARTING_FUEL),
    };
    const strike = (): LanternWorld =>
      resolveTurn(state, lanternPhases('costsATurn', moveCommand(built.at('c'))));

    state = setShutterTurn(state, 'open');
    const declared = creatureById(state.world, built.ids[0]).mind;
    expect(declared).toEqual({ kind: 'awake', intent: { kind: 'attack', at: built.at('@') } });
    // The tell, and the whole of the ruling in two assertions: the clock has not moved, and the
    // creature it just woke is due at the same instant the player is — `now` — rather than at an
    // instant the next command would step straight over.
    expect(state.world.schedule.now).toBe(0);
    expect(state.world.schedule.entries).toEqual([
      { actorId: PLAYER_ID, nextActAt: 0 },
      { actorId: built.ids[0], nextActAt: 0 },
    ]);

    // First strike, and the creature's one action lands in the same command's phase 4 — after the
    // player's, which is what "never zero" means: it could not resolve inside the *free* command
    // that woke it, and exactly one paid command separates the wake from this.
    state = strike();
    expect(creatureById(state.world, built.ids[0]).hp).toBe(CINDER.maxHp - PLAYER_ATTACK);
    expect(playerOf(state.world).hp).toBe(PLAYER_MAX_HP - CINDER.attack);

    state = strike();
    expect(state.world.actors.some((actor) => actor.id === built.ids[0])).toBe(false);
    // ...and the ember is paid for in the currency §4 prices a wake in: 2 HP, not 0.
    expect(playerOf(state.world).hp).toBe(PLAYER_MAX_HP - CINDER.attack);
    expect(state.world.embers).toEqual([{ at: built.at('c'), amount: CINDER.emberDrop }]);
  });

  it('makes a beginRun-woken kill cost the same 2 HP, with no free action anywhere', () => {
    // ═══ THE REPRODUCTION THAT STOPPED #125 BEING FIXED WRONG, KEPT AS THE ONE THAT PROVES IT WAS
    //     FIXED RIGHT ═══
    //
    // The route above needs a flash. **This one does not touch the shutter at all.** `beginRun`
    // runs §2 phase 3 and *only* phase 3, to put the entrance room on screen before the first
    // command — so it wakes whatever the opening light reaches at `now = 0` and never runs a phase 4
    // to advance the clock. No free action anywhere, and it is a property of **every run start** —
    // about **one in nine** of them, 11.2% over 2000 seeds (#127; **not** one in five, which is a
    // rate over floors 1-8, and a run start is always floor 1).
    //
    // **`arriveOn` in `tests/unit/support/lantern-run.ts` starts every floor shuttered and never
    // calls `beginRun`, so the corpus above cannot reach this route at all.** That is why it is
    // pinned by hand and why the guard is not enough on its own: #125's opening proposal — *schedule
    // a creature woken by a free action at `now`* — turned the corpus assertion and the flash
    // reproduction red and left this one **green**, i.e. it would have enabled a one-line guard over
    // a corpus blind to the route still open. The rule that shipped is stated over the schedule
    // instead: a woken creature is due when the **player** is due, which asks nothing about which
    // command woke it.
    //
    // **One in nine is the frequency of the old *grace*, not of a free kill.** The floor below is
    // hand-built at Manhattan **2**; §5 step 7 keeps a *generated* opening at Manhattan 3 or more,
    // where the window was worth 0 HP to no line of play. What the ruling took at a real run start
    // is a **command** of approach, not 2 HP. Do not quote this block as "one run start in nine was
    // a free kill".
    const built = scenario(['######', '#@.c.#', '######']);
    let state: LanternWorld = beginRun(built.world.floor);
    const woken = creatureById(state.world, built.ids[0]);

    // Phase 3 ran and nothing else: the creature is awake and declaring, the clock is untouched, and
    // the player is still due at the instant the run began on — so the creature is due there too.
    expect(woken.mind).toEqual({ kind: 'awake', intent: { kind: 'move', to: { x: 2, y: 1 } } });
    expect(state.world.schedule.now).toBe(0);
    expect(state.world.schedule.entries).toEqual([
      { actorId: PLAYER_ID, nextActAt: 0 },
      { actorId: built.ids[0], nextActAt: 0 },
    ]);

    const command = (to: { x: number; y: number }): LanternWorld =>
      resolveTurn(state, lanternPhases('costsATurn', moveCommand(to)));

    // Command 1 — step toward it, onto the very tile it declared a move to. It *is* due, so phase 4
    // gives it its action, and the action is the move it declared at `beginRun`: blocked by the
    // player now standing there, and spent. **Baiting survives the ruling** — a stale declaration is
    // still wasted on a tile the player has left or taken, which is §2's whole defensive move.
    state = command({ x: 2, y: 1 });
    expect(playerOf(state.world).at).toEqual({ x: 2, y: 1 });
    expect(creatureById(state.world, built.ids[0]).at).toEqual({ x: 3, y: 1 });
    expect(playerOf(state.world).hp).toBe(PLAYER_MAX_HP);

    // Command 2 — first strike, and the attack it declared after that wasted move now resolves on
    // the tile the player is standing on. This is the 2 HP the run start used to hand back.
    state = command({ x: 3, y: 1 });
    expect(creatureById(state.world, built.ids[0]).hp).toBe(CINDER.maxHp - PLAYER_ATTACK);
    expect(creatureById(state.world, built.ids[0]).at).toEqual({ x: 3, y: 1 });
    expect(playerOf(state.world).hp).toBe(PLAYER_MAX_HP - CINDER.attack);

    // Command 3 — second strike, in phase 1, before the attack it has now declared can resolve. The
    // kill still takes three commands; what it no longer takes is zero HP.
    state = command({ x: 3, y: 1 });
    expect(state.world.actors.some((actor) => actor.id === built.ids[0])).toBe(false);
    expect(playerOf(state.world).hp).toBe(PLAYER_MAX_HP - CINDER.attack);
    expect(state.world.embers).toEqual([{ at: { x: 3, y: 1 }, amount: CINDER.emberDrop }]);
  });

  it('does not open the window on a descent, which is the boundary of the claim', () => {
    // The negative control, and it stops #125 being restated as "arriving wakes things for free".
    // `arriveOnFloor` **charges the player** (§13 pays the descent's turn below), and `descendTurn`
    // runs the whole phase list — so phase 4 *does* sweep, the clock advances with the wake, and the
    // creature is due on the very next command exactly as §2 promises. A descent that woke something
    // hands the player one command, not two.
    //
    // Without this, the invariant above reads as "any arrival", which is both wrong and the kind of
    // overstatement that gets a real defect dismissed.
    const first = scenario(['######', '#@...#', '######']);
    const next = scenario(['######', '#@.c.#', '######']);
    const arrived = descendTurn(beginRun(first.world.floor), next.world.floor);

    const creature = creatureById(arrived.world, next.ids[0]);
    expect(creature.mind.kind).toBe('awake'); // the arriving light woke it
    // The tell, and the whole difference from `beginRun` above: the clock has already moved to the
    // instant the creature is due at, so it acts in phase 4 of the next command rather than the one
    // after.
    expect(arrived.world.schedule.now).toBe(ACTION_COST);
    expect(arrived.world.schedule.entries).toEqual([
      { actorId: PLAYER_ID, nextActAt: ACTION_COST },
      { actorId: next.ids[0], nextActAt: ACTION_COST },
    ]);
  });
});

// --- ADR-0015's clear criteria (§4, *The dark can take nothing*; #144/#149, judged by #145) -------

describe('ADR-0015 clear-1: a style that never opens the shutter does not out-earn one that flashes', () => {
  /**
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   * THE ASSERTION §4'S INVARIANT 4 HAS NEVER HAD, AND WHY THIS BLOCK REPLACED THE ONE BEFORE IT
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   *
   * §4 invariant 4: *"at comparable combat, a style that never opens the shutter must not out-earn
   * one that flashes."* **The scoping clause is load-bearing** — stated unscoped it contradicts
   * invariant 2, which asserts the opposite ordering between *pacifist* styles and is pinned two
   * blocks up. It is compatible only between styles that fight comparably, which is exactly what
   * `HARVESTER` against `STALKER` measures: the two differ in their light policy and in nothing
   * else, and both clear **every creature on every floor** (420 kills each, over this corpus).
   *
   * **This block stands where `fuel at 0 is a desperate state, not a loss state` stood.** That was
   * four tests describing a rule that has been deleted, built on `runs(DRY_CRAWL, 0)` — a run that
   * starts at 0 fuel, which is now a run that cannot exist. It was not repaired; the style was
   * re-pointed at a full lantern, where it is the never-flash **fighter** invariant 4 is about. The
   * one assertion in it that outlived the rule — *ember-sense does not shrink with the fuel* — is
   * kept below, at a low fuel rather than at none.
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   */
  it('is comparing two styles that fight the same amount, which is the invariant’s own scope', () => {
    // The positive control, and it comes first because the assertion below is meaningless without
    // it: an unscoped invariant 4 is satisfied by a never-flash style that simply fights less.
    const kills = (results: RunResult[]): number =>
      floorsOf(results).reduce((total, floor) => total + floor.kills, 0);
    expect(kills(harvester)).toBe(kills(stalker));
    expect(kills(harvester)).toBeGreaterThan(SEEDS * FLOORS * 4);
    // ...and they are genuinely different styles: one buys light, the other never does.
    expect(floorsOf(harvester).reduce((total, floor) => total + floor.flashes, 0)).toBe(0);
    expect(floorsOf(stalker).reduce((total, floor) => total + floor.flashes, 0)).toBeGreaterThan(0);
  });

  it('leaves the never-flash fighter with no income at all', () => {
    // The mechanism, stated as the sharpest thing that is true. Under *The dark can take nothing* a
    // style that never lights a tile banks **nothing**: not the caches (§4's rule since #31/#41) and
    // now not the drops either, because every creature it kills dies on ground it never lit.
    //
    // Exactly zero rather than "less", for the reason `DARK_PACIFIST`'s zero is exact and with the
    // same caveat: `arriveOn` starts every floor shuttered and never calls `beginRun`, so the
    // `revealed` plane is empty by construction. A real run keeps floor 1's entrance room, which is
    // worth about 0.2 caches a run — the rule is marginally *looser* in play than this line reports,
    // never stricter.
    const income = floorsOf(harvester).reduce((total, floor) => total + floor.income, 0);
    const kills = floorsOf(harvester).reduce((total, floor) => total + floor.kills, 0);
    console.log(`harvester: ${kills} kills, ${income} fuel of income, 0 flashes`);
    expect(kills).toBeGreaterThan(0); // it really is killing things...
    expect(income).toBe(0); // ...and being paid for none of them
  });

  it('does not out-earn the flashing fighter — ADR-0015 clear-1, asserted', () => {
    // ═══ THE CRITERION, IN ONE COMPARISON ═══
    //
    // Measured over this corpus, at `4a59a04` and at this commit. Both columns are this file's own
    // seeds (`econ-0`..`econ-9`), `FLOORS` 8, and `netPerFloor`'s median-of-`income - demand`:
    //
    //                            STALKER              HARVESTER
    //     net fuel per floor      +6  ->    +2          0  ->  -105
    //     cache take         117/121  ->  110/121       0  ->     0
    //     income               11325  ->  10510      8400  ->     0
    //     ran dry             on 4 of 10 seeds, both   on 9 of 10  ->  10 of 10
    //     first dry floor     unchanged: 2-4          2-4  ->  floor 1
    //
    // **The never-flash fighter was not out-earning anything; it was breaking even and running dry
    // on nine seeds in ten — and that did not matter, because 0 fuel was survivable.** It ended
    // those runs with 42-130 fuel, having dried on floor 2-4 and refilled off the next kill. So the
    // dark line was never *solvent*; it was **unpunished**. Clause 1 takes the income to zero and
    // clause 2 takes the impunity, which is why the two are one ruling and not two.
    //
    // *An earlier version of this comment read `+30 -> -117` and called `HARVESTER` "the dominant
    // line". **Neither number was measured**, and the account of *where they came from* was itself
    // wrong on the second pass — recorded rather than quietly replaced, because a fabricated
    // before-number is the exact failure this block exists to supply the cure for.*
    //
    // *`STALKER`'s old after-row (`+9 / 10450 / 82-121`) does reproduce, exactly and three-for-three,
    // at one intermediate: the kill-based income counter **and** no drop-flash clause. So that half
    // was a mid-work snapshot. **`HARVESTER`'s `-117` reproduces nowhere** — and it cannot have come
    // from the clause the first correction blamed: that clause lives inside `chooseShutter`'s
    // `case 'flash'`, and **`HARVESTER` is `light: 'never'`, so it never reaches that arm**. (Not
    // that no edit to `chooseShutter` could move it — `case 'never'` is in there too.)
    // Saying so is the standard this block imposes on everyone else: name the build a number came
    // from, or say plainly that you could not find one.*
    //
    // `STALKER` is barely moved on every axis — same 420 kills, 878 -> 836 flashes, income −7.2%
    // against demand −1% — which is the ruling's own prediction and **not** its third Watch firing.
    // That Watch fires on `STALKER` *collapsing* while `HARVESTER` holds; here `HARVESTER` fell 105
    // fuel a floor and `STALKER` fell 4.
    const flashing = netPerFloor(stalker);
    const never = netPerFloor(harvester);
    console.log(`net fuel per floor — stalker ${flashing}, harvester ${never} (§4 invariant 4)`);
    expect(never).toBeLessThan(flashing);
    // ...and the gap is not a rounding artefact of two styles that both break even.
    expect(never).toBeLessThan(0);
    expect(flashing).toBeGreaterThan(0);
  });

  it('runs the never-flash fighter dry on the first floor of every seed', () => {
    // The other face of the same number, and the one that says invariant 4 is satisfied on the
    // *income* side rather than by a threshold: a style with no income has 80 fuel and a floor to
    // cross, so it empties.
    //
    // **The interesting half is `<= 1`, not `not.toBeNull()`.** Before #149 this style already dried
    // on 9 of 10 seeds — on floors **2-4** — and went on to finish all eight with 42-130 fuel,
    // because a kill refilled it and 0 was survivable. So "it runs dry" was true before the ruling
    // and says nothing. What the ruling changed is *when* and *whether it comes back*: floor **1**,
    // on 10 of 10, and the reserve never rises again, because there is nothing left that pays it.
    for (const result of harvester) {
      expect(result.driedOnFloor).not.toBeNull();
      expect(result.driedOnFloor ?? 99).toBe(1);
    }
    // ...and it stays dry. A style whose income is exactly 0 cannot recover, which is the half the
    // floor number alone does not say.
    for (const result of harvester) expect(result.fuelAfter).toBe(0);
  });
});

describe('ADR-0015 clear-2: a line that never opens the shutter dies', () => {
  /**
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   * THE ONE CRITERION THIS CORPUS CANNOT MEASURE, AND WHY IT IS ASSERTED THROUGH `step()` INSTEAD
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   *
   * > **clear-2:** *over a zero-strategy bot sweep of at least 9 seeds, the never-flash line must not
   * > reach floor 8 on every seed at full HP.* **This is the single number the whole rebuild is
   * > against.**
   *
   * **The before-number is this block's own, taken on these nine seeds at `4a59a04`:** all nine
   * reached floor 8 at **12/12 HP**, in 128-167 turns, seven of them arriving at exactly 0 fuel. So
   * the criterion was red by the widest possible margin, and the *manner* of it is the ruling's whole
   * case — the line ran the reserve to nothing and then kept walking, for dozens of turns, because
   * nothing happened when it did. (ADR-0015 and #149 quote **824 turns at 12/12** for this criterion.
   * That is #108's hand-played *wandering* autoplay and not this script; the two are different bots
   * and the numbers must not be pooled. The *9 of 9* is this suite's own sweep, **not** #108's — its
   * autoplay is a single run. What the two agree on is only the shape: a never-flash line finished,
   * at full HP, with the reserve run to nothing.)
   *
   * The corpus above is **structurally blind to it**, twice over: `lantern-run.ts` takes liberty 1
   * (the player is immortal, so the fuel economy rather than survival is what it measures) and it
   * never calls `step()` at all, so `statusAfterTurn` — where the fuel ending lives — is not in its
   * path. A route the corpus cannot reach needs a reproduction, not a statistic; that is the same
   * argument #133 made about `beginRun`, and it applies here for a stronger reason, because the thing
   * being asserted is *the run ending*.
   *
   * So the instrument is `diveToTheBottom`, which drives the real `step()` with real `Command`s and
   * **is** the zero-strategy line the criterion names: it shutters on command 1, never opens again,
   * never hunts, and walks to the stairs. Note the distinction the criterion turns on — a bot that
   * *fights* in the dark is `HARVESTER` and is clear-1's, above. Neither number may be borrowed for
   * the other.
   *
   * ## Read the **turn**, not the floor: the floor number here is not what a player will see
   *
   * Measured over this sweep, every seed dies on **turn 79** with `fuelBurned` 80 and **`gathered`
   * 0** — 80 fuel at 1 a turn, and nothing at all coming in. That number is the criterion; it is a
   * property of the *rules* and it is the same for anyone who never opens the shutter.
   *
   * **The floors those 79 turns buy are a property of the script and nothing else.** This one takes
   * the header's routing liberty — it reads `world.floor.stairs` and beelines over the real grid, so
   * it crosses a floor in ~15 turns and dies on floor **4-6**. A human mapping the same floors by
   * touch at radius 1 covers far less ground per turn: the #145 playtest, hand-played, died on the
   * same **turn 79** on floor **2 of 8**, at 12/12 HP with 2 kills and `gathered` 0.
   *
   * So do not quote "floors 4-6" as what the dark line experiences — the honest statement is *79
   * turns and two floors*, and the playtest's caveat travels with it: **it dies, which is the point,
   * but floor 2 of 8 in 79 turns is not "a run"**, and a player who has not yet worked out the claim
   * rule will play close to that line by accident. That is #154's territory, not this file's.
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   */
  const SWEEP = ['dark-1', 'dark-2', 'dark-3', 'dark-4', 'dark-5', 'dark-6', 'dark-7', 'dark-8', 'dark-9'];

  it('does not reach floor 8 on any seed — let alone on every one', () => {
    const ends = SWEEP.map((seed) => replay(diveToTheBottom(seed)));
    console.log(
      `never-flash sweep — ${ends.filter((end) => end.status.kind === 'died').length}/${SWEEP.length} ` +
        `dead on turn ${ends.map((end) => end.turnsElapsed).join(',')}; ` +
        `floors reached ${ends.map(floorNumberOf).join(',')} (a router's, not a player's — see above)`,
    );

    // The criterion, stated as it is written: not every seed reaches floor 8 at full HP.
    expect(ends.every((end) => floorNumberOf(end) === LAST_FLOOR)).toBe(false);
    // ...and the true state of the world is much stronger, so it is asserted rather than implied.
    for (const end of ends) {
      expect(end.status).toEqual({ kind: 'died' });
      expect(floorNumberOf(end)).toBeLessThan(LAST_FLOOR);
    }
  });

  it('dies of the dark rather than of anything on the floor, which is proposition (a)', () => {
    // ADR-0015's (a): *you must be able to die of the dark.* The distinction matters — §4 says
    // nothing wakes in the dark and a pursuer cannot hit a moving player, so **there is nothing in a
    // shuttered floor for a moving player to die of except the dark itself**. Full HP at the end is
    // therefore not incidental: it is the proposition.
    for (const seed of SWEEP) {
      const end = replay(diveToTheBottom(seed));
      // **The ending, first.** Without it this test passes unchanged under a build that deleted the
      // `isDry` line from `statusAfterTurn` — a never-flash line still ends at 0 fuel and full HP,
      // it just does not *stop*. The two readings below are what the death was **of**; this is that
      // there was one.
      expect(end.status).toEqual({ kind: 'died' });
      expect(end.lantern.fuel).toBe(0);
      expect(playerOf(end.world).hp).toBe(PLAYER_MAX_HP);
    }
  });
});

// --- what survives the ruling ---------------------------------------------------------------------

describe('§4: ember-sense is the player’s dark-adapted eyes, not the lamp', () => {
  it('gives a nearly-dry player their ember-sense back on the usual ramp', () => {
    // §4's dark column. A guttering lantern is not a fifth vision state: touch still reaches one
    // tile, and the sense of the living still climbs +1 a turn back to five. If ember-sense were
    // powered by the lantern, the last turns of every run would be a state in which the player can
    // neither see a destination nor reach one — the "unplayable rather than desperate" failure §4 has
    // guarded against from the beginning, and the reason the fuel ending had to be *short* rather
    // than survivable.
    //
    // **Run at a low fuel rather than at none** (#149): the rule is untouched by *The dark can take
    // nothing*, but its old demonstration — a whole run played at 0 — is a run that cannot exist.
    const floor = generateFloor(createRng('dry-sense'), 5).value;
    const LOW_FUEL = 6; // six shuttered turns left: enough to walk the ramp and one to spare
    const arrived = createLanternWorld(floor, 'shuttered', LOW_FUEL);
    // Mid-ramp, as if the player had just been plunged into the dark by the shutter closing.
    let state: LanternWorld = {
      world: arrived.world,
      lantern: {
        fuel: LOW_FUEL,
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
    // The radius did not track the reserve: five turns of fuel went and the sense went the other way.
    expect(state.lantern.fuel).toBe(LOW_FUEL - 5 * FUEL_BURN_SHUTTERED);
    expect(canOpen(state.lantern)).toBe(true);

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
