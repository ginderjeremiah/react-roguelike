/**
 * How loud the turn line is drawn — the one paint decision `StatusLine` makes, kept out of the
 * `.tsx` so it can be tested.
 *
 * Same argument as `cell-style.ts` and `summary-style.ts`: ADR-0005 says there is no component test
 * runner, so anything inside a React component is verified only by driving a browser. GDD §11 asks
 * for an assertion that two emphasis levels differ in **two channels, one of which is not colour**,
 * in **both** schemes — that is a property of a style object, and it is far cheaper and far sharper
 * to check in Vitest than by reading computed styles out of Chromium. See
 * `tests/unit/play-theme.test.ts`.
 *
 * Nothing here decides *which* level a line is. That is `messages.ts`'s, chosen from the cue that
 * won the line (§10, #94), and this file never sees a sentence — deliberately, because a function
 * that could read the text is a function that could start branching on it.
 */

import type { LineLevel } from './messages';
import type { GameTheme } from './theme';

/** The type ramp the turn line shares with the rest of the screen, as a fact and not as a memory. */
export const TURN_LINE_FONT_SIZE = 14;

/**
 * The style of a line at a level: colour, size, weight.
 *
 * ## The size is shared, and it went up
 *
 * §10 ruled the ordinal position rather than a number: the turn line ranks **above every caption and
 * sub-label on the screen** (the 10px button hint and build note), **may equal the control-label
 * size**, and only the HUD's values (17px) may be larger. 14 is that — the same size as `CLOSE
 * SHUTTER`. It replaces 13px, which sat one point above the captions and read as one of them.
 *
 * **Both levels share it, and that is a rule rather than a shortcut.** The row is fixed-height so
 * that a message appearing does not move the board — a board that jumps is a board you cannot aim at
 * (`board.tsx` resolves a press by measuring where it is) — and §11's text scaling multiplies
 * whatever is chosen here, so a larger `alarm` would put reflow risk on precisely the message that
 * must not reflow.
 *
 * ## Weight is the non-colour carrier
 *
 * §11 forbids colour as the sole carrier, and §10 rejects the tempting defence that *the sentences
 * differ* — a carrier that works only once you have read the sentence is not a carrier for a signal
 * whose whole job is to be caught before you read it. So `700` against `400`: strictly heavier, and
 * at least as heavy as the control labels (`controls.tsx` draws those at 14px/700). It survives
 * greyscale, every colourblindness and both schemes.
 *
 * The weight is a string because that is what React Native's `fontWeight` takes.
 */
export function statusStyle(
  level: LineLevel,
  theme: GameTheme,
): { readonly color: string; readonly fontSize: number; readonly fontWeight: '400' | '700' } {
  return {
    color: theme.line[level],
    fontSize: TURN_LINE_FONT_SIZE,
    fontWeight: level === 'alarm' ? '700' : '400',
  };
}
