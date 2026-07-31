import { StyleSheet, Text, View } from 'react-native';

import { Fonts } from '@/constants/theme';
import type { OutcomeHud } from '@/render';
import type { GameTheme } from './theme';

/**
 * One line between the board and the thumb controls: what just happened, or how the run ended.
 *
 * GDD §2 requires that a refused tap produce feedback, and §9 adds the larger case — an impassable
 * neighbour never becomes a command at all, so no cue exists for it. This line answers both, and it
 * does so **without motion**, which is the cheapest honest way to satisfy §11's reduced-motion
 * requirement: there is nothing here to reduce.
 *
 * The height is fixed so that a message appearing does not move the board. A board that jumps by a
 * line every time something happens is a board you cannot aim at.
 *
 * §13's two endings take the line over entirely. They are the only thing in this screen that is
 * allowed to shout.
 */
export type StatusLineProps = {
  /** The turn's sentence, or `null` for a turn with nothing to say. */
  readonly message: string | null;
  readonly outcome: OutcomeHud;
  readonly theme: GameTheme;
};

export function StatusLine({ message, outcome, theme }: StatusLineProps) {
  const headline = outcome.kind === 'running' ? null : outcome.headline;
  const ended = headline !== null;

  return (
    <View style={styles.line}>
      <Text
        testID="status-line"
        numberOfLines={2}
        style={[
          styles.text,
          {
            color: ended ? theme.token.ember : theme.textDim,
            fontWeight: ended ? '700' : '400',
          },
        ]}
      >
        {headline ?? message ?? ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  text: {
    fontFamily: Fonts.mono,
    fontSize: 13,
    textAlign: 'center',
  },
});
