import { useTranslation } from 'react-i18next';

import { AppBar, EmptyState, Screen } from '../../theme/components';

export function BrowseScreen() {
  const { t } = useTranslation();
  return (
    <Screen>
      <AppBar title={t('tabs.browse')} large />
      <EmptyState
        icon="compass-outline"
        title={t('browse.emptyTitle')}
        message={t('browse.emptyMessage')}
      />
    </Screen>
  );
}
