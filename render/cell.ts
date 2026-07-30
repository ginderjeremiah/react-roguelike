/**
 * One cell of the board, and the four states GDD §10 says a player must be able to tell apart.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE FOUR STATES ARE CARRIED BY TWO NON-COLOUR CHANNELS, AND THAT IS A CONSTRAINT ON THIS TYPE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * §10: "Four cell states must be distinguishable at a glance without colour: **lit**,
 * **remembered**, **unknown**, **sensed-but-unseen**." §11 makes it general: colour is never the
 * sole carrier of meaning.
 *
 * That is not a `components/` problem. If the only field separating two states were a `ColorToken`,
 * no choice made above this layer could rescue it — the information would already be gone. So the
 * two channels are **fields**:
 *
 *   | state        | glyph                          | opacity |
 *   | ---          | ---                            | ---     |
 *   | `visible`    | terrain, a creature, or `@`    | 1.00    |
 *   | `sensed`     | `*`, and never anything else   | 0.85    |
 *   | `remembered` | terrain only                   | 0.40    |
 *   | `unknown`    | **blank**                      | 0.00    |
 *
 *   - **Opacity alone separates all four**, because the four values are pairwise distinct. It is a
 *     luminance channel, which is exactly what a colourblind player still reads.
 *   - **Glyph presence separates `unknown` from the rest** — it is the only blank state — and the
 *     glyph *vocabulary* separates `sensed`, whose glyph is always `*`.
 *
 * `accessibility.test.ts` asserts both as properties over real runs, and asserts the stronger form
 * that matters: **no two cells in different states may differ only in their colour fields.**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## Why `visible` and not §10's `lit`
 *
 * §10 wrote the four states before §4's dark column had a name for its terrain sense. With the
 * shutter **open** the perceived terrain is the lit field, and "lit" is exactly right. With the
 * shutter **shut** the player still perceives nine tiles — §4's touch radius — and no light is
 * involved at all. Calling those cells `lit` would make the state name a lie in the vision state the
 * whole game is about, and the alternative (a fifth state for touch) would mean §10's four became
 * five for a distinction the player does not need to make: *you know what is on this tile right now*
 * is one fact however you came by it.
 *
 * So the state is named for the knowledge, matching `game/fov/vision.ts`'s existing
 * `TileKnowledge = 'unknown' | 'remembered' | 'perceived'`, and the **lamplight** that §10's name was
 * reaching for is carried separately and honestly by `tint`. Worth a one-word amendment to §10 — see
 * the journal entry for this PR.
 *
 * ## `sensed` is slightly wider than §10's parenthetical, deliberately
 *
 * §10 glosses the fourth state as "a `*` on a tile whose terrain you have never seen". Read
 * literally, a contact felt on a tile you *remember* would fall into `remembered` and be drawn at
 * memory opacity — a living creature rendered as dim as the stone it is standing on, which is a
 * legibility failure §10 cannot have meant. So `sensed` is **a felt contact on any tile you are not
 * currently perceiving**, which contains §10's case and fixes the one it did not consider. A contact
 * felt on a tile you *are* perceiving (adjacent, in the dark) is `visible`: you know that tile.
 */

import { LIT_RADIUS } from '../game/fov';
import type { ColorToken } from './colors';

/**
 * How much the player knows about this cell **right now**. See the header for the channels.
 *
 * A closed union rather than a pair of booleans: `perceived && !remembered && felt` describes eight
 * states of which four are reachable, and nothing would say which four.
 */
export type CellState =
  /** Perceived this turn — the lit field with the shutter open, the touch radius with it shut. */
  | 'visible'
  /** A living thing felt through stone, on a tile that is not perceived this turn. §4, §10. */
  | 'sensed'
  /** Perceived on an earlier turn and not now. §4: "permanent once seen, dimmed". */
  | 'remembered'
  /** Never perceived, nothing felt. Blank — see `CELL_OPACITY`. */
  | 'unknown';

/** Every state, in a fixed order: most known first. Iterate this. */
export const CELL_STATES: readonly CellState[] = ['visible', 'sensed', 'remembered', 'unknown'];

/**
 * The non-colour channel that carries `CellState`. **Four pairwise-distinct values, and that is the
 * property, not the numbers.**
 *
 * Ordered by how live the information is, which is also how loud the cell should be: what is in
 * front of you now, then a living thing you can feel but not see, then stone you are recalling, then
 * nothing.
 *
 * `sensed` sits *above* `remembered` and close to `visible` on purpose. A `*` is the only warning
 * the dark ever gives (§4), and a warning rendered at memory opacity is a warning nobody reads.
 *
 * The values themselves are presentation tuning and M4 may move them. What M4 may **not** do is make
 * two of them equal, and `accessibility.test.ts` is what says so.
 */
