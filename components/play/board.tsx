import { memo, useRef } from 'react';
import { Pressable, View, type GestureResponderEvent } from 'react-native';

import type { SceneGrid, TapAction } from '@/render';
import { BoardCell } from './board-cell';
import { tileAtPoint } from './hit-test';
import type { GameTheme } from './theme';

/**
 * The board: a glyph grid, one touch surface over it, and a ring on each tile a tap can act on.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ONE PRESS HANDLER FOR THE WHOLE BOARD, AND TWO REASONS IT IS NOT ONE PER CELL
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * **Memoisation.** The obvious build makes every cell a `Pressable`. It costs the whole
 * optimisation: a cell's props would then include a handler, the handler closes over the current
 * `Run`, and a new `Run` every turn means ~165 changed props and ~165 re-renders of components whose
 * pixels are identical. `render/`'s cell reuse would still be working perfectly and nothing would
 * benefit from it. So the grid is inert (`pointerEvents="none"`) and stays memoised on the `Cell`
 * objects `presentScene` hands back.
 *
 * **Testability.** The first version of this file put five oversized `Pressable`s on top of the grid
 * for §9's five tiles, with a whole-board `Pressable` underneath for everything else. It shipped a
 * bug that its own E2E test could not see — see `onBoardPress` below — because the only presses that
 * reached the underneath handler were ones whose correct outcome was "do nothing". With one handler,
 * **every tap in the game goes through the same three lines**, so any test that taps anything
 * exercises them.
 *
 * The 44pt targets that the overlay was there to provide are now arithmetic, in `hit-test.ts`, where
 * they are unit-tested against a `Scene`'s own tap list rather than inferred from a stack of views.
 *
 * ## What was given up, honestly
 *
 * The overlay's five `Pressable`s were focusable, labelled, and lit up under the thumb. This has none
 * of that: the rings are decoration. The press feedback is the action itself (immediate — nothing
 * here animates) and, for a tap that resolves to nothing, §2's line under the board. The screen
 * reader story for a glyph grid is unsolved either way and is not one of GDD §11's five requirements;
 * it is worth its own issue rather than a worse touch layer.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

export type BoardProps = {
  readonly grid: SceneGrid;
  /** GDD §9's control scheme as data. `render/taps.ts` decided all of it. */
  readonly taps: readonly TapAction[];
  /** Side of one cell, in points. The screen measures the space and divides. */
  readonly cellSize: number;
  readonly theme: GameTheme;
  /** Called with a **tile**, never a pixel. The screen turns it into an intent. */
  readonly onTapTile: (x: number, y: number) => void;
};

