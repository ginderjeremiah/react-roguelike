import { describe, expect, it } from 'vitest';
import { runStates, type GameState } from '@/game/core';
import { CINDER } from '@/game/content';
import { awaken } from '@/tests/unit/support/scenario';
import { scenarioState, stateFrom } from '@/tests/unit/support/presentation';
import { diveToTheBottom, standUntilDead } from '@/tests/unit/support/run-script';
import { COLOR_TOKENS } from './colors';
import { CELL_OPACITY, type Cell } from './cell';
import { GLYPHS } from './glyphs';
import { presentHud } from './hud';
import { presentScene } from './scene';

/**
 * GDD §11, as properties rather than as a checklist.
 *
 * > Colorblind-safe palette; **colour never the sole carrier of meaning.** This has already cut one
 * > mechanic (brightness-encoded health in ember-sense, §4) and constrains intent markers (§2).
 *
 * §11 says these "constrain design from the start" and are "not deferred to the end as a checklist
 * item". The way that becomes real rather than aspirational is a test that fails when the constraint
 * stops holding — and the test that does that is **the greyscale reading**: take every cell of a real
 * run, delete its two colour fields, and check that everything a player has to read is still
 * determined by what is left.
 *
 * If any assertion in this file goes red, no palette in `components/` can fix it. The information
 * was already gone at this layer.
 */

const DIVE = diveToTheBottom('a11y', 3);
const DEATH = standUntilDead('grave', 3);
const CORPUS: readonly GameState[] = [
  ...runStates(DIVE.seed, DIVE.commands),
  ...runStates(DEATH.seed, DEATH.commands),
];

/**
 * A cell with its colour deleted. Everything here survives a greyscale screenshot: a glyph is a
 * shape, opacity and tint and fill are luminance, and a frame is a shape.
 */
function greyscale(cell: Cell): string {
  return JSON.stringify([
    cell.glyph,
    cell.opacity,
    cell.tint,
    cell.bgAlpha,
    cell.telegraph === null ? null : cell.telegraph.frame,
  ]);
}

const CELLS: readonly Cell[] = CORPUS.flatMap((state) => presentScene(state).grid.cells);

/** For each distinct greyscale reading, every value of `read` that reading ever stood for. */
function readings(read: (cell: Cell) => string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const cell of CELLS) {
    const key = greyscale(cell);
    const set = out.get(key) ?? new Set<string>();
    set.add(read(cell));
    out.set(key, set);
  }
  return out;
}

function ambiguous(read: (cell: Cell) => string): [string, string[]][] {
  return [...readings(read)]
    .filter(([, values]) => values.size > 1)
    .map(([key, values]) => [key, [...values].sort()] as [string, string[]]);
}

describe('the board is readable in greyscale', () => {
  it('determines which of §10’s four states a cell is in, without colour', () => {
    // THE §10 CONSTRAINT, asserted as a function rather than as four constants: over hundreds of
    // real boards, no greyscale reading ever stood for two different states. `cell.test.ts` proves
    // the opacity table is distinct; this proves the table is what the board actually uses, and that
    // nothing else on the cell smuggles the state into a colour field.
    expect(ambiguous((cell) => cell.state)).toEqual([]);
  });

  it('determines whether a tile is telegraphed, and by what, without colour', () => {
    // §2 requires **two** non-colour channels for the marker. The frame is one and the fill alpha is
    // the other; `bg` is the third and is the only chromatic one. If this goes red, the telegraph is
    // being carried by `bg` alone and a colourblind player is reading an unmarked board.
    expect(ambiguous((cell) => cell.telegraph?.kind ?? 'none')).toEqual([]);
  });

  it('determines what is standing on a tile, without colour', () => {
    // Player, identified creature, felt contact, ember on the ground, bare terrain. Four of those
    // five are things that can kill you or save you, and `fg` is not allowed to be how you tell.
    expect(ambiguous((cell) => cell.fg)).toEqual([]);
  });

  it('is not asserting this over a board with three kinds of cell on it', () => {
    // The guard. Every property above is trivially true of a corpus with no variety, and a corpus
    // is exactly the kind of thing that quietly loses variety when a helper changes.
    expect(CELLS.length).toBeGreaterThan(10_000);
    expect(new Set(CELLS.map(greyscale)).size).toBeGreaterThan(20);
    expect(new Set(CELLS.map((cell) => cell.state)).size).toBe(4);
  });
});

