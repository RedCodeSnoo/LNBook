import { Directory } from 'expo-file-system';
import { ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { RootScreenProps } from '../../app/navigation';
import {
  AppBar,
  IconButton,
  ListItem,
  RadioItem,
  Screen,
  SectionHeader,
  SwitchItem,
} from '../../theme/components';
import { folderLabel } from '../backup/backupService';
import { setSetting, useSetting } from './settingsStore';

const DELAYS = [500, 1000, 2000, 5000];

/** Settings → Downloads: network, politeness delay, storage. */
export function DownloadSettingsScreen({ navigation }: RootScreenProps<'settingsDownloads'>) {
  const { t } = useTranslation();
  const wifiOnly = useSetting('downloadWifiOnly');
  const delay = useSetting('downloadDelayMs');
  const exportFolder = useSetting('exportFolder');
  const autoDownloadNew = useSetting('autoDownloadNew');
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
        <SectionHeader title={t('downloads.newChapters')} />
        <SwitchItem
          icon="download-circle-outline"
          title={t('downloads.autoDownloadNew')}
          subtitle={t('downloads.autoDownloadNewHint')}
          value={autoDownloadNew}
          onValueChange={(value) => setSetting('autoDownloadNew', value)}
        />
        <SectionHeader title={t('downloads.exportFolder')} />
        <ListItem
          icon="folder-outline"
          title={exportFolder ? folderLabel(exportFolder) : t('downloads.exportFolderAsk')}
          subtitle={t('downloads.exportFolderHint')}
          onPress={() => {
            void Directory.pickDirectoryAsync()
              .then((directory) => setSetting('exportFolder', directory.uri))
              .catch(() => undefined);
          }}
          right={
            exportFolder ? (
              <IconButton
                icon="close"
                label={t('downloads.exportFolderForget')}
                onPress={() => setSetting('exportFolder', '')}
              />
            ) : undefined
          }
        />
      </ScrollView>
    </Screen>
  );
}
