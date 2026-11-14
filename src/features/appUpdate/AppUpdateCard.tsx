import { useEffect, useState } from 'react';
import { AppState, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import i18n from '../../i18n';
import { formatBytes, formatDate } from '../../services/format';
import { AppText, Button, Dialog, Icon } from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { RADIUS, SPACING } from '../../theme/typography';
import { useSetting } from '../settings/settingsStore';
import {
  dismissInstallPrompt,
  downloadAndInstall,
  ignoreRelease,
  openInstallPermission,
  retryInstall,
  useAppUpdate,
} from './appUpdateService';
import { parseReleaseNotes } from './releaseNotes';

const MAX_NOTE_LINES = 10;
const ELLIPSIS = { kind: 'text', text: '…' } as const;

/** Changelog of a release: headings, bullet points and paragraphs of its Markdown text. */
export function ReleaseNotes({ notes }: { notes: string }) {
  // The card stays short; the whole text is one tap away on the release page.
  const all = parseReleaseNotes(notes);
  const lines = all.length > MAX_NOTE_LINES ? [...all.slice(0, MAX_NOTE_LINES), ELLIPSIS] : all;
  return (
    <View style={styles.notes}>
      {lines.map((line, index) =>
        line.kind === 'heading' ? (
          <AppText key={index} variant="label" secondary accessibilityRole="header">
            {line.text}
          </AppText>
        ) : line.kind === 'bullet' ? (
          <View key={index} style={styles.bullet}>
            <AppText>•</AppText>
            <AppText style={styles.flex}>{line.text}</AppText>
          </View>
        ) : (
          <AppText key={index}>{line.text}</AppText>
        ),
      )}
    </View>
  );
}

/** "Version 1.4.0 available": changelog, download, checksum, installation. */
export function AppUpdateCard() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const dateFormat = useSetting('dateFormat');
  const { release, ignored, phase, received, total, failure } = useAppUpdate();
  // The changelog is folded: the card must not hide the new chapters below it.
  const [showNotes, setShowNotes] = useState(false);

  // Back from the Android settings with the permission given: the installation continues.
  useEffect(() => {
    if (phase !== 'needsPermission') {
      return undefined;
    }
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        retryInstall();
      }
    });
    return () => subscription.remove();
  }, [phase]);

  if (!release || ignored) {
    return null;
  }
  const busy = phase === 'downloading' || phase === 'verifying';
  const ratio = total > 0 ? Math.min(1, received / total) : 0;

  return (
    <View
      style={[styles.card, { backgroundColor: colors.surfaceVariant, borderColor: colors.border }]}
    >
      <View style={styles.titleRow}>
        <Icon name="arrow-up-bold-circle-outline" color={colors.primary} />
        <View style={styles.flex}>
          <AppText variant="subtitle" accessibilityRole="header">
            {t('appUpdate.available', { version: release.version })}
          </AppText>
          <AppText variant="caption" secondary>
            {[
              release.publishedAt
                ? formatDate(release.publishedAt, dateFormat, i18n.language)
                : null,
              release.apkSize > 0 ? formatBytes(release.apkSize) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </AppText>
        </View>
      </View>

      {release.notes ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showNotes }}
            onPress={() => setShowNotes((value) => !value)}
            android_ripple={{ color: colors.ripple }}
            style={styles.notesToggle}
          >
            <AppText variant="label" color={colors.primary}>
              {showNotes ? t('appUpdate.hideChanges') : t('appUpdate.showChanges')}
            </AppText>
            <Icon
              name={showNotes ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={colors.primary}
            />
          </Pressable>
          {showNotes ? <ReleaseNotes notes={release.notes} /> : null}
        </>
      ) : null}

      {busy ? (
        <View style={styles.progress}>
          <View
            style={[styles.track, { backgroundColor: colors.border }]}
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100) }}
          >
            <View
              style={[
                styles.bar,
                { backgroundColor: colors.primary, width: `${Math.round(ratio * 100)}%` },
              ]}
            />
          </View>
          <AppText variant="caption" secondary>
            {phase === 'verifying'
              ? t('appUpdate.verifying')
              : t('appUpdate.downloading', {
                  received: formatBytes(received),
                  total: formatBytes(total),
                })}
          </AppText>
        </View>
      ) : null}

      {failure ? (
        <AppText variant="label" color={colors.error}>
          {failure === 'checksum'
            ? t('appUpdate.failedChecksum')
            : failure === 'install'
              ? t('appUpdate.failedInstall')
              : t('appUpdate.failedDownload')}
        </AppText>
      ) : null}
      {phase === 'installing' ? (
        <AppText variant="label" secondary>
          {t('appUpdate.installing')}
        </AppText>
      ) : null}

      <View style={styles.actions}>
        {release.pageUrl && showNotes ? (
          <Button
            label={t('appUpdate.openPage')}
            variant="text"
            compact
            onPress={() => void Linking.openURL(release.pageUrl as string)}
          />
        ) : null}
        <Button
          label={t('appUpdate.ignore')}
          variant="text"
          compact
          disabled={busy}
          onPress={() => ignoreRelease(release.version)}
        />
        <Button
          label={phase === 'installing' || failure ? t('appUpdate.retry') : t('appUpdate.install')}
          icon="download-outline"
          compact
          disabled={busy}
          onPress={() => void downloadAndInstall()}
        />
      </View>

      <Dialog
        visible={phase === 'needsPermission'}
        title={t('appUpdate.permissionTitle')}
        message={t('appUpdate.permissionMessage')}
        onClose={dismissInstallPrompt}
        actions={[
          { label: t('common.cancel'), onPress: dismissInstallPrompt },
          { label: t('appUpdate.openSettings'), onPress: openInstallPermission },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    padding: SPACING.lg,
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: SPACING.sm,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  notes: { gap: SPACING.xs },
  notesToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    alignSelf: 'flex-start',
  },
  bullet: { flexDirection: 'row', gap: SPACING.sm },
  progress: { gap: SPACING.xs },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  bar: { height: 6, borderRadius: 3 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: SPACING.xs,
  },
});
