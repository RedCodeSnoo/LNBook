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

export interface HeaderLanguage {
  /** Language code; null = original language unknown. */
  code: string | null;
  original: boolean;
  /** Translated chapters, for a translation. */
  count: number;
}

export function NovelHeader({
  novel,
  languages,
  activeLang,
  onPickLanguage,
  onLanguageOptions,
  onAddLanguage,
  chapterCount,
  readCount,
  resume,
  actions,
  onContinue,
  onOpenStats,
  estimatedMs = 0,
}: {
  novel: Novel;
  /** Original language first, then every language with translated chapters. */
  languages: HeaderLanguage[];
  /** Language the novel is read in (null = original). */
  activeLang: string | null;
  onPickLanguage: (code: string | null) => void;
  onLanguageOptions: (code: string) => void;
  onAddLanguage: () => void;
  chapterCount: number;
  readCount: number;
  resume: { chapter: Chapter; started: boolean } | null;
  actions: HeaderAction[];
  onContinue: () => void;
  onOpenStats?: () => void;
  /** Part of the time given by "Set my progress". */
  estimatedMs?: number;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
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
          <View style={styles.flags} accessibilityLabel={t('novel.languages')}>
            {languages.map((item) => {
              const info = languageInfo(item.code);
              const active = item.original ? activeLang === null : activeLang === item.code;
              const partial = !item.original && item.count < chapterCount;
              return (
                <Pressable
                  key={item.original ? 'original' : item.code}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={
                    item.original
                      ? t('translation.flagOriginal', { language: info?.name ?? '?' })
                      : t('translation.flagTranslated', {
                          language: info?.name ?? '?',
                          done: item.count,
                          total: chapterCount,
                        })
                  }
                  onPress={() => onPickLanguage(item.original ? null : item.code)}
                  onLongPress={
                    item.original || !item.code
                      ? undefined
                      : () => onLanguageOptions(item.code as string)
                  }
                  style={[styles.flag, { borderColor: active ? colors.primary : 'transparent' }]}
                >
                  <AppText>{info?.flag ?? '🏳️'}</AppText>
                  {partial ? (
                    <AppText variant="caption" secondary>
                      {`${item.count} / ${chapterCount}`}
                    </AppText>
                  ) : null}
                </Pressable>
              );
            })}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('translation.addLanguage')}
              onPress={onAddLanguage}
              style={[styles.flag, styles.addFlag, { borderColor: colors.border }]}
            >
              <Icon name="plus" size={16} color={colors.textSecondary} />
            </Pressable>
          </View>
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
            <AppText variant="bodyStrong">
              {estimatedMs > 0
                ? t('progress.approx', { time: formatDuration(novel.totalReadMs, t) })
                : formatDuration(novel.totalReadMs, t)}
            </AppText>
            <AppText variant="caption" secondary>
              {estimatedMs > 0
                ? t('progress.timeSpentEstimated', { time: formatDuration(estimatedMs, t) })
                : t('novel.timeSpent')}
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
  flags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SPACING.xs },
  flag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 32,
    borderWidth: 2,
    borderRadius: RADIUS.sm,
    paddingHorizontal: 6,
  },
  addFlag: { borderWidth: 1, minWidth: 32, justifyContent: 'center' },
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
