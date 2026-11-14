import { ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { RootScreenProps } from '../../app/navigation';
import { getDb } from '../../db/client';
import { invalidate, useQuery } from '../../db/invalidation';
import { ensureNotificationPermission } from '../../services/notifications';
import {
  AppBar,
  CheckItem,
  RadioItem,
  Screen,
  SectionHeader,
  SwitchItem,
} from '../../theme/components';
import { listCategories, setCategoryExcluded } from '../library/libraryRepository';
import { syncBackgroundCheck } from '../updates/updateService';
import { setSetting, useSetting } from './settingsStore';

const FREQUENCIES = [6, 12, 24, 0];

/** Settings → Updates: how often new chapters are looked for, and what is announced. */
export function UpdateSettingsScreen({ navigation }: RootScreenProps<'settingsUpdates'>) {
  const { t } = useTranslation();
  const hours = useSetting('updateCheckHours');
  const wifiOnly = useSetting('updateWifiOnly');
  const notify = useSetting('notifyNewChapters');
  const categories = useQuery(() => listCategories(getDb()), ['categories']);

  return (
    <Screen bottom>
      <AppBar title={t('settings.updates')} onBack={navigation.goBack} />
      <ScrollView>
        <SectionHeader title={t('updates.frequency')} />
        {FREQUENCIES.map((value) => (
          <RadioItem
            key={value}
            title={value === 0 ? t('updates.never') : t('updates.everyHours', { count: value })}
            checked={hours === value}
            onPress={() => {
              setSetting('updateCheckHours', value);
              void syncBackgroundCheck();
            }}
          />
        ))}
        <SwitchItem
          icon="wifi"
          title={t('updates.wifiOnly')}
          value={wifiOnly}
          onValueChange={(value) => setSetting('updateWifiOnly', value)}
        />
        <SwitchItem
          icon="bell-outline"
          title={t('updates.notify')}
          subtitle={t('updates.notifyHint')}
          value={notify}
          onValueChange={(value) => {
            setSetting('notifyNewChapters', value);
            if (value) {
              void ensureNotificationPermission();
            }
          }}
        />
        <SectionHeader title={t('updates.excludedCategories')} />
        {categories.map((category) => (
          <CheckItem
            key={category.id}
            title={category.name}
            checked={category.excludeFromUpdates}
            onPress={() => {
              setCategoryExcluded(getDb(), category.id, !category.excludeFromUpdates);
              invalidate('categories');
            }}
          />
        ))}
      </ScrollView>
    </Screen>
  );
}
