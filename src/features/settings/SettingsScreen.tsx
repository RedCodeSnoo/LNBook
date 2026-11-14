import { ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { RootScreenProps } from '../../app/navigation';
import { AppBar, ListItem, Screen, type IconName } from '../../theme/components';

interface Group {
  key: string;
  icon: IconName;
  route?:
    | 'settingsGeneral'
    | 'settingsAppearance'
    | 'settingsLibrary'
    | 'settingsReader'
    | 'settingsSources'
    | 'settingsDownloads'
    | 'settingsUpdates'
    | 'settingsVoice';
}

const GROUPS: Group[] = [
  { key: 'general', icon: 'tune-variant', route: 'settingsGeneral' },
  { key: 'appearance', icon: 'palette-outline', route: 'settingsAppearance' },
  { key: 'library', icon: 'bookshelf', route: 'settingsLibrary' },
  { key: 'reader', icon: 'book-open-page-variant-outline', route: 'settingsReader' },
  { key: 'voice', icon: 'account-voice', route: 'settingsVoice' },
  { key: 'translation', icon: 'translate' },
  { key: 'downloads', icon: 'download-outline', route: 'settingsDownloads' },
  { key: 'updates', icon: 'bell-outline', route: 'settingsUpdates' },
  { key: 'sources', icon: 'puzzle-outline', route: 'settingsSources' },
  { key: 'advanced', icon: 'wrench-outline' },
];

export function SettingsScreen({ navigation }: RootScreenProps<'settings'>) {
  const { t } = useTranslation();
  return (
    <Screen bottom>
      <AppBar title={t('settings.title')} onBack={navigation.goBack} />
      <ScrollView>
        {GROUPS.map((group) => (
          <ListItem
            key={group.key}
            icon={group.icon}
            title={t(`settings.${group.key}`)}
            subtitle={t(`settings.${group.key}Hint`)}
            onPress={() =>
              group.route
                ? navigation.navigate(group.route)
                : navigation.navigate('placeholder', {
                    titleKey: `settings.${group.key}`,
                    icon: group.icon,
                  })
            }
          />
        ))}
      </ScrollView>
    </Screen>
  );
}
