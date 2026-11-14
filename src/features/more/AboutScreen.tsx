import * as Application from 'expo-application';
import { Linking, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { RootScreenProps } from '../../app/navigation';
import { REPOSITORY_URL } from '../../services/appInfo';
import { AppBar, ListItem, Screen } from '../../theme/components';

export function AboutScreen({ navigation }: RootScreenProps<'about'>) {
  const { t } = useTranslation();
  return (
    <Screen bottom>
      <AppBar title={t('about.title')} onBack={navigation.goBack} />
      <ScrollView>
        <ListItem
          icon="information-outline"
          title={t('about.version')}
          subtitle={Application.nativeApplicationVersion ?? '—'}
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
          onPress={() =>
            navigation.navigate('placeholder', { titleKey: 'about.licenses', icon: 'license' })
          }
        />
      </ScrollView>
    </Screen>
  );
}
