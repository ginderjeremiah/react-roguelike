import { useColorScheme } from '@/hooks/use-color-scheme';
import { DARK_THEME, LIGHT_THEME, type GameTheme } from './theme';

/**
 * The palette for the active colour scheme. GDD §11 requires both, so neither is the "real" one.
 *
 * A hook rather than a context: there is exactly one game screen, the tables are module constants,
 * and a provider would add a re-render boundary to save nothing. If a second screen ever needs the
 * same theme, this is still the thing it calls.
 *
 * **The returned object is referentially stable per scheme**, which is what lets `BoardCell`'s
 * `React.memo` use the default comparator — a theme rebuilt on every render would make every cell's
 * props change every turn and delete the memoisation `render/`'s cell reuse exists to enable.
 */
export function useGameTheme(): GameTheme {
  return useColorScheme() === 'dark' ? DARK_THEME : LIGHT_THEME;
}
