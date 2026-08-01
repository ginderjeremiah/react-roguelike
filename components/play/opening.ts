/**
 * Starting a run, and the one sentence it can already owe the player.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE OPENING FRAME IS A TURN THAT ALREADY HAPPENED, AND IT WAS SILENT FOR ONE REVIEW CYCLE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `beginRun` is not a blank board waiting for a press. GDD §4 starts the lantern **open**, and
 * `createInitialState` runs §2's phase 3 once — so on the opening frame the light has already
 * fallen, and it has already woken whatever it touched. `session/run.ts` emits those wakes as cues;
 * §4 (#79) requires them to be *said*.
 *
 * **This module exists because the screen forgot to say them.** `app/index.tsx` held the message in
 * `useState<string | null>(null)` and only ever assigned it from a *press* handler, so the opening
 * cue list was computed, handed to `cuesOf`, and dropped on the floor. Nothing went red: the seed is
 * a constant until #47, and `emberdepth` happens to be one of the 90% of seeds whose opening wakes
 * nothing. Review caught it by pointing the app at a seed that does.
 *
 * So the decision is **not a line inside a `.tsx`**. It is here, in a plain `.ts` module Vitest can
 * import, because that is the difference between a rule with a test and a rule with a comment. The
 * screen's job is now to call this and use both halves of what it returns.
 *
 * ## Why it returns the pair rather than just the message
 *
 * A caller that did `const run = beginRun(seed)` and then `openingMessageFor(seed)` would begin a
 * *second* run to describe the first — same seed, so the same cues today, and a silent divergence
 * the day anything about a run stops being a pure function of its seed. The two values come out of
 * one `beginRun` call, together, so they cannot describe different runs.
 *
 * It is deliberately **not** `advance`'s job (`app/index.tsx`). `advance` describes a *turn* and
 * carries a rule about the turn that ends a run — it suppresses the line when the summary is up, so
 * the panel and the status line do not both narrate the death. A fresh run has no summary and has
 * had no turn, so routing a restart through `advance` would be borrowing a rule that has nothing to
 * say here.
 */

import { beginRun, cuesOf, type Run } from '@/session';
import { describeTurn, type TurnLine } from './messages';

/** A run that has just begun, and the line the screen owes it. `message` is `null` when silent. */
export type OpenedRun = {
  readonly run: Run;
  /**
   * `describeTurn` of the opening cues — a wake sentence, or `null` on a quiet opening.
   *
   * A `TurnLine`, so it carries §10's level like every other line the screen shows (#94). The
   * opening is the one place where that level is not a branch: the only thing an opening frame can
   * say is a wake, so a speaking opening is always an `alarm` and a silent one is `null`. It is
   * still taken from `describeTurn` rather than written here, because "the opening says what the
   * opening cues say" is the property this module exists to hold.
   */
  readonly message: TurnLine | null;
};

/**
 * Begin a run on `seed` and work out what, if anything, the screen must already say about it.
 *
 * Pure and total, exactly as `beginRun` is: any string is a seed, and no clock, storage or
 * randomness is touched. Called for the first run and for §13's RUN AGAIN alike, so the two cannot
 * drift — a restart that cleared the line while a launch showed it would be the same bug wearing a
 * different hat.
 *
 * Roughly one opening in ten has something to say (measured across 200 seeds in
 * `tests/unit/play-opening.test.ts`), which matches §4's "one arrival in five" for a *descent*
 * being higher than for the opening — §5 keeps creatures out of the entrance room, so only the
 * light that spills through a doorway can find one.
 */
export function openRun(seed: string): OpenedRun {
  const run = beginRun(seed);
  return { run, message: describeTurn(cuesOf(run)) };
}
