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

  /** A point in board space -> the tile it means -> the screen's handler. The last two lines. */
  const resolve = (x: number, y: number) => {
    // A press whose coordinates did not survive the platform is dropped rather than guessed at.
    // Guessing would move the player somewhere they did not aim, which is worse than a dead tap.
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const tile = tileAtPoint({ x, y }, cellSize, taps);
    onTapTile(tile.x, tile.y);
  };

  /**
   * Every tap on the board, resolved to a tile.
   *
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   * `locationX` IS `undefined` ON REACT NATIVE WEB, SO THE OFFSET IS MEASURED — PER PRESS
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   *
   * React Native types `GestureResponderEvent['nativeEvent'].locationX` as a `number`, and native
   * supplies one. **React Native Web does not**: its `nativeEvent` is the raw DOM event, whose own
   * enumerable keys are `['isTrusted']`. So a handler written to the type —
   * `Math.floor(locationX / cellSize)` — type-checks, works on a phone, and silently drops every
   * press on the web build, which is the build this project tests and ships first (ADR-0002). That
   * is not hypothetical: it shipped here, and its E2E test passed anyway, because the test asserted
   * that a distant tap changes nothing and nothing was listening.
   *
   * ── AND THE OBVIOUS REPAIR — CACHE THE ORIGIN, REFRESH IT `onLayout` — IS ALSO WRONG. ──────────
   *
   * **`onLayout` on react-native-web is a `ResizeObserver`** (`modules/useElementLayout/index.js`).
   * It observes **size, and never position.** At a phone viewport the board is *width*-bound —
   * eleven columns against 390pt — so anything above it that grows taller moves the board while
   * leaving `cellSize`, and therefore the board's own box, exactly as it was. No resize, no
   * callback, no re-measure. Every press for the rest of the run then lands ~16% of a cell out —
   * a move the player did not aim at, which is the thing the line above forbids.
   *
   * **Do not look for one canonical trigger; any layout change above the board is one.** The
   * original was the shutter press: `hud.sense` gained an `adapting` note where it had none, the
   * HUD grew a line, and the board slid ~6pt *down*. #61 then gave that stat a note in **both**
   * shutter states, and shuttering now changes the HUD's height by zero — so that description was
   * false within two issues of being written, and this paragraph is the second attempt at it. The
   * trigger the E2E uses today is the *end* of §4's adaptation ramp, where the note clears and the
   * board moves ~6pt *up*. It will not be the last one.
   *
   * It is also invisible from two directions at once, which is why it survived review: at a
   * *desktop* viewport the board is **height**-bound, so the same HUD growth changes `cellSize`,
   * the board really does resize, `onLayout` fires and the cache is correct — the desktop project
   * physically cannot reproduce it. And every spec that presses a tile *centre* has ±17pt of
   * half-cell to absorb a 6pt error.
   *
   * So there is no cache. **The origin is read at the moment of the press**, which is correct
   * whatever moved and needs no theory about what might.
   *
   * ── AND IT IS READ SYNCHRONOUSLY, WHICH IS THE THIRD THING THIS BUG TEACHES. ──────────────────
   *
   * The obvious way to read it is `measureInWindow`, and that is **asynchronous on web**:
   * `UIManager.measureInWindow` is a `setTimeout(0)` around `getBoundingClientRect`. Resolving the
   * tile in that callback moves the state update out of React's event handling, and two presses
   * whose timers land in the same task then both compute from the render that installed the
   * handler — the second `setRun` derives from the same `Run` as the first and silently discards a
   * turn. That was measured, not theorised: driving presses in a tight loop lost two thirds of
   * them. So the DOM node is asked directly and the press stays synchronous, exactly as it was.
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   */
  const onBoardPress = (event: GestureResponderEvent) => {
    const { locationX, locationY } = event.nativeEvent;

    // Native: the press already knows where it landed inside this view, and no measurement can be
    // more authoritative than that.
    if (Number.isFinite(locationX) && Number.isFinite(locationY)) {
      resolve(locationX, locationY);
      return;
    }

    // Web: work it out from where the board is *right now*.
    const origin = originOf(board.current);
    const point = viewportPointOf(event.nativeEvent);
    if (origin === null || point === null) return;
    resolve(point.x - origin.x, point.y - origin.y);
  };

  return (
    <Pressable
      ref={board}
      testID="board"
      accessibilityRole="button"
      // A stopgap, and named as one: one label for the whole board is not access to a glyph grid, it
      // is an announcement that there is one. Per-tile semantics need a design (what does a screen
      // reader say about 165 tiles?) rather than a prop, and it is not among GDD §11's five
      // requirements. Better than a focusable element that announces nothing at all.
      accessibilityLabel={`The floor, ${grid.width} by ${grid.height}. Tap a tile beside you to move or attack, or your own tile to wait.`}
      // ═══════════════════════════════════════════════════════════════════════════════════════
      // THE PRESS SURFACE IS THE GRID AND NOTHING OUTSIDE IT — a decision, not an accident
      // ═══════════════════════════════════════════════════════════════════════════════════════
      //
      // Sized to the grid exactly, so a press outside it never reaches `onBoardPress` at all. #60
      // gave a distant *tile* tap §2's acknowledgement; a press **below** the board — the ~44pt
      // strip between the grid and the thumb controls, where the status line sits — stays silent.
      //
      // The alternative is to make the padded parent the press surface. Rejected: that strip's
      // other neighbour is the shutter control, so a thumb that *missed the shutter* would be told
      // "Too far to step." — a sentence about the board, in answer to a press aimed at a button.
      // §2 asks that a refused **tap on a tile** be acknowledged; it does not ask the game to
      // narrate every square point of the screen, and answering a missed control with the wrong
      // rule is worse than answering it with nothing.
      //
      // Written down because #60's review measured that strip and found it silent. A gap that is
      // measured but unexplained gets "fixed" by the next person who measures it.
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
 * The board's top-left corner in viewport coordinates, read **now**.
 *
 * On react-native-web a `View`'s ref *is* the host `div`, so this asks the element itself and gets a
 * synchronous answer. React Native's own `measureInWindow` is deliberately not used: it is
 * asynchronous on both platforms, and resolving a press outside React's event handling is what
 * makes two presses in one task collapse into one turn (see `onBoardPress`).
 *
 * `null` when the node cannot answer — which on a real platform means the press arrived with
 * `locationX` and never reached here. It is not a fallback path in disguise: it is the "coordinates
 * did not survive, so drop the press rather than guess" rule, applied to the other input.
 */
function originOf(node: View | null): { readonly x: number; readonly y: number } | null {
  const dom = node as unknown as { getBoundingClientRect?: () => { left: number; top: number } };
  if (node === null || typeof dom.getBoundingClientRect !== 'function') return null;
  const rect = dom.getBoundingClientRect();
  return Number.isFinite(rect.left) && Number.isFinite(rect.top)
    ? { x: rect.left, y: rect.top }
    : null;
}

/**
 * Where a press landed, in the same coordinate space `originOf` answers in.
 *
 * **`clientX` first, `pageX` second, and the order is the whole point.** `measureInWindow` reports a
 * *viewport*-relative box on web (`getBoundingClientRect`) and a *window*-relative one on native.
 * The DOM's `pageX` is **document**-relative — it includes the scroll offset — so subtracting a
 * viewport-relative origin from it is only correct while the page is scrolled to the top. This
 * screen does not scroll today, which is exactly the kind of fact that stops being true quietly, and
 * the failure it produces is a press attributed to the wrong tile. `clientX` is the viewport form
 * and is what react-native-web's raw DOM event carries; `pageX` is what React Native's own
 * `GestureResponderEvent` declares and is what native supplies, where there is no scroll to differ
 * by.
 *
 * The cast is narrow and deliberate: `clientX` is genuinely present on web and genuinely absent from
 * React Native's type, so it is read as optional and ignored when it is not a number.
 */
function viewportPointOf(
  nativeEvent: GestureResponderEvent['nativeEvent'],
): { readonly x: number; readonly y: number } | null {
  const dom = nativeEvent as unknown as { clientX?: unknown; clientY?: unknown };
  if (typeof dom.clientX === 'number' && typeof dom.clientY === 'number') {
    return { x: dom.clientX, y: dom.clientY };
  }
  const { pageX, pageY } = nativeEvent;
  return Number.isFinite(pageX) && Number.isFinite(pageY) ? { x: pageX, y: pageY } : null;
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
