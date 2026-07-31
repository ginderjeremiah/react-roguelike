import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts } from '@/constants/theme';
import type { RunSummary, SummaryStat } from '@/render';
import { TOUCH_TARGET } from './hit-test';
import { verdictTone } from './summary-style';
import type { GameTheme } from './theme';

/**
 * GDD §13's end-of-run panel: how it ended, what it came to, the seed, and the way back in.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * IT REPLACES THE THUMB CONTROLS, NOT THE BOARD
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * §13 is explicit about the final frame: "the last thing on screen is the thing that killed you, not
 * three Cinders shuffling around a corpse ... Pillar 2 in its most literal form." A summary drawn
 * over the whole screen would delete the one frame the simulation went out of its way to preserve.
 * So the board and the HUD stay exactly where they were, frozen at the values the run ended on, and
 * this takes the bottom band — which is the band that was full of controls that no longer do
 * anything (§13: a finished run refuses every command).
 *
 * That placement also puts **RUN AGAIN under the thumb that was just playing**, at the position the
 * shutter control occupied a frame earlier. The first playtest's one replayability complaint was
 * "Would I immediately start another run? Yes — and I couldn't"; the answer to that is a button in
 * the place the hand already is, not a menu.
 *
 * ## Every decision on this screen was made in `render/summary.ts`
 *
 * The verdict, the marker, the headline, which ending is a **win**, the four numbers, their labels
 * and their order. This file chooses type sizes and where things sit. In particular it does not ask
 * `outcome === 'reachedBottom'` anywhere — `summary.won` is the model's answer, because deciding
 * which of §13's two endings is the victory is a design fact and not a layout one.
 *
 * ## §11, twice
 *
 * **Colour is never the sole carrier.** Which ending this was rides on a word (`verdict`) and a
 * glyph (`marker`) before any colour is applied; the tint below is the third channel, not the first.
 * Turn the screen greyscale and `† DIED` and `> REACHED THE BOTTOM` are still two different screens.
 *
 * **Nothing animates.** Not a stopgap: it is the honest way to satisfy §11's reduced-motion
 * requirement, and the run summary is precisely the screen a player wants *now* rather than after a
 * flourish. The state is already final when this mounts.
 *
 * Text scales with the system setting — nothing here disables font scaling, and the panel grows
 * downward into the board's space rather than clipping, because every row is laid out by content.
 */
export type RunSummaryPanelProps = {
  readonly summary: RunSummary;
  /**
   * §2's one line of feedback, while the run is over. `null` most of the time.
   *
   * This is the same role `StatusLine` plays during a run, and it exists for the same reason: the
   * board is still on screen and still receives presses, every one of which §13 refuses. Without an
   * acknowledgement those presses are "a UI failure wearing the costume of a rule" — and, because
   * `render/taps.ts` empties the tap list at the ending, they are also the one refusal with no cue
   * behind it, so nothing else can speak for them.
   *
   * **It shares the seed's row and the row reserves its height**, which is not a layout preference:
   * a line that appeared and pushed the panel taller would move the board under it, and the board
   * resolves a press by measuring where it is (`board.tsx`). A summary that shifted the board every
   * time it was tapped would be re-creating #20's stale-origin bug from the other end.
   */
  readonly note: string | null;
  /** Starts a fresh run in place. `session/`'s `beginRun` is pure and total, so it cannot fail. */
  readonly onRestart: () => void;
  readonly theme: GameTheme;
};

