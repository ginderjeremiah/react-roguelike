/**
 * `GameState` -> a board. The whole of this layer's job, in one function.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT GOES ON A CELL, AND IN WHAT ORDER
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A cell shows **one** glyph. Everything on this list can occupy the same tile, so the order is a
 * decision rather than an accident, and it is the order of *how much the player needs it*:
 *
 *   1. **The player** (`@`). You always know where you are, so this can never be occluded.
 *   2. **A felt contact** (`*`). §4: shuttered, ember-sense gives position and nothing else — so
 *      this outranks the stone underneath it. The player loses one tile of terrain and gains the
 *      one thing the dark ever tells them. (It cannot collide with 3: identity and touch are the
 *      two columns of §4's table and the shutter is in one position at a time.)
 *   3. **A seen creature** (`c`/`C`). §4's lit column: "visible in the lit radius, **identified**".
 *   4. **An ember drop**, with the shutter open. §4: "Items / ember caches — visible in the lit
 *      radius / **invisible**" while shuttered.
 *   5. **The terrain**, if the cell is `visible` or `remembered`.
 *   6. **Nothing.** `unknown` cells are blank. Not a dot, not a shade of the wall behind them.
 *
 * ## The one place this layer knowingly diverges from §4, and why it is not fixable here
 *
 * §4 makes items **invisible while shuttered**. An ember *drop* is an actor-layer value with a
 * position, so rule 4 above implements that exactly. An ember **cache is terrain** — a `cache` tile
 * — and `game/systems/light.ts` phase 3 folds *everything* `perceive` returns into permanent memory,
 * including a cache tile felt by touch in the dark. So a cache you shuffle past shuttered is
 * remembered, and this layer draws what the player is recorded as knowing.
 *
 * The fix does not belong here. Suppressing the glyph would put a §4 rule in `render/` while
 * `vision.remembered` — the simulation's own record of what has been seen — went on saying the
 * opposite, which is the two-sources-of-truth failure this codebase keeps refusing. It is a
 * `game/fov/` question (does touch perceive a cache as a cache, or as floor?) and it may well be a
 * `game-designer` one. **Issue #41.** Delete this note when that lands.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * CELLS ARE REFERENTIALLY STABLE, AND THAT IS A PROPERTY OF THIS MODEL RATHER THAN OF `components/`
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * #20's definition of done: *a cell whose model entry is unchanged must not re-render.* A ~165-cell
 * board is ~165 `View`s against a 16ms frame budget (ADR-0003), and the cheapest possible answer is
 * `React.memo` with the **default** comparator — which needs the cell object to be the same object
 * as last turn.
 *
 * That is not something `components/` can arrange after the fact: if this function allocates 165
 * fresh objects every turn, every memo misses and the seam has handed the renderer a problem it
 * cannot solve. So `presentScene` takes the previous `Scene` and reuses each cell object whose
 * picture is unchanged (`sameCell`), the `cells` array when *no* cell changed, and the `grid` object
 * with it.
 *
 * Two consequences worth knowing:
 *
 *   - **`previous` is an optimisation and never an input to the answer.** `presentScene(s)` and
 *     `presentScene(s, anything)` are structurally identical; only object identity differs.
 *     `scene.test.ts` asserts that against a hostile `previous` built from a different state, because
 *     a reuse predicate that got it wrong would show the player a stale board and nothing else would
 *     fail.
 *   - **The reuse is only as good as `sameCell`.** A field it forgets is a cell that never updates.
 *     `cell.test.ts` mutates every field in turn for exactly that reason.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

import { assertNever, type GameState } from '../game/core';
import { declaredIntent, playerOf, type CreatureActor, type Intent } from '../game/entities';
import { hasTile, perceive, type CreatureSense, type TileSet } from '../game/fov';
import {
  chebyshevDistance,
  positionOf,
  tileIndex,
  type Grid,
  type Position,
  type Tile,
} from '../game/map';
import type { ColorToken } from './colors';
import {
  ATTACK_TELEGRAPH,
  CELL_OPACITY,
  lampTint,
  MOVE_TELEGRAPH,
  NO_TINT,
  sameCell,
  type Cell,
  type CellState,
  type Telegraph,
} from './cell';
import { GLYPHS, glyphForCreature, glyphForTile } from './glyphs';
import { presentHud, type Hud } from './hud';
import { livingCreaturePositions } from './perception';

/** The board: dimensions, and one cell per tile, row-major. Mirrors `Grid`'s layout exactly. */
export type SceneGrid = {
  readonly width: number;
  readonly height: number;
  /** Row-major, exactly `width * height` cells. `index = y * width + x`. */
  readonly cells: readonly Cell[];
};

