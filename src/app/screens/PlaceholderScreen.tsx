import { useTranslation } from 'react-i18next';

import { AppBar, EmptyState, Screen, type IconName } from '../../theme/components';
import type { RootScreenProps } from '../navigation';

/** Shown for the features that arrive in a later version. */
export function PlaceholderScreen({ navigation, route }: RootScreenProps<'placeholder'>) {
  const { t } = useTranslation();
  return (
    <Screen bottom>
      <AppBar title={t(route.params.titleKey)} onBack={navigation.goBack} />
      <EmptyState
        icon={route.params.icon as IconName}
        title={t('common.comingSoon')}
        message={t('common.comingSoonHint')}
      />
    </Screen>
  );
}
