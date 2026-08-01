import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COLOR_TOKENS, type ColorToken } from '@/render';
import type { LineLevel } from '@/components/play/messages';
import { statusStyle, TURN_LINE_FONT_SIZE } from '@/components/play/status-style';
import { DARK_THEME, LIGHT_THEME, mixHex, type GameTheme } from '@/components/play/theme';

/**
 * The provisional palette, held to the three things a palette can be *wrong* about before anyone has
 * looked at it. Everything else about colour is M4's and is a matter of taste.
 *
 * This is a Vitest suite over files in `components/` — which the rest of that directory does not get,
 * because the rest of it imports React Native and is verified by Playwright (ADR-0005). `theme.ts`
 * and `cell-style.ts` are deliberately plain TypeScript for exactly this reason: the palette is data
 * and the cell paint is arithmetic, and both are cheaper and sharper to check here than through a
 * browser.
 */

const THEMES: readonly (readonly [string, GameTheme])[] = [
  ['dark', DARK_THEME],
  ['light', LIGHT_THEME],
];

/** WCAG relative luminance of a `#rrggbb` colour. */
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

/** The tokens that are drawn *on* something rather than being the something. */
const FOREGROUND: readonly ColorToken[] = COLOR_TOKENS.filter(
  (token) => token !== 'void' && token !== 'surface',
);

/** The things that can kill you or save you. §10's "at a glance" applies to these hardest. */
const LIVE: readonly ColorToken[] = ['player', 'creature', 'contact', 'ember', 'stairs'];

