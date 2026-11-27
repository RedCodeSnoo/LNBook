import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { RootScreenProps } from '../../app/navigation';
import { useDataVersion } from '../../db/invalidation';
import i18n from '../../i18n';
import { formatBytes, formatDate, formatTime } from '../../services/format';
import {
  AppBar,
  AppText,
  Button,
  Dialog,
  ListItem,
  RadioItem,
  Screen,
  SectionHeader,
  showToast,
  SwitchItem,
} from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { SPACING } from '../../theme/typography';
import { setSetting, useSetting } from '../settings/settingsStore';
import type { AutoBackupFrequency, BackupContent } from './backupFile';
import { backupErrorText, isCancelled } from './backupErrors';
import {
  cancelBackupWork,
  chooseAutoBackupFolder,
  createManualBackup,
  describeError,
  didLastAutoBackupFail,
  discardPickedBackup,
  folderLabel,
  getLastAutoBackupAt,
  getRestoreSafetyBackup,
  importLnReader,
  installSources,
  openRestoreSafetyBackup,
  pickBackupFile,
  restoreBackup,
  runAutoBackupIfDue,
  shareRestoreSafetyBackup,
  useBackupProgress,
  type PickedBackup,
  type SavedBackup,
} from './backupService';
import type { IgnoredItem, LnReaderImportSummary } from './lnreaderImport';
import type { RestoreSummary } from './restore';

const FREQUENCIES: AutoBackupFrequency[] = ['off', 'daily', 'weekly'];

type Pending =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'restore'; name: string; content: BackupContent }
  | { kind: 'lnreader'; name: string; data: Uint8Array }
  | { kind: 'lnreaderDone'; summary: LnReaderImportSummary }
  | { kind: 'created'; saved: SavedBackup }
  | { kind: 'restored'; summary: RestoreSummary; mode: 'replace' | 'merge' }
  | { kind: 'failed'; title: string; message: string; detail: string }
  | { kind: 'safety' };

