import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { RootScreenProps } from '../../app/navigation';
import { useDataVersion } from '../../db/invalidation';
import i18n from '../../i18n';
import { formatDate, formatTime } from '../../services/format';
import {
  AppBar,
  AppText,
  CheckItem,
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
import {
  chooseAutoBackupFolder,
  createManualBackup,
  didLastAutoBackupFail,
  folderLabel,
  getLastAutoBackupAt,
  importLnReader,
  installSources,
  pickBackupFile,
  restoreBackup,
  runAutoBackupIfDue,
} from './backupService';
import type { IgnoredItem, LnReaderImportSummary } from './lnreaderImport';

const FREQUENCIES: AutoBackupFrequency[] = ['off', 'daily', 'weekly'];

type Pending =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'restore'; name: string; content: BackupContent }
  | { kind: 'lnreader'; name: string; data: Uint8Array }
  | { kind: 'lnreaderDone'; summary: LnReaderImportSummary };

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
  const [includeChapters, setIncludeChapters] = useState(true);
  const [includeTranslations, setIncludeTranslations] = useState(true);
  const [stamp, setStamp] = useState(0);
  useDataVersion('library');

  const close = () => setPending({ kind: 'none' });
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
      const outcome = await createManualBackup(target, { includeChapters, includeTranslations });
      if (outcome === 'saved') {
        showToast(t('backup.saved'));
      } else if (outcome === 'failed') {
        showToast(t('backup.failed'));
      }
    });
  };

  const pick = (expected: 'lnbook' | 'lnreader') => {
    void run(async () => {
      const picked = await pickBackupFile();
      if (picked.kind === 'cancelled') {
        return;
      }
      if (picked.kind === 'error') {
        showToast(
          picked.reason === 'tooRecent'
            ? t('backup.errorTooRecent')
            : picked.reason === 'notBackup'
              ? expected === 'lnreader'
                ? t('backup.errorNotLnReader')
                : t('backup.errorNotBackup')
              : t('backup.errorCorrupted'),
        );
        return;
      }
      // Whatever entry was used, the file decides what happens.
      setPending(
        picked.kind === 'lnbook'
          ? { kind: 'restore', name: picked.name, content: picked.content }
          : { kind: 'lnreader', name: picked.name, data: picked.data },
      );
    });
  };

  const restore = (content: BackupContent, mode: 'replace' | 'merge') => {
    close();
    void run(async () => {
      try {
        const summary = await restoreBackup(content, mode);
        showToast(
          mode === 'replace'
            ? t('backup.restored', { count: summary.novelsAdded })
            : t('backup.merged', { added: summary.novelsAdded, updated: summary.novelsUpdated }),
        );
      } catch (error) {
        console.warn('Restore failed', error);
        showToast(t('backup.restoreFailed'));
      }
    });
  };

  const importFromLnReader = (data: Uint8Array) => {
    close();
    void run(async () => {
      try {
        setPending({ kind: 'lnreaderDone', summary: await importLnReader(data) });
      } catch (error) {
        console.warn('LNReader import failed', error);
        showToast(t('backup.restoreFailed'));
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
  const autoFailed = didLastAutoBackupFail();
  const ignoredLabel = (item: IgnoredItem) =>
    'name' in item
      ? `${t(`backup.ignored.${item.kind}`)} : ${item.name}`
      : t(`backup.ignored.${item.kind}`);

  return (
    <Screen bottom>
      <AppBar title={t('more.backup')} onBack={navigation.goBack} />
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
        {busy ? (
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
        <AppText secondary>{t('backup.contentHint')}</AppText>
        <CheckItem
          title={t('backup.includeChapters')}
          subtitle={t('backup.includeChaptersHint')}
          checked={includeChapters}
          onPress={() => setIncludeChapters((value) => !value)}
        />
        <CheckItem
          title={t('backup.includeTranslations')}
          checked={includeTranslations}
          onPress={() => setIncludeTranslations((value) => !value)}
        />
      </Dialog>

      {pending.kind === 'restore' ? (
        <Dialog
          visible
          title={t('backup.restore')}
          onClose={close}
          actions={[
            { label: t('common.cancel'), onPress: close },
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
              count: pending.content.tables.novels.length,
            })}
          </AppText>
          {!pending.content.manifest.includesChapters ? (
            <AppText secondary>{t('backup.noChaptersInside')}</AppText>
          ) : null}
          <AppText secondary style={styles.gap}>
            {t('backup.mergeHint')}
          </AppText>
          <AppText secondary>{t('backup.replaceHint')}</AppText>
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
});
