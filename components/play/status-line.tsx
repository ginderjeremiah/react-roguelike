import { StyleSheet, Text, View } from 'react-native';

import { Fonts } from '@/constants/theme';
import type { GameTheme } from './theme';

/**
 * One line between the board and the thumb controls: what the turn just did.
 *
 * GDD §2 requires that a refused tap produce feedback, and §9 adds the larger case — an impassable
 * neighbour never becomes a command at all, so no cue exists for it. This line answers both, and it
 * does so **without motion**, which is the cheapest honest way to satisfy §11's reduced-motion
 * requirement: there is nothing here to reduce.
 *
 * The height is fixed so that a message appearing does not move the board. A board that jumps by a
 * line every time something happens is a board you cannot aim at.
 *
 * ## It used to shout §13's endings, and it deliberately no longer does
 *
 * #20 had this line take the ending over — the only surface that existed then. #21 gives the ending
 * a screen (`run-summary.tsx`), which replaces this line and the controls below it, so a headline
 * branch here would be a second, quieter copy of the same sentence that nothing could ever render.
 * The `outcome` prop went with it. A finished run never mounts this component.
 */
export type StatusLineProps = {
  /** The turn's sentence, or `null` for a turn with nothing to say. */
  readonly message: string | null;
  readonly theme: GameTheme;
};

export function StatusLine({ message, theme }: StatusLineProps) {
  return (
    <View style={styles.line}>
      <Text testID="status-line" numberOfLines={2} style={[styles.text, { color: theme.textDim }]}>
        {message ?? ''}
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
