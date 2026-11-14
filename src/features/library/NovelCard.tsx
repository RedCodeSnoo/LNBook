import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText, Cover, Icon } from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { RADIUS, SPACING } from '../../theme/typography';
import type { LibraryDisplay } from '../settings/settings';
import { languageInfo } from '../translation/languages';
import type { LibraryNovel } from './libraryRepository';

export interface CardBadges {
  unread: boolean;
  download: boolean;
  language: boolean;
  progress: boolean;
}

interface Props {
  novel: LibraryNovel;
  display: LibraryDisplay;
  badges: CardBadges;
  selected: boolean;
  selectionMode: boolean;
  onPress: (novel: LibraryNovel) => void;
  onLongPress: (novel: LibraryNovel) => void;
  onContinue: (novel: LibraryNovel) => void;
}

function Badge({ label, background, color }: { label: string; background: string; color: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: background }]}>
      <AppText variant="caption" color={color} style={styles.badgeText}>
        {label}
      </AppText>
    </View>
  );
}

function ProgressBar({ value }: { value: number }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.progressTrack, { backgroundColor: colors.surfaceVariant }]}>
      <View
        style={[
          styles.progressFill,
          { backgroundColor: colors.primary, width: `${Math.round(value * 100)}%` },
        ]}
      />
    </View>
  );
}

function NovelCardBase({
  novel,
  display,
  badges,
  selected,
  selectionMode,
  onPress,
  onLongPress,
  onContinue,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const unread = novel.chapterCount - novel.readCount;
  const flags = badges.language
    ? [novel.originalLang, ...novel.translatedLangs]
        .map((code) => languageInfo(code)?.flag)
        .filter(Boolean)
        .join(' ')
    : '';
  const partial =
    novel.origin === 'online' && novel.downloadedCount > 0 && !novel.isLocal
      ? t('library.downloadedCount', { done: novel.downloadedCount, total: novel.chapterCount })
      : null;
  const originIcon = novel.origin === 'local' ? 'file-outline' : 'earth';
  const label = [
    novel.title,
    novel.author,
    unread > 0 ? t('library.unreadCount', { count: unread }) : null,
  ]
    .filter(Boolean)
    .join(', ');

  const continueButton =
    !selectionMode && novel.chapterCount > 0 ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('library.continueReading', { title: novel.title })}
        hitSlop={6}
        onPress={() => onContinue(novel)}
        style={[styles.continue, { backgroundColor: colors.primary }]}
      >
        <Icon name="play" size={18} color={colors.onPrimary} />
      </Pressable>
    ) : null;

  if (display === 'list') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected }}
        onPress={() => onPress(novel)}
        onLongPress={() => onLongPress(novel)}
        android_ripple={{ color: colors.ripple }}
        style={[styles.listRow, selected && { backgroundColor: colors.primaryContainer }]}
      >
        <View style={styles.listCover}>
          <Cover path={novel.coverPath} title={novel.title} radius={6} />
        </View>
        <View style={styles.listTexts}>
          <AppText variant="subtitle" numberOfLines={2}>
            {novel.title}
          </AppText>
          {novel.author ? (
            <AppText variant="label" secondary numberOfLines={1}>
              {novel.author}
            </AppText>
          ) : null}
          <View style={styles.listMeta}>
            <Icon name={originIcon} size={14} color={colors.textSecondary} />
            {flags ? <AppText variant="caption">{flags}</AppText> : null}
            {badges.download && partial ? (
              <AppText variant="caption" secondary>
                {partial}
              </AppText>
            ) : null}
          </View>
          {badges.progress && novel.progress > 0 ? <ProgressBar value={novel.progress} /> : null}
        </View>
        {badges.unread && unread > 0 ? (
          <Badge
            label={String(unread)}
            background={colors.primary as string}
            color={colors.onPrimary as string}
          />
        ) : null}
        {continueButton ? <View>{continueButton}</View> : null}
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={() => onPress(novel)}
      onLongPress={() => onLongPress(novel)}
      style={styles.gridItem}
    >
      <View>
        <Cover path={novel.coverPath} title={novel.title} />
        <View style={styles.topBadges}>
          {badges.unread && unread > 0 ? (
            <Badge
              label={String(unread)}
              background={colors.primary as string}
              color={colors.onPrimary as string}
            />
          ) : null}
          {badges.download && partial ? (
            <Badge label={partial} background="rgba(0,0,0,0.72)" color="#FFFFFF" />
          ) : null}
        </View>
        <View style={styles.bottomBadges}>
          <View style={styles.origin}>
            <Icon name={originIcon} size={13} color="#FFFFFF" />
            {flags ? (
              <AppText variant="caption" color="#FFFFFF">
                {flags}
              </AppText>
            ) : null}
          </View>
        </View>
        {continueButton ? <View style={styles.continueOverlay}>{continueButton}</View> : null}
        {selected ? (
          <View style={[styles.selectedOverlay, { borderColor: colors.primary }]}>
            <View style={[styles.check, { backgroundColor: colors.primary }]}>
              <Icon name="check" size={18} color={colors.onPrimary} />
            </View>
          </View>
        ) : null}
        {display === 'compact' ? (
          <View style={styles.compactTitle}>
            <AppText variant="label" color="#FFFFFF" numberOfLines={2}>
              {novel.title}
            </AppText>
          </View>
        ) : null}
      </View>
      {badges.progress && novel.progress > 0 ? <ProgressBar value={novel.progress} /> : null}
      {display === 'grid' ? (
        <AppText variant="label" numberOfLines={2} style={styles.gridTitle}>
          {novel.title}
        </AppText>
      ) : null}
    </Pressable>
  );
}

export const NovelCard = memo(NovelCardBase);

const styles = StyleSheet.create({
  gridItem: { flex: 1, padding: SPACING.xs + 2, gap: SPACING.xs },
  gridTitle: { minHeight: 36 },
  topBadges: {
    position: 'absolute',
    top: 6,
    left: 6,
    right: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  bottomBadges: { position: 'absolute', left: 6, bottom: 6 },
  origin: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: RADIUS.sm,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: RADIUS.sm,
    alignSelf: 'flex-start',
  },
  badgeText: { fontVariant: ['tabular-nums'] },
  continueOverlay: { position: 'absolute', right: 6, bottom: 6 },
  continue: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
  },
  selectedOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 3,
    borderRadius: RADIUS.sm,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactTitle: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 6,
    paddingTop: 18,
    paddingBottom: 30,
    borderBottomLeftRadius: RADIUS.sm,
    borderBottomRightRadius: RADIUS.sm,
    backgroundColor: 'rgba(0,0,0,0.55)',
    zIndex: -1,
  },
  progressTrack: { height: 3, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 3, borderRadius: 2 },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  listCover: { width: 52 },
  listTexts: { flex: 1, gap: 3 },
  listMeta: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
});
