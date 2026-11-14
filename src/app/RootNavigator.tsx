import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { CategoriesScreen } from '../features/library/CategoriesScreen';
import { AboutScreen } from '../features/more/AboutScreen';
import { NovelEditScreen } from '../features/novel/NovelEditScreen';
import { NovelScreen } from '../features/novel/NovelScreen';
import { QuoteFoldersScreen } from '../features/quotes/QuoteFoldersScreen';
import { ChapterEditScreen } from '../features/reader/ChapterEditScreen';
import { ReaderScreen } from '../features/reader/ReaderScreen';
import { ReplacementsScreen } from '../features/reader/ReplacementsScreen';
import { AppearanceSettingsScreen } from '../features/settings/AppearanceSettingsScreen';
import { GeneralSettingsScreen } from '../features/settings/GeneralSettingsScreen';
import { LibrarySettingsScreen } from '../features/settings/LibrarySettingsScreen';
import { ReaderSettingsScreen } from '../features/settings/ReaderSettingsScreen';
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
      <Stack.Screen name="settingsLibrary" component={LibrarySettingsScreen} />
      <Stack.Screen name="categories" component={CategoriesScreen} />
      <Stack.Screen name="novel" component={NovelScreen} />
      <Stack.Screen name="novelEdit" component={NovelEditScreen} />
      <Stack.Screen name="reader" component={ReaderScreen} options={{ animation: 'fade' }} />
      <Stack.Screen name="chapterEdit" component={ChapterEditScreen} />
      <Stack.Screen name="replacements" component={ReplacementsScreen} />
      <Stack.Screen name="settingsReader" component={ReaderSettingsScreen} />
      <Stack.Screen name="quoteFolders" component={QuoteFoldersScreen} />
      <Stack.Screen name="placeholder" component={PlaceholderScreen} />
    </Stack.Navigator>
  );
}
