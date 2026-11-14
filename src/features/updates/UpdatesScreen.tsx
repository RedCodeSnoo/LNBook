import { FlashList } from '@shopify/flash-list';
import { useCallback, useMemo } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { TabScreenProps } from '../../app/navigation';
import { getDb } from '../../db/client';
import { invalidate, useQuery } from '../../db/invalidation';
import i18n from '../../i18n';
import { getInstalledPlugin } from '../../plugins/pluginManager';
import { formatDayLabel, formatTime } from '../../services/format';
import {
  AppBar,
  AppText,
  Cover,
  EmptyState,
  Icon,
  IconButton,
  Menu,
  Screen,
  showToast,
} from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { RADIUS, SPACING } from '../../theme/typography';
import { sourceErrorMessage } from '../browse/SourceBits';
import { queueDownloads } from '../downloads/downloadService';
import { PluginError } from '../../plugins/pluginErrors';
import {
  clearUpdates,
  groupUpdatesByDay,
  listNovelsToCheck,
  listUpdates,
  type UpdateItem,
} from './updateChecker';
import { getLastCheckAt, getLastFailures, runUpdateCheck, useUpdateState } from './updateService';

export function UpdatesScreen({ navigation }: TabScreenProps<'updates'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const rows = useQuery(() => listUpdates(getDb()), ['updates', 'chapters', 'library']);
  const failures = useQuery(() => getLastFailures(), ['updates']);
  const lastCheck = useQuery(() => getLastCheckAt(), ['updates']);
  const followed = useQuery(() => listNovelsToCheck(getDb()).length, ['library', 'categories']);
  const { checking, progress } = useUpdateState();
  const items = useMemo(() => groupUpdatesByDay(rows), [rows]);
  const dayLabels = useMemo(
    () => ({ today: t('history.today'), yesterday: t('history.yesterday') }),
    [t],
  );

  const check = useCallback(() => {
    void runUpdateCheck().then((result) => {
      if (result === null) {
        showToast(t('updates.cannotCheck'));
      } else {
        const count = result.updates.reduce((sum, update) => sum + update.chapterIds.length, 0);
        showToast(count > 0 ? t('updates.found', { count }) : t('updates.nothingNew'));
      }
    });
  }, [t]);

  const renderItem = useCallback(
    ({ item }: { item: UpdateItem }) => {
      if (item.type === 'day') {
        return (
          <AppText
            variant="label"
            color={colors.primary}
            style={styles.day}
            accessibilityRole="header"
          >
            {formatDayLabel(item.day, i18n.language, dayLabels)}
          </AppText>
        );
      }
      const { row } = item;
      const dimmed = row.isRead ? colors.textDisabled : undefined;
      return (
        <View style={styles.row}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('history.openNovel', { title: row.novelTitle })}
            onPress={() => navigation.navigate('novel', { novelId: row.novelId })}
            style={styles.cover}
          >
            <Cover path={row.coverPath} title={row.novelTitle} shadow={false} radius={RADIUS.sm} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('reader', { chapterId: row.chapterId })}
            android_ripple={{ color: colors.ripple }}
            style={styles.texts}
          >
            <AppText variant="bodyStrong" color={dimmed} numberOfLines={1}>
              {row.novelTitle}
            </AppText>
            <AppText color={dimmed} numberOfLines={1}>
              {row.chapterTitle}
            </AppText>
          </Pressable>
          {row.isDownloaded ? (
            <View style={styles.downloaded}>
              <Icon name="check-circle-outline" size={20} color={colors.textSecondary} />
            </View>
          ) : (
            <IconButton
              icon="download-outline"
              label={t('updates.download', { title: row.chapterTitle })}
              onPress={() => {
                queueDownloads([row.chapterId]);
                showToast(t('downloads.queued', { count: 1 }));
              }}
            />
          )}
        </View>
      );
    },
    [colors, dayLabels, navigation, t],
  );

  const header = (
    <View>
      {checking ? (
        <View style={[styles.banner, { backgroundColor: colors.primaryContainer }]}>
          <AppText variant="label" color={colors.onPrimaryContainer} numberOfLines={1}>
            {progress
              ? t('updates.checkingProgress', {
                  done: progress.done + 1,
                  total: progress.total,
                  title: progress.title,
                })
              : t('updates.checking')}
          </AppText>
        </View>
      ) : lastCheck ? (
        <AppText variant="caption" secondary style={styles.lastCheck}>
          {t('updates.lastCheck', {
            day: formatDayLabel(lastCheck, i18n.language, dayLabels),
            time: formatTime(lastCheck),
          })}
        </AppText>
      ) : null}
      {failures.map((failure) => (
        <AppText
          key={failure.pluginId}
          variant="caption"
          color={colors.error}
          style={styles.failure}
        >
          {getInstalledPlugin(getDb(), failure.pluginId)?.name ?? failure.pluginId}
          {' : '}
          {sourceErrorMessage(new PluginError(failure.kind, ''), t)}
        </AppText>
      ))}
    </View>
  );

  return (
    <Screen>
      <AppBar
        title={t('tabs.updates')}
        large
        actions={
          <>
            <IconButton
              icon="refresh"
              label={t('updates.checkNow')}
              disabled={checking || followed === 0}
              onPress={check}
            />
            <Menu
              label={t('history.menu')}
              items={[
                {
                  label: t('updates.clear'),
                  icon: 'notification-clear-all',
                  disabled: rows.length === 0,
                  onPress: () => {
                    clearUpdates(getDb());
                    invalidate('updates');
                  },
                },
                {
                  label: t('settings.updates'),
                  icon: 'cog-outline',
                  onPress: () => navigation.navigate('settingsUpdates'),
                },
              ]}
            />
          </>
        }
      />
      <FlashList
        data={items}
        renderItem={renderItem}
        keyExtractor={(item) => item.key}
        getItemType={(item) => item.type}
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={checking}
            onRefresh={check}
            colors={[colors.primary as string]}
            progressBackgroundColor={colors.surface}
          />
        }
        ListEmptyComponent={
          <EmptyState
            icon="bell-outline"
            title={t('updates.emptyTitle')}
            message={followed === 0 ? t('updates.emptyMessage') : t('updates.pullToCheck')}
          />
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: SPACING.xl },
  banner: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
  },
  lastCheck: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xs },
  failure: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xs },
  day: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, paddingBottom: SPACING.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: SPACING.lg,
    paddingRight: SPACING.xs,
    paddingVertical: SPACING.sm,
    gap: SPACING.md,
  },
  cover: { width: 44 },
  texts: { flex: 1, gap: 2 },
  downloaded: { width: 44, alignItems: 'center' },
});
