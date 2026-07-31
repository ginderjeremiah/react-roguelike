/**
 * GDD §13's run summary: the last screen of a run, as values.
 *
 * §13 settles the *state* an ended run is in and then says, in as many words, what it does not own:
 * "the summary screen ... what is drawn on top of it — floors reached, kills, fuel spent, turns
 * taken, the seed (Pillar 4) — is the run-loop work." This module is that list, turned into a flat
 * record a component renders without deciding anything.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE ENDING IS STATED ONCE, AND THIS MODULE IS HANDED IT RATHER THAN RE-DERIVING IT
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `presentSummary` takes the `OutcomeHud` `hud.ts` already produced instead of reading
 * `state.status` a second time. That is deliberate and it is the same rule `state.ts` applies to
 * `floorNumber`: **one source of truth**. Two independent readings of `status` would be two places
 * to add a third ending to, and — worse — two places the *copy* could disagree, so a status line
 * saying `The lantern goes out.` could sit above a panel headlined `You reach the bottom.`
 *
 * The consequence is the two-argument signature, which looks redundant (`outcome` is derivable from
 * `state`) and is not: `presentScene` already computed the HUD, and `taps.ts` is handed
 * `isRunning(state)` for exactly the same reason a few lines away in the same function.
 *
 * ## What a summary is not
 *
 * **It is not a second tally.** Every number here is read off `GameState`, where `step` accumulated
 * it as it happened — §13 requires that ("the terminal state is a snapshot of the moment the run
 * ended, not a tidied-up world, so counters must be accumulated as they happen rather than derived
 * from it afterwards"). The one derived number is `gathered`, and it is derived from an identity
 * `game/core/state.ts` states and `replay.test.ts` pins, not from a guess.
 *
 * **It is not a cue reader.** `render/cues.ts` emits per-actor cues by iterating `world.actors` in
 * ascending id, which is an emission order two separate bugs have already been built on (#59, and
 * `components/play/messages.ts`'s header). A summary assembled by counting `died` cues would inherit
 * that dependency for numbers the simulation already holds exactly.
 *
 * ## §11: which ending this was survives greyscale, twice over
 *
 * Colour may not be the sole carrier of anything, and an ending is the single most important bit on
 * this screen — one of the two is a **win**. So the distinction rides on `verdict` (a word) and
 * `marker` (a glyph shape), and a component is free to add colour on top. `summary.test.ts` asserts
 * that both differ between the endings, so a palette change cannot quietly become the only signal.
 */

import { LAST_FLOOR, STARTING_FUEL } from '../game/content';
import { floorNumberOf, type GameState } from '../game/core';
import { GLYPHS } from './glyphs';
import type { OutcomeHud } from './hud';

/**
 * The four numbers §13 names, in the order they are read.
 *
 * Order is part of the model rather than a component's layout decision: floors first because it is
 * the answer to "how far did I get", turns last because it is the least interesting of the four and
 * the one a player checks rather than feels. Exported so a test can assert the list is exhaustive —
 * a fifth stat added to `statsOf` and not to this union is a compile error, and one added here and
 * not there is a test failure.
 */
export const SUMMARY_STAT_KEYS = ['floors', 'kills', 'fuel', 'turns'] as const;

export type SummaryStatKey = (typeof SUMMARY_STAT_KEYS)[number];

/** One readout on the summary. A label, a number already rendered, and an optional second line. */
export type SummaryStat = {
  readonly key: SummaryStatKey;
  /** Shown above the value. Copy, decided here so it is testable. */
  readonly label: string;
  /** Already a string: `3/8` is one readout, not a component's job to assemble. */
  readonly value: string;
  /** A quieter second line, or `null` for a stat that needs no qualifier. */
  readonly note: string | null;
};

/** §13's death, as a word. The non-colour half of "which ending was this". */
export const DEATH_VERDICT = 'DIED';

/**
 * §13's win, as a word. **`reachedBottom` is a win**, and a summary that read as a failure screen
 * with different numbers would be the one thing this module must not get wrong.
 */
export const VICTORY_VERDICT = 'REACHED THE BOTTOM';

/**
 * The marker for a death. A dagger is the roguelike's own gravestone and it is a *shape*, so it
 * carries the ending with no colour at all (§11).
 */
export const DEATH_MARKER = '†';

/**
 * The marker for a win: the stairs glyph, because taking these stairs **is** the ending (§13 — "the
 * eighth descent *is* the ending"). Taken from `GLYPHS` rather than written as `'>'` so that the
 * board and the summary cannot drift apart on what the last tile of a run looks like.
 */
