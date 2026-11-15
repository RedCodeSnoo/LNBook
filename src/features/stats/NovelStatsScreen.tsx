import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { RootScreenProps } from '../../app/navigation';
import { getDb } from '../../db/client';
import { useQuery } from '../../db/invalidation';
import { formatDate, formatDuration } from '../../services/format';
import {
  AppBar,
  AppText,
  EmptyState,
  ListItem,
  Screen,
  SegmentedTabs,
} from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { RADIUS, SPACING } from '../../theme/typography';
import { formatChapterNumber } from '../novel/chapterNumber';
import { getNovel } from '../novel/novelRepository';
import { useSetting } from '../settings/settingsStore';
import { BarChart } from './charts';
import { chartBars, novelTimes, type ChartPeriod } from './statistics';
import { timeBars } from './statsFormat';
import { loadChapterCounts, loadChapterTimes, loadSessions } from './statsRepository';
import { Section } from './StatsScreen';

const PERIODS: ChartPeriod[] = ['7d', '30d', '12m', 'all'];

/** Statistics of one novel: times, days, estimate of what is left, time per chapter. */
export function NovelStatsScreen({ navigation, route }: RootScreenProps<'novelStats'>) {
  const { novelId } = route.params;
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const dateFormat = useSetting('dateFormat');
  const [period, setPeriod] = useState<ChartPeriod>('30d');
  const novel = useQuery(() => getNovel(getDb(), novelId), ['novel'], [novelId]);
  const sessions = useQuery(() => loadSessions(getDb(), novelId), ['stats'], [novelId]);
  const counts = useQuery(
    () => loadChapterCounts(getDb(), novelId),
    ['stats', 'chapters'],
    [novelId],
  );
  const chapters = useQuery(
    () => loadChapterTimes(getDb(), novelId),
    ['stats', 'chapters'],
    [novelId],
  );
  const [now] = useState(() => Date.now());
  const times = useMemo(() => novelTimes(sessions, counts), [sessions, counts]);
  const estimatedChapters = useMemo(
    () =>
      new Set(
        sessions
          .filter((row) => row.mode === 'estimated' && row.chapterId !== null)
          .map((row) => row.chapterId as number),
      ),
    [sessions],
  );
  const bars = useMemo(
    () => timeBars(chartBars(sessions, period, now), i18n.language, t),
    [sessions, period, now, i18n.language, t],
  );

  const duration = (ms: number) => formatDuration(ms, t);
  const date = (day: number | null) =>
    day === null ? '–' : formatDate(day, dateFormat, i18n.language);
  const facts: [string, string][] = [
    [t('stats.reading'), duration(times.readMs)],
    [t('stats.listening'), duration(times.listenMs)],
    ...(times.estimatedMs > 0
      ? ([[t('stats.estimated'), `~${duration(times.estimatedMs)}`]] as [string, string][])
      : []),
    [t('stats.firstDay'), date(times.firstDay)],
    [t('stats.lastDay'), date(times.lastDay)],
    [t('stats.chaptersRead'), t('novel.progressCount', { read: counts.read, total: counts.total })],
    [
      t('stats.averagePerChapter'),
      times.averagePerChapterMs === null ? '–' : duration(times.averagePerChapterMs),
    ],
    [
      t('stats.remaining'),
      times.remainingMs === null || counts.read >= counts.total ? '–' : duration(times.remainingMs),
    ],
  ];

  return (
    <Screen bottom>
      <AppBar title={t('more.statistics')} subtitle={novel?.title} onBack={navigation.goBack} />
      {sessions.length === 0 ? (
        <EmptyState
          icon="chart-box-outline"
          title={t('stats.emptyTitle')}
          message={t('stats.emptyNovelMessage')}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={[styles.card, { backgroundColor: colors.primaryContainer }]}>
            <AppText variant="label" color={colors.onPrimaryContainer}>
              {t('stats.totalTime')}
            </AppText>
            <AppText variant="headline" color={colors.onPrimaryContainer}>
              {duration(times.totalMs)}
            </AppText>
          </View>

          <View style={styles.facts}>
            {facts.map(([label, value]) => (
              <View
                key={label}
                accessible
                accessibilityLabel={`${label}, ${value}`}
                style={[styles.fact, { borderBottomColor: colors.border }]}
              >
                <AppText secondary style={styles.factLabel}>
                  {label}
                </AppText>
                <AppText variant="bodyStrong">{value}</AppText>
              </View>
            ))}
          </View>

          <Section title={t('stats.timePerDay')}>
            <SegmentedTabs<ChartPeriod>
              value={period}
              onChange={setPeriod}
              options={PERIODS.map((value) => ({ value, label: t(`stats.period.${value}`) }))}
            />
            <BarChart
              key={period}
              bars={bars}
              summary={t('stats.periodTotal', {
                time: duration(bars.reduce((sum, bar) => sum + bar.value, 0)),
              })}
            />
          </Section>

          <Section title={t('stats.timePerChapter')}>
            <View style={styles.chapters}>
              {chapters.map((chapter) => (
                <ListItem
                  key={chapter.id}
                  title={chapter.title}
                  subtitle={t('novel.chapterNumber', {
                    number: formatChapterNumber(chapter.number ?? chapter.position + 1),
                  })}
                  onPress={() => navigation.navigate('reader', { chapterId: chapter.id })}
                  right={
                    <AppText variant="label" secondary>
                      {estimatedChapters.has(chapter.id)
                        ? t('progress.approxChapter', { time: duration(chapter.readMs) })
                        : duration(chapter.readMs)}
                    </AppText>
                  }
                />
              ))}
            </View>
          </Section>
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: SPACING.lg, gap: SPACING.xl, paddingBottom: SPACING.xxl },
  card: { padding: SPACING.lg, borderRadius: RADIUS.lg, gap: 2 },
  facts: {},
  fact: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    gap: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  factLabel: { flex: 1 },
  chapters: { marginHorizontal: -SPACING.lg },
});
