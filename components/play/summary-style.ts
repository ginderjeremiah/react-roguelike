/**
 * The two paint decisions the run summary makes, kept out of the `.tsx` so they can be tested.
 *
 * Same argument as `cell-style.ts`: ADR-0005 says there is no component test runner, so anything
 * inside a React component is verified only by driving a browser. A colour choice and a width budget
 * are arithmetic over data, and both are cheaper and sharper to check in Vitest — see
 * `tests/unit/play-run-summary.test.ts`.
 *
 * Neither of these is a game rule. *Which ending is a win* is decided in `render/summary.ts`
 * (`RunSummary.won`); this file only says what a win looks like.
 */

import type { RunSummary } from '@/render';
import type { GameTheme } from './theme';

/**
 * The colour an ending is drawn in — the marker, the verdict, and the outline of RUN AGAIN.
 *
 * **The board's own vocabulary, not a new pair of colours.** A win is `stairs`, because taking the
 * stairs on the last floor *is* the win (GDD §13, "the eighth descent is the ending"), and the
 * summary's marker is the stairs glyph for the same reason. A death is `ember`, the colour of the
 * lantern that just went out.
 *
 * **This is the third carrier and never the first** (§11). The ending is already legible as a word
 * (`verdict`) and as a glyph shape (`marker`) with no colour at all; if this function returned one
 * colour for both endings the screen would still be readable. It is asserted to return two anyway,
 * because a palette that says the same thing twice is a palette that has stopped helping.
 */
export function verdictTone(summary: RunSummary, theme: GameTheme): string {
  return summary.won ? theme.token.stairs : theme.token.ember;
}

/**
 * How wide one character is, as a fraction of its font size, in the mono face the screen uses.
 *
 * A conservative round number rather than a measurement: real monospace faces sit between 0.55 and
 * 0.6, and the budget below is only useful if it errs toward *predicting overflow that does not
 * happen* rather than missing overflow that does.
 */
export const MONO_ADVANCE = 0.62;

/** Points a string occupies at a font size, including the tracking the style adds per character. */
export function monoWidth(text: string, fontSize: number, letterSpacing = 0): number {
  return text.length * (fontSize * MONO_ADVANCE + letterSpacing);
}