export function Board({ grid, taps, cellSize, theme, onTapTile }: BoardProps) {
  const board = useRef<View | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);

  // Re-measured on every layout, so a rotation, a font-size change or a HUD that grew by a line
  // cannot leave a stale origin behind and send every tap one row off.
  const measure = () => {
    board.current?.measureInWindow((x, y) => {
      origin.current = { x, y };
    });
  };

  /**
   * Every tap on the board, resolved to a tile.
   *
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   * `locationX` IS `undefined` ON REACT NATIVE WEB, AND THE FALLBACK IS NOT OPTIONAL
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   *
   * React Native types `GestureResponderEvent['nativeEvent'].locationX` as a `number`, and native
   * supplies one. **React Native Web does not**: its `nativeEvent` is the raw DOM event, whose own
   * enumerable keys are `['isTrusted']`, and which carries `pageX`/`pageY` instead. So a handler
   * written to the type — `Math.floor(locationX / cellSize)` — type-checks, works on a phone, and
   * silently drops every press on the web build, which is the build this project tests and ships
   * first (ADR-0002).
   *
   * That is not hypothetical: it shipped in this file, and its E2E test passed anyway, because the
   * test asserted that a distant tap changes nothing and nothing was listening. It was found by
   * mutating the screen to make a distant tap spend a turn and watching the test stay green.
   *
   * `pageX` minus the board's measured origin is the same quantity on both platforms, so the fallback
   * is not a web special case so much as the portable form of the question.
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   */
  const onBoardPress = (event: GestureResponderEvent) => {
    const { locationX, locationY, pageX, pageY } = event.nativeEvent;
    const at = origin.current;
    const x = Number.isFinite(locationX) ? locationX : at === null ? NaN : pageX - at.x;
    const y = Number.isFinite(locationY) ? locationY : at === null ? NaN : pageY - at.y;

    // A press whose coordinates did not survive the platform is dropped rather than guessed at.
    // Guessing would move the player somewhere they did not aim, which is worse than a dead tap.
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const tile = tileAtPoint({ x, y }, cellSize, taps);
    onTapTile(tile.x, tile.y);
  };

  return (
    <Pressable
      ref={board}
      onLayout={measure}
      testID="board"
      accessibilityRole="button"
      // A stopgap, and named as one: one label for the whole board is not access to a glyph grid, it
      // is an announcement that there is one. Per-tile semantics need a design (what does a screen
      // reader say about 165 tiles?) rather than a prop, and it is not among GDD §11's five
      // requirements. Better than a focusable element that announces nothing at all.
      accessibilityLabel={`The floor, ${grid.width} by ${grid.height}. Tap a tile beside you to move or attack, or your own tile to wait.`}
      style={{ width: cellSize * grid.width, height: cellSize * grid.height }}
      onPress={onBoardPress}
    >
      <BoardGrid grid={grid} cellSize={cellSize} theme={theme} />

      {/* The floor's full extent, as a hairline just outside the grid.
          Without it the explored part of the map floats in the void with nothing to place it
          against, and an early board — one room out of fifteen rows — reads as a broken layout
          rather than as a floor you have barely started. It leaks nothing: every floor is the same
          11×15 (GDD §5), so the rectangle is a constant, not information about this one. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: -1,
          top: -1,
          right: -1,
          bottom: -1,
          borderWidth: 1,
          borderColor: theme.border,
        }}
      />

      {taps.map((tap) => (
        <ReachRing key={`${tap.at.x}-${tap.at.y}`} tap={tap} cellSize={cellSize} theme={theme} />
      ))}
    </Pressable>
  );
}

/**
 * The grid itself, memoised on the whole `SceneGrid`.
 *
 * `presentScene` hands back the **same `SceneGrid` object** when no cell changed — a refused tap, a
 * turn where nothing moved — so this skips the 165-element map entirely on those turns, and the
 * per-cell memo handles every other turn. Two levels, because they catch different things.
 */
const BoardGrid = memo(function BoardGrid({
  grid,
  cellSize,
  theme,
}: {
  readonly grid: SceneGrid;
  readonly cellSize: number;
  readonly theme: GameTheme;
}) {
  return (
    <View
      pointerEvents="none"
      style={{
        width: cellSize * grid.width,
        height: cellSize * grid.height,
        flexDirection: 'row',
        flexWrap: 'wrap',
      }}
    >
      {grid.cells.map((cell) => (
        <BoardCell key={cell.y * grid.width + cell.x} cell={cell} size={cellSize} theme={theme} />
      ))}
    </View>
  );
});

/**
 * What a tap on this tile would do, drawn on the tile.
 *
 * **The ring's shape carries the action, not its colour** (§11): a solid edge is a strike, a dashed
 * edge is a step, a dotted edge is the tile you are standing on. All three are the same ink, so the
 * board still reads with no colour at all — and the ring is an outline rather than a fill, so it
 * never covers the glyph underneath, which is the thing that says *what* you are about to hit.
 *
 * A `blocked` neighbour draws nothing: §9 says it is not a tap target, so nothing may invite the tap.
 * The press is still received and answered with a line (§2) — that is `app/index.tsx`'s job, not this
 * ring's.
 *
 * Kept in the DOM with a `testID` even when it draws nothing, because it is how a test finds the tile
 * §9 classified: `tap-blocked-4-2` is the model's answer, at the coordinates a tap must be aimed at.
 */
function ReachRing({
  tap,
  cellSize,
  theme,
}: {
  readonly tap: TapAction;
  readonly cellSize: number;
  readonly theme: GameTheme;
}) {
  return (
    <View
      testID={`tap-${tap.kind}-${tap.at.x}-${tap.at.y}`}
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: tap.at.x * cellSize,
        top: tap.at.y * cellSize,
        width: cellSize,
        height: cellSize,
        ...ringStyle(tap.kind, theme),
      }}
    />
  );
}

function ringStyle(kind: TapAction['kind'], theme: GameTheme) {
  const base = { borderColor: theme.reach, borderRadius: 3 } as const;

  switch (kind) {
    case 'attack':
      return { ...base, borderWidth: 2, borderStyle: 'solid' as const, opacity: 0.85 };
    case 'move':
      return { ...base, borderWidth: 1, borderStyle: 'dashed' as const, opacity: 0.5 };
    case 'wait':
      return { ...base, borderWidth: 1, borderStyle: 'dotted' as const, opacity: 0.35 };
    // Not a tap target (§9), and nothing is bound here yet. Occupies its tile so a test can aim at
    // it, and draws not one pixel.
    case 'blocked':
    case 'unbound':
      return { opacity: 0 };
  }
}