export const VICTORY_MARKER = GLYPHS.stairs;

/**
 * A finished run, as a screen. §13's exactly-two endings, plus the five things drawn on top.
 *
 * `outcome` mirrors `RunStatus`'s two terminal kinds rather than flattening to a boolean, for the
 * reason `game/core/state.ts` gives about `{ over: true }` — but `won` is here as well, and is not
 * redundancy: deciding **which of the two endings is the victory** is a design fact (§13), and a
 * component comparing a string against `'reachedBottom'` would be holding a copy of it.
 */
export type RunSummary = {
  readonly outcome: 'died' | 'reachedBottom';
  /** True for exactly `reachedBottom`. §13 gives the run a win, and this is it. */
  readonly won: boolean;
  /** The ending as a word, in caps. Carries the outcome with no colour (§11). */
  readonly verdict: string;
  /** The ending as a shape. The second non-colour carrier (§11). */
  readonly marker: string;
  /** The sentence. The same one the run's `OutcomeHud` carries — see the header. */
  readonly headline: string;
  /** §13's four numbers, in reading order. Exhaustive over `SUMMARY_STAT_KEYS`. */
  readonly stats: readonly SummaryStat[];
  /**
   * The seed the run was started from. Pillar 4: "a run is a shareable artifact" — a seed plus a
   * command log replays exactly, so this is the half of it a player can read off the screen.
   */
  readonly seed: string;
};

/**
 * The summary for a state, or `null` while the run is still going.
 *
 * **`null` rather than a running-flavoured summary**, because there is no such screen: §13's tally
 * is a statement about a finished run, and a mid-run `RunSummary` would be a value whose only honest
 * use is to be checked for and discarded. The nullability is also what a caller branches its whole
 * layout on, which is one question instead of two.
 *
 * @param outcome the ending, from `presentHud`. Not re-read from `state.status` — see the header.
 */
export function presentSummary(state: GameState, outcome: OutcomeHud): RunSummary | null {
  if (outcome.kind === 'running') return null;

  const won = outcome.kind === 'reachedBottom';
  return {
    outcome: outcome.kind,
    won,
    verdict: won ? VICTORY_VERDICT : DEATH_VERDICT,
    marker: won ? VICTORY_MARKER : DEATH_MARKER,
    headline: outcome.headline,
    stats: statsOf(state),
    seed: state.seed,
  };
}

/**
 * §13's four numbers, read off the counters `step` accumulated.
 *
 * **`floorNumberOf` is the floor the run ended on and therefore the number of floors reached**,
 * because a run starts on floor 1 and a descent is the only thing that changes it. On a win it is
 * `LAST_FLOOR` exactly — the winning descent ends in phase 1 and generates no floor 9 (§13) — which
 * is why the same expression serves both endings and there is no `won ? ... : ...` here.
 *
 * **Fuel spent is gross** (`state.fuelBurned`), and the ember it did not net off is shown beside it
 * rather than subtracted from it. `game/core/state.ts` argues the ledger at length; the short version
 * is that netting would report a lit run that looted well as *cheaper* than a shuttered run that
 * looted nothing, inverting the arithmetic §4 asks the player to do. Showing both is what makes the
 * §4 trade legible after the fact, which is the only reason a summary shows a resource at all.
 *
 * `gathered` is **derived, not stored**: §4 gives fuel exactly two verbs and a descent carries the
 * reserve untouched, so `fuelBurned + fuel - STARTING_FUEL` is an identity over every state of every
 * run (`game/core/state.ts`, and `replay.test.ts` pins it). A stored copy would be a second source of
 * truth for a number two existing fields already imply.
 */
function statsOf(state: GameState): readonly SummaryStat[] {
  const gathered = state.fuelBurned + state.lantern.fuel - STARTING_FUEL;

  return [
    {
      key: 'floors',
      label: 'FLOORS',
      value: `${floorNumberOf(state)}/${LAST_FLOOR}`,
      note: null,
    },
    { key: 'kills', label: 'KILLS', value: `${state.kills}`, note: null },
    {
      key: 'fuel',
      label: 'FUEL SPENT',
      value: `${state.fuelBurned}`,
      // §4's income side, so the burn reads as a trade rather than as a drain.
      note: `gathered ${gathered}`,
    },
    { key: 'turns', label: 'TURNS', value: `${state.turnsElapsed}`, note: null },
  ];
}
