import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { useSetting } from '../features/settings/settingsStore';
import { buildTheme, resolveThemeName, type Theme } from './palette';

interface ThemeContextValue {
  theme: Theme;
  /** Multiplier applied to interface text sizes. */
  scale: number;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: buildTheme('light', 'indigo'),
  scale: 1,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const appTheme = useSetting('appTheme');
  const accent = useSetting('accent');
  const scale = useSetting('uiScale');

  const value = useMemo(
    () => ({
      theme: buildTheme(
        resolveThemeName(appTheme, systemScheme === 'dark' ? 'dark' : 'light'),
        accent,
      ),
      scale,
    }),
    [appTheme, accent, scale, systemScheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext).theme;
}

export function useUiScale(): number {
  return useContext(ThemeContext).scale;
}