export function RunSummaryPanel({ summary, note, onRestart, theme }: RunSummaryPanelProps) {
  // The third carrier, never the first — see `summary-style.ts`, where it is decided and tested.
  const tone = verdictTone(summary, theme);

  return (
    <View
      testID="run-summary"
      style={[styles.panel, { backgroundColor: theme.panel, borderTopColor: theme.border }]}
    >
      <View style={styles.verdictRow}>
        <Text testID="summary-marker" style={[styles.marker, { color: tone }]}>
          {summary.marker}
        </Text>
        <View style={styles.verdictText}>
          <Text testID="summary-verdict" style={[styles.verdict, { color: tone }]}>
            {summary.verdict}
          </Text>
          <Text testID="summary-headline" style={[styles.headline, { color: theme.text }]}>
            {summary.headline}
          </Text>
        </View>
      </View>

      <View style={styles.stats}>
        {summary.stats.map((stat) => (
          <SummaryReadout key={stat.key} stat={stat} theme={theme} />
        ))}
      </View>

      {/* Pillar 4: a run is a shareable artifact, and the seed is the half of it a player can read
          off the screen. `selectable` is one prop on web and costs nothing anywhere else, so the
          seed can be copied instead of transcribed — which is the difference between "shareable"
          and "printed". The word is chrome and the seed is the data, so only one of them is dim. */}
      <View style={styles.seedRow}>
        <Text testID="summary-seed" selectable style={[styles.seed, { color: theme.textDim }]}>
          {'seed  '}
          <Text style={{ color: theme.text }}>{summary.seed}</Text>
        </Text>
        {/* §2's acknowledgement, in the space the row already occupies. See the `note` prop. */}
        <Text testID="summary-note" style={[styles.note, { color: theme.textDim }]}>
          {note ?? ''}
        </Text>
      </View>

      <Pressable
        testID="control-restart"
        accessibilityRole="button"
        accessibilityLabel="Run again. Starts a new run from the beginning."
        onPress={onRestart}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: pressed ? theme.border : theme.panel, borderColor: tone },
        ]}
      >
        <Text style={[styles.buttonLabel, { color: theme.text }]}>RUN AGAIN</Text>
      </Pressable>
    </View>
  );
}

/**
 * One of §13's four numbers, laid out exactly as the HUD lays out its readouts.
 *
 * Deliberately the same shape as `hud-bar.tsx`'s `Stat` — dim label above, the number below, a
 * quieter note under that. A player has spent the whole run reading that arrangement; the summary is
 * the wrong moment to teach them a second one.
 */
function SummaryReadout({ stat, theme }: { readonly stat: SummaryStat; readonly theme: GameTheme }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statLabel, { color: theme.textDim }]}>{stat.label}</Text>
      <Text testID={`summary-${stat.key}`} style={[styles.statValue, { color: theme.text }]}>
        {stat.value}
      </Text>
      {stat.note === null ? null : (
        <Text style={[styles.statNote, { color: theme.textDim }]}>{stat.note}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  verdictRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  marker: {
    fontFamily: Fonts.mono,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '700',
  },
  verdictText: {
    flex: 1,
  },
  verdict: {
    fontFamily: Fonts.mono,
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: 1,
  },
  headline: {
    fontFamily: Fonts.mono,
    fontSize: 13,
    marginTop: 1,
  },
  stats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  stat: {
    flex: 1,
  },
  statLabel: {
    fontFamily: Fonts.mono,
    fontSize: 9,
    letterSpacing: 1.2,
  },
  statValue: {
    fontFamily: Fonts.mono,
    fontSize: 17,
    fontWeight: '600',
  },
  statNote: {
    fontFamily: Fonts.mono,
    fontSize: 10,
  },
  seedRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
    // What actually keeps the board still when an acknowledgement appears is the **row**: the note
    // shares this line with the seed, which is always rendered at the same size, so the panel's
    // height does not change. Verified by mutation — moving the note to its own line shifts the
    // board 6.5pt on desktop and 15pt on phone, and the E2E catches it.
    //
    // `minHeight` is belt-and-braces for font scaling and for whoever next edits this row; it is
    // not currently load-bearing (removing it leaves the death spec green). Kept, but do not
    // mistake it for the guarantee.
    minHeight: 15,
  },
  seed: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    letterSpacing: 0.4,
  },
  note: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    textAlign: 'right',
  },
  button: {
    // The same generous target as the thumb controls it replaces, and for the same reason: this is
    // the one thing on the screen a player wants to hit without looking.
    minHeight: TOUCH_TARGET + 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 8,
  },
  buttonLabel: {
    fontFamily: Fonts.mono,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
});
