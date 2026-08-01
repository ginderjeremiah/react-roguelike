import { StyleSheet, Text, View } from 'react-native';

import { Fonts } from '@/constants/theme';
import type { TurnLine } from './messages';
import { statusStyle } from './status-style';
import type { GameTheme } from './theme';

/**
 * One line between the board and the thumb controls: what the turn just did, and how loudly.
 *
 * GDD §2 requires that a refused tap produce feedback, and §9 adds the larger case — an impassable
 * neighbour never becomes a command at all, so no cue exists for it. This line answers both, and it
 * does so **without motion**, which is the cheapest honest way to satisfy §11's reduced-motion
 * requirement: there is nothing here to reduce.
 *
 * The height is fixed so that a message appearing does not move the board. A board that jumps by a
 * line every time something happens is a board you cannot aim at.
 *
 * ## The volume is §10's, and this component only obeys it
 *
 * Every line arrives carrying a `LineLevel` chosen from **the cue that won it** (`messages.ts`), and
 * `status-style.ts` turns that into weight, size and colour. Nothing here looks at the sentence.
 * That is the constraint #94 was ruled under: a component deciding emphasis by matching on text
 * would be a second copy of the copy, and it would rot the first time a sentence was reworded.
 *
 * ## It used to shout §13's endings, and it deliberately no longer does
 *
 * #20 had this line take the ending over — the only surface that existed then. #21 gives the ending
 * a screen (`run-summary.tsx`), which replaces this line and the controls below it, so a headline
 * branch here would be a second, quieter copy of the same sentence that nothing could ever render.
 * The `outcome` prop went with it. A finished run never mounts this component.
 */
export type StatusLineProps = {
  /** The turn's sentence and its level, or `null` for a turn with nothing to say. */
  readonly line: TurnLine | null;
  readonly theme: GameTheme;
};

/**
 * What the row is showing, as a test id on the wrapper.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE LEVEL IS IN THE DOM AS AN ATTRIBUTE, ON PURPOSE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * §10 requires the emphasis rule to be checkable "without a human looking at a screenshot", and to
 * be checkable as **the rule** rather than as its current pixels — an E2E reading `font-weight: 700`
 * out of computed styles would go red the day M4 repaints the screen without anything being wrong.
 * `testID` is the typed route React Native already gives us (react-native-web renders it as
 * `data-testid`), so the level rides out on the wrapper and the assertion reads like the ruling.
 *
 * **`status-line` itself stays on the `Text`**, because five assertions across two E2E specs select
 * it and they are about the *words*. Playwright's `getByTestId` matches exactly, so the ids below
 * never collide with it.
 *
 * The empty row gets its own id rather than being called a `report`. A row with nothing on it is not
 * a quiet claim, it is the absence of one — and keeping the two apart is what lets an E2E assert "a
 * report is on screen" and have that mean something.
 */
function rowTestID(line: TurnLine | null): string {
  return line === null ? 'status-line-empty' : `status-line-${line.level}`;
}

export function StatusLine({ line, theme }: StatusLineProps) {
  // The resting row still needs *a* colour and *a* size, and `report` is the quiet one. It paints an
  // empty string, so this is a fallback for the box rather than a claim about the turn — which is
  // why the row's test id above does not call it a report.
  const paint = statusStyle(line?.level ?? 'report', theme);

  return (
    <View testID={rowTestID(line)} style={styles.line}>
      <Text testID="status-line" numberOfLines={2} style={[styles.text, paint]}>
        {line?.text ?? ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    // ── UNCHANGED BY #94's SIZE BUMP, AND THAT WAS MEASURED RATHER THAN ASSUMED ────────────────
    //
    // 34pt holds one 18pt line plus its padding with room to spare, so the row is a **fixed** 34
    // for every sentence the game can produce at the default text size: the longest is
    // `The shutter opens. Light spills out.` at 36 mono characters, which is ~313pt inside 362pt of
    // room at 390 wide. Nothing wraps, so nothing moves the board — which is the property §10 asked
    // for, and `board.tsx` resolves a press by measuring where the board is.
    //
    // A draft of this reserved two lines (44) so that a wrap could not move the board either. It was
    // reverted: on the **desktop** viewport the board is height-bound rather than width-bound, and
    // those 10pt took the cell from 30pt to 29 — trading a point of board legibility, which the
    // player reads every turn, for a case that cannot occur at the default text size. §11's scaling
    // is what can still wrap this line, and then the row grows rather than clipping, which is the
    // right failure of the two.
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  text: {
    fontFamily: Fonts.mono,
    // Stated rather than inherited: react-native-web's default line box is a browser default, and
    // the height reserved above is arithmetic that has to hold on every platform. The size and the
    // weight come from `status-style.ts`, which is where the ramp is argued and tested.
    lineHeight: 18,
    textAlign: 'center',
  },
});