export const CELL_OPACITY: Readonly<Record<CellState, number>> = {
  visible: 1,
  sensed: 0.85,
  remembered: 0.4,
  unknown: 0,
};

/**
 * How much lamplight falls on the cell, `0` to `1`. **Cosmetic, and it must stay that way.**
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * FALLOFF IS A PRESENTATION DERIVATION AND CARRIES NO INFORMATION
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * §10 asks for "light falloff expressed as cell tint". **The simulation has no falloff**: §4's lit
 * field is binary — Chebyshev 4 with line of sight, in or out — and the hard square edge is
 * load-bearing, because §4's metric ruling picked Chebyshev precisely so that "a square edge is
 * countable and grid-aligned ... the player can see where the light ended."
 *
 * So a gradient is invented here, and an invented gradient can lie in two ways. Both are closed:
 *
 *   1. **It must not imply partial knowledge.** A cell is lit or it is not; there is no "half seen".
 *      Tint therefore never crosses the boundary: every lit cell has tint ≥ `LAMP_TINT_EDGE`, every
 *      other cell has tint exactly `0`, and `LAMP_TINT_EDGE > 0`. The step at the edge of the light
 *      is larger than every step inside it, so the countable edge stays countable. Knowledge is
 *      carried by `state`/`opacity`, which tint may not contradict.
 *   2. **It must not leak.** Tint is a pure function of Chebyshev distance from the player's own
 *      tile, and both ends of that measurement are on screen. It can tell the player nothing they
 *      could not work out with a finger.
 *
 * It is also **discrete by construction** — distance is an integer, so there are exactly
 * `LIT_RADIUS + 1` values and no ramp. A continuous gradient computed per pixel is what would read
 * as "fading out of view".
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */
export const LAMP_TINT_EDGE = 0.6;

/** No lamplight at all: shuttered, remembered, sensed, unknown. Distinct from every lit value. */
export const NO_TINT = 0;

/**
 * Lamplight at `distance` tiles (Chebyshev) from the lantern: `1` underfoot, `LAMP_TINT_EDGE` at the
 * edge of the lit field.
 *
 * **Not rounded.** A `Math.round(value * 100) / 100` was written here to keep `0.6999999999999999`
 * out of a DOM snapshot, and a mutation run showed it changes nothing: at `LIT_RADIUS` 4 and
 * `LAMP_TINT_EDGE` 0.6 the five values are 1, 0.9, 0.8, 0.7, 0.6 and every one of them is already
 * exact. It was an unkillable line, and the test written for it could not fail — so it is gone
 * rather than documented, and `cell.test.ts` pins the ramp's five values instead. If a future
 * palette pass moves either constant into float noise, that is the moment to reintroduce it, with
 * a test that fails without it.
 *
 * @throws if `distance` is outside the lit field. A tile further than `LIT_RADIUS` is not lit, and
 *   asking for its tint means the caller has already lost track of which cells are in the field —
 *   extrapolating the ramp would answer with a plausible number instead of reporting that.
 */
export function lampTint(distance: number): number {
  if (!Number.isInteger(distance) || distance < 0 || distance > LIT_RADIUS) {
    throw new Error(
      `render: lamp tint is defined for integer distances 0..${LIT_RADIUS}, got ${distance}`,
    );
  }
  return 1 - (distance / LIT_RADIUS) * (1 - LAMP_TINT_EDGE);
}

