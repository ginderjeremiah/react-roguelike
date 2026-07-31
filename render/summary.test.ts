import { describe, expect, it } from 'vitest';
import { LAST_FLOOR, STARTING_FUEL } from '@/game/content';
import { floorNumberOf, replay, runStates, step, type GameState } from '@/game/core';
import { scenarioState } from '@/tests/unit/support/presentation';
import { diveToTheBottom, standUntilDead } from '@/tests/unit/support/run-script';
import { presentHud, type OutcomeHud } from './hud';
import {
  DEATH_MARKER,
  DEATH_VERDICT,
  presentSummary,
  SUMMARY_STAT_KEYS,
  VICTORY_MARKER,
  VICTORY_VERDICT,
  type RunSummary,
  type SummaryStatKey,
} from './summary';

/**
 * GDD §13's summary, over **real runs** rather than hand-built terminal states.
 *
 * That is not a stylistic preference here the way it sometimes is: §13's whole warning about this
 * screen is that "the terminal state is a snapshot of the moment the run ended, not a tidied-up
 * world", and a hand-built state is by definition tidy. `standUntilDead` and `diveToTheBottom` drive
 * the real `step()` to the two real endings, so the numbers below are the numbers a player would see.
 *
 * The one place a state is fabricated is `presentSummary`'s second argument, and that is the point of
 * the test it appears in — see "the ending is the one it is handed".
 */

const DEATH = standUntilDead('grave', 3);
const DYING: readonly GameState[] = runStates(DEATH.seed, DEATH.commands);
const DIED = replay(DEATH);

const VICTORY = diveToTheBottom('win', LAST_FLOOR);
const WON = replay(VICTORY);

/** The summary for a state, built the way `presentScene` builds it. */
function summaryOf(state: GameState): RunSummary | null {
  return presentSummary(state, presentHud(state).outcome);
}

/** The summary for a state that must be over. @throws if it is not, so a test cannot go vacuous. */
function endedSummaryOf(state: GameState): RunSummary {
  const summary = summaryOf(state);
  if (summary === null) throw new Error('summary.test: expected a finished run');
  return summary;
}

/**
 * The summary a **still-running** state would produce if it had just ended.
 *
 * Two of the numbers below — a kill, and ember gathered off the corpse — are unreachable from the
 * scripted runs at the top of this file (one stands still until it dies, the other walks around
 * everything it meets), and a hand-built terminal state cannot be built: `status` is set by
 * `statusAfterTurn` and nothing above `game/` may forge one. So the *board* is real and driven by
 * real commands, and only the ending is supplied — which is legal precisely because the ending is an
 * argument rather than something `presentSummary` reads for itself.
 */
function summaryAsIfOver(state: GameState): RunSummary {
  const summary = presentSummary(state, { kind: 'died', headline: 'the run stopped here' });
  if (summary === null) throw new Error('summary.test: a supplied ending must produce a summary');
  return summary;
}

function statOf(summary: RunSummary, key: SummaryStatKey): string {
  const stat = summary.stats.find((candidate) => candidate.key === key);
  if (stat === undefined) throw new Error(`summary.test: no ${key} stat`);
  return stat.value;
}

function noteOf(summary: RunSummary, key: SummaryStatKey): string | null {
  const stat = summary.stats.find((candidate) => candidate.key === key);
  if (stat === undefined) throw new Error(`summary.test: no ${key} stat`);
  return stat.note;
}

describe('there is no summary of a run in progress', () => {
  it.each([
    ['a run that ends in a death', DYING],
    ['a run that ends at the bottom', runStates(VICTORY.seed, VICTORY.commands)],
  ])('appears exactly when the run is over, over %s', (_name, states) => {
    // The nullability is what a whole layout branches on, so "null while running" is not a detail —
    // a summary that appeared on turn 1 would replace the game with its own obituary, and one that
    // never appeared would leave the run with no ending on screen at all. Both directions, because
    // asserting only the first is satisfied by a function that returns `null` forever.
    const seen = { running: 0, over: 0 };
    for (const state of states) {
      const running = state.status.kind === 'running';
      expect(summaryOf(state) === null, `turn ${state.turnsElapsed}`).toBe(running);
      if (running) seen.running += 1;
      else seen.over += 1;
    }
    expect(seen.running).toBeGreaterThan(1);
    // §13: a finished run accepts no more commands, so the death script's three trailing waits are
    // refused and every state after the ending is the ending. All of them must still summarise.
    expect(seen.over).toBeGreaterThan(0);
  });
});

