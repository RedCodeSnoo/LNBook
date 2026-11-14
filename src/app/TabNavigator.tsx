import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';

import { BrowseScreen } from '../features/browse/BrowseScreen';
import { HistoryScreen } from '../features/history/HistoryScreen';
import { LibraryScreen } from '../features/library/LibraryScreen';
import { MoreScreen } from '../features/more/MoreScreen';
import { getSetting } from '../features/settings/settingsStore';
import { UpdatesScreen } from '../features/updates/UpdatesScreen';
import { Icon, type IconName } from '../theme/components';
import { useTheme, useUiScale } from '../theme/ThemeProvider';
import { FONTS } from '../theme/typography';
import type { TabParamList } from './navigation';

const Tab = createBottomTabNavigator<TabParamList>();

const ICONS: Record<keyof TabParamList, { idle: IconName; active: IconName }> = {
  library: { idle: 'bookshelf', active: 'bookshelf' },
  updates: { idle: 'bell-outline', active: 'bell' },
  history: { idle: 'history', active: 'history' },
  browse: { idle: 'compass-outline', active: 'compass' },
  more: { idle: 'dots-horizontal', active: 'dots-horizontal' },
};

export function TabNavigator() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const scale = useUiScale();

  return (
    <Tab.Navigator
      // The first tab opened is a setting; Back always returns to the Library before leaving.
      initialRouteName={getSetting('startTab')}
      backBehavior="firstRoute"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary as string,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: { fontFamily: FONTS.medium, fontSize: 11 * scale },
        tabBarIcon: ({ focused, color }) => (
          <Icon name={focused ? ICONS[route.name].active : ICONS[route.name].idle} color={color} />
        ),
      })}
    >
      <Tab.Screen name="library" component={LibraryScreen} options={{ title: t('tabs.library') }} />
      <Tab.Screen name="updates" component={UpdatesScreen} options={{ title: t('tabs.updates') }} />
      <Tab.Screen name="history" component={HistoryScreen} options={{ title: t('tabs.history') }} />
      <Tab.Screen name="browse" component={BrowseScreen} options={{ title: t('tabs.browse') }} />
      <Tab.Screen name="more" component={MoreScreen} options={{ title: t('tabs.more') }} />
    </Tab.Navigator>
  );
}
