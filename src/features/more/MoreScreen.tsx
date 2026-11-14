import { ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { TabScreenProps } from '../../app/navigation';
import { AppBar, Divider, ListItem, Screen, SwitchItem } from '../../theme/components';
import { setSetting, useSetting } from '../settings/settingsStore';

export function MoreScreen({ navigation }: TabScreenProps<'more'>) {
  const { t } = useTranslation();
  const incognito = useSetting('incognito');

  const soon = (titleKey: string, icon: string) => () =>
    navigation.navigate('placeholder', { titleKey, icon });

  return (
    <Screen>
      <AppBar title={t('tabs.more')} large />
      <ScrollView>
        <SwitchItem
          icon="incognito"
          title={t('more.incognito')}
          subtitle={t('more.incognitoHint')}
          value={incognito}
          onValueChange={(value) => setSetting('incognito', value)}
        />
        <Divider />
        <ListItem
          icon="download-outline"
          title={t('more.downloads')}
          onPress={soon('more.downloads', 'download-outline')}
        />
        <ListItem
          icon="chart-box-outline"
          title={t('more.statistics')}
          onPress={soon('more.statistics', 'chart-box-outline')}
        />
        <ListItem
          icon="format-quote-close"
          title={t('more.quotes')}
          onPress={soon('more.quotes', 'format-quote-close')}
        />
        <Divider />
        <ListItem
          icon="cog-outline"
          title={t('more.settings')}
          onPress={() => navigation.navigate('settings')}
        />
        <ListItem
          icon="backup-restore"
          title={t('more.backup')}
          onPress={soon('more.backup', 'backup-restore')}
        />
        <ListItem
          icon="information-outline"
          title={t('more.about')}
          onPress={() => navigation.navigate('about')}
        />
      </ScrollView>
    </Screen>
  );
}