describe('§13 has exactly two endings, and one of them is a win', () => {
  it('tells them apart in words and in shape, not only in kind', () => {
    const died = endedSummaryOf(DIED);
    const won = endedSummaryOf(WON);

    expect(died.outcome).toBe('died');
    expect(won.outcome).toBe('reachedBottom');

    // §11: colour may not be the sole carrier, and this is the most important bit on the screen.
    // Two independent non-colour channels, and both must actually differ — a palette cannot fix a
    // model that says the same word for a death and a victory.
    expect(died.verdict).not.toBe(won.verdict);
    expect(died.marker).not.toBe(won.marker);
    expect(died.headline).not.toBe(won.headline);
    expect(died.verdict).toBe(DEATH_VERDICT);
    expect(won.verdict).toBe(VICTORY_VERDICT);
    expect(died.marker).toBe(DEATH_MARKER);
    expect(won.marker).toBe(VICTORY_MARKER);
  });

  it('calls reaching the bottom a win and dying not one', () => {
    // §13: "the eighth descent *is* the ending". If this inverts, the game congratulates corpses.
    expect(endedSummaryOf(WON).won).toBe(true);
    expect(endedSummaryOf(DIED).won).toBe(false);
  });

  it('carries the headline the HUD carries, rather than a second copy of it', () => {
    for (const state of [DIED, WON]) {
      const outcome = presentHud(state).outcome;
      expect(outcome.kind).not.toBe('running');
      expect(endedSummaryOf(state).headline).toBe(
        outcome.kind === 'running' ? '' : outcome.headline,
      );
    }
  });

  it('uses the ending it is handed and never re-reads `status`', () => {
    // The two-argument signature exists so that the ending is stated once (see the module header).
    // A `presentSummary` that consulted `state.status` itself would ignore this argument entirely,
    // and would then be free to disagree with the status line drawn from the same HUD.
    const injected: OutcomeHud = { kind: 'reachedBottom', headline: 'a headline from elsewhere' };
    const summary = presentSummary(DIED, injected);

    expect(summary?.outcome).toBe('reachedBottom');
    expect(summary?.headline).toBe('a headline from elsewhere');
    expect(summary?.won).toBe(true);
  });
});

