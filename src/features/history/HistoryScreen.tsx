import { FlashList } from '@shopify/flash-list';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { TabScreenProps } from '../../app/navigation';
import { useBackHandler } from '../../app/useBackHandler';
import { getDb } from '../../db/client';
import { invalidate, useQuery } from '../../db/invalidation';
import i18n from '../../i18n';
import { formatDayLabel, formatDuration, formatPercent, formatTime } from '../../services/format';
import {
  AppBar,
  AppText,
  ConfirmDialog,
  Cover,
  EmptyState,
  Icon,
  IconButton,
  Menu,
  Screen,
  TextField,
  showToast,
} from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { RADIUS, SPACING } from '../../theme/typography';
import { formatChapterNumber } from '../novel/chapterNumber';
import { useSetting } from '../settings/settingsStore';
import {
  groupHistoryByDay,
  hideAllHistory,
  hideNovelHistory,
  listHistory,
  setHistoryEntryHidden,
  type HistoryItem,
  type HistoryRow,
} from './historyRepository';

type Confirm = { kind: 'none' } | { kind: 'all' } | { kind: 'novel'; row: HistoryRow };

export function HistoryScreen({ navigation }: TabScreenProps<'history'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const incognito = useSetting('incognito');
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>({ kind: 'none' });

  const rows = useQuery(() => listHistory(getDb(), search), ['history', 'chapters'], [search]);
  const items = useMemo(() => groupHistoryByDay(rows), [rows]);
  const dayLabels = useMemo(
    () => ({ today: t('history.today'), yesterday: t('history.yesterday') }),
    [t],
  );

  const closeSearch = useCallback(() => {
    setSearching(false);
    setSearch('');
  }, []);
  useBackHandler(searching, closeSearch);

  const remove = useCallback(
    (row: HistoryRow) => {
      setHistoryEntryHidden(getDb(), row.id, true);
      invalidate('history');
      showToast(t('history.removed'), {
        duration: 5000,
        actionLabel: t('history.undo'),
        onAction: () => {
          setHistoryEntryHidden(getDb(), row.id, false);
          invalidate('history');
        },
      });
    },
    [t],
  );

  const renderItem = useCallback(
    ({ item }: { item: HistoryItem }) => {
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
      const number =
        row.chapterNumber !== null && !/\d/.test(row.chapterTitle)
          ? `${t('novel.chapterNumber', { number: formatChapterNumber(row.chapterNumber) })} – `
          : '';
      const details = [
        formatTime(row.lastReadAt),
        formatDuration(row.totalMs, t),
        formatPercent(row.progress),
      ].join(' · ');
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
            onLongPress={() => setConfirm({ kind: 'novel', row })}
            android_ripple={{ color: colors.ripple }}
            style={styles.texts}
          >
            <AppText variant="bodyStrong" numberOfLines={1}>
              {row.novelTitle}
            </AppText>
            <AppText numberOfLines={1}>
              {number}
              {row.chapterTitle}
            </AppText>
            <AppText variant="caption" secondary numberOfLines={1}>
              {details}
            </AppText>
          </Pressable>
          <IconButton
            icon="trash-can-outline"
            label={t('history.remove', { title: row.chapterTitle })}
            onPress={() => remove(row)}
          />
        </View>
      );
    },
    [colors, dayLabels, navigation, remove, t],
  );

  return (
    <Screen>
      {searching ? (
        <View style={styles.searchBar}>
          <IconButton icon="arrow-left" label={t('common.close')} onPress={closeSearch} />
          <View style={styles.searchField}>
            <TextField
              autoFocus
              value={search}
              onChangeText={setSearch}
              placeholder={t('history.search')}
              accessibilityLabel={t('history.search')}
            />
          </View>
        </View>
      ) : (
        <AppBar
          title={t('tabs.history')}
          large
          actions={
            <>
              <IconButton
                icon="magnify"
                label={t('history.search')}
                onPress={() => setSearching(true)}
              />
              <Menu
                label={t('history.menu')}
                items={[
                  {
                    label: t('history.clearAll'),
                    icon: 'delete-sweep-outline',
                    danger: true,
                    disabled: rows.length === 0,
                    onPress: () => setConfirm({ kind: 'all' }),
                  },
                ]}
              />
            </>
          }
        />
      )}
      {incognito ? (
        <View style={[styles.banner, { backgroundColor: colors.surfaceVariant }]}>
          <Icon name="incognito" size={20} color={colors.textSecondary} />
          <AppText variant="label" secondary style={styles.bannerText}>
            {t('history.incognitoBanner')}
          </AppText>
        </View>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          icon="history"
          title={search === '' ? t('history.emptyTitle') : t('history.noMatch')}
          message={search === '' ? t('history.emptyMessage') : undefined}
        />
      ) : (
        <FlashList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item.key}
          getItemType={(item) => item.type}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
        />
      )}

      <ConfirmDialog
        visible={confirm.kind !== 'none'}
        title={confirm.kind === 'novel' ? t('history.clearNovelTitle') : t('history.clearAll')}
        message={
          confirm.kind === 'novel'
            ? t('history.clearNovelMessage', { title: confirm.row.novelTitle })
            : t('history.clearAllMessage')
        }
        confirmLabel={t('common.delete')}
        danger
        onClose={() => setConfirm({ kind: 'none' })}
        onConfirm={() => {
          if (confirm.kind === 'novel') {
            hideNovelHistory(getDb(), confirm.row.novelId);
          } else if (confirm.kind === 'all') {
            hideAllHistory(getDb());
          }
          invalidate('history');
          setConfirm({ kind: 'none' });
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
  },
  bannerText: { flex: 1 },
  searchBar: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.xs,
  },
  searchField: { flex: 1, paddingRight: SPACING.md },
  list: { paddingBottom: SPACING.xl },
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
});
