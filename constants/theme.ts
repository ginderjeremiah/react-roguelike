/**
 * Base colors and font stacks for app chrome.
 *
 * Deliberately minimal, and **not** the game palette. Per ADR-0003 the grid's colors come from the
 * presentation model produced by `render/`, so M4's palette work belongs there, not here. Only
 * what the surrounding UI needs lives in this file.
 *
 * The tutorial's `tint`, `icon`, `tabIconDefault`, and `tabIconSelected` were dropped along with
 * the tab bar that was their only consumer.
 */

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#11181C',
    background: '#fff',
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
  },
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
