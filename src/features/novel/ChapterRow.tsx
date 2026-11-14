import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { Chapter, Volume } from '../../db/schema';
import { formatDuration, formatPercent } from '../../services/format';
import { AppText, Icon } from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { SPACING } from '../../theme/typography';
import { formatChapterNumber } from './chapterNumber';

interface ChapterRowProps {
  chapter: Chapter;
  selected: boolean;
  current?: boolean;
  onPress: (chapter: Chapter) => void;
  onLongPress?: (chapter: Chapter) => void;
}

function ChapterRowBase({ chapter, selected, current, onPress, onLongPress }: ChapterRowProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  // A chapter that has been read is greyed out.
  const titleColor = current ? colors.primary : chapter.isRead ? colors.textDisabled : colors.text;
  const metaColor = chapter.isRead ? colors.textDisabled : colors.textSecondary;
  const number = formatChapterNumber(chapter.number ?? chapter.position + 1);
  const meta = [
    chapter.releaseTime,
    chapter.readMs > 0 ? formatDuration(chapter.readMs, t) : null,
    !chapter.isRead && chapter.progress > 0 ? formatPercent(chapter.progress) : null,
  ].filter(Boolean);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={[
        chapter.title,
        chapter.isRead ? t('novel.read') : null,
        chapter.isFavorite ? t('novel.favorite') : null,
        ...meta,
      ]
        .filter(Boolean)
        .join(', ')}
      onPress={() => onPress(chapter)}
      onLongPress={onLongPress ? () => onLongPress(chapter) : undefined}
      android_ripple={{ color: colors.ripple }}
      style={[styles.row, selected && { backgroundColor: colors.primaryContainer }]}
    >
      <AppText variant="label" color={metaColor} style={styles.number} numberOfLines={1}>
        {number}
      </AppText>
      <View style={styles.texts}>
        <AppText color={titleColor} numberOfLines={2}>
          {chapter.title}
        </AppText>
        {meta.length > 0 ? (
          <AppText variant="caption" color={metaColor} numberOfLines={1}>
            {meta.join(' · ')}
          </AppText>
        ) : null}
      </View>
      <View style={styles.icons}>
        {chapter.isFavorite ? <Icon name="star" size={16} color={colors.warning} /> : null}
        {chapter.isEdited ? <Icon name="pencil-outline" size={16} color={metaColor} /> : null}
        {chapter.isDownloaded ? (
          <Icon name="check-circle-outline" size={16} color={metaColor} />
        ) : null}
      </View>
    </Pressable>
  );
}

export const ChapterRow = memo(ChapterRowBase);

function VolumeHeaderBase({
  volume,
  chapterCount,
  readCount,
  collapsed,
  onPress,
  onLongPress,
}: {
  volume: Volume;
  chapterCount: number;
  readCount: number;
  collapsed: boolean;
  onPress: (volume: Volume) => void;
  onLongPress?: (volume: Volume) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: !collapsed }}
      onPress={() => onPress(volume)}
      onLongPress={onLongPress ? () => onLongPress(volume) : undefined}
      android_ripple={{ color: colors.ripple }}
      style={[styles.volume, { backgroundColor: colors.surfaceVariant }]}
    >
      <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} color={colors.textSecondary} />
      <AppText variant="bodyStrong" style={styles.texts} numberOfLines={2}>
        {volume.title}
      </AppText>
      <AppText variant="caption" secondary>
        {t('novel.volumeProgress', { read: readCount, total: chapterCount })}
      </AppText>
    </Pressable>
  );
}

export const VolumeHeader = memo(VolumeHeaderBase);

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  number: { minWidth: 34, textAlign: 'right', fontVariant: ['tabular-nums'] },
  texts: { flex: 1, gap: 2 },
  icons: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  volume: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    marginTop: SPACING.xs,
  },
});
