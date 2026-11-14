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
import { setSetting, useSetting } from './settingsStore';

const DELAYS = [500, 1000, 2000, 5000];

/** Settings → Downloads: network, politeness delay, storage. */
export function DownloadSettingsScreen({ navigation }: RootScreenProps<'settingsDownloads'>) {
  const { t } = useTranslation();
  const wifiOnly = useSetting('downloadWifiOnly');
  const delay = useSetting('downloadDelayMs');
  return (
    <Screen bottom>
      <AppBar title={t('settings.downloads')} onBack={navigation.goBack} />
      <ScrollView>
        <ListItem
          icon="download-outline"
          title={t('more.downloads')}
          subtitle={t('downloads.queueHint')}
          onPress={() => navigation.navigate('downloads')}
        />
        <ListItem
          icon="harddisk"
          title={t('downloads.storage')}
          subtitle={t('downloads.storageHint')}
          onPress={() => navigation.navigate('storage')}
        />
        <SwitchItem
          icon="wifi"
          title={t('downloads.wifiOnly')}
          value={wifiOnly}
          onValueChange={(value) => setSetting('downloadWifiOnly', value)}
        />
        <SectionHeader title={t('downloads.delay')} />
        {DELAYS.map((value) => (
          <RadioItem
            key={value}
            title={t('downloads.delaySeconds', { seconds: String(value / 1000).replace('.', ',') })}
            checked={delay === value}
            onPress={() => setSetting('downloadDelayMs', value)}
          />
        ))}
        <ListItem title={t('downloads.exportFolder')} subtitle={t('downloads.exportFolderHint')} />
      </ScrollView>
    </Screen>
  );
}
