import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../ThemeProvider';

/** Full screen container with the theme background and safe area padding. */
export function Screen({
  children,
  top = true,
  bottom = false,
}: {
  children: ReactNode;
  /** Pad the status bar area (false when an AppBar already does it). */
  top?: boolean;
  /** Pad the navigation bar area (screens that are not inside the tab bar). */
  bottom?: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.screen,
        {
          backgroundColor: theme.colors.background,
          paddingTop: top ? insets.top : 0,
          paddingBottom: bottom ? insets.bottom : 0,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({ screen: { flex: 1 } });
