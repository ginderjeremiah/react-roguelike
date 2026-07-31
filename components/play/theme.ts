/**
 * The provisional palette: `render/`'s semantic tokens, given values.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THIS IS THE LAYER THAT IS ALLOWED TO KNOW WHAT COLOUR ANYTHING IS
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `render/colors.ts` emits **roles** — `'wall'`, `'creature'`, `'telegraphAttack'` — and no hex
 * codes, for two reasons it argues at length: a hex cannot be dark-mode aware and a role can, and
 * GDD §10 defers the palette to M4. So the values live here, one table per scheme, and swapping them
 * is a change to this file and to nothing else.
 *
 * **These numbers are provisional and are expected to move.** M4 owns colour and typography; what
 * this file owes the project until then is (a) a total mapping, so no token renders as transparent,
 * and (b) enough contrast that the first playtest is about the game rather than about squinting.
 * `tests/unit/game-theme.test.ts` holds both to account.
 *
 * ## What this table may not do
 *
 * **It may not collapse two tokens onto one value.** `render/` went to the trouble of distinguishing
 * them; a theme that maps `wall` and `pillar` to the same grey has thrown information away *below*
 * the point where any test in `render/` can see it. That is asserted, not asked for.
 *
 * It also may not become the sole carrier of anything (§11) — but that one is already safe by
 * construction, because every distinction `render/` expresses in colour it also expresses in a glyph,
 * an opacity, or a telegraph frame (`render/accessibility.test.ts`). This file cannot break that; it
 * can only fail to take advantage of it.
 *
 * ## Two colours that are not tokens
 *
 * `lamp` and `lampStrength` implement §10's "light falloff expressed as cell tint". They belong to
 * the theme rather than to `render/` because they are *values* — `render/` hands over a number from
 * 0 to 1 per cell (`Cell.tint`) and says nothing about what warm looks like. See `cell-style.ts` for
 * how the two are combined, and for the rule that keeps `tint` and `opacity` apart.
 */

import type { ColorToken } from '@/render';

/** Every colour the game screen uses. Tokens for the board; the rest for the frame around it. */
export type GameTheme = {
  /** `render/`'s vocabulary, in full. A `Record` over the union, so a new token is a type error. */
  readonly token: Readonly<Record<ColorToken, string>>;
  /** Behind everything, including outside the board. Matches `token.void` so the board has no seam. */
  readonly background: string;
  /** HUD and control text. */
  readonly text: string;
  /** Labels and units — present, but never competing with the number beside them. */
  readonly textDim: string;
  /** Panel fill for the HUD and the thumb controls. */
  readonly panel: string;
  /** Hairlines between panels and around controls. */
  readonly border: string;
  /** §11: a meter's severity may drive colour **only** because the number is always beside it. */
  readonly meter: Readonly<Record<'ok' | 'low' | 'critical', string>>;
  /** The lamplight mixed into a lit cell's background, in proportion to `Cell.tint`. */
  readonly lamp: string;
  /** How much lamplight a fully lit cell gets, `0`..`1`. Tuning; see `cell-style.ts`. */
  readonly lampStrength: number;
  /** The ring drawn on a tile a tap will act on. Shape carries the action; this is only the ink. */
  readonly reach: string;
};

/**
 * Dark first, because the game is about a lantern in the dark and this is the scheme it will be
 * played in. "A beautiful terminal" (ADR-0003) rather than a black background with pure-hue text:
 * the void is warm-black, the known board is one step above it, and the only saturated colours on
 * screen are the things that can kill you or save you.
 */
export const DARK_THEME: GameTheme = {
  token: {
    void: '#070606',
    surface: '#201b15',
    // Terrain: readable, and quiet in that order. The floor is a texture, not a subject — but it is
    // still held above the surface by enough margin to be seen at 40% (a remembered cell).
    wall: '#8a8073',
    floor: '#5f5a51',
    pillar: '#a89880',
    doorway: '#c9974a',
    entrance: '#8fa3bd',
    stairs: '#6fd3bf',
    ember: '#f0a92e',
    // The living. Saturated on purpose: these three are the only tokens that move.
    player: '#fdf6e8',
    creature: '#ea6647',
    contact: '#c07de6',
    // Telegraphs are used twice — washed over the cell at `bgAlpha`, and at full strength as the
    // frame around it — so they have to work dark-on-dark *and* as a line. See `cell-style.ts`.
    telegraphAttack: '#d94f3d',
    telegraphMove: '#5f86b8',
  },
  background: '#070606',
  text: '#e8e0d2',
  textDim: '#9a9083',
  panel: '#14110d',
  border: '#2c261e',
  meter: { ok: '#8fc98a', low: '#e0b04a', critical: '#e2593c' },
  lamp: '#ffb648',
  lampStrength: 0.14,
  reach: '#e8e0d2',
};

/**
 * Light mode is a lit page rather than an inverted terminal, and the one thing it has to get right is
 * that **the known board is brighter than the unknown**. Inverting the dark theme would put the
 * unexplored parts of the floor in white, which reads as "this is the paper" instead of "this is the
 * dark", and the four §10 states stop making sense at a glance.
 */
export const LIGHT_THEME: GameTheme = {
  token: {
    void: '#d8cfbd',
    surface: '#f4ede0',
    wall: '#6d6152',
    floor: '#b3a894',
    pillar: '#5c5245',
    doorway: '#8a5a1f',
    entrance: '#47597a',
    stairs: '#12695c',
    ember: '#8f5205',
    player: '#14110d',
    creature: '#a8321c',
    contact: '#6b3ba8',
    telegraphAttack: '#c0392b',
    telegraphMove: '#3f6fa8',
  },
  background: '#d8cfbd',
  text: '#1d1a15',
  textDim: '#6a6154',
  panel: '#efe7d8',
  border: '#c3b8a3',
  meter: { ok: '#2f6f38', low: '#8a5a10', critical: '#a8321c' },
  lamp: '#ffcf70',
  lampStrength: 0.45,
  reach: '#1d1a15',
};

/**
 * Blend two `#rrggbb` colours. `t` is how much of `b` ends up in the result: `0` is `a` unchanged.
 *
 * Plain sRGB interpolation rather than a perceptual space. It is what a compositor does when it
 * draws one colour over another at an alpha, which is exactly the operation being modelled here —
 * a telegraph wash and a lamplight glow are both "this colour, over that one".
 *
 * @throws on anything that is not a six-digit hex colour. A silent fallback here is a cell that
 *   renders in a colour nobody chose, on a board where colour is a role.
 */
export function mixHex(a: string, b: string, t: number): string {
  const from = channels(a);
  const to = channels(b);
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const mixed = from.map((value, index) => Math.round(value + (to[index] - value) * clamped));
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function channels(hex: string): [number, number, number] {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`theme: "${hex}" is not a #rrggbb colour`);
  }
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}
