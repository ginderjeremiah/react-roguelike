import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts } from '@/constants/theme';
import type { Hud } from '@/render';
// The one vocabulary `session/` re-exports so a control can *name* what it sends. It is a two-member
// string union that references nothing in the simulation — see `session/index.ts`.
import type { ShutterState } from '@/session';
import { TOUCH_TARGET } from './hit-test';
import { descendHint } from './messages';
import type { GameTheme } from './theme';

/**
 * The two controls GDD §9 puts under the thumb, and the rules about when each of them exists.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE SHUTTER IS A TOGGLE THAT SENDS A SETTING
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * §9 states it once, deliberately: "**The control is a toggle; the command is not.**" What the thumb
 * sends names a setting absolutely — `open`, or `shuttered` — because a toggle's meaning depends on
 * the state before it, so one dropped or duplicated command silently inverts the rest of a stored
 * run.
 *
 * The consequence for this file is one line and it is the whole point: the setting to send is
 * computed from **`hud.shutter.state`**, which came from the simulation this turn, and never from a
 * local mirror of it. There is no `useState` in this component for exactly that reason.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * **At 0 fuel the shutter can no longer be opened** (§4), and `game/systems/lantern.ts` says what the
 * renderer owes that fact: "a control that silently does nothing is worse than one that is visibly
 * dead". So `canOpen: false` disables the control, greys it, and labels it — rather than sending a
 * command that would be refused.
 *
 * **Descend is its own control, present only on the stairs** (§9). Not the self-tap, which is `wait`
 * — "waiting on the stairs is a real move", and the stairs are where §3's macro decision gets made.
 * Its appearing is also the confirmation that you are standing on them, which is worth something in
 * the dark.
 *
 * ## This row is mounted only while the run is running
 *
 * #20 had it grey itself out on a finished run, because there was nowhere else for the end of a run
 * to go. #21 gives it somewhere: `run-summary.tsx` replaces this whole band the moment
 * `scene.summary` stops being `null` (`app/index.tsx`), so a `!running` branch here is a state that
 * cannot be rendered. It is gone rather than kept "for safety" — an unreachable branch is a branch
 * nothing tests, and this file's own argument is that a control must never lie about what it does.
 */
export type ControlsProps = {
  readonly hud: Hud;
  /** Absolute, never a toggle. See the header. */
  readonly onSetShutter: (to: ShutterState) => void;
  readonly onDescend: () => void;
  readonly theme: GameTheme;
};

export function Controls({ hud, onSetShutter, onDescend, theme }: ControlsProps) {
  const open = hud.shutter.state === 'open';
  // The setting the toggle is toggling **to**, read off this turn's state.
  const target: ShutterState = open ? 'shuttered' : 'open';
  // Closing is always possible; opening needs fuel (§4).
  const shutterDead = !open && !hud.shutter.canOpen;

  return (
    <View style={[styles.row, { borderTopColor: theme.border }]}>
      <ControlButton
        testID="control-shutter"
        label={open ? 'CLOSE SHUTTER' : hud.shutter.canOpen ? 'OPEN SHUTTER' : 'SHUTTER STUCK'}
        hint={shutterDead ? 'no fuel to light it' : `then burning ${open ? 1 : 4} per turn`}
        disabled={shutterDead}
        onPress={() => onSetShutter(target)}
        theme={theme}
      />

      {/* §9: present **only** while standing on the stairs. Not disabled — absent. */}
      {hud.onStairs ? (
        <ControlButton
          testID="control-descend"
          label="DESCEND"
          // §13: the eighth descent *is* the ending, so the last floor's stairs do not lead to a
          // floor 9. The copy is decided in `messages.ts`, where a test can read it.
          hint={descendHint(hud.floor)}
          onPress={onDescend}
          theme={theme}
        />
      ) : null}
    </View>
  );
}

function ControlButton({
  label,
  hint,
  onPress,
  disabled = false,
  theme,
  testID,
}: {
  readonly label: string;
  readonly hint: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly theme: GameTheme;
  readonly testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${hint}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: pressed ? theme.border : theme.panel,
          borderColor: theme.border,
          // Visibly dead, not silently inert. The label says why; this says it at a glance.
          opacity: disabled ? 0.45 : 1,
        },
      ]}
    >
      <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
      <Text style={[styles.hint, { color: theme.textDim }]}>{hint}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  button: {
    flex: 1,
    // Comfortably past the 44pt minimum: these are the two controls a thumb reaches for without
    // looking, and they sit in the bottom band of the screen where that thumb already is.
    minHeight: TOUCH_TARGET + 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
  },
  label: {
    fontFamily: Fonts.mono,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  hint: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    marginTop: 2,
  },
});
