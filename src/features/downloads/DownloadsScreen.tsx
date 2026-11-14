import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { RootScreenProps } from '../../app/navigation';
import { getDb } from '../../db/client';
import { invalidate, useQuery } from '../../db/invalidation';
import {
  AppBar,
  AppText,
  Button,
  EmptyState,
  IconButton,
  ListItem,
  Menu,
  Screen,
} from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { RADIUS, SPACING } from '../../theme/typography';
import {
  cancelAllDownloads,
  cancelDownload,
  listDownloads,
  moveDownload,
  retryFailedDownloads,
  summarizeQueue,
} from './downloadsRepository';
import {
  pauseAllDownloads,
  resumeAllDownloads,
  startDownloads,
  useDownloadState,
} from './downloadService';

const STATUS_KEYS = {
  queued: 'downloads.statusQueued',
  running: 'downloads.statusRunning',
  paused: 'downloads.statusPaused',
  failed: 'downloads.statusFailed',
  done: 'downloads.statusQueued',
} as const;

const STOP_KEYS = {
  offline: 'downloads.waitingNetwork',
  cloudflare: 'downloads.waitingCloudflare',
} as const;

/** Plus → Downloads: the queue, with pause, resume, cancel and order. */
export function DownloadsScreen({ navigation }: RootScreenProps<'downloads'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const rows = useQuery(() => listDownloads(getDb()), ['downloads']);
  const { running, progress, lastStop } = useDownloadState();
  const summary = summarizeQueue(rows);
  const changed = () => invalidate('downloads');
  const blocked =
    !running && (lastStop === 'offline' || lastStop === 'cloudflare') ? STOP_KEYS[lastStop] : null;

  return (
    <Screen bottom>
      <AppBar
        title={t('more.downloads')}
        onBack={navigation.goBack}
        actions={
          <>
            {summary.paused > 0 ? (
              <IconButton icon="play" label={t('downloads.resume')} onPress={resumeAllDownloads} />
            ) : summary.waiting > 0 ? (
              <IconButton icon="pause" label={t('downloads.pause')} onPress={pauseAllDownloads} />
            ) : null}
            <Menu
              label={t('downloads.menu')}
              items={[
                {
                  label: t('downloads.retryFailed'),
                  icon: 'refresh',
                  disabled: summary.failed === 0,
                  onPress: () => {
                    retryFailedDownloads(getDb());
                    changed();
                    void startDownloads();
                  },
                },
                {
                  label: t('downloads.cancelAll'),
                  icon: 'close-circle-outline',
                  danger: true,
                  disabled: rows.length === 0,
                  onPress: () => {
                    pauseAllDownloads();
                    cancelAllDownloads(getDb());
                    changed();
                  },
                },
              ]}
            />
          </>
        }
      />
      <ListItem
        icon="harddisk"
        title={t('downloads.storage')}
        subtitle={t('downloads.storageHint')}
        onPress={() => navigation.navigate('storage')}
      />
      {running && progress ? (
        <View style={[styles.banner, { backgroundColor: colors.primaryContainer }]}>
          <AppText variant="bodyStrong" color={colors.onPrimaryContainer} numberOfLines={1}>
            {progress.novelTitle} – {progress.done} / {progress.total}
          </AppText>
          <AppText variant="caption" color={colors.onPrimaryContainer} numberOfLines={1}>
            {progress.chapterTitle}
          </AppText>
        </View>
      ) : blocked ? (
        <View style={[styles.banner, { backgroundColor: colors.surfaceVariant }]}>
          <AppText variant="label">{t(blocked)}</AppText>
          <View style={styles.bannerButton}>
            <Button
              label={t('downloads.resume')}
              icon="play"
              variant="tonal"
              compact
              onPress={resumeAllDownloads}
            />
          </View>
        </View>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon="download-outline"
          title={t('downloads.emptyTitle')}
          message={t('downloads.emptyMessage')}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          <AppText variant="label" secondary style={styles.count}>
            {t('downloads.count', { count: rows.length })}
          </AppText>
          {rows.map((row, index) => (
            <View key={row.id} style={styles.row}>
              <View style={styles.texts}>
                <AppText numberOfLines={1}>{row.chapterTitle}</AppText>
                <AppText
                  variant="caption"
                  color={row.status === 'failed' ? colors.error : colors.textSecondary}
                  numberOfLines={2}
                >
                  {[
                    row.novelTitle,
                    t(STATUS_KEYS[row.status]),
                    row.status === 'failed' ? row.error : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </AppText>
              </View>
              <IconButton
                icon="arrow-up"
                label={t('downloads.moveUp', { title: row.chapterTitle })}
                disabled={index === 0}
                onPress={() => {
                  moveDownload(getDb(), row.id, -1);
                  changed();
                }}
              />
              <IconButton
                icon="arrow-down"
                label={t('downloads.moveDown', { title: row.chapterTitle })}
                disabled={index === rows.length - 1}
                onPress={() => {
                  moveDownload(getDb(), row.id, 1);
                  changed();
                }}
              />
              <IconButton
                icon="close"
                label={t('downloads.cancel', { title: row.chapterTitle })}
                onPress={() => {
                  cancelDownload(getDb(), row.id);
                  changed();
                }}
              />
            </View>
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    gap: 2,
  },
  bannerButton: { alignItems: 'flex-start', paddingTop: SPACING.xs },
  list: { paddingBottom: SPACING.xl },
  count: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: SPACING.lg,
    paddingRight: SPACING.xs,
    minHeight: 56,
  },
  texts: { flex: 1 },
});