/** Plus → Backup and restore. */
export function BackupScreen({ navigation }: RootScreenProps<'backup'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const frequency = useSetting('autoBackup');
  const folder = useSetting('autoBackupFolder');
  const autoChapters = useSetting('autoBackupChapters');
  const dateFormat = useSetting('dateFormat');
  const [pending, setPending] = useState<Pending>({ kind: 'none' });
  const [busy, setBusy] = useState(false);
  const [stamp, setStamp] = useState(0);
  const progress = useBackupProgress();
  useDataVersion('library');

  const close = () => setPending({ kind: 'none' });
  const closeRestore = () => {
    if (pending.kind === 'restore') {
      discardPickedBackup(pending.content);
    }
    close();
  };
  /** Shows the real cause and keeps the whole error in the journal (Settings → Advanced). */
  const fail = (title: string, context: string, error: unknown) => {
    console.error(context, describeError(error), error);
    if (isCancelled(error)) {
      showToast(t('backup.errors.cancelled'));
      return;
    }
    const text = backupErrorText(error, t);
    setPending({ kind: 'failed', title, message: text.message, detail: text.detail });
  };
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
      setStamp((value) => value + 1);
    }
  };

  const create = (target: 'folder' | 'share') => {
    close();
    void run(async () => {
      try {
        const saved = await createManualBackup(target);
        if (saved) {
          setPending({ kind: 'created', saved });
        }
      } catch (error) {
        fail(t('backup.failed'), 'Backup failed', error);
      }
    });
  };

  const opened = (picked: PickedBackup) => {
    if (picked.kind === 'cancelled') {
      return;
    }
    // Whatever entry was used, the file decides what happens.
    setPending(
      picked.kind === 'lnbook'
        ? { kind: 'restore', name: picked.name, content: picked.content }
        : { kind: 'lnreader', name: picked.name, data: picked.data },
    );
  };

  const pick = (expected: 'lnbook' | 'lnreader') => {
    void run(async () => {
      try {
        opened(await pickBackupFile());
      } catch (error) {
        if (error instanceof Error && error.name === 'NotABackupError') {
          showToast(
            expected === 'lnreader' ? t('backup.errorNotLnReader') : t('backup.errorNotBackup'),
          );
          return;
        }
        fail(t('backup.openFailed'), 'Cannot open the backup', error);
      }
    });
  };

  const restore = (content: BackupContent, mode: 'replace' | 'merge') => {
    close();
    void run(async () => {
      try {
        const summary = await restoreBackup(content, mode);
        setPending({ kind: 'restored', summary, mode });
      } catch (error) {
        fail(t('backup.restoreFailed'), 'Restore failed', error);
      }
    });
  };

  const undoLastRestore = () => {
    close();
    void run(async () => {
      try {
        opened(await openRestoreSafetyBackup());
      } catch (error) {
        fail(t('backup.openFailed'), 'Cannot open the safety backup', error);
      }
    });
  };

  const shareSafety = () => {
    close();
    void run(async () => {
      try {
        await shareRestoreSafetyBackup();
      } catch (error) {
        fail(t('backup.failed'), 'Cannot share the safety backup', error);
      }
    });
  };

  const importFromLnReader = (data: Uint8Array) => {
    close();
    void run(async () => {
      try {
        setPending({ kind: 'lnreaderDone', summary: await importLnReader(data) });
      } catch (error) {
        fail(t('backup.restoreFailed'), 'LNReader import failed', error);
      }
    });
  };

  const installMissingSources = (summary: LnReaderImportSummary) => {
    close();
    void run(async () => {
      const failed = await installSources(summary.installable);
      showToast(
        failed.length === 0
          ? t('backup.sourcesInstalled', { count: summary.installable.length })
          : t('backup.sourcesFailed', { names: failed.join(', ') }),
      );
    });
  };

  const setFrequency = (value: AutoBackupFrequency) => {
    if (value === 'off' || folder) {
      setSetting('autoBackup', value);
      if (value !== 'off') {
        void run(async () => void (await runAutoBackupIfDue()));
      }
      return;
    }
    void run(async () => {
      if (await chooseAutoBackupFolder()) {
        setSetting('autoBackup', value);
        await runAutoBackupIfDue();
      }
    });
  };

  const lastAuto = getLastAutoBackupAt();
  const safety = getRestoreSafetyBackup();
  const counts = (content: BackupContent) =>
    content.manifest.counts ?? {
      novels: content.tables.novels.length,
      chapters: content.tables.chapters.length,
      quotes: content.tables.quotes.length,
    };
  const autoFailed = didLastAutoBackupFail();
  const ignoredLabel = (item: IgnoredItem) =>
    'name' in item
      ? `${t(`backup.ignored.${item.kind}`)} : ${item.name}`
      : t(`backup.ignored.${item.kind}`);

  return (
    <Screen bottom>
      <AppBar title={t('more.backup')} onBack={navigation.goBack} />
      {progress.step ? (
        <View
          style={[styles.progress, { backgroundColor: colors.surfaceVariant }]}
          accessibilityLiveRegion="polite"
        >
          <View style={styles.progressRow}>
            <ActivityIndicator color={colors.primary as string} />
            <AppText variant="bodyStrong" style={styles.flex}>
              {t(`backup.step.${progress.step}`)}
            </AppText>
            {progress.step !== 'restoring' && progress.step !== 'preparing' ? (
              <Button
                label={t('common.cancel')}
                variant="text"
                compact
                onPress={cancelBackupWork}
              />
            ) : null}
          </View>
          {progress.totalBytes > 0 ? (
            <View
              style={[styles.track, { backgroundColor: colors.border }]}
              accessibilityRole="progressbar"
              accessibilityValue={{
                min: 0,
                max: 100,
                now: Math.round((progress.bytes / progress.totalBytes) * 100),
              }}
            >
              <View
                style={[
                  styles.fill,
                  {
                    backgroundColor: colors.primary as string,
                    width: `${Math.min(100, (progress.bytes / progress.totalBytes) * 100)}%`,
                  },
                ]}
              />
            </View>
          ) : null}
          <AppText variant="caption" secondary>
            {progress.totalBytes > 0
              ? t('backup.progressBytes', {
                  done: formatBytes(progress.bytes),
                  total: formatBytes(progress.totalBytes),
                })
              : progress.bytes > 0
                ? formatBytes(progress.bytes)
                : t('backup.working')}
          </AppText>
        </View>
      ) : null}
      <ScrollView contentContainerStyle={styles.list} key={stamp}>
        <SectionHeader title={t('backup.manual')} />
        <ListItem
          icon="content-save-outline"
          title={t('backup.create')}
          subtitle={t('backup.createHint')}
          disabled={busy}
          onPress={() => setPending({ kind: 'create' })}
        />
        <ListItem
          icon="backup-restore"
          title={t('backup.restore')}
          subtitle={t('backup.restoreHint')}
          disabled={busy}
          onPress={() => pick('lnbook')}
        />
        {safety ? (
          <ListItem
            icon="history"
            title={t('backup.safetyTitle')}
            subtitle={t('backup.safetyHint', {
              date: formatDate(safety.date, dateFormat, i18n.language),
              time: formatTime(safety.date),
              size: formatBytes(safety.size),
            })}
            disabled={busy}
            onPress={() => setPending({ kind: 'safety' })}
          />
        ) : null}

        <SectionHeader title={t('backup.automatic')} />
        {FREQUENCIES.map((value) => (
          <RadioItem
            key={value}
            title={t(`backup.frequency.${value}`)}
            checked={frequency === value}
            disabled={busy}
            onPress={() => setFrequency(value)}
          />
        ))}
        <ListItem
          icon="folder-outline"
          title={t('backup.folder')}
          subtitle={folder ? folderLabel(folder) : t('backup.folderNone')}
          disabled={busy}
          onPress={() => void run(async () => void (await chooseAutoBackupFolder()))}
        />
        <SwitchItem
          icon="book-open-page-variant-outline"
          title={t('backup.autoChapters')}
          subtitle={t('backup.autoChaptersHint')}
          value={autoChapters}
          onValueChange={(value) => setSetting('autoBackupChapters', value)}
        />
        <AppText
          variant="caption"
          color={autoFailed ? colors.error : undefined}
          secondary={!autoFailed}
          style={styles.hint}
        >
          {autoFailed
            ? t('backup.autoFailed')
            : lastAuto
              ? t('backup.lastAuto', {
                  date: formatDate(lastAuto, dateFormat, i18n.language),
                  time: formatTime(lastAuto),
                })
              : t('backup.autoHint')}
        </AppText>

        <SectionHeader title={t('backup.otherApps')} />
        <ListItem
          icon="import"
          title={t('backup.lnreader')}
          subtitle={t('backup.lnreaderHint')}
          disabled={busy}
          onPress={() => pick('lnreader')}
        />
        {busy && !progress.step ? (
          <View style={styles.busy}>
            <ActivityIndicator color={colors.primary as string} />
            <AppText secondary>{t('backup.working')}</AppText>
          </View>
        ) : null}
      </ScrollView>

      <Dialog
        visible={pending.kind === 'create'}
        title={t('backup.create')}
        onClose={close}
        actions={[
          { label: t('common.cancel'), onPress: close },
          { label: t('backup.share'), onPress: () => create('share') },
          { label: t('backup.saveToFolder'), onPress: () => create('folder') },
        ]}
      >
        <AppText>{t('backup.contentFull')}</AppText>
        <AppText secondary style={styles.gap}>
          {t('backup.contentHint')}
        </AppText>
        <AppText secondary style={styles.gap}>
          {t('backup.targetHint')}
        </AppText>
      </Dialog>

      {pending.kind === 'created' ? (
        <Dialog
          visible
          title={t('backup.createdTitle')}
          onClose={close}
          actions={[{ label: t('common.close'), onPress: close }]}
        >
          <AppText variant="bodyStrong">{pending.saved.name}</AppText>
          <AppText>
            {t('backup.createdSize', { size: formatBytes(pending.saved.backup.size) })}
          </AppText>
          <AppText secondary style={styles.gap}>
            {t('backup.createdCounts', {
              novels: pending.saved.backup.manifest.counts?.novels ?? 0,
              chapters: pending.saved.backup.manifest.counts?.chapters ?? 0,
              quotes: pending.saved.backup.manifest.counts?.quotes ?? 0,
              files: pending.saved.backup.manifest.counts?.files ?? 0,
            })}
          </AppText>
          <AppText secondary style={styles.gap}>
            {pending.saved.outcome === 'saved'
              ? t('backup.createdVerified')
              : t('backup.createdShared')}
          </AppText>
          {pending.saved.backup.missing.length > 0 ? (
            <AppText secondary style={styles.gap}>
              {t('backup.createdMissing', { count: pending.saved.backup.missing.length })}
            </AppText>
          ) : null}
        </Dialog>
      ) : null}

      {pending.kind === 'restored' ? (
        <Dialog
          visible
          title={t('backup.restoredTitle')}
          onClose={close}
          actions={[{ label: t('common.close'), onPress: close }]}
        >
          <AppText>
            {pending.mode === 'replace'
              ? t('backup.restored', { count: pending.summary.novelsAdded })
              : t('backup.merged', {
                  added: pending.summary.novelsAdded,
                  updated: pending.summary.novelsUpdated,
                })}
          </AppText>
          <AppText secondary style={styles.gap}>
            {t('backup.restoredSafety')}
          </AppText>
        </Dialog>
      ) : null}

      {pending.kind === 'failed' ? (
        <Dialog
          visible
          title={pending.title}
          onClose={close}
          actions={[{ label: t('common.close'), onPress: close }]}
        >
          <AppText>{pending.message}</AppText>
          <AppText variant="caption" secondary style={styles.gap} selectable>
            {t('backup.errorDetail', { detail: pending.detail })}
          </AppText>
          <AppText variant="caption" secondary style={styles.gap}>
            {t('backup.errorJournal')}
          </AppText>
        </Dialog>
      ) : null}

      {pending.kind === 'safety' && safety ? (
        <Dialog
          visible
          title={t('backup.safetyTitle')}
          message={t('backup.safetyExplain')}
          onClose={close}
          actions={[
            { label: t('common.cancel'), onPress: close },
            { label: t('backup.share'), onPress: shareSafety },
            { label: t('backup.safetyRestore'), onPress: undoLastRestore },
          ]}
        />
      ) : null}

      {pending.kind === 'restore' ? (
        <Dialog
          visible
          title={t('backup.restore')}
          onClose={closeRestore}
          actions={[
            { label: t('common.cancel'), onPress: closeRestore },
            { label: t('backup.merge'), onPress: () => restore(pending.content, 'merge') },
            {
              label: t('backup.replace'),
              danger: true,
              onPress: () => restore(pending.content, 'replace'),
            },
          ]}
        >
          <AppText variant="bodyStrong">{pending.name}</AppText>
          <AppText secondary>
            {t('backup.fileInfo', {
              date: formatDate(pending.content.manifest.createdAt, dateFormat, i18n.language),
              version: pending.content.manifest.appVersion,
              count: counts(pending.content).novels,
            })}
          </AppText>
          <AppText secondary>
            {t('backup.fileCounts', {
              chapters: counts(pending.content).chapters,
              quotes: counts(pending.content).quotes,
            })}
          </AppText>
          <AppText secondary>
            {pending.content.manifest.checksums
              ? t('backup.fileChecked')
              : t('backup.fileOldFormat')}
          </AppText>
          {!pending.content.manifest.includesChapters ? (
            <AppText secondary>{t('backup.noChaptersInside')}</AppText>
          ) : null}
          <AppText secondary style={styles.gap}>
            {t('backup.mergeHint')}
          </AppText>
          <AppText secondary>{t('backup.replaceHint')}</AppText>
          <AppText secondary style={styles.gap}>
            {t('backup.safetyBefore')}
          </AppText>
        </Dialog>
      ) : null}

      {pending.kind === 'lnreader' ? (
        <Dialog
          visible
          title={t('backup.lnreader')}
          message={t('backup.lnreaderConfirm', { name: pending.name })}
          onClose={close}
          actions={[
            { label: t('common.cancel'), onPress: close },
            { label: t('backup.import'), onPress: () => importFromLnReader(pending.data) },
          ]}
        />
      ) : null}

      {pending.kind === 'lnreaderDone' ? (
        <Dialog
          visible
          title={t('backup.lnreaderDone')}
          onClose={close}
          actions={[
            { label: t('common.close'), onPress: close },
            ...(pending.summary.installable.length > 0
              ? [
                  {
                    label: t('backup.installSources', {
                      count: pending.summary.installable.length,
                    }),
                    onPress: () => installMissingSources(pending.summary),
                  },
                ]
              : []),
          ]}
        >
          <AppText>
            {t('backup.lnreaderSummary', {
              added: pending.summary.novelsAdded,
              merged: pending.summary.novelsMerged,
              chapters: pending.summary.chapters,
              categories: pending.summary.categoriesAdded,
            })}
          </AppText>
          {pending.summary.sources.length > 0 ? (
            <AppText secondary style={styles.gap}>
              {t('backup.lnreaderSources', { names: pending.summary.sources.join(', ') })}
            </AppText>
          ) : null}
          {pending.summary.ignored.length > 0 ? (
            <View style={styles.gap}>
              <AppText variant="label" secondary>
                {t('backup.ignoredTitle')}
              </AppText>
              {pending.summary.ignored.slice(0, 40).map((item, index) => (
                <AppText key={index} variant="caption" secondary>
                  • {ignoredLabel(item)}
                </AppText>
              ))}
              {pending.summary.ignored.length > 40 ? (
                <AppText variant="caption" secondary>
                  • {t('backup.ignoredMore', { count: pending.summary.ignored.length - 40 })}
                </AppText>
              ) : null}
            </View>
          ) : null}
        </Dialog>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: SPACING.xl },
  hint: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  busy: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.md,
    padding: SPACING.lg,
  },
  gap: { marginTop: SPACING.md },
  flex: { flex: 1 },
  progress: {
    gap: SPACING.sm,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.sm,
    padding: SPACING.md,
    borderRadius: 12,
  },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
});
