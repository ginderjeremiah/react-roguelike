import { memo } from 'react';
import { Text, View } from 'react-native';

import { Fonts } from '@/constants/theme';
import type { Cell } from '@/render';
import { paintCell } from './cell-style';
import type { GameTheme } from './theme';

/**
 * One tile. A `View` for the ground and a `Text` for the glyph, and nothing else.
 *
 * ## Why this is memoised, and why the default comparator is enough
 *
 * There are ~165 of these on an 11×15 floor against a 16ms frame budget (ADR-0003), and on most
 * turns two of them change. `render/scene.ts` **reuses the previous `Cell` object** for every cell
 * whose picture is unchanged, precisely so that this can be `React.memo` with the default shallow
 * comparison rather than a custom predicate — the identity check *is* `sameCell`, already done, once
 * per turn, in a layer with tests.
 *
 * That only holds while the other two props are stable as well: `size` is a number and `theme` is a
 * module constant (`use-game-theme.ts`). Passing a fresh object for either — a style built inline, a
 * theme spread — would make every cell re-render every turn and quietly delete the whole scheme.
 *
 * **Measured, because ADR-0003 asks for a number rather than a claim.** 40 real taps in the built web
 * app at a Pixel 7 viewport, timed from the browser's `touchend` to the DOM commit: **median 1.1ms,
 * p90 1.5ms** unthrottled, and **median 8.3ms, p90 13.3ms** at 4× CPU throttling (roughly a mid-range
 * phone). Inside the 16ms budget either way. The honest part: removing this `memo` and re-measuring
 * changed **nothing** — 8.0ms against 8.3ms, inside the noise — because 165 cells is simply not many,
 * and because `reactCompiler` is on and already memoises what it can see. It stays because it is free,
 * because it is what the DoD asks for, and because the 40×24 board ADR-0003 sizes the risk against is
 * six times this one. Do not read the null result as "memoisation does not matter here"; read it as
 * "at 165 cells nothing matters here yet".
 *
 * ## Font scaling
 *
 * `allowFontScaling={false}`, deliberately, and it is the one place this screen does not follow the
 * system text size. The board is a **map**: a cell is a geometric square sized to fit the floor on
 * screen, and a glyph scaled past it would overflow its neighbours and break the grid alignment that
 * makes a glyph grid readable at all (ADR-0003). Everything that is genuinely text — the HUD, the
 * controls, the status line — scales normally. GDD §11's requirement is about reading the interface,
 * and the interface here is the part that stays honest.
 */
export type BoardCellProps = {
  readonly cell: Cell;
  /** Side of the square, in points. Chosen by the board from the space it was given. */
  readonly size: number;
  readonly theme: GameTheme;
};

function BoardCellView({ cell, size, theme }: BoardCellProps) {
  const paint = paintCell(cell, theme);

  return (
    <View
      testID={`cell-${cell.x}-${cell.y}`}
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: paint.backgroundColor,
        // §10/§11's non-colour channel for cell state. Never multiplied by `tint` — see
        // `cell-style.ts`, which is the only place either value is touched.
        opacity: paint.opacity,
        // §2's telegraph, as a **cell decoration**: a border, never characters around the glyph.
        // Borders are inside the box in React Native, so this cannot change the grid's geometry.
        borderColor: paint.frameColor,
        borderWidth: paint.frame === 'brackets' ? 2 : 0,
        borderBottomWidth: paint.frame === null ? 0 : 2,
      }}
    >
      <Text
        allowFontScaling={false}
        style={{
          color: paint.color,
          fontFamily: Fonts.mono,
          fontSize: Math.round(size * 0.68),
          lineHeight: size,
          textAlign: 'center',
        }}
      >
        {cell.glyph}
      </Text>
    </View>
  );
}

export const BoardCell = memo(BoardCellView);
