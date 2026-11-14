import { ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { RootScreenProps } from '../../app/navigation';
import { AppBar, Divider, ListItem, Screen } from '../../theme/components';
import { ReaderSettingsForm } from '../reader/ReaderSettingsSheet';
import { useReaderSettings } from '../reader/useReaderSettings';

/** Settings → Reader: default values of the reader and global text replacement. */
export function ReaderSettingsScreen({ navigation }: RootScreenProps<'settingsReader'>) {
  const { t } = useTranslation();
  const { settings, update } = useReaderSettings(null);
  return (
    <Screen bottom>
      <AppBar title={t('settings.reader')} onBack={navigation.goBack} />
      <ScrollView keyboardShouldPersistTaps="handled">
        <ListItem
          icon="find-replace"
          title={t('reader.replacements')}
          subtitle={t('reader.replacementsHint')}
          onPress={() => navigation.navigate('replacements', {})}
        />
        <Divider />
        <ReaderSettingsForm settings={settings} onChange={update} />
      </ScrollView>
    </Screen>
  );
}