describe('the specific distinctions §4 and §6 say a player must be able to make', () => {
  it('tells a dormant creature from an awake one by case, not by hue', () => {
    // §3's dormant strike is double damage and §11 already cut one mechanic over this. The two
    // states share a colour token on purpose — they are the same creature — so the glyph is the
    // only carrier, and it must differ.
    const seen = CELLS.filter((cell) => cell.fg === 'creature');
    expect(seen.length).toBeGreaterThan(5);
    for (const cell of seen) {
      expect([CINDER.glyphDormant, CINDER.glyphAwake]).toContain(cell.glyph);
    }
    expect(CINDER.glyphDormant).not.toBe(CINDER.glyphAwake);
  });

  it('tells a felt contact from an identified creature by glyph', () => {
    // §4: ember-sense gives position only. The `*` must not be readable as "a Cinder over there",
    // and the way that stays true is that it is a different shape, not a different shade of red.
    const felt = CELLS.filter((cell) => cell.glyph === GLYPHS.contact);
    expect(felt.length).toBeGreaterThan(5);
    expect(GLYPHS.contact).not.toBe(CINDER.glyphDormant);
    expect(GLYPHS.contact).not.toBe(CINDER.glyphAwake);
    for (const cell of felt) expect(cell.fg).toBe('contact');
  });

  it('tells the four states apart on luminance alone, in the right order', () => {
    // The reading a player makes at arm's length, before they have focused on any glyph: how much of
    // the board is live. A `sensed` cell dimmer than a `remembered` one would bury the only warning
    // the dark ever gives underneath the map.
    const byState = new Map<string, Set<number>>();
    for (const cell of CELLS) {
      const set = byState.get(cell.state) ?? new Set<number>();
      set.add(cell.opacity);
      byState.set(cell.state, set);
    }
    for (const [state, opacities] of byState) expect([...opacities], state).toHaveLength(1);
    expect(CELL_OPACITY.visible).toBeGreaterThan(CELL_OPACITY.sensed);
    expect(CELL_OPACITY.sensed).toBeGreaterThan(CELL_OPACITY.remembered);
    expect(CELL_OPACITY.remembered).toBeGreaterThan(CELL_OPACITY.unknown);
  });
});

describe('the colour vocabulary is closed', () => {
  it('never emits a token a theme could not have a colour for', () => {
    // A stray token renders as transparent, or as whatever the theme's fallback is, on a cell that
    // may be the creature about to kill you.
    for (const cell of CELLS) {
      expect(COLOR_TOKENS, `fg ${cell.fg}`).toContain(cell.fg);
      expect(COLOR_TOKENS, `bg ${cell.bg}`).toContain(cell.bg);
    }
  });

  it('exercises every token it declares', () => {
    // A token no board can ever produce is a colour a theme has to invent a meaning for, and it is
    // usually the fossil of a distinction that was dropped. Two real runs happen to reach all
    // fourteen; if a future token cannot be reached, it either does not exist yet or should not.
    const used = new Set(CELLS.flatMap((cell) => [cell.fg, cell.bg]));
    expect(COLOR_TOKENS.filter((token) => !used.has(token))).toEqual([]);
  });

  it('reaches the move telegraph and the ember drop directly, not only by luck of the seed', () => {
    const built = scenarioState(['#########', '#@.C....#', '#########'], {
      shutter: 'open',
      perceive: false,
    });
    const moving = stateFrom(
      awaken(built.state.world, built.scenario.ids[0], { kind: 'move', to: { x: 2, y: 1 } }),
      { shutter: 'open' },
    );
    const tokens = new Set(presentScene(moving).grid.cells.map((cell) => cell.bg));
    expect(tokens).toContain('telegraphMove');

    const withEmber = stateFrom(
      { ...built.state.world, embers: [{ at: { x: 2, y: 1 }, amount: 20 }] },
      { shutter: 'open' },
    );
    const scene = presentScene(withEmber);
    expect(scene.grid.cells.some((cell) => cell.fg === 'ember')).toBe(true);
  });
});

describe('the HUD never leans on colour either', () => {
  it('ships the number beside every level it reports', () => {
    // §11's rule applied to the frame around the board: `MeterLevel` may drive colour, but the digits
    // are the carrier. A level with no number beside it would be a red bar and nothing else.
    for (const state of CORPUS) {
      const hud = presentHud(state);
      expect(typeof hud.health.hp).toBe('number');
      expect(typeof hud.health.maxHp).toBe('number');
      expect(typeof hud.fuel.fuel).toBe('number');
      expect(typeof hud.fuel.turnsRemaining).toBe('number');
      expect(typeof hud.sense.radius).toBe('number');
      expect(typeof hud.sense.max).toBe('number');
      expect(typeof hud.floor.number).toBe('number');
    }
  });

  it('states the shutter and the two controls as words and booleans, not as styling', () => {
    for (const state of CORPUS) {
      const hud = presentHud(state);
      expect(['open', 'shuttered']).toContain(hud.shutter.state);
      expect(typeof hud.shutter.canOpen).toBe('boolean');
      expect(typeof hud.onStairs).toBe('boolean');
      expect(typeof hud.sense.adapting).toBe('boolean');
    }
  });
});
