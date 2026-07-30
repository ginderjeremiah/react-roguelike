import { StyleSheet, Text, type TextProps } from 'react-native';

import { useThemeColor } from '@/hooks/use-theme-color';

/**
 * Text that picks up the active color scheme.
 *
 * Trimmed to the two variants actually in use. The tutorial shipped `defaultSemiBold`,
 * `subtitle`, and `link` — all only referenced by deleted screens, and `link` hardcoded the
 * tutorial's tint color. Add variants back when something needs them, not speculatively.
 */
export type ThemedTextProps = TextProps & {
  lightColor?: string;
  darkColor?: string;
  type?: 'default' | 'title';
};

export function ThemedText({
  style,
  lightColor,
  darkColor,
  type = 'default',
  ...rest
}: ThemedTextProps) {
  const color = useThemeColor({ light: lightColor, dark: darkColor }, 'text');

  return (
    <Text
      style={[{ color }, type === 'default' ? styles.default : styles.title, style]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  default: {
    fontSize: 16,
    lineHeight: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    lineHeight: 32,
  },
});
