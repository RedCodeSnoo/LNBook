import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { TabScreenProps } from '../../app/navigation';
import { AppBar, Button, EmptyState, Screen, SegmentedTabs } from '../../theme/components';

type LibraryTab = 'online' | 'local';

export function LibraryScreen({ navigation }: TabScreenProps<'library'>) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<LibraryTab>('online');

  return (
    <Screen>
      <AppBar title={t('tabs.library')} large />
      <SegmentedTabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'online', label: t('library.online') },
          { value: 'local', label: t('library.local') },
        ]}
      />
      {tab === 'online' ? (
        <EmptyState
          icon="earth"
          title={t('library.emptyOnlineTitle')}
          message={t('library.emptyOnlineMessage')}
        >
          <Button
            label={t('library.browseSources')}
            icon="compass-outline"
            onPress={() => navigation.navigate('browse')}
          />
        </EmptyState>
      ) : (
        <EmptyState
          icon="bookshelf"
          title={t('library.emptyLocalTitle')}
          message={t('library.emptyLocalMessage')}
        >
          <Button
            label={t('library.browseSources')}
            variant="tonal"
            icon="compass-outline"
            onPress={() => navigation.navigate('browse')}
          />
        </EmptyState>
      )}
    </Screen>
  );
}
