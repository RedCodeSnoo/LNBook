import { Linking, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { RootScreenProps } from '../../app/navigation';
import { REPOSITORY_URL } from '../../services/appInfo';
import { AppBar, ListItem, Screen } from '../../theme/components';
import { AppUpdateCheck } from '../appUpdate/AppUpdateCheck';
import { installedVersion, useAppUpdate } from '../appUpdate/appUpdateService';

export function AboutScreen({ navigation }: RootScreenProps<'about'>) {
  const { t } = useTranslation();
  const release = useAppUpdate((state) => state.release);

  return (
    <Screen bottom>
      <AppBar title={t('about.title')} onBack={navigation.goBack} />
      <ScrollView>
        <ListItem
          icon="information-outline"
          title={t('about.version')}
          subtitle={installedVersion()}
        />
        <AppUpdateCheck />
        {release ? (
          <ListItem
            icon="arrow-up-bold-circle-outline"
            title={t('appUpdate.available', { version: release.version })}
            subtitle={t('appUpdate.openUpdates')}
            onPress={() => navigation.navigate('tabs', { screen: 'updates' })}
          />
        ) : null}
        <ListItem
          icon="text-box-outline"
          title={t('about.changelog')}
          onPress={() => void Linking.openURL(`${REPOSITORY_URL}/releases`)}
        />
        <ListItem
          icon="github"
          title={t('about.repository')}
          subtitle={REPOSITORY_URL.replace('https://', '')}
          onPress={() => void Linking.openURL(REPOSITORY_URL)}
        />
        <ListItem
          icon="license"
          title={t('about.licenses')}
          subtitle={t('about.licensesHint')}
          onPress={() => navigation.navigate('licenses')}
        />
      </ScrollView>
    </Screen>
  );
}
