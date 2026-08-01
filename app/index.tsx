import { useCallback, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { Board } from '@/components/play/board';
import { Controls } from '@/components/play/controls';
import { HudBar } from '@/components/play/hud-bar';
import {
  BLOCKED_MESSAGE,
  describeTurn,
  RUN_OVER_MESSAGE,
  TOO_FAR_MESSAGE,
} from '@/components/play/messages';
import { openRun } from '@/components/play/opening';
import { RunSummaryPanel } from '@/components/play/run-summary';
import { StatusLine } from '@/components/play/status-line';
import { useGameTheme } from '@/components/play/use-game-theme';
import { Fonts } from '@/constants/theme';
import { tapAt } from '@/render';
import {
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
 *   - Start another run: `openRun(SEED)`. §13's loop, closed, with no reload.
 *
 * **`openRun` rather than `beginRun`, and that is a repair rather than a preference.** A fresh run
 * is not a blank slate: §4 opens the lantern and `createInitialState` runs phase 3, so the opening
 * frame can already owe the player a sentence (§4/#79). This file used to initialise `message` to a
 * literal `null` and only ever assign it from a press handler, which computed the opening cues and
 * dropped them. See `components/play/opening.ts` — the decision lives there, where a test can reach
 * it, precisely because it went unnoticed here.
 *
 * The one decision that is genuinely local is what a tap that resolves to nothing looks like: §2
 * insists a dead tap be acknowledged, so **all three refusals that never reach `step` write a line**
 * rather than doing nothing at all — `blocked`, `unbound`, and a tap on a board whose run has ended.
 * Those three have no cue to speak for them, because no command is ever built. See
 * `components/play/messages.ts`.
 *
 * Two of the three were silent when they shipped, and neither was caught by a test: the run-over case
 * by a mutant that survived review (#21), the `unbound` case by a playtester tapping a distant tile
 * (#60). **A refusal with no feedback is indistinguishable from a handler that was never called**, so
 * the suite cannot tell them apart either. #75 is about making that structural rather than
 * remembered; until it lands, assume a fourth refusal has forgotten its line.
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
 * **No travel on a distant tile.** ADR-0009 defers auto-travel to M2 (#65); `tapAt` answers `unbound`
 * and this switch acknowledges the tap without acting on it (#60) — the acknowledgement is a refusal
 * message, deliberately worded so it promises nothing about pathing. The `Position` is already in
 * hand, which was the whole constraint, so `travel(run, tap.at)` replaces that one line.
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
  // One `openRun` call feeds both pieces of state, so the board and the line under it are always
  // describing the same run. Both initialisers are lazy, so the run is begun once and not on every
  // render — and `opened` is read only during the first render, which is why it is not a ref.
  const [opened] = useState(() => openRun(SEED));
  const [run, setRun] = useState<Run>(opened.run);
  const [message, setMessage] = useState<string | null>(opened.message);
  const [space, setSpace] = useState<BoardSpace>({ width: 0, height: 0 });

  const scene = sceneOf(run);

  /**
   * Advance the run and say what the turn did.
   *
   * Both halves matter. A refused intent still returns a **new** `Run` whose scene is the previous
   * object (`session/run.ts`), so React re-renders, the board does not repaint, and the cue list
   * carries §2's refusal — which becomes the line under the board.
   *
   * **Except on the turn that ends the run.** `describeTurn` would return `The lantern goes out.`,
   * which is the headline the summary is about to print two lines below in bold. One line, one
   * voice: the panel says how the run ended, and this line goes quiet so that whatever it says next
   * is about the *press*, not about the run.
   *
   * That exception is why a **restart** does not come through here even though it also produces a
   * `Run`: `onRestart` uses `openRun`, which carries no rule about endings because a fresh run has
   * no ending to suppress. The two are not interchangeable and were never meant to be.
   */
  const advance = useCallback((next: Run) => {
    setRun(next);
    setMessage(sceneOf(next).summary === null ? describeTurn(cuesOf(next)) : null);
  }, []);

  const onTapTile = useCallback(
    (x: number, y: number) => {
      // ═════════════════════════════════════════════════════════════════════════════════════════
      // §13's refusal, and the only one in the game that produces neither a cue nor a `TapAction`
      // ═════════════════════════════════════════════════════════════════════════════════════════
      //
      // A finished run accepts no commands (§13), and `render/taps.ts` expresses that by emitting an
      // **empty** tap list — so every tile answers `unbound` below and nothing is ever sent to
      // `session/`. That is correct, and it leaves this press with no observable at all: §2's "a tap
      // that does nothing reads on a phone as 'the touch did not register'" applies exactly here,
      // and a dead handler would be indistinguishable from a working refusal. Both the rule and the
      // test need this line to exist.
      if (scene.summary !== null) {
        setMessage(RUN_OVER_MESSAGE);
        return;
      }

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
          //
          // Until then the tap is a refusal like any other, and §2 says a refusal is acknowledged.
          // It was silent until #60, and the first playtest found it the way a player would: tapping
          // a distant tile is the first thing anyone does on a phone, and nothing happening reads as
          // a missed touch rather than as a rule. **When travel lands this becomes the travel call
          // and the message goes away** — it is not permanent copy.
          setMessage(TOO_FAR_MESSAGE);
          return;
      }
    },
    [advance, run, scene.summary, scene.taps],
  );

  const onSetShutter = useCallback(
    (to: ShutterState) => advance(setShutter(run, to)),
    [advance, run],
  );
  const onDescend = useCallback(() => advance(descend(run)), [advance, run]);

  /**
   * §13's run loop, closed. A new run, in place, with no reload.
   *
   * `openRun` is pure and total (it is `beginRun` plus a sentence), so there is nothing to fail,
   * nothing to await and nothing to tear down — the old `Run` is a value and dropping the reference
   * is the whole of disposing of it.
   *
   * **Not `advance`, and no longer a blank line either.** `advance` describes a *turn* and carries a
   * rule about the turn that ends a run, which a fresh run has no use for — that part of the old
   * reasoning stands. What did not stand is the conclusion drawn from it: this used to
   * `setMessage(null)` on the argument that "a fresh run has had none", and a fresh run **has**
   * had phase 3 (§4 opens the lantern; `session/run.ts`'s `beginRun` says so at length). So the
   * line does not carry the last run's death, and it does carry this run's opening — which is a
   * wake sentence about one restart in ten, and empty on the rest.
   *
   * The seed is the same constant (#47), so the new run is the same floor 1 — and therefore the
   * same opening line. That is the deliberate state of the project and it is what the note at the
   * bottom of the screen says.
   */
  const onRestart = useCallback(() => {
    const restarted = openRun(SEED);
    setRun(restarted.run);
    setMessage(restarted.message);
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
          <RunSummaryPanel
            summary={scene.summary}
            note={message}
            onRestart={onRestart}
            theme={theme}
          />
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
