import { useTranslation } from 'react-i18next';

import { AppBar, EmptyState, Screen } from '../../theme/components';

export function UpdatesScreen() {
  const { t } = useTranslation();
  return (
    <Screen>
      <AppBar title={t('tabs.updates')} large />
      <EmptyState
        icon="bell-outline"
        title={t('updates.emptyTitle')}
        message={t('updates.emptyMessage')}
      />
    </Screen>
  );
}
