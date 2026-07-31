import { useCallback, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { Board } from '@/components/play/board';
import { Controls } from '@/components/play/controls';
import { HudBar } from '@/components/play/hud-bar';
import { BLOCKED_MESSAGE, describeTurn } from '@/components/play/messages';
import { RunSummaryPanel } from '@/components/play/run-summary';
import { StatusLine } from '@/components/play/status-line';
import { useGameTheme } from '@/components/play/use-game-theme';
import { Fonts } from '@/constants/theme';
import { tapAt } from '@/render';
import {
  beginRun,
  cuesOf,
  descend,
  move,
  sceneOf,
  setShutter,
  wait,
  type Run,
  type ShutterState,
} from '@/session';

/**
 * The game screen. A `Run` in state, a `Scene` on screen, and five things a thumb can do.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THIS FILE IS WIRING. EVERY RULE IT LOOKS LIKE IT IS APPLYING WAS DECIDED BELOW IT
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `app/` may wire `session/`, `render/` and `components/`, and never `game/` (ARCHITECTURE.md; two
 * independent gates enforce it). What that leaves is genuinely small:
 *
 *   - Hold a `Run`. Every intent returns a new one; nothing here mutates anything.
 *   - Ask `sceneOf(run)` what to draw and `cuesOf(run)` what just happened.
 *   - Turn a tap into an intent — and **which** intent is `tapAt`'s answer, not this file's. §9's
 *     rule about impassable neighbours lives in `render/taps.ts` because it is a game rule, and a
 *     `blocksMovement` call in a `.tsx` is exactly the shape of mistake the seam exists to prevent.
 *   - Swap the bottom band when the run ends, on `scene.summary` — one field, computed in
 *     `render/summary.ts`, so "is this run over" is never a comparison written here.
 *   - Start another run: `setRun(beginRun(SEED))`. §13's loop, closed, with no reload.
 *
 * The one decision that is genuinely local is what a tap that resolves to nothing looks like: §2
 * insists a dead tap be acknowledged, so a `blocked` tap writes a line rather than doing nothing at
 * all. See `components/play/messages.ts`.
 *
 * (The directory is `components/play/` and not `components/game/` because the layer lint rule
 * matches the *specifier* by path segment: `@/components/game/board` contains a `game` segment and is
 * reported as a component reaching into the simulation. ARCHITECTURE.md records the mirror image of
 * this — a `components/` directory inside `game/` — as a known limit of the mechanical enforcement.)
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## The seed is a constant, on purpose, and every run is the same run
 *
 * Choosing a seed reads a clock or a save file, which is `platform/`'s job, and `platform/` does not
 * exist yet — **issue #47**. Until it does, `beginRun` is handed the literal below and floor 1 is
 * identical on every launch. That is not a bug and it is not a placeholder that was forgotten: it is
 * the deliberate state of the project, and the seed is printed at the bottom of the screen so that
 * nobody playtesting has to guess. The day #47 lands, this constant is replaced by one call.
 *
 * ## What is deliberately not here
 *
 * **No animation.** `cuesOf` returns facts and never durations, and what this screen does with them
 * is write a sentence. Motion is M4's, and shipping none is the honest way to satisfy §11's
 * reduced-motion requirement for a first playtest — there is nothing to reduce. When it arrives it
 * attaches here, to the cue list, with Reanimated and a `useReducedMotion()` guard.
 *
 * **No tap on a distant tile.** ADR-0009 defers auto-travel to M2; `tapAt` answers `unbound` and this
 * switch does nothing with it. The `Position` is already in hand, which was the whole constraint.
 */

/**
 * ═══ THE SEED IS A CONSTANT UNTIL #47. EVERY RUN IS THE SAME RUN. THIS IS NOT A BUG. ═══
 * See the header. `platform/` owns where a real seed comes from; `beginRun` only takes one.
 */
const SEED = 'emberdepth';

/** GDD §5: the floor is 11×15, so the board is width-bound on a phone. Measured, not assumed. */
type BoardSpace = { readonly width: number; readonly height: number };

export default function GameScreen() {
  const theme = useGameTheme();
  const [run, setRun] = useState<Run>(() => beginRun(SEED));
  const [message, setMessage] = useState<string | null>(null);
  const [space, setSpace] = useState<BoardSpace>({ width: 0, height: 0 });

  const scene = sceneOf(run);

  /**
   * Advance the run and say what the turn did.
   *
   * Both halves matter. A refused intent still returns a **new** `Run` whose scene is the previous
   * object (`session/run.ts`), so React re-renders, the board does not repaint, and the cue list
   * carries §2's refusal — which becomes the line under the board.
   */
  const advance = useCallback((next: Run) => {
    setRun(next);
    setMessage(describeTurn(cuesOf(next)));
  }, []);

  const onTapTile = useCallback(
    (x: number, y: number) => {
      // §9's whole control scheme, decided in `render/taps.ts` and merely obeyed here.
      const tap = tapAt(scene.taps, x, y);
      switch (tap.kind) {
        case 'move':
        case 'attack':
          // §3: one directional command. `game/systems/bump` decides which of the two it resolves
          // as, from what is standing there at the moment of the tap. The pair exists so the board
          // can *draw* the difference, never so this file can act on it.
          advance(move(run, tap.dir));
          return;
        case 'wait':
          // §9: the self-tap is `wait`, and on the stairs that is a real decision — descend is its
          // own control.
          advance(wait(run));
          return;
        case 'blocked':
          // §9: an impassable neighbour is not a tap target, so no command is sent. §2: the tap is
          // acknowledged anyway, because a dead tap reads on a phone as a missed touch.
          setMessage(BLOCKED_MESSAGE);
          return;
        case 'unbound':
          // Nothing is bound to this tile yet. ADR-0009's `travel(run, tap.at)` lands here in M2;
          // the position is already in hand, which is the only thing this milestone owed it.
          return;
      }
    },
    [advance, run, scene.taps],
  );

  const onSetShutter = useCallback(
    (to: ShutterState) => advance(setShutter(run, to)),
    [advance, run],
  );
  const onDescend = useCallback(() => advance(descend(run)), [advance, run]);

  /**
   * §13's run loop, closed. A new run, in place, with no reload.
   *
   * `beginRun` is pure and total (`session/run.ts`), so there is nothing to fail, nothing to await
   * and nothing to tear down — the old `Run` is a value and dropping the reference is the whole of
   * disposing of it. **Not `advance`**: `advance` describes a *turn*, and a fresh run has had none,
   * so the line under the board is cleared rather than left carrying the last run's death.
   *
   * The seed is the same constant (#47), so the new run is the same floor 1. That is the deliberate
   * state of the project and it is what the note at the bottom of the screen says.
   */
  const onRestart = useCallback(() => {
    setRun(beginRun(SEED));
    setMessage(null);
  }, []);

  const onBoardSpace = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSpace({ width, height });
  }, []);

  // Square cells, as large as the space allows, floored to a whole point so the grid stays crisp
  // and eleven columns add up to exactly the board's width.
  const cellSize = Math.floor(
    Math.min(space.width / scene.grid.width, space.height / scene.grid.height),
  );

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      {/* The design target is a thumb on a phone (Pillar 3), and the layout is built for that width.
          On a desktop the same layout stretched to 1280 leaves the HUD's three readouts marooned at
          the thirds of the screen and a shutter control a metre wide. Capping the column keeps the
          desktop build — which is what E2E and every screenshot run against — a faithful view of the
          thing being designed, rather than a second layout nobody is looking at. */}
      <View style={styles.column}>
        <HudBar hud={scene.hud} theme={theme} />

        <View style={styles.boardSpace} onLayout={onBoardSpace}>
          {cellSize > 0 ? (
            <Board
              grid={scene.grid}
              taps={scene.taps}
              cellSize={cellSize}
              theme={theme}
              onTapTile={onTapTile}
            />
          ) : null}
        </View>

        {/* §13's two endings take the bottom band over entirely. One field decides it, and it is
            the field `render/` computes for exactly this branch — a run in progress has no summary
            and a finished run has no live control, so there is never a moment both belong on
            screen. The board above stays drawn: §13 keeps the final frame at the killing blow. */}
        {scene.summary === null ? (
          <>
            <StatusLine message={message} theme={theme} />
            <Controls
              hud={scene.hud}
              onSetShutter={onSetShutter}
              onDescend={onDescend}
              theme={theme}
            />
          </>
        ) : (
          <RunSummaryPanel summary={scene.summary} onRestart={onRestart} theme={theme} />
        )}

        {/* The build note, and it belongs to a run in progress. Once the summary is up it would be a
            second, dimmer copy of the seed and the turn count sitting four lines under the first —
            and the summary's copy is the one that is selectable and the one Pillar 4 is about. */}
        {scene.summary === null ? (
          <Text testID="seed-note" style={[styles.seed, { color: theme.textDim }]}>
            {`seed "${SEED}" · turn ${scene.hud.turnsElapsed} · fixed until #47`}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingTop: 24,
    paddingBottom: 12,
  },
  column: {
    flex: 1,
    width: '100%',
    // A little wider than the widest phone, so the phone layout is never the constrained one.
    maxWidth: 480,
    alignSelf: 'center',
  },
  boardSpace: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  seed: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    textAlign: 'center',
    paddingTop: 8,
  },
});
