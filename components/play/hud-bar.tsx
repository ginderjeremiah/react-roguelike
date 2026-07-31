import { StyleSheet, Text, View } from 'react-native';

import { Fonts } from '@/constants/theme';
import type { Hud, MeterLevel } from '@/render';
import type { GameTheme } from './theme';

/**
 * GDD §9's HUD: **HP, fuel, floor number, shutter state, ember-sense radius.** All five, always.
 *
 * The fifth is the one that gets dropped and the one §4 says cannot be: during the four turns after
 * shuttering, the containment guarantee — *everything a flash can wake, you can already feel* — is
 * suspended, and "it stays legible because the HUD shows the number". A HUD without it turns the
 * game's tensest deliberate gamble into an ambush.
 *
 * ## Fuel is read in turns (§4), so the turns are the loud number
 *
 * "There is no maximum" — `refuel` has no ceiling — so a percentage would be a percentage of a
 * number the game does not have, and §4 says to "read it as a number of *turns*" instead. Both the
 * reserve and the turns it buys are shown, along with **what this turn costs**, because that is the
 * number that makes a flash legible: 4 with the shutter open, 1 with it shut.
 *
 * ## §11: colour is never the sole carrier
 *
 * `MeterLevel` drives the colour of a value, and **the number is always printed beside it** — which
 * is what makes that legal (`render/colors.ts`). A `critical` meter additionally gets a `!`, so the
 * severity survives a greyscale screenshot as well as a colourblind reading.
 *
 * Text here scales with the system setting, unlike the board's glyphs; see `board-cell.tsx` for why
 * the two differ.
 */
export type HudBarProps = {
  readonly hud: Hud;
  readonly theme: GameTheme;
};

export function HudBar({ hud, theme }: HudBarProps) {
  const { health, fuel, floor, shutter, sense } = hud;

  return (
    <View
      testID="hud"
      style={[styles.bar, { backgroundColor: theme.panel, borderBottomColor: theme.border }]}
    >
      <View style={styles.row}>
        <Stat
          testID="hud-floor"
          label="FLOOR"
          value={`${floor.number}/${floor.last}`}
          theme={theme}
        />
        <Stat
          testID="hud-hp"
          label="HEALTH"
          value={`${health.hp}/${health.maxHp}`}
          level={health.level}
          theme={theme}
        />
        <Stat
          testID="hud-sense"
          label="EMBER-SENSE"
          value={`${sense.radius}/${sense.max}`}
          // §4's four-turn window. Named on screen because the containment guarantee is off while
          // it is climbing, and the player is entitled to know that without counting turns.
          note={sense.adapting ? 'adapting' : undefined}
          theme={theme}
        />
      </View>

      <View style={styles.row}>
        <Stat
          testID="hud-fuel"
          label="FUEL"
          value={`${fuel.fuel}`}
          level={fuel.level}
          theme={theme}
        />
        <Stat
          testID="hud-burn"
          label="BURNING"
          value={`${fuel.turnsRemaining} turns`}
          note={`${fuel.burnRate} per turn`}
          level={fuel.level}
          theme={theme}
        />
        <Stat
          testID="hud-shutter"
          label="LANTERN"
          value={shutter.state === 'open' ? 'OPEN' : 'SHUT'}
          note={fuel.dry ? 'dry' : undefined}
          theme={theme}
        />
      </View>
    </View>
  );
}

function Stat({
  label,
  value,
  note,
  level,
  theme,
  testID,
}: {
  readonly label: string;
  readonly value: string;
  readonly note?: string;
  readonly level?: MeterLevel;
  readonly theme: GameTheme;
  readonly testID: string;
}) {
  const tone = level === undefined ? theme.text : theme.meter[level];

  return (
    <View style={styles.stat}>
      <Text style={[styles.label, { color: theme.textDim }]}>{label}</Text>
      <Text testID={testID} style={[styles.value, { color: tone }]}>
        {/* The non-colour half of §11: a critical meter says so in a character, not only in red. */}
        {level === 'critical' ? `! ${value}` : value}
      </Text>
      {note === undefined ? null : (
        <Text style={[styles.note, { color: theme.textDim }]}>{note}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  stat: {
    flex: 1,
  },
  label: {
    fontFamily: Fonts.mono,
    fontSize: 9,
    letterSpacing: 1.2,
  },
  value: {
    fontFamily: Fonts.mono,
    fontSize: 17,
    fontWeight: '600',
  },
  note: {
    fontFamily: Fonts.mono,
    fontSize: 10,
  },
});
