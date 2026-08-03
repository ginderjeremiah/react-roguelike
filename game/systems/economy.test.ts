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
import { scenario } from '@/tests/unit/support/scenario';
import { CINDER, PLAYER_ATTACK, PLAYER_MAX_HP, STARTING_FUEL } from '../content';
import { creatureById, isAlive, PLAYER_ID, playerOf } from '../entities';
import { ADAPTATION_FLOOR, EMBER_SENSE_RADIUS, perceive } from '../fov';
import { generateFloor } from '../map';
import { createRng } from '../rng';
import { canOpen, createLantern, toggleShutter } from './lantern';
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

// --- §4's regression guard (#121, #123) ----------------------------------------------------------

describe('§4’s regression guard cannot be enabled yet, and this is the size of the gap (#125)', () => {
  /**
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   * THE GUARD #123 WAS ASKED FOR, THE INSTRUMENT IT NEEDED, AND WHAT THE INSTRUMENT FOUND
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   *
   * **Status, 2026-08-03: #125 is *ruled* and closed (PR #134, ADR-0014, GDD §4 *The grace turn is
   * deleted*) and nothing in `game/` moved with it. The build is #133** — it deletes this block and
   * enables §4's guard, and its acceptance criteria are copied from §4's *What a build owes*. So
   * "whoever fixes #125" below means #133; the rule is settled and is not to be re-litigated here.
   *
   * §4 keeps a **regression guard**: *"No run may bank ember from a creature it woke without paying
   * HP for it."* It is labelled a guard rather than a watch because §4 believes it is zero by
   * arithmetic — 5 HP against 3 damage is two strikes, and by #121's proof the player is adjacent at
   * their own decision point only once the creature has already declared on their tile, so the first
   * strike always eats 2. §4 and the roadmap both say the guard must not be listed as an acceptance
   * criterion unless the per-creature instrumentation behind it is built.
   *
   * **#123 built the instrumentation** (`WokenKill` / `WakeLedger` in
   * `tests/unit/support/lantern-run.ts`) **and the guard came back red.** Measured here: 56 of
   * `STALKER`'s 386 woken kills and 22 of `FLOODLIT`'s 247 cost the player **nothing**.
   *
   * ## The mechanism is **#125**, and it is a scheduling invariant, not a fact about flashes
   *
   * It is not a #123 regression — it predates #123 and #83 alike. **State it as the invariant,
   * because the narrower statement points at a fix that does not close it:**
   *
   * > `wakeInLight` schedules a woken creature at `now + ACTION_COST`. A creature's first action
   * > therefore resolves on the first command whose `now` has reached that instant — and **whether
   * > that is the next command or the one after depends on whether the waking command's phase 4
   * > swept past `now`.**
   *
   * On an ordinary paid command it does: phase 4 finds nothing due, advances the clock to
   * `now + ACTION_COST`, and the creature is due on the very next command. That is §2's "declares
   * this turn, acts next turn". **Two commands do not sweep, and they are different in kind:**
   *
   *   - a **free action** (`actorPhase('free')` is `identity`, so phase 4 never runs); and
   *   - **`beginRun`**, which runs *phase 3 only* to light the entrance room — no free action
   *     anywhere, and the shutter never touched.
   *
   * In both, `now` is left behind, the next command spends its own phase 4 doing the advance, and
   * the creature is due only on the one after that. The player gets **two** phase-1 actions instead
   * of one before the creature resolves anything — and two actions is two strikes, and two strikes
   * is exactly a 5 HP Cinder against a 3 damage player. `light.ts` has recorded the free-action half
   * since M1 (*"a creature woken during a free action sees two player commands before its declared
   * action resolves"*) and nobody multiplied it by §3's damage.
   *
   * **What the extra command buys is one of two things, and both are pinned below.** Either the
   * creature's single action falls outside the interval between the two strikes entirely (the flash
   * case), or it falls inside but is spent resolving a *stale* declaration — one made at wake time,
   * before the player's last move — which is a move rather than an attack on the tile the player is
   * now standing on (the `beginRun` case). A woken kill costs HP only when a creature resolves an
   * **attack on the player's tile** between the two strikes; the window removes that in both shapes.
   *
   * **So #125's option 1 — "schedule a creature woken by a *free action* at `now`" — does not close
   * this.** `beginRun` has no free action in it. Whoever fixes #125 against the narrow statement will
   * delete this block, enable §4's one-line guard, and find it still red.
   *
   * ## What this corpus cannot see — the mechanism, not more HP
   *
   * **`arriveOn` in `tests/unit/support/lantern-run.ts` starts every floor shuttered and never calls
   * `beginRun`.** So every number below is the **free-action half only**. The `beginRun` route is
   * structurally invisible to this corpus and is pinned instead by the hand-built reproduction at the
   * bottom of this block.
   *
   * **What that blindness is worth was measured by #134's ruling, and it is the opposite of what this
   * comment said for two milestones.** It read: *"do not read 14.5% as the size of #125 — read it as
   * the size of the part a harness that never starts a real run can measure"*, i.e. a **floor** under
   * a larger unknown. That is now false. `generateFloor` skips any spawn within
   * `CREATURE_ENTRANCE_EXCLUSION` (2) of the entrance — `game/map/generate.ts`, pinned for every seed
   * at every depth by `generate.test.ts` — so **every generated opening wake is at Manhattan >= 3**,
   * and GDD §4's distance table (re-measured as the minimum over every legal line of play) puts the
   * window at **2 HP** from Manhattan 3 outward. Teaching `arriveOn` to call `beginRun` would add
   * woken kills that **all cost 2 HP**, which moves the free fraction *down*.
   *
   * **The reversal does not depend on how many.** Adding *k* kills that all cost HP raises the
   * denominator and not the numerator, so the free fraction falls for any *k* > 0 — do not let this
   * argument come to rest on a figure. The figure quoted elsewhere, ~0.11 a run, is `223/2000`: the
   * rate at which a run start wakes **at least one** creature. That is an *upper bound* on added
   * woken kills, since a run does not kill everything it wakes, and it is not a measurement of the
   * added kills themselves.
   *
   * So for this style, **14.5% is essentially the whole of the HP defect, not a floor under it.** The
   * run start is still part of #125 and the rule still closes it — what it costs there is a
   * **command**, a tempo hole this corpus could not see even if it did call `beginRun`, because the
   * corpus measures HP. That is exactly why the reproduction below and not the guard is the signal.
   *
   * ## So this is a characterisation test, and it says so
   *
   * Asserting §4's guard here would be red. Deleting it and printing a number would be worse — this
   * file's own rule is that a counter which is only printed is a counter that can be set to zero
   * without a test going red. So the gap is asserted instead, in both directions:
   *
   *   - it is **real** (there is at least one free woken kill), so nobody can quietly claim §4's
   *     arithmetic holds; and
   *   - it is not the shape of the game (a **catastrophe** bound — see the assertion, which says
   *     what it is and is not).
   *
   * **When the rule is built this test goes red on its first assertion**, and that is the handover:
   * whoever builds it deletes this block and replaces it with §4's guard, which is one line —
   * `expect(kill.hpSpentWhileAwake).toBeGreaterThan(0)` over `wokenKills`. Nothing else has to move.
   * If it goes red *here* and not in the reproduction below, the fix closed the free-action half and
   * left `beginRun`'s open.
   *
   * ## What the attribution can and cannot see
   *
   * `hpSpentWhileAwake` over-credits when two hunters overlap — §2 has a creature mark a *tile* and
   * two adjacent creatures mark the same one, so nothing in the state says which of them swung. The
   * error runs one way: a free kill in a crowd reports a cost it did not incur, which makes the
   * measured 56 a **lower bound** on the real number. See `WokenKill`.
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

  it('still banks woken kills for nothing, soon after the wake, in the half it can see', () => {
    // **Named for what it measures.** An earlier title said *"all of them the #125 window"*, which
    // asserted a cause this test never observes: `commandsAwake` counts commands, not mechanisms,
    // and cannot tell a free-action window from a `beginRun` one from a third thing nobody has
    // thought of. What is actually pinned is *how soon after the wake* a free kill happens, which
    // is weaker and true. The mechanism is pinned by the reproductions below, not here.
    for (const [name, results] of [
      ['stalker', stalker],
      ['floodlit', floodlit],
    ] as const) {
      const woken = wokenKills(results);
      const free = woken.filter((kill) => kill.hpSpentWhileAwake === 0);
      console.log(
        `${name}: ${free.length}/${woken.length} woken kills cost 0 HP (#125, free-action half ` +
          `only — this corpus never calls beginRun); they die ` +
          `${Math.min(...free.map((k) => k.commandsAwake))}-` +
          `${Math.max(...free.map((k) => k.commandsAwake))} commands after waking`,
      );

      // **#125 exists.** Delete this block and enable §4's guard when it does not.
      expect(free.length, `${name}: §4's guard now holds — enable it and delete this test`)
        .toBeGreaterThan(0);

      // ═══ A CATASTROPHE BOUND, NOT A REGRESSION BOUND — read the number before trusting it ═══
      //
      // Measured today: 56/386 (14.5%) for `stalker`, 22/247 (8.9%) for `floodlit`. This ceiling is
      // **25%**, so #125 could get roughly 70% worse and stay green. That is deliberate and it is
      // the weaker of two bad options: pinning near the measurement makes an ordinary tuning change
      // to `FLASH_THRESHOLD` or a route heuristic go red for a reason that has nothing to do with
      // the defect, in a file whose entire argument is that thresholds should be relative. What this
      // catches is a *rules* change that makes free kills the ordinary case — a creature with 3 HP
      // or less, or a `PLAYER_ATTACK` that one-shots an awake Cinder. It does **not** catch #125
      // drifting, and the console line above is where drift is read.
      expect(free.length * 4, `${name}: free woken kills have become the ordinary case`)
        .toBeLessThan(woken.length);

      // Every free kill happens within a handful of commands of the wake. This is a bound on *when*,
      // not on *why*: a free kill on a creature that had been awake for twenty commands would be a
      // different defect, and this is what would notice one arriving.
      for (const kill of free) {
        expect(kill.commandsAwake, `${name}: creature ${kill.id} was killed free long after waking`)
          .toBeLessThanOrEqual(8);
      }
    }
  });

  it('reproduces #125 from a flash, which is the half the corpus above measures', () => {
    // A corpus statistic with no explanation is a number nobody can act on. This is the whole route
    // in three commands.
    //
    // Shuttered, standing next to a sleeper. The flash is **free** (§2), so phase 4 is `identity`
    // and `now` does not move: the Cinder wakes, declares an attack on the player's tile, and is
    // scheduled at `now + ACTION_COST` — an instant the *next* command spends its own phase 4
    // arriving at. So the creature's single action falls after both strikes rather than between
    // them, and two strikes at 3 damage is a 5 HP Cinder.
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
    // The tell: the clock has not moved, and the creature it just woke is due at an instant in the
    // future that the next command will step straight over.
    expect(state.world.schedule.now).toBe(0);

    state = strike();
    expect(creatureById(state.world, built.ids[0]).hp).toBe(CINDER.maxHp - PLAYER_ATTACK);
    state = strike();

    expect(state.world.actors.some((actor) => actor.id === built.ids[0])).toBe(false);
    // ...and the player is untouched, holding an ember it paid 4 fuel and no HP for. §4 says this
    // costs 2. It does not.
    expect(playerOf(state.world).hp).toBe(PLAYER_MAX_HP);
    expect(state.world.embers).toEqual([{ at: built.at('c'), amount: CINDER.emberDrop }]);
  });

  it('reproduces #125 from beginRun, with no free action anywhere — the half it cannot', () => {
    // ═══ THE ASSERTION THAT STOPS #125 BEING FIXED WRONG ═══
    //
    // The route above needs a flash. **This one does not touch the shutter at all.** `beginRun`
    // runs §2 phase 3 and *only* phase 3, to put the entrance room on screen before the first
    // command — so it wakes whatever the opening light reaches at `now = 0`, schedules it at 100,
    // and never runs a phase 4 to advance the clock. Same window, no free action, and it is a
    // property of **every run start** — about **one in nine** of them, 11.2% over 2000 seeds.
    //
    // **Not one in five (#127).** An earlier version of this comment cited GDD's change log at *20%
    // of arrivals* and applied it here. The citation was accurate and the inference was not: that
    // 20% is measured over floors 1-8, and **a run start is always floor 1**, which carries
    // `min(2 + floor, 6)` = 3 creatures against 6 from floor 4 down. Per depth the rate is
    // 11.2 / 14.7 / 17.9 / 20.6%, flat from floor 4 down because the `min` caps spawn there.
    // `tests/unit/play-opening.test.ts` and `docs/ARCHITECTURE.md` already said one in ten, and a
    // documented number overwrote three agreeing sources — ADR-0013 is about exactly this.
    //
    // The frequency does not change what this test asserts; it changes what #125 is worth.
    //
    // **And it is the frequency of the *window*, not of a free kill** — ruled 2026-08-03, ADR-0014.
    // The floor below is hand-built at Manhattan **2**. §5 step 7 keeps a *generated* opening at
    // Manhattan 3 or more, and the window is worth 0 HP only at 1-2 (measured as the minimum over
    // every legal line of play to depth 9), so a real run start already pays the full 2 HP and the
    // free kill leaks through the **free action** instead. This block still pins the mechanism, which
    // is the same on both routes; do not quote it as "one run start in nine is a free kill".
    //
    // This is why #125's cause has to be stated as the scheduling invariant — and **read the signal
    // carefully, because an earlier draft of this comment had it backwards.** This test asserts that
    // the defect is *present*. So:
    //
    //   - a fix that special-cases free actions leaves this test **PASSING**, because the `beginRun`
    //     half is still open. Measured, by implementing that fix as a mutant: the corpus assertion
    //     and the flash reproduction both go red, and this one stays green.
    //   - a **complete** fix is what turns this test red.
    //
    // **A still-passing test here is the failure signal, not the success signal.** Do not delete this
    // block while it passes: the handover at the top of this file says whoever fixes #125 deletes the
    // block and enables §4's one-line guard, and doing that on two reds would enable a guard over a
    // corpus that cannot see the route this test pins.
    //
    // `arriveOn` in `tests/unit/support/lantern-run.ts` starts every floor shuttered and never calls
    // `beginRun`, so nothing in the corpus above can reach this. It is pinned here instead.
    const built = scenario(['######', '#@.c.#', '######']);
    let state: LanternWorld = beginRun(built.world.floor);
    const woken = creatureById(state.world, built.ids[0]);

    // Phase 3 ran and nothing else: the creature is awake and declaring, the clock is untouched, and
    // the player is still due at the same instant the run began on.
    expect(woken.mind).toEqual({ kind: 'awake', intent: { kind: 'move', to: { x: 2, y: 1 } } });
    expect(state.world.schedule.now).toBe(0);
    expect(state.world.schedule.entries).toEqual([
      { actorId: PLAYER_ID, nextActAt: 0 },
      { actorId: built.ids[0], nextActAt: ACTION_COST },
    ]);

    const command = (to: { x: number; y: number }): LanternWorld =>
      resolveTurn(state, lanternPhases('costsATurn', moveCommand(to)));

    // Command 1 — step toward it, onto the very tile it declared a move to. Its turn is not due at
    // `now = 0`, so phase 4 spends this command advancing the clock instead of giving it one.
    state = command({ x: 2, y: 1 });
    expect(playerOf(state.world).at).toEqual({ x: 2, y: 1 });
    expect(creatureById(state.world, built.ids[0]).at).toEqual({ x: 3, y: 1 });

    // Command 2 — first strike. Now it *is* due, and it gets its one action: resolving the move it
    // declared back at `beginRun`, which the player is now standing on, so it is blocked and spent.
    // **A stale declaration is not an attack**, which is the other shape the window takes.
    state = command({ x: 3, y: 1 });
    expect(creatureById(state.world, built.ids[0]).hp).toBe(CINDER.maxHp - PLAYER_ATTACK);
    expect(creatureById(state.world, built.ids[0]).at).toEqual({ x: 3, y: 1 });

    // Command 3 — second strike, in phase 1, before the attack it has now declared can resolve.
    state = command({ x: 3, y: 1 });
    expect(state.world.actors.some((actor) => actor.id === built.ids[0])).toBe(false);
    expect(playerOf(state.world).hp).toBe(PLAYER_MAX_HP);
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