describe('the theme is a total mapping', () => {
  it('has a colour for every token `render/` can emit, in both schemes', () => {
    // THE COMPLETENESS CHECK, driven by `COLOR_TOKENS` rather than by `Object.keys` of the table —
    // which is the difference between "a new token is a test failure" and "a new token is a
    // transparent cell that might be the creature about to kill you". `render/colors.ts` exports the
    // list for this.
    for (const [name, theme] of THEMES) {
      for (const token of COLOR_TOKENS) {
        expect(theme.token[token], `${name}/${token}`).toMatch(/^#[0-9a-f]{6}$/);
      }
      expect(Object.keys(theme.token).sort(), name).toEqual([...COLOR_TOKENS].sort());
    }
  });

  it('gives every other colour in the theme a value too', () => {
    // The frame around the board is not driven by tokens, so nothing above would catch a missing
    // panel colour — which renders as a transparent HUD over the void.
    for (const [name, theme] of THEMES) {
      const colours = [
        theme.background,
        theme.text,
        theme.textDim,
        theme.panel,
        theme.border,
        theme.lamp,
        theme.reach,
        theme.meter.ok,
        theme.meter.low,
        theme.meter.critical,
        theme.line.alarm,
        theme.line.report,
      ];
      for (const colour of colours) expect(colour, name).toMatch(/^#[0-9a-f]{6}$/);
      expect(theme.lampStrength, name).toBeGreaterThan(0);
      expect(theme.lampStrength, name).toBeLessThanOrEqual(1);
    }
  });

  it('never collapses two tokens onto one value', () => {
    // `render/` distinguished these roles; a theme that maps two of them to the same hex throws that
    // away BELOW the point where any test in `render/` can see it — `accessibility.test.ts` asserts
    // over `ColorToken`s, not over pixels. This is the only place that failure is visible.
    for (const [name, theme] of THEMES) {
      const values = COLOR_TOKENS.map((token) => theme.token[token]);
      expect(new Set(values).size, `${name}: ${values.join(' ')}`).toBe(COLOR_TOKENS.length);
    }
  });

  it('never collapses the turn line’s two levels either (§10, #94)', () => {
    // The same rule, extended to the one non-token pair that carries meaning. §10 ruled the
    // `alarm`/`report` pair closed and said in as many words that "a theme may not map both to the
    // same value" — which is the one edit that would satisfy every other assertion in this file
    // while deleting the distinction #94 exists to create.
    //
    // The two named rejections are asserted as well, because both are things a future retune would
    // do without noticing. `token.creature` is a *board* role — it means "a creature seen in light",
    // it is wrong for `You take N.` and `The lantern goes out.`, and sharing the value would let a
    // board retune silently move the chrome. And `textDim` may still *equal* `report` by value
    // today, so what is pinned is the thing that must not be true of `alarm`.
    for (const [name, theme] of THEMES) {
      expect(theme.line.alarm, `${name}: the two levels must not be one colour`).not.toBe(
        theme.line.report,
      );
      expect(theme.line.alarm, `${name}: alarm is chrome, not the creature glyph`).not.toBe(
        theme.token.creature,
      );
      expect(theme.line.alarm, `${name}: an alarm cannot be the dim label colour`).not.toBe(
        theme.textDim,
      );
    }
  });

  it('is two different themes, not one table copied', () => {
    // A light mode that is the dark table with a different name is a light mode nobody has looked
    // at. Cheap, but it is the failure mode of "add a second theme" as a task.
    const shared = COLOR_TOKENS.filter(
      (token) => DARK_THEME.token[token] === LIGHT_THEME.token[token],
    );
    expect(shared).toEqual([]);
  });
});

describe('the board is legible in both schemes', () => {
  it('holds the known board apart from the unexplored dark', () => {
    // §10's four states are carried by opacity and glyph, so this is not what makes them legible —
    // but an `unknown` cell is drawn on `void` and a `remembered` one on `surface`, and if those two
    // matched, the explored part of the floor would have no shape at all.
    for (const [name, theme] of THEMES) {
      expect(contrast(theme.token.void, theme.token.surface), name).toBeGreaterThan(1.1);
      expect(theme.background, name).toBe(theme.token.void);
    }
  });

  it('keeps every glyph visible against the surface it sits on, lit or unlit', () => {
    // Checked against BOTH the plain surface and a fully lit one, because lamplight is mixed into the
    // background (`cell-style.ts`) and a wash that is bright enough to see is also bright enough to
    // swallow a dim glyph. The floor's `·` is deliberately quiet — it is a texture, not a subject —
    // so the bar for "visible at all" is low and stated rather than pretended to be 4.5.
    for (const [name, theme] of THEMES) {
      const lit = mixHex(theme.token.surface, theme.lamp, theme.lampStrength);
      for (const token of FOREGROUND) {
        expect(contrast(theme.token[token], theme.token.surface), `${name}/${token}`)
          .toBeGreaterThan(1.5);
        expect(contrast(theme.token[token], lit), `${name}/${token} lit`).toBeGreaterThan(1.5);
      }
    }
  });

  it('gives the things that can kill you real contrast, not merely visible contrast', () => {
    // The player, a creature, a felt contact, ember on the ground, and the stairs. A glyph grid lives
    // or dies on finding these at a glance; 4.5:1 is WCAG's body-text bar and these are read like
    // text.
    //
    // The bar drops to 3:1 against a **fully lit** cell, and the reason is stated rather than
    // reverse-engineered from what happened to pass: 3:1 is the bar for large text and for graphical
    // objects, a cell glyph is ~23pt, and holding 4.5 against the lamplight wash would force
    // `lampStrength` down until the lit field stopped being visible — trading the thing §4 says the
    // player must be able to see (where the light ended) for a margin on the thing they already can.
    for (const [name, theme] of THEMES) {
      const lit = mixHex(theme.token.surface, theme.lamp, theme.lampStrength);
      for (const token of LIVE) {
        expect(contrast(theme.token[token], theme.token.surface), `${name}/${token}`)
          .toBeGreaterThan(4.5);
        expect(contrast(theme.token[token], lit), `${name}/${token} lit`).toBeGreaterThan(3);
      }
    }
  });

  it('keeps the HUD readable on its own panel', () => {
    for (const [name, theme] of THEMES) {
      expect(contrast(theme.text, theme.panel), `${name} text`).toBeGreaterThan(4.5);
      // Labels and units are quieter on purpose, but a label nobody can read is a label nobody put
      // there — 3:1 is the large-text/graphical bar.
      expect(contrast(theme.textDim, theme.panel), `${name} dim`).toBeGreaterThan(3);
      for (const level of ['ok', 'low', 'critical'] as const) {
        expect(contrast(theme.meter[level], theme.panel), `${name} ${level}`).toBeGreaterThan(3);
      }
    }
  });

  it('makes lamplight visible as a warm step, and the edge of the light the biggest step of all', () => {
    // §4 chose Chebyshev so that "the player can see where the light ended", and `render/cell.ts`
    // keeps the tint ramp discrete for the same reason. That only survives into pixels if the
    // theme's lamp actually moves the colour — a `lampStrength` tuned to nothing would leave a flat
    // board with an invisible boundary.
    // The tint ramp is 1, 0.9, 0.8, 0.7, 0.6 inside the field and 0 outside (`render/cell.ts`), so
    // the interesting comparison is the step *at the boundary* against the step one tile inside it.
    // Magnitudes, not signed differences: in light mode the lamp is warmer and slightly darker than
    // the page, which is what light on paper looks like — the step is what has to be visible, not
    // its direction.
    for (const [name, theme] of THEMES) {
      const unlit = theme.token.surface;
      const edge = mixHex(unlit, theme.lamp, 0.6 * theme.lampStrength);
      const oneIn = mixHex(unlit, theme.lamp, 0.7 * theme.lampStrength);
      const centre = mixHex(unlit, theme.lamp, theme.lampStrength);

      expect(edge, name).not.toBe(unlit);
      expect(centre, name).not.toBe(edge);
      expect(Math.abs(luminance(edge) - luminance(unlit)), name).toBeGreaterThan(
        Math.abs(luminance(oneIn) - luminance(edge)),
      );
    }
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * §11's TEST FOR THE TURN LINE — TWO CHANNELS, ONE OF THEM NOT COLOUR, IN BOTH SCHEMES
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * GDD §11 forbids colour as the sole carrier of anything, and §10 (#94) applies that to the turn
 * line's two emphasis levels **and rejects the usual escape hatch**: the tempting defence is that
 * the sentences differ so the distinction survives greyscale, and it is rejected because it is the
 * same defence that would justify changing nothing at all. A carrier that only works once you have
 * read the sentence is not a carrier for a signal whose entire job is to be caught before you read
 * it.
 *
 * So this is the assertion that must not be allowed to degrade into "the colours differ". It reads
 * the **actual style objects** `StatusLine` paints with — `statusStyle` is the only thing in the
 * component that varies with the level — rather than a table transcribed into the test, which would
 * agree with itself forever.
 */
const LEVELS: readonly LineLevel[] = ['alarm', 'report'];

/** The rest of the screen's type ramp, read out of the source rather than remembered. */
const RAMP = (() => {
  const read = (file: string) =>
    fs.readFileSync(path.resolve(__dirname, '../../components/play', file), 'utf8');
  const size = (source: string, block: string): number => {
    const found = new RegExp(`${block}: \\{[^}]*fontSize: (\\d+)`, 's').exec(source);
    if (found === null) throw new Error(`play-theme: no fontSize in \`${block}\` — update this test`);
    return Number(found[1]);
  };
  const weight = (source: string, block: string): number => {
    const found = new RegExp(`${block}: \\{[^}]*fontWeight: '(\\d+)'`, 's').exec(source);
    if (found === null) throw new Error(`play-theme: no fontWeight in \`${block}\` — update this`);
    return Number(found[1]);
  };
  const controls = read('controls.tsx');
  const hud = read('hud-bar.tsx');
  return {
    /** `CLOSE SHUTTER`. The turn line may equal this size and must be at least this heavy. */
    controlLabel: { size: size(controls, 'label'), weight: weight(controls, 'label') },
    /** `then burning 1 per turn`. The turn line must rank strictly above every caption. */
    controlHint: size(controls, 'hint'),
    /** `FUEL`/`HP`. The only thing on screen allowed to be larger than the turn line. */
    hudValue: size(hud, 'value'),
  };
})();

describe('the turn line’s two levels are told apart without colour (§10/§11, #94)', () => {
  it('differs in at least two channels, one of which is not colour, in both schemes', () => {
    // THE §11 TEST. Computed over the style object's own keys, so a third channel added later is
    // counted automatically and a channel *removed* later cannot quietly take the count to one.
    for (const [name, theme] of THEMES) {
      const alarm = statusStyle('alarm', theme);
      const report = statusStyle('report', theme);

      const differing = (Object.keys(alarm) as (keyof typeof alarm)[]).filter(
        (key) => alarm[key] !== report[key],
      );
      expect(differing.length, `${name}: ${JSON.stringify({ alarm, report })}`).toBeGreaterThanOrEqual(2);
      expect(
        differing.filter((key) => key !== 'color'),
        `${name}: colour is the only thing telling an alarm from a report`,
      ).not.toHaveLength(0);
    }
  });

  it('makes weight the non-colour carrier, at least as heavy as the control labels', () => {
    // §10: "`alarm` is drawn strictly heavier than `report`, and at least as heavy as the control
    // labels. It survives greyscale, every colourblindness, and both schemes." The control label is
    // read out of `controls.tsx`, so a repaint that made `CLOSE SHUTTER` heavier than the wake line
    // fails here instead of shipping.
    for (const [name, theme] of THEMES) {
      const alarm = Number(statusStyle('alarm', theme).fontWeight);
      const report = Number(statusStyle('report', theme).fontWeight);
      expect(alarm, `${name}: an alarm must be strictly heavier than a report`).toBeGreaterThan(report);
      expect(alarm, `${name}: and at least as heavy as CLOSE SHUTTER`).toBeGreaterThanOrEqual(
        RAMP.controlLabel.weight,
      );
    }
  });

  it('shares one raised size, above every caption and no larger than the HUD', () => {
    // §10 ruled the ordinal position rather than a number: above every caption and sub-label, may
    // equal the control-label size, and only the HUD's values may be larger. A **per-level** size is
    // rejected — the row is fixed height so the board does not jump, and §11's text scaling
    // multiplies whatever is chosen, which would land reflow risk on the message that must not
    // reflow. So the two sizes must be equal *and* correctly placed in the ramp.
    for (const [name, theme] of THEMES) {
      const sizes = LEVELS.map((level) => statusStyle(level, theme).fontSize);
      expect(new Set(sizes).size, `${name}: the two levels must share one size`).toBe(1);
      expect(sizes[0], name).toBe(TURN_LINE_FONT_SIZE);
    }
    expect(TURN_LINE_FONT_SIZE, 'the turn line must rank above every caption').toBeGreaterThan(
      RAMP.controlHint,
    );
    expect(TURN_LINE_FONT_SIZE, 'it may equal the control label, never exceed it').toBeLessThanOrEqual(
      RAMP.controlLabel.size,
    );
    expect(TURN_LINE_FONT_SIZE, 'only the HUD values may be larger').toBeLessThan(RAMP.hudValue);
  });

  it('keeps both levels readable where they are actually drawn', () => {
    // The row sits on the screen background, between the board and the panel the controls are on, so
    // both surfaces are asked. 3:1 is the large-text/graphical bar and is what `textDim` is already
    // held to above; the alarm is held higher because it is the line that has to be caught at a
    // glance, which is the entire finding behind #94.
    for (const [name, theme] of THEMES) {
      for (const level of LEVELS) {
        const colour = statusStyle(level, theme).color;
        expect(contrast(colour, theme.background), `${name}/${level} on the page`).toBeGreaterThan(3);
        expect(contrast(colour, theme.panel), `${name}/${level} on the panel`).toBeGreaterThan(3);
      }
      // And the loud one is the higher-contrast one, in both schemes — brighter than the report in
      // the dark, darker than it on the page. That is the half of the colour difference that
      // survives a greyscale screenshot, and it is a direction rather than a hue.
      expect(
        contrast(theme.line.alarm, theme.background),
        `${name}: an alarm must not be quieter than a report`,
      ).toBeGreaterThan(contrast(theme.line.report, theme.background));
    }
  });
});

describe('mixHex', () => {
  it('is the identity at 0 and the destination at 1', () => {
    expect(mixHex('#102030', '#a0b0c0', 0)).toBe('#102030');
    expect(mixHex('#102030', '#a0b0c0', 1)).toBe('#a0b0c0');
  });

  it('interpolates each channel and pads the result', () => {
    // The padding is not cosmetic: `#0a0b0c` unpadded becomes `#abc`, which is a *different colour*
    // that React Native will happily accept.
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#000000', '#141414', 0.5)).toBe('#0a0a0a');
  });

  it('clamps rather than extrapolating past either end', () => {
    expect(mixHex('#000000', '#ffffff', 2)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', -1)).toBe('#000000');
  });

  it('refuses a colour it cannot parse instead of inventing one', () => {
    // A silent fallback here paints a cell in a colour nobody chose, on a board where colour is a
    // role. `red`, `#abc` and `rgba(...)` are all things React Native accepts and this must not.
    expect(() => mixHex('red', '#000000', 0.5)).toThrow(/not a #rrggbb colour/);
    expect(() => mixHex('#abc', '#000000', 0.5)).toThrow(/not a #rrggbb colour/);
    expect(() => mixHex('#000000', 'rgba(0,0,0,0.5)', 0.5)).toThrow(/not a #rrggbb colour/);
  });
});