/**
 * A creature's declared action, drawn on the tile it marks. GDD §2's telegraph.
 *
 * ## Two non-colour channels, because §2 requires two
 *
 * §2: "The marker must be carried by **two non-color channels** (e.g. cell background *and* a
 * bracket/underline treatment) — colour is never the sole carrier (§11)."
 *
 *   - **`frame`** is a shape. Brackets around the glyph for an attack, an underline for a move. It
 *     separates marked from unmarked, *and* attack from move, with no hue involved.
 *   - **`fill`** is an alpha on the cell's background, not a hue. A filled cell reads as filled in
 *     greyscale, which is what makes it a second channel rather than a restatement of `bg`.
 *
 * The attack's fill is heavier than the move's, so the two are separable on both channels rather
 * than on `frame` alone. `bg` (a `ColorToken`) is the third, chromatic channel, and it is the one
 * that may be dropped without losing the information.
 *
 * **`frame` names a cell decoration, not characters.** `'brackets'` is a border drawn around the
 * cell; it is *not* `'[' + glyph + ']'`. `Cell.glyph` is exactly one character because the board is a
 * monospaced grid, and a cell that renders three characters is a cell wider than its neighbours —
 * which breaks the one thing this whole rendering approach depends on (ADR-0003). The same goes for
 * `'underline'`: a rule under the cell, not a combining character.
 *
 * ## When a telegraph is drawn
 *
 * Only with the shutter **open**, only for a creature the player can **see**, and only on a cell
 * whose terrain is `visible`. §4's table: "Enemy intent | Visible | Hidden" — shuttered, you get the
 * `*` and not the plan. The third condition is the one worth stating: a marked tile that the player
 * has never perceived would draw a box in the dark and hand out one tile of free map knowledge,
 * which is the same defect ADR-0009 rejected as "free map information dressed as a pathfinding
 * detail". It costs almost nothing — a creature's target is one orthogonal step away and the lit
 * field is radius 4 — and what it costs is honest.
 */
export type Telegraph = {
  /** §2: "a declared attack marks its target tile; a declared move marks its destination tile." */
  readonly kind: 'attack' | 'move';
  /** Channel 1, shape. `components/` draws these; it does not choose which. */
  readonly frame: 'brackets' | 'underline';
  /** Channel 2, an alpha on the background. Non-chromatic, so it survives greyscale. */
  readonly fill: number;
};

/** The declared-attack telegraph. Shared immutable value; never written through. */
export const ATTACK_TELEGRAPH: Telegraph = { kind: 'attack', frame: 'brackets', fill: 0.35 };

/** The declared-move telegraph. Lighter than an attack on both channels. */
export const MOVE_TELEGRAPH: Telegraph = { kind: 'move', frame: 'underline', fill: 0.15 };

/**
 * One cell of the board: everything `components/` needs to draw it, and nothing else.
 *
 * Flat and dumb by design (ADR-0003). There is no `Tile` here, no actor, no id — a component that
 * could reach an actor could ask it a question, and the answer would be a game rule living in
 * `components/`.
 *
 * **Cell objects are referentially stable across turns when nothing about them changed**, which is
 * what lets `React.memo` skip a cell without a custom comparator. See `presentScene`.
 */
export type Cell = {
  readonly x: number;
  readonly y: number;
  /** The four states of §10. Carried by `glyph` and `opacity` as well — see the header. */
  readonly state: CellState;
  /** Exactly one character. `' '` when there is nothing to draw. */
  readonly glyph: string;
  readonly fg: ColorToken;
  readonly bg: ColorToken;
  /** Alpha on `bg`. `0` for an ordinary cell; a telegraph's `fill` when one is present. */
  readonly bgAlpha: number;
  /** The §10/§11 non-colour channel for `state`. Always `CELL_OPACITY[state]`. */
  readonly opacity: number;
  /** Lamplight, `LAMP_TINT_EDGE`..`1` inside the lit field and `NO_TINT` everywhere else. */
  readonly tint: number;
  /** A creature's declared action on this tile, or `null`. §2. */
  readonly telegraph: Telegraph | null;
};

/**
 * Are these two cells the same picture?
 *
 * The memoisation predicate, and the reason `Cell` has no nested structure but `Telegraph`: every
 * other field is a primitive, so this is a field-by-field comparison with one shallow descent and no
 * general deep-equality walk. #20's definition of done — "a cell whose model entry is unchanged must
 * not re-render" — is enforced by `presentScene` reusing the previous object when this returns
 * `true`, so this predicate missing a field would mean a stale cell on screen.
 *
 * `cell.test.ts` therefore mutates **every** field in turn and asserts this returns `false` for each,
 * rather than checking a hand-picked two. A comparison that forgets a field is exactly the bug that
 * would otherwise ship as "the telegraph does not clear".
 */
export function sameCell(a: Cell, b: Cell): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.state === b.state &&
    a.glyph === b.glyph &&
    a.fg === b.fg &&
    a.bg === b.bg &&
    a.bgAlpha === b.bgAlpha &&
    a.opacity === b.opacity &&
    a.tint === b.tint &&
    sameTelegraph(a.telegraph, b.telegraph)
  );
}

function sameTelegraph(a: Telegraph | null, b: Telegraph | null): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && a.frame === b.frame && a.fill === b.fill;
}
