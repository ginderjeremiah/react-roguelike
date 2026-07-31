import { describe, expect, it } from 'vitest';
import { cellAt, type Cell, type Scene } from '@/render';
import { beginRun, move, sceneOf, setShutter, type Run } from '@/session';
import { paintCell } from '@/components/play/cell-style';
import { DARK_THEME, LIGHT_THEME, mixHex, type GameTheme } from '@/components/play/theme';

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE BUG THIS FILE EXISTS TO CATCH: `opacity * tint`
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `render/cell.ts` warns about it at the declaration of `tint`, and says why no test in `render/`
 * can catch it:
 *
 * > `tint` is `0` on every remembered cell and on every cell of a shuttered board — so a consumer
 * > that reasonably writes `opacity * tint` erases the entire remembered map, and the whole screen
 * > in the dark. ... Nothing in `render/`'s tests can catch a `components/` mistake here.
 *
 * This is the test on the other side of that sentence. It is written against **outcomes on real
 * boards** rather than against the shape of `paintCell`, so it survives a rewrite of that function:
 * a shuttered run still draws its cells at full opacity, and a remembered corridor is still on
 * screen. Both assertions go to zero under the mutation, which is the whole point.
 *
 * The file is also the reason `cell-style.ts` is plain TypeScript with no React in it.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

/** A run with the lantern shut: every cell's `tint` is 0, and the board must still be drawn. */
function shutteredRun(): Run {
  return setShutter(beginRun('paint'), 'shuttered');
}

/**
 * A run that has walked far enough to leave terrain behind it in memory. Lit, so there is a lit
 * field with real tints on it as well as remembered cells with none.
 */
function exploredRun(): Run {
  let run = beginRun('paint');
  for (const dir of ['east', 'east', 'south', 'south', 'east'] as const) run = move(run, dir);
  return run;
}

function cellsWhere(scene: Scene, predicate: (cell: Cell) => boolean): readonly Cell[] {
  return scene.grid.cells.filter(predicate);
}

describe('opacity and tint are independent channels', () => {
  it('draws a shuttered board at full opacity even though nothing on it is tinted', () => {
    // THE WHOLE-SCREEN CASE. With the shutter shut there is no lamplight anywhere, so every tint is
    // 0 — and the nine tiles the player perceives by touch are `visible` and must be at opacity 1.
    // Under `opacity * tint` this board is entirely invisible: a black screen, in the vision state
    // the whole game is about.
    const scene = sceneOf(shutteredRun());
    const visible = cellsWhere(scene, (cell) => cell.state === 'visible');
    expect(visible.length).toBeGreaterThan(4);

    for (const cell of visible) {
      expect(cell.tint, `(${cell.x},${cell.y}) tint`).toBe(0);
      expect(paintCell(cell, DARK_THEME).opacity, `(${cell.x},${cell.y}) opacity`).toBe(1);
    }
  });

  it('keeps the remembered map on screen, which has no lamplight on it either', () => {
    // THE REMEMBERED-MAP CASE. §4: memory is "permanent once seen, dimmed" — 0.4 opacity and 0 tint.
    // Under the mutation the player's whole map of the floor disappears the moment they walk out of
    // the light, which reads as a rendering bug rather than as a rule and deletes §10's four states
    // down to two.
    const scene = sceneOf(exploredRun());
    const remembered = cellsWhere(scene, (cell) => cell.state === 'remembered');
    expect(remembered.length).toBeGreaterThan(4);

    for (const cell of remembered) {
      expect(cell.tint).toBe(0);
      expect(paintCell(cell, DARK_THEME).opacity).toBe(0.4);
      expect(paintCell(cell, LIGHT_THEME).opacity).toBe(0.4);
    }
  });

  it('passes §10’s opacity through untouched for every cell of a real board', () => {
    // The general form: whatever `render/` decided, this layer draws. Stated over both a lit and a
    // shuttered board so that neither vision state can be the one that works.
    for (const run of [shutteredRun(), exploredRun()]) {
      for (const cell of sceneOf(run).grid.cells) {
        expect(paintCell(cell, DARK_THEME).opacity).toBe(cell.opacity);
      }
    }
  });

  it('never lets tint reach the glyph colour', () => {
    // The other half of keeping the channels apart. Lamplight is mixed into the background only —
    // mixing it into the foreground converges every lit glyph on the lamp's own amber, which deletes
    // the role colour §11 relies on being there beside the shape.
    const scene = sceneOf(beginRun('paint'));
    const lit = cellsWhere(scene, (cell) => cell.tint > 0);
    expect(lit.length).toBeGreaterThan(4);
    expect(new Set(lit.map((cell) => cell.tint)).size).toBeGreaterThan(1);

    for (const cell of lit) {
      expect(paintCell(cell, DARK_THEME).color).toBe(DARK_THEME.token[cell.fg]);
    }
  });
});

describe('what tint does do', () => {
  it('washes lamplight over the background, in proportion to the tint', () => {
    const theme: GameTheme = DARK_THEME;
    const scene = sceneOf(beginRun('paint'));
    const lit = cellsWhere(scene, (cell) => cell.tint > 0 && cell.bgAlpha === 0);
    expect(lit.length).toBeGreaterThan(4);

    for (const cell of lit) {
      expect(paintCell(cell, theme).backgroundColor).toBe(
        mixHex(theme.token[cell.bg], theme.lamp, cell.tint * theme.lampStrength),
      );
    }
  });

  it('leaves an untinted cell exactly its own surface colour', () => {
    // The identity case, and the one that would break first if lamplight were ever applied
    // unconditionally: a remembered cell must be the plain surface, not a surface with a trace of a
    // lantern that is nowhere near it.
    const scene = sceneOf(exploredRun());
    for (const cell of cellsWhere(scene, (cell) => cell.tint === 0 && cell.bgAlpha === 0)) {
      expect(paintCell(cell, DARK_THEME).backgroundColor).toBe(DARK_THEME.token[cell.bg]);
    }
  });
});

describe('the telegraph is composed over the surface', () => {
  it('washes the telegraph colour on at its fill, and draws the frame at full strength', () => {
    // §2 wants two non-colour channels, and both survive into pixels here: `bgAlpha` becomes a wash
    // that reads in greyscale, and `frame` becomes a border shape. A `bgAlpha` dropped on the floor
    // would leave the frame carrying the mark alone, which is one channel.
    const marked: Cell = {
      x: 1,
      y: 1,
      state: 'visible',
      glyph: '·',
      fg: 'floor',
      bg: 'telegraphAttack',
      bgAlpha: 0.35,
      opacity: 1,
      tint: 0,
      telegraph: { kind: 'attack', frame: 'brackets', fill: 0.35 },
    };
    const paint = paintCell(marked, DARK_THEME);

    expect(paint.backgroundColor).toBe(
      mixHex(DARK_THEME.token.surface, DARK_THEME.token.telegraphAttack, 0.35),
    );
    expect(paint.backgroundColor).not.toBe(DARK_THEME.token.telegraphAttack);
    expect(paint.frame).toBe('brackets');
    expect(paint.frameColor).toBe(DARK_THEME.token.telegraphAttack);
  });

  it('draws no frame on an ordinary cell', () => {
    const scene = sceneOf(beginRun('paint'));
    const plain = cellAt(scene.grid, scene.grid.width - 1, scene.grid.height - 1);
    expect(plain.telegraph).toBeNull();
    expect(paintCell(plain, DARK_THEME).frame).toBeNull();
  });
});
