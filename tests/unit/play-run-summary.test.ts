import { describe, expect, it } from 'vitest';
import { LAST_FLOOR } from '@/game/content';
import { replay } from '@/game/core';
import { presentHud, presentSummary, type RunSummary } from '@/render';
import { DARK_THEME, LIGHT_THEME, type GameTheme } from '@/components/play/theme';
import { RUN_OVER_MESSAGE } from '@/components/play/messages';
import { monoWidth, verdictTone } from '@/components/play/summary-style';
import { diveToTheBottom, standUntilDead } from '@/tests/unit/support/run-script';

/**
 * The run summary's two testable halves: what colour an ending is, and whether the words fit a
 * phone.
 *
 * The panel itself is React and is driven by Playwright (ADR-0005). What is checked here is
 * everything about it that is data — `summary-style.ts` exists so that this list is not empty, on the
 * same argument `cell-style.ts` was extracted for.
 *
 * **The width budget is the half that earns its keep.** A label lengthened by one word is a four-
 * column band that wraps at 390pt and a summary that reads as broken at the exact moment a player is
 * paying most attention — and it is invisible on a desktop viewport, which is where screenshots get
 * taken. Arithmetic catches it before a browser does.
 */

const DIED = replay(standUntilDead('grave', 1));
const WON = replay(diveToTheBottom('win', LAST_FLOOR));

const THEMES: readonly (readonly [string, GameTheme])[] = [
  ['dark', DARK_THEME],
  ['light', LIGHT_THEME],
];

/** The narrowest phone the design targets (Pillar 3), and the width the layout is built for. */
const PHONE_WIDTH = 390;

/** `run-summary.tsx`'s `panel.paddingHorizontal`, both sides. */
const PANEL_PADDING = 24;

/** `stats.gap`, between four columns. */
const COLUMN_GAP = 8;

const COLUMN_WIDTH = (PHONE_WIDTH - PANEL_PADDING - 3 * COLUMN_GAP) / 4;

function summaryOf(state: Parameters<typeof presentHud>[0]): RunSummary {
  const summary = presentSummary(state, presentHud(state).outcome);
  if (summary === null) throw new Error('play-run-summary: expected a finished run');
  return summary;
}

const SUMMARIES: readonly (readonly [string, RunSummary])[] = [
  ['died', summaryOf(DIED)],
  ['won', summaryOf(WON)],
];

describe('the colour of an ending', () => {
  it('is a different colour for each ending, in both schemes', () => {
    // §11 makes colour the *third* carrier here (the verdict word and the marker glyph come first),
    // so this cannot be the assertion that keeps the screen readable. It is still worth pinning: a
    // palette in which a win and a death are painted identically has stopped adding anything, and
    // that is a change nobody would notice in a light-mode screenshot of a run they won.
    for (const [name, theme] of THEMES) {
      const died = verdictTone(summaryOf(DIED), theme);
      const won = verdictTone(summaryOf(WON), theme);
      expect(died, name).not.toBe(won);
    }
  });

  it('keys off `won` rather than off the outcome string', () => {
    // The design fact — which of §13's two endings is the victory — lives in `render/summary.ts`.
    // A component re-deriving it from `outcome === 'reachedBottom'` would be holding a copy.
    const pretendWin: RunSummary = { ...summaryOf(DIED), won: true };
    expect(verdictTone(pretendWin, DARK_THEME)).toBe(verdictTone(summaryOf(WON), DARK_THEME));
  });

  it('is readable against the panel it is printed on, in both schemes', () => {
    // The verdict is 19pt bold, so WCAG's large-text 3:1 is the applicable bar; these clear it with
    // room, because this line is the single thing on the screen a player reads first.
    for (const [name, theme] of THEMES) {
      for (const [ending, summary] of SUMMARIES) {
        expect(contrast(verdictTone(summary, theme), theme.panel), `${name}/${ending}`)
          .toBeGreaterThan(3);
      }
    }
  });
});

describe('the summary fits a 390pt phone', () => {
  it('keeps four stat columns from colliding', () => {
    // `stats` is a four-column row (`run-summary.tsx`), so every label, value and note has to fit one
    // quarter of the band. `FUEL SPENT` is the longest label and `gathered NNN` the longest note.
    for (const [ending, summary] of SUMMARIES) {
      expect(summary.stats).toHaveLength(4);
      for (const stat of summary.stats) {
        const label = monoWidth(stat.label, 9, 1.2);
        const value = monoWidth(stat.value, 17);
        const note = stat.note === null ? 0 : monoWidth(stat.note, 10);
        expect(label, `${ending}/${stat.key} label`).toBeLessThanOrEqual(COLUMN_WIDTH);
        expect(value, `${ending}/${stat.key} value`).toBeLessThanOrEqual(COLUMN_WIDTH);
        expect(note, `${ending}/${stat.key} note`).toBeLessThanOrEqual(COLUMN_WIDTH);
      }
    }
  });

  it('leaves the seed room to share its row with §2’s acknowledgement', () => {
    // `run-summary.tsx` puts the seed and the run-over note on one reserved-height row, so that a
    // press on the finished board can be acknowledged without moving the board it was aimed at. The
    // two have to fit side by side or that row wraps and the panel grows anyway.
    const band = PHONE_WIDTH - PANEL_PADDING - COLUMN_GAP;
    for (const [ending, summary] of SUMMARIES) {
      const seed = monoWidth(`seed  ${summary.seed}`, 11, 0.4);
      expect(seed + monoWidth(RUN_OVER_MESSAGE, 11), `${ending} seed row`).toBeLessThanOrEqual(band);
    }

    // The fixtures above use short test seeds, so on their own this budget describes strings the
    // app never shows. The shipped seed is `emberdepth`; more importantly #47 will replace it with
    // something chosen elsewhere, and a seed is meant to be human-typable and shareable (Pillar 4),
    // so the length that matters is the longest one we would let a player enter — not the longest
    // one a fixture happens to use. Same trap the E2E press budgets now document: a number that
    // stops being an observation the moment the thing it measured is replaced.
    const longestPlausibleSeed = 'a'.repeat(24);
    const widest = monoWidth(`seed  ${longestPlausibleSeed}`, 11, 0.4);
    expect(widest + monoWidth(RUN_OVER_MESSAGE, 11), 'longest plausible seed').toBeLessThanOrEqual(
      band,
    );
  });

  it('keeps the verdict on one line beside its marker', () => {
    // `REACHED THE BOTTOM` is the long one, and it is the *win* — the line that must not wrap is the
    // one a player sees once in a good run.
    const beside = PHONE_WIDTH - PANEL_PADDING - monoWidth('M', 30) - 10;
    for (const [ending, summary] of SUMMARIES) {
      expect(monoWidth(summary.verdict, 19, 1), `${ending} verdict`).toBeLessThanOrEqual(beside);
      expect(monoWidth(summary.headline, 13), `${ending} headline`).toBeLessThanOrEqual(beside);
    }
  });

  it('draws a marker that is one character, so the verdict starts where it should', () => {
    // The row is `[marker][verdict]` with the marker sized as a single 30pt glyph. A multi-character
    // marker would push the verdict off the right edge of a phone, and the layout gives it no wrap.
    for (const [ending, summary] of SUMMARIES) {
      expect([...summary.marker], ending).toHaveLength(1);
    }
  });
});

/** WCAG relative luminance of a `#rrggbb` colour. Same arithmetic as `play-theme.test.ts`. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}
