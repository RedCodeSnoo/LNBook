import { useState } from 'react';
import { Linking, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { RootScreenProps } from '../../app/navigation';
import { REPOSITORY_URL } from '../../services/appInfo';
import { AppBar, ListItem, Screen, showToast } from '../../theme/components';
import {
  checkForAppUpdate,
  installedVersion,
  stopIgnoringRelease,
  useAppUpdate,
} from '../appUpdate/appUpdateService';

export function AboutScreen({ navigation }: RootScreenProps<'about'>) {
  const { t } = useTranslation();
  const release = useAppUpdate((state) => state.release);
  const [checking, setChecking] = useState(false);

  const check = () => {
    setChecking(true);
    void checkForAppUpdate()
      .then((outcome) => {
        if (outcome === 'available') {
          // Asking by hand shows a version that was ignored again.
          stopIgnoringRelease();
          navigation.navigate('tabs', { screen: 'updates' });
        } else {
          showToast(outcome === 'upToDate' ? t('appUpdate.upToDate') : t('appUpdate.checkFailed'));
        }
      })
      .finally(() => setChecking(false));
  };

  return (
    <Screen bottom>
      <AppBar title={t('about.title')} onBack={navigation.goBack} />
      <ScrollView>
        <ListItem
          icon="information-outline"
          title={t('about.version')}
          subtitle={installedVersion()}
        />
        <ListItem
          icon="update"
          title={t('appUpdate.checkNow')}
          subtitle={
            checking
              ? t('updates.checking')
              : release
                ? t('appUpdate.available', { version: release.version })
                : undefined
          }
          disabled={checking}
          onPress={check}
        />
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