describe('§13’s four numbers', () => {
  it('shows every stat, once, in order, and nothing else', () => {
    // A fifth number added to `statsOf` but not to `SUMMARY_STAT_KEYS` fails to compile; one added
    // here and not there fails right now. Order is part of the model, so it is asserted as a list.
    const summary = endedSummaryOf(DIED);
    expect(summary.stats.map((stat) => stat.key)).toEqual([...SUMMARY_STAT_KEYS]);
  });

  it('renders every label, value and note as real text', () => {
    // The failure this catches is not a wrong number, it is `undefined` or `NaN` rendered as words
    // on the one screen a player reads carefully.
    for (const summary of [endedSummaryOf(DIED), endedSummaryOf(WON)]) {
      for (const stat of summary.stats) {
        expect(stat.label.length, stat.key).toBeGreaterThan(0);
        expect(stat.value, stat.key).toMatch(/^[0-9]+(\/[0-9]+)?$/);
        expect(String(stat.note), stat.key).not.toContain('undefined');
        expect(String(stat.note), stat.key).not.toContain('NaN');
      }
    }
  });

  it('reports the floor the run ended on, against the last floor', () => {
    expect(statOf(endedSummaryOf(DIED), 'floors')).toBe(`${floorNumberOf(DIED)}/${LAST_FLOOR}`);
    // §13: a winning descent generates no floor 9, so the win is `8/8` and not `9/8`.
    expect(floorNumberOf(WON)).toBe(LAST_FLOOR);
    expect(statOf(endedSummaryOf(WON), 'floors')).toBe(`${LAST_FLOOR}/${LAST_FLOOR}`);
  });

  it('reports turns from the counter, never from the number of commands', () => {
    // §2's free actions and §2's refusals both make `commands.length` the wrong number, and the
    // winning run's log contains a `setShutter` that costs no turn.
    for (const state of [DIED, WON]) {
      expect(statOf(endedSummaryOf(state), 'turns')).toBe(`${state.turnsElapsed}`);
    }
    expect(WON.turnsElapsed).toBeLessThan(VICTORY.commands.length);
  });

  it('reports kills from the run counter', () => {
    for (const state of [DIED, WON]) {
      expect(statOf(endedSummaryOf(state), 'kills')).toBe(`${state.kills}`);
    }
  });

  it('shows a kill that happened, so the readout is not a hard-coded zero', () => {
    // The two scripted runs above may legitimately kill nothing — one stands still and one walks
    // around everything it meets — so without this the kills readout could be `'0'` unconditionally
    // and every assertion above would still pass.
    const killed = afterAKill();
    expect(killed.kills).toBeGreaterThan(0);
    expect(statOf(summaryAsIfOver(killed), 'kills')).toBe(`${killed.kills}`);
  });

  it('reports fuel spent gross, with the ember it did not net off beside it', () => {
    for (const state of [DIED, WON]) {
      const summary = endedSummaryOf(state);
      expect(statOf(summary, 'fuel')).toBe(`${state.fuelBurned}`);
      // The identity `game/core/state.ts` states and `replay.test.ts` pins.
      const gathered = state.fuelBurned + state.lantern.fuel - STARTING_FUEL;
      expect(noteOf(summary, 'fuel')).toBe(`gathered ${gathered}`);
    }
  });

  it('does not net income against the burn, on a run that actually gathered ember', () => {
    // §4's ledger, and the reason `fuelBurned` is gross: a lit run that looted well must not report
    // as cheaper than a shuttered one that looted nothing. Netting would show `fuel spent` here as
    // less than the burn, and on a good floor as a negative number.
    const state = afterGatheringEmber();
    const gathered = state.fuelBurned + state.lantern.fuel - STARTING_FUEL;
    expect(gathered).toBeGreaterThan(0);

    const summary = summaryAsIfOver(state);
    expect(statOf(summary, 'fuel')).toBe(`${state.fuelBurned}`);
    expect(Number(statOf(summary, 'fuel'))).toBeGreaterThan(STARTING_FUEL - state.lantern.fuel);
    expect(noteOf(summary, 'fuel')).toContain(`${gathered}`);
  });
});

describe('the seed, because Pillar 4 says a run is a shareable artifact', () => {
  it('is the seed the run was started from, on both endings', () => {
    expect(endedSummaryOf(DIED).seed).toBe(DEATH.seed);
    expect(endedSummaryOf(WON).seed).toBe(VICTORY.seed);
    // Two different runs, two different seeds — a constant would satisfy either line alone.
    expect(DEATH.seed).not.toBe(VICTORY.seed);
  });
});

/**
 * A state in which the player has killed something, forced rather than hoped for.
 *
 * Bumps east into a Cinder until it stops being alive. `bump` resolves the move as an attack (§3),
 * so this is a sequence of ordinary player commands and not a poked-in counter.
 */
function afterAKill(): GameState {
  let state = scenarioState(['#####', '#@c.#', '#####'], { shutter: 'open' }).state;
  for (let turn = 0; turn < 10 && state.kills === 0; turn += 1) {
    state = step(state, { kind: 'move', dir: 'east' });
  }
  if (state.kills === 0) throw new Error('summary.test: the Cinder would not die');
  return state;
}

/** The same, then walking onto the ember it dropped so GDD §2 phase 5 refuels the lantern. */
function afterGatheringEmber(): GameState {
  let state = afterAKill();
  for (let turn = 0; turn < 4; turn += 1) {
    const before = state.lantern.fuel;
    state = step(state, { kind: 'move', dir: 'east' });
    if (state.lantern.fuel > before) return state;
  }
  throw new Error('summary.test: never walked onto the ember drop');
}