/** Everything on screen for one state: the board and the frame around it. */
export type Scene = {
  readonly grid: SceneGrid;
  readonly hud: Hud;
};

/**
 * Everything one pass over the grid needs, gathered once so the per-cell loop is a lookup rather
 * than a search. Local to this module; nothing outside needs to know it exists.
 */
type Overlays = {
  readonly perceived: TileSet;
  readonly remembered: TileSet;
  readonly playerAt: Position;
  /** `true` while the lit field is real light rather than the touch radius. Drives `tint`. */
  readonly lamplit: boolean;
  /** Tile index -> how the creature there is perceived. From `perceive`, never from `actors`. */
  readonly contacts: ReadonlyMap<number, CreatureSense['kind']>;
  /** Tile index -> the creature there, **only for tiles perceived as `seen`**. */
  readonly identified: ReadonlyMap<number, CreatureActor>;
  /** Tile index -> total ember waiting there. Empty while shuttered (§4: items are invisible). */
  readonly embers: ReadonlySet<number>;
  /** Tile index -> a declared action marking it. Empty while shuttered (§4: intent is hidden). */
  readonly telegraphs: ReadonlyMap<number, Telegraph>;
};

/**
 * The board and the HUD for one state.
 *
 * @param previous the scene this one replaces, for cell reuse. Purely an optimisation — see the
 *   header. Omitting it produces the same board.
 */
export function presentScene(state: GameState, previous?: Scene | null): Scene {
  return {
    grid: presentGrid(state, previous?.grid ?? null),
    hud: presentHud(state),
  };
}

function presentGrid(state: GameState, previous: SceneGrid | null): SceneGrid {
  const grid = state.world.floor.grid;
  const overlays = gatherOverlays(state);

  // A previous grid of a different shape is a different floor; nothing in it can be reused.
  const reusable =
    previous !== null && previous.width === grid.width && previous.height === grid.height
      ? previous.cells
      : null;

  const cells: Cell[] = new Array<Cell>(grid.tiles.length);
  let allReused = reusable !== null;
  for (let index = 0; index < grid.tiles.length; index += 1) {
    const fresh = buildCell(grid, index, overlays);
    const old = reusable === null ? null : reusable[index];
    if (old !== null && sameCell(old, fresh)) {
      cells[index] = old;
    } else {
      cells[index] = fresh;
      allReused = false;
    }
  }

  // Nothing on the board moved: hand back the previous array and object, so a memo above the grid
  // can skip the whole thing too. `previous` is non-null whenever `allReused` is.
  if (allReused && previous !== null) return previous;
  return { width: grid.width, height: grid.height, cells };
}

