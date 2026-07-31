/**
 * One `Cell` of the presentation model, turned into the three or four style values that draw it.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * `opacity` AND `tint` ARE INDEPENDENT CHANNELS. MULTIPLYING THEM ERASES THE GAME.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `render/cell.ts` states this at the declaration of `tint`, and it is worth repeating at the one
 * place that could get it wrong:
 *
 * > `tint` is `0` on every remembered cell and on every cell of a shuttered board — so a consumer
 * > that reasonably writes `opacity * tint` erases the entire remembered map, and the whole screen
 * > in the dark.
 *
 * Nothing in `render/`'s tests can catch that, because the mistake is not expressible there. So this
 * module is shaped so the mistake is hard to write:
 *
 *   - **`tint` reaches exactly one function, `lamplit`, which never sees `opacity`.** It answers a
 *     *colour*: how much lamplight is mixed into the cell's background.
 *   - **`opacity` is copied straight through, and touches nothing else.** It is §10's non-colour
 *     channel for cell state and it is the whole of how a player tells lit from remembered.
 *
 * The two never appear in the same expression. `tests/unit/cell-style.test.ts` asserts the outcome
 * rather than the shape — a shuttered board's cells still draw at full opacity, and a remembered cell
 * still draws at 0.4 — so the guard survives a refactor that changes these function names.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## Where the lamplight goes, and why not on the glyph
 *
 * §10 asks for falloff "expressed as cell tint". It is applied to the **background** only. Mixing it
 * into the foreground was the first attempt and it is wrong twice: at full tint every glyph in the
 * lit field converges on the lamp's own amber, which deletes the role colour §11 relies on being
 * there alongside the shape; and in light mode, warming a dark glyph *lowers* its contrast against
 * the page, so the best-lit tiles would be the hardest to read. A warm wash behind the glyphs says
 * "the lantern reaches here" without either.
 *
 * ## The telegraph is composed here, not in `render/`
 *
 * A telegraphed cell arrives with `bg` naming the telegraph's colour and `bgAlpha` naming how
 * strongly it is laid on. What it is laid on *is* the surface — `render/cell.ts` guarantees a
 * telegraph is only ever drawn on a `visible` cell — so the base is `surface` and the composition is
 * one `mixHex`. Reading that guarantee is not the same as re-deriving the rule: nothing here decides
 * *whether* a cell is telegraphed.
 */

import type { Cell } from '@/render';
import { mixHex, type GameTheme } from './theme';

/** Everything needed to draw one cell. Flat values; no rules, no `Cell` left in it. */
export type CellPaint = {
  /** The glyph's colour. Never touched by lamplight — see the header. */
  readonly color: string;
  /** The cell's fill: its surface, plus any telegraph wash, plus any lamplight. */
  readonly backgroundColor: string;
  /**
   * §10's non-colour channel for cell state, passed through **unmodified**. `1` lit, `0.85` sensed,
   * `0.4` remembered, `0` unknown.
   */
  readonly opacity: number;
  /** §2's telegraph shape, or `null`. A cell decoration — never characters around the glyph. */
  readonly frame: 'brackets' | 'underline' | null;
  /** The ink for `frame`. Meaningless when `frame` is `null`. */
  readonly frameColor: string;
};

/** The paint for one cell under one theme. Pure, total, and allocating one small object. */
export function paintCell(cell: Cell, theme: GameTheme): CellPaint {
  const surface = theme.token[cell.bg];
  const base =
    cell.bgAlpha === 0 ? surface : mixHex(theme.token.surface, theme.token[cell.bg], cell.bgAlpha);

  return {
    color: theme.token[cell.fg],
    backgroundColor: lamplit(base, cell.tint, theme),
    // `cell.opacity`, alone, and it must stay alone. See the header.
    opacity: cell.opacity,
    frame: cell.telegraph === null ? null : cell.telegraph.frame,
    frameColor: theme.token[cell.bg],
  };
}

/**
 * A cell's background with `tint` worth of lamplight mixed in.
 *
 * **Takes no opacity, and must not be given one.** `tint` is `0` for everything outside the lit
 * field, which makes this the identity for every remembered cell and for every cell of a shuttered
 * board — exactly the cells whose `opacity` is the only thing keeping them on screen.
 */
function lamplit(base: string, tint: number, theme: GameTheme): string {
  if (tint === 0) return base;
  return mixHex(base, theme.lamp, tint * theme.lampStrength);
}
