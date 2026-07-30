import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts } from '@/constants/theme';

/**
 * Placeholder shell. The game grid replaces this in M1 — see docs/ROADMAP.md.
 *
 * Kept deliberately bare: it exists so the app boots and the E2E smoke test has something real to
 * assert against, not to prototype the UI. Do not grow this file; the game screen will be built
 * from a presentation model produced by render/ (docs/ARCHITECTURE.md).
 */
export default function GameScreen() {
  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title" style={styles.title}>
        EMBERDEPTH
      </ThemedText>
      <ThemedText style={styles.subtitle}>M0 — foundations</ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 24,
  },
  title: {
    // Monospace throughout: the game is a glyph grid (ADR-0003), and a proportional font would
    // make cells inconsistent widths.
    fontFamily: Fonts.mono,
    letterSpacing: 4,
  },
  subtitle: {
    fontFamily: Fonts.mono,
    opacity: 0.6,
  },
});