function gatherOverlays(state: GameState): Overlays {
  const world = state.world;
  const grid = world.floor.grid;
  const vision = state.lantern.vision;
  const playerAt = playerOf(world).at;

  // The real creature list, through `perceive` — see `perception.ts` for why that matters twice.
  const perception = perceive(grid, vision, playerAt, livingCreaturePositions(world));

  const contacts = new Map<number, CreatureSense['kind']>();
  for (const sense of perception.creatures) {
    contacts.set(tileIndex(grid, sense.at.x, sense.at.y), sense.kind);
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // THE ONLY DOOR BETWEEN A PERCEIVED CREATURE AND ITS IDENTITY
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  //
  // A creature reaches this map **only** where the sense says `seen`. That is §4's "position only"
  // as control flow rather than as a promise, and two rules fall out of it rather than being
  // written a second time somewhere else:
  //
  //   - A `felt` contact has no species, no HP and no dormancy on screen, because there is nothing
  //     here to look one up in.
  //   - **Enemy intent is hidden while shuttered** (§4's table), because `seen` only ever happens
  //     with the shutter open, so this map is empty in the dark and `gatherTelegraphs` has nothing
  //     to iterate. An explicit `if (shuttered) return no telegraphs` was written, and a mutation
  //     run showed deleting it changed nothing — an unkillable line. It is gone; this is why.
  //
  // `contacts.get(index) === 'seen'` is **not** interchangeable with `contacts.has(index)`. An
  // earlier note here said it was, on the grounds that `faceOf` checks for a `felt` contact before
  // it ever consults this map, so a felt creature that slipped in could not be *drawn*. That
  // argument is sound and it covers exactly one of this map's two consumers. `gatherTelegraphs`
  // reads it as well and has no such prior branch: loosen the check and a creature the player can
  // only feel starts telegraphing, and — adjacent, in the dark — its declared attack is painted on
  // the tile the player is standing on. That is §4's "Enemy intent | Visible | **Hidden**" deleted
  // by one token, which is the reason the strict form is the code and not a stylistic preference.
  //
  // `scene.test.ts`'s "hides the intent of a creature standing right beside you in the dark" kills
  // that mutant, and adjacency is what makes it killable: a creature far enough off to be out of
  // ember-sense is not in `contacts` at all, so a test using one passes without ever reaching here.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const identified = new Map<number, CreatureActor>();
  for (const actor of world.actors) {
    if (actor.kind !== 'creature') continue;
    const index = tileIndex(grid, actor.at.x, actor.at.y);
    if (contacts.get(index) === 'seen') identified.set(index, actor);
  }

  const lamplit = vision.shutter === 'open';

  const embers = new Set<number>();
  if (lamplit) {
    for (const drop of world.embers) embers.add(tileIndex(grid, drop.at.x, drop.at.y));
  }

  return {
    perceived: perception.terrain,
    remembered: vision.remembered,
    playerAt,
    lamplit,
    contacts,
    identified,
    embers,
    telegraphs: gatherTelegraphs(grid, identified, perception.terrain),
  };
}

/**
 * §2's telegraphs, for the creatures the player can see.
 *
 * Two conditions, both §4's table rather than taste. The creature must be perceived as `seen` — which
 * is what `identified` holds, and which is also what makes intent hidden in the dark, above. And the
 * marked tile must itself be perceived; see `cell.ts`'s `Telegraph` for why that one is not tidiness.
 *
 * Iterated in ascending actor id, which is the order `world.actors` is held in, so two creatures
 * marking the same tile resolve to the lower id's mark rather than to whichever the map happened to
 * yield last. That is unreachable today — an attack marks an orthogonal neighbour and a move marks a
 * vacant tile — but "whichever came last out of a Map" is precisely the iteration-order dependence
 * ADR-0004 forbids, and writing it down costs one sort that is already sorted.
 */
function gatherTelegraphs(
  grid: Grid,
  identified: ReadonlyMap<number, CreatureActor>,
  perceived: TileSet,
): ReadonlyMap<number, Telegraph> {
  const out = new Map<number, Telegraph>();
  const seen = [...identified.values()].sort((a, b) => a.id - b.id);
  for (const creature of seen) {
    if (creature.mind.kind !== 'awake') continue;
    const marked = markedTileOf(declaredIntent(creature));
    if (marked === null) continue;
    if (!hasTile(perceived, marked.at.x, marked.at.y)) continue;
    const index = tileIndex(grid, marked.at.x, marked.at.y);
    if (!out.has(index)) out.set(index, marked.telegraph);
  }
  return out;
}

/** §2: an attack marks its target tile, a move marks its destination. A wait marks nothing. */
function markedTileOf(
  intent: Intent,
): { readonly at: Position; readonly telegraph: Telegraph } | null {
  switch (intent.kind) {
    case 'wait':
      return null;
    case 'move':
      return { at: intent.to, telegraph: MOVE_TELEGRAPH };
    case 'attack':
      return { at: intent.at, telegraph: ATTACK_TELEGRAPH };
    default:
      return assertNever(intent, 'markedTileOf');
  }
}

function buildCell(grid: Grid, index: number, overlays: Overlays): Cell {
  const at = positionOf(grid, index);
  const perceived = hasTile(overlays.perceived, at.x, at.y);
  const contact = overlays.contacts.get(index) ?? null;
  const state = cellStateOf(perceived, hasTile(overlays.remembered, at.x, at.y), contact);
  const telegraph = overlays.telegraphs.get(index) ?? null;
  const face = faceOf(grid.tiles[index], at, index, state, contact, overlays);

  return {
    x: at.x,
    y: at.y,
    state,
    glyph: face.glyph,
    fg: face.fg,
    bg: telegraph === null ? backgroundOf(state) : telegraphBackground(telegraph),
    bgAlpha: telegraph === null ? 0 : telegraph.fill,
    opacity: CELL_OPACITY[state],
    tint:
      overlays.lamplit && perceived ? lampTint(chebyshevDistance(overlays.playerAt, at)) : NO_TINT,
    telegraph,
  };
}

/**
 * The §10 four-state classification. See `cell.ts`'s header for the reasoning on both edges — why
 * a perceived tile wins over a felt contact, and why a felt contact wins over memory.
 */
function cellStateOf(
  perceived: boolean,
  remembered: boolean,
  contact: CreatureSense['kind'] | null,
): CellState {
  if (perceived) return 'visible';
  if (contact === 'felt') return 'sensed';
  if (remembered) return 'remembered';
  return 'unknown';
}

/** The glyph and its colour, by the priority order in the header. */
function faceOf(
  tile: Tile,
  at: Position,
  index: number,
  state: CellState,
  contact: CreatureSense['kind'] | null,
  overlays: Overlays,
): { readonly glyph: string; readonly fg: ColorToken } {
  if (at.x === overlays.playerAt.x && at.y === overlays.playerAt.y) {
    return { glyph: GLYPHS.player, fg: 'player' };
  }
  if (contact === 'felt') return { glyph: GLYPHS.contact, fg: 'contact' };

  // Reached only after the `felt` branch above has returned, and `identified` is `seen`-only in the
  // first place — the two together are what keep §4's "position only" true. See `gatherOverlays`.
  const creature = overlays.identified.get(index) ?? null;
  if (creature !== null) return { glyph: glyphForCreature(creature), fg: 'creature' };

  if (state === 'visible' && overlays.embers.has(index)) {
    return { glyph: GLYPHS.ember, fg: 'ember' };
  }
  if (state === 'visible' || state === 'remembered') {
    return { glyph: glyphForTile(tile), fg: terrainColorOf(tile) };
  }
  return { glyph: GLYPHS.blank, fg: 'void' };
}

function terrainColorOf(tile: Tile): ColorToken {
  switch (tile.kind) {
    case 'wall':
      return 'wall';
    case 'floor':
      return 'floor';
    case 'pillar':
      return 'pillar';
    case 'doorway':
      return 'doorway';
    case 'entrance':
      return 'entrance';
    case 'stairs':
      return 'stairs';
    case 'cache':
      return 'ember';
    default:
      return assertNever(tile, 'terrainColorOf');
  }
}

/** An `unknown` cell sits on the void; everything else sits on the board's surface. */
function backgroundOf(state: CellState): ColorToken {
  return state === 'unknown' ? 'void' : 'surface';
}

function telegraphBackground(telegraph: Telegraph): ColorToken {
  switch (telegraph.kind) {
    case 'attack':
      return 'telegraphAttack';
    case 'move':
      return 'telegraphMove';
    default:
      return assertNever(telegraph.kind, 'telegraphBackground');
  }
}

/** The cell at `(x, y)`, for a test or a hit test. Row-major, same layout as `Grid`. */
export function cellAt(grid: SceneGrid, x: number, y: number): Cell {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) {
    throw new Error(`render: (${x}, ${y}) is outside the ${grid.width}x${grid.height} board`);
  }
  return grid.cells[y * grid.width + x];
}
