import { ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { TabScreenProps } from '../../app/navigation';
import { AppBar, Divider, ListItem, Screen, SwitchItem } from '../../theme/components';
import { setSetting, useSetting } from '../settings/settingsStore';

export function MoreScreen({ navigation }: TabScreenProps<'more'>) {
  const { t } = useTranslation();
  const incognito = useSetting('incognito');

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
          onPress={() => navigation.navigate('downloads')}
        />
        <ListItem
          icon="chart-box-outline"
          title={t('more.statistics')}
          onPress={() => navigation.navigate('stats')}
        />
        <ListItem
          icon="format-quote-close"
          title={t('more.quotes')}
          onPress={() => navigation.navigate('quotes')}
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
          onPress={() => navigation.navigate('backup')}
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
