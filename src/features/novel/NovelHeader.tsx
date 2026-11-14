import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { Chapter, Novel } from '../../db/schema';
import { formatDuration, formatPercent } from '../../services/format';
import { AppText, Button, Cover, Icon, type IconName } from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { RADIUS, SPACING } from '../../theme/typography';
import { languageInfo } from '../translation/languages';
import { formatChapterNumber } from './chapterNumber';

export interface HeaderAction {
  key: string;
  icon: IconName;
  label: string;
  active?: boolean;
  onPress: () => void;
}

export function NovelHeader({
  novel,
  chapterCount,
  readCount,
  resume,
  actions,
  onContinue,
  onOpenStats,
}: {
  novel: Novel;
  chapterCount: number;
  readCount: number;
  resume: { chapter: Chapter; started: boolean } | null;
  actions: HeaderAction[];
  onContinue: () => void;
  onOpenStats?: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const language = languageInfo(novel.originalLang);
  const genres = (novel.genres ?? '')
    .split(',')
    .map((genre) => genre.trim())
    .filter(Boolean);

  return (
    <View style={styles.container}>
      <View style={styles.top}>
        <View style={styles.cover}>
          <Cover path={novel.coverPath} title={novel.title} radius={RADIUS.md} />
        </View>
        <View style={styles.info}>
          {language ? (
            <View style={styles.flags} accessibilityLabel={t('novel.languages')}>
              <View style={[styles.flag, { borderColor: colors.primary }]}>
                <AppText accessibilityLabel={language.name}>{language.flag}</AppText>
              </View>
            </View>
          ) : null}
          <AppText variant="headline" numberOfLines={4} selectable>
            {novel.title}
          </AppText>
          {novel.author ? (
            <AppText secondary numberOfLines={2}>
              {novel.author}
            </AppText>
          ) : null}
          <View style={styles.source}>
            <Icon
              name={novel.origin === 'local' ? 'file-outline' : 'earth'}
              size={16}
              color={colors.textSecondary}
            />
            <AppText variant="label" secondary numberOfLines={1}>
              {[novel.origin === 'local' ? t('novel.localFile') : novel.pluginId, novel.status]
                .filter(Boolean)
                .join(' · ')}
            </AppText>
          </View>
        </View>
      </View>

      {genres.length > 0 ? (
        <View style={styles.genres}>
          {genres.map((genre) => (
            <View key={genre} style={[styles.genre, { backgroundColor: colors.surfaceVariant }]}>
              <AppText variant="caption" secondary>
                {genre}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}

      {novel.description ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={expanded ? t('novel.showLess') : t('novel.showMore')}
          disabled={!canExpand && !expanded}
          onPress={() => setExpanded((value) => !value)}
        >
          <AppText
            secondary
            numberOfLines={expanded ? undefined : 3}
            onTextLayout={(event) => {
              if (!expanded) {
                setCanExpand(event.nativeEvent.lines.length >= 3);
              }
            }}
          >
            {novel.description}
          </AppText>
          {canExpand || expanded ? (
            <AppText variant="label" color={colors.primary}>
              {expanded ? t('novel.showLess') : t('novel.showMore')}
            </AppText>
          ) : null}
        </Pressable>
      ) : null}

      <View style={styles.stats}>
        <Pressable
          accessibilityRole={onOpenStats ? 'button' : undefined}
          disabled={!onOpenStats}
          onPress={onOpenStats}
          style={[styles.stat, { backgroundColor: colors.surfaceVariant }]}
        >
          <Icon name="clock-outline" size={18} color={colors.textSecondary} />
          <View>
            <AppText variant="bodyStrong">{formatDuration(novel.totalReadMs, t)}</AppText>
            <AppText variant="caption" secondary>
              {t('novel.timeSpent')}
            </AppText>
          </View>
        </Pressable>
        <View style={[styles.stat, { backgroundColor: colors.surfaceVariant }]}>
          <Icon name="book-open-variant" size={18} color={colors.textSecondary} />
          <View>
            <AppText variant="bodyStrong">
              {t('novel.progressCount', { read: readCount, total: chapterCount })}
            </AppText>
            <AppText variant="caption" secondary>
              {formatPercent(chapterCount > 0 ? readCount / chapterCount : 0)}
            </AppText>
          </View>
        </View>
      </View>

      {resume ? (
        <View style={styles.continue}>
          <Button
            icon="play"
            label={
              resume.started
                ? t('novel.continue', {
                    chapter:
                      resume.chapter.number !== null
                        ? t('novel.chapterNumber', {
                            number: formatChapterNumber(resume.chapter.number),
                          })
                        : resume.chapter.title,
                  })
                : t('novel.start')
            }
            onPress={onContinue}
          />
        </View>
      ) : null}

      <View style={styles.actions}>
        {actions.map((action) => (
          <Pressable
            key={action.key}
            accessibilityRole="button"
            accessibilityState={{ selected: Boolean(action.active) }}
            onPress={action.onPress}
            android_ripple={{ color: colors.ripple, borderless: true }}
            style={styles.action}
          >
            <Icon
              name={action.icon}
              color={action.active ? colors.primary : colors.textSecondary}
            />
            <AppText
              variant="caption"
              color={action.active ? colors.primary : colors.textSecondary}
              center
              numberOfLines={2}
            >
              {action.label}
            </AppText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, gap: SPACING.md },
  top: { flexDirection: 'row', gap: SPACING.lg },
  cover: { width: 116 },
  info: { flex: 1, gap: SPACING.xs, justifyContent: 'center' },
  flags: { flexDirection: 'row', gap: SPACING.xs },
  flag: { borderWidth: 2, borderRadius: RADIUS.sm, paddingHorizontal: 4 },
  source: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  genres: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  genre: { paddingHorizontal: SPACING.sm, paddingVertical: 2, borderRadius: RADIUS.pill },
  stats: { flexDirection: 'row', gap: SPACING.sm },
  stat: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
  },
  continue: { alignItems: 'stretch' },
  actions: { flexDirection: 'row', flexWrap: 'wrap' },
  action: {
    width: '25%',
    minHeight: 60,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    padding: 4,
  },
});
