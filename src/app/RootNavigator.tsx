import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { AboutScreen } from '../features/more/AboutScreen';
import { AppearanceSettingsScreen } from '../features/settings/AppearanceSettingsScreen';
import { GeneralSettingsScreen } from '../features/settings/GeneralSettingsScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { useTheme } from '../theme/ThemeProvider';
import { DURATION } from '../theme/typography';
import type { RootStackParamList } from './navigation';
import { PlaceholderScreen } from './screens/PlaceholderScreen';
import { TabNavigator } from './TabNavigator';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { colors } = useTheme();
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'fade_from_bottom',
        animationDuration: DURATION.medium,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="tabs" component={TabNavigator} />
      <Stack.Screen name="settings" component={SettingsScreen} />
      <Stack.Screen name="settingsGeneral" component={GeneralSettingsScreen} />
      <Stack.Screen name="settingsAppearance" component={AppearanceSettingsScreen} />
      <Stack.Screen name="about" component={AboutScreen} />
      <Stack.Screen name="placeholder" component={PlaceholderScreen} />
    </Stack.Navigator>
  );
}
