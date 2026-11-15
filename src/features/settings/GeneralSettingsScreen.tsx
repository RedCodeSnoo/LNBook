import { ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { RootScreenProps } from '../../app/navigation';
import { getDb } from '../../db/client';
import { invalidate } from '../../db/invalidation';
import i18n, { changeLanguage, languageFor } from '../../i18n';
import { DEFAULT_CATEGORY_KEYS, translateDefaultCategories } from '../library/libraryRepository';
import { AppBar, RadioItem, Screen, SectionHeader } from '../../theme/components';
import type { DateFormatSetting, LanguageSetting, TabName } from './settings';
import { setSetting, useSetting } from './settingsStore';

const LANGUAGES: { value: LanguageSetting; labelKey: string }[] = [
  { value: 'system', labelKey: 'settings.languageSystem' },
  { value: 'fr', labelKey: 'settings.languageFr' },
  { value: 'en', labelKey: 'settings.languageEn' },
];

const TABS: TabName[] = ['library', 'updates', 'history', 'browse', 'more'];

const DATE_FORMATS: { value: DateFormatSetting; labelKey: string }[] = [
  { value: 'system', labelKey: 'settings.dateFormatSystem' },
  { value: 'dmy', labelKey: 'settings.dateFormatDmy' },
  { value: 'mdy', labelKey: 'settings.dateFormatMdy' },
  { value: 'ymd', labelKey: 'settings.dateFormatYmd' },
];

export function GeneralSettingsScreen({ navigation }: RootScreenProps<'settingsGeneral'>) {
  const { t } = useTranslation();
  const language = useSetting('language');
  const startTab = useSetting('startTab');
  const dateFormat = useSetting('dateFormat');

  return (
    <Screen bottom>
      <AppBar title={t('settings.general')} onBack={navigation.goBack} />
      <ScrollView>
        <SectionHeader title={t('settings.language')} />
        {LANGUAGES.map((option) => (
          <RadioItem
            key={option.value}
            title={t(option.labelKey)}
            checked={language === option.value}
            onPress={() => {
              const names = (lang: string) => {
                const translate = i18n.getFixedT(lang);
                return DEFAULT_CATEGORY_KEYS.map((key) => translate(key));
              };
              const before = names(i18n.language);
              const after = names(languageFor(option.value));
              setSetting('language', option.value);
              changeLanguage(option.value);
              if (translateDefaultCategories(getDb(), before, after) > 0) {
                invalidate('categories', 'library');
              }
            }}
          />
        ))}

        <SectionHeader title={t('settings.startTab')} />
        {TABS.map((tab) => (
          <RadioItem
            key={tab}
            title={t(`tabs.${tab}`)}
            checked={startTab === tab}
            onPress={() => setSetting('startTab', tab)}
          />
        ))}

        <SectionHeader title={t('settings.dateFormat')} />
        {DATE_FORMATS.map((option) => (
          <RadioItem
            key={option.value}
            title={t(option.labelKey)}
            checked={dateFormat === option.value}
            onPress={() => setSetting('dateFormat', option.value)}
          />
        ))}
      </ScrollView>
    </Screen>
  );
}
