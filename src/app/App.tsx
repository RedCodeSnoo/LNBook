import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useMemo, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { checkAppUpdateAtLaunch } from '../features/appUpdate/appUpdateService';
import { runAutoBackupIfDue } from '../features/backup/backupService';
import { resumeDownloadsAtLaunch } from '../features/downloads/downloadService';
import { ImportHost } from '../features/library/ImportHost';
import { useOpenWithImport } from '../features/library/openWith';
import { checkAtLaunchIfDue, syncBackgroundCheck } from '../features/updates/updateService';
import { watchNotificationTaps } from '../services/notifications';
import { ToastHost } from '../theme/components';
import { ThemeProvider, useTheme } from '../theme/ThemeProvider';
import { FONTS } from '../theme/typography';
import { navigationRef } from './navigationRef';
import { RootNavigator } from './RootNavigator';
import { StartupErrorScreen } from './screens/StartupErrorScreen';
import { startApp } from './startup';

function ThemedApp() {
  const theme = useTheme();
  useOpenWithImport();

  // Work that continues from one launch to the next: downloads, new chapter checks,
  // app updates and automatic backups.
  useEffect(() => {
    resumeDownloadsAtLaunch();
    checkAtLaunchIfDue();
    void syncBackgroundCheck();
    checkAppUpdateAtLaunch();
    // After the first screens are drawn: building the archive takes a moment.
    const backupTimer = setTimeout(() => void runAutoBackupIfDue(), 4000);
    const stopWatching = watchNotificationTaps();
    return () => {
      clearTimeout(backupTimer);
      stopWatching();
    };
  }, []);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(theme.colors.background);
  }, [theme.colors.background]);

  const navigationTheme = useMemo(() => {
    const base = theme.dark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: theme.colors.primary as string,
        background: theme.colors.background,
        card: theme.colors.surface,
        text: theme.colors.text,
        border: theme.colors.border,
        notification: theme.colors.error,
      },
      fonts: {
        regular: { fontFamily: FONTS.regular, fontWeight: '400' as const },
        medium: { fontFamily: FONTS.medium, fontWeight: '500' as const },
        bold: { fontFamily: FONTS.semiBold, fontWeight: '600' as const },
        heavy: { fontFamily: FONTS.bold, fontWeight: '700' as const },
      },
    };
  }, [theme]);

  return (
    <NavigationContainer ref={navigationRef} theme={navigationTheme}>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <RootNavigator />
      <ImportHost />
      <ToastHost />
    </NavigationContainer>
  );
}

export default function App() {
  // The database is opened synchronously: the first frame already has the right theme.
  const [startup] = useState(startApp);

  if (!startup.ok) {
    return <StartupErrorScreen error={startup.error} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <ThemedApp />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
