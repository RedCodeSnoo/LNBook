import { ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { RootScreenProps } from '../../app/navigation';
import {
  AppBar,
  ListItem,
  RadioItem,
  Screen,
  SectionHeader,
  SwitchItem,
} from '../../theme/components';
import type { LibraryDisplay } from './settings';
import { setSetting, useSetting } from './settingsStore';

const DISPLAYS: { value: LibraryDisplay; labelKey: string }[] = [
  { value: 'grid', labelKey: 'library.displayGrid' },
  { value: 'compact', labelKey: 'library.displayCompact' },
  { value: 'list', labelKey: 'library.displayList' },
];

export function LibrarySettingsScreen({ navigation }: RootScreenProps<'settingsLibrary'>) {
  const { t } = useTranslation();
  const display = useSetting('libraryDisplay');
  const columns = useSetting('libraryColumns');
  const unread = useSetting('showUnreadBadge');
  const download = useSetting('showDownloadBadge');
  const language = useSetting('showLanguageBadge');
  const progress = useSetting('showProgressBar');
  const keepFormatting = useSetting('keepEpubFormatting');

  return (
    <Screen bottom>
      <AppBar title={t('settings.library')} onBack={navigation.goBack} />
      <ScrollView>
        <ListItem
          icon="label-outline"
          title={t('categories.title')}
          subtitle={t('categories.settingsHint')}
          onPress={() => navigation.navigate('categories')}
        />

        <SectionHeader title={t('library.display')} />
        {DISPLAYS.map((option) => (
          <RadioItem
            key={option.value}
            title={t(option.labelKey)}
            checked={display === option.value}
            onPress={() => setSetting('libraryDisplay', option.value)}
          />
        ))}

        <SectionHeader title={t('library.columns')} />
        {[2, 3, 4, 5].map((count) => (
          <RadioItem
            key={count}
            title={String(count)}
            checked={columns === count}
            onPress={() => setSetting('libraryColumns', count)}
          />
        ))}

        <SectionHeader title={t('settings.badges')} />
        <SwitchItem
          title={t('settings.badgeUnread')}
          value={unread}
          onValueChange={(value) => setSetting('showUnreadBadge', value)}
        />
        <SwitchItem
          title={t('settings.badgeDownload')}
          value={download}
          onValueChange={(value) => setSetting('showDownloadBadge', value)}
        />
        <SwitchItem
          title={t('settings.badgeLanguage')}
          value={language}
          onValueChange={(value) => setSetting('showLanguageBadge', value)}
        />
        <SwitchItem
          title={t('settings.badgeProgress')}
          value={progress}
          onValueChange={(value) => setSetting('showProgressBar', value)}
        />

        <SectionHeader title={t('settings.importSection')} />
        <SwitchItem
          title={t('settings.keepEpubFormatting')}
          subtitle={t('settings.keepEpubFormattingHint')}
          value={keepFormatting}
          onValueChange={(value) => setSetting('keepEpubFormatting', value)}
        />
      </ScrollView>
    </Screen>
  );
}
