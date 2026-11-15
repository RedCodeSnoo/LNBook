import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { RootScreenProps } from '../../app/navigation';
import { getDb } from '../../db/client';
import { useQuery } from '../../db/invalidation';
import { formatDuration } from '../../services/format';
import {
  AppBar,
  AppText,
  Cover,
  EmptyState,
  Icon,
  Screen,
  SegmentedTabs,
  type IconName,
} from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { RADIUS, SPACING } from '../../theme/typography';
import { languageInfo } from '../translation/languages';
import { BarChart, Heatmap, ShareRows } from './charts';
import { chartBars, overview, totalsBy, type ChartPeriod } from './statistics';
import { hourBars, timeBars } from './statsFormat';
import { loadCounts, loadNovelLabels, loadSessions } from './statsRepository';

const PERIODS: ChartPeriod[] = ['7d', '30d', '12m', 'all'];

/** Plus → Statistics: time spent reading and listening, over every novel. */
export function StatsScreen({ navigation }: RootScreenProps<'stats'>) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const [period, setPeriod] = useState<ChartPeriod>('7d');
  const sessions = useQuery(() => loadSessions(getDb()), ['stats']);
  const counts = useQuery(() => loadCounts(getDb()), ['stats', 'chapters', 'quotes']);
  const labels = useQuery(() => loadNovelLabels(getDb()), ['stats', 'library', 'novel']);

  // "Now" is read once per visit: the charts do not move while they are looked at.
  const [now] = useState(() => Date.now());
  const data = useMemo(() => overview(sessions, now), [sessions, now]);
  const bars = useMemo(
    () => timeBars(chartBars(sessions, period, now), i18n.language, t),
    [sessions, period, now, i18n.language, t],
  );
  const periodTotal = bars.reduce((sum, bar) => sum + bar.value, 0);
  const bySource = useMemo(
    () => totalsBy(sessions, (row) => labels.get(row.novelId)?.pluginId ?? ''),
    [sessions, labels],
  );

  const duration = (ms: number) => formatDuration(ms, t);
  const tiles: { icon: IconName; value: string; label: string }[] = [
    {
      icon: 'book-open-variant',
      value: String(counts.chaptersRead),
      label: t('stats.chaptersRead'),
    },
    {
      icon: 'text',
      value: data.totals.words.toLocaleString(i18n.language),
      label: t('stats.wordsRead'),
    },
    { icon: 'bookshelf', value: String(counts.novelsStarted), label: t('stats.novelsStarted') },
    {
      icon: 'check-circle-outline',
      value: String(counts.novelsFinished),
      label: t('stats.novelsFinished'),
    },
    { icon: 'format-quote-close', value: String(counts.quotes), label: t('stats.quotes') },
    {
      icon: 'speedometer',
      value: data.speed === null ? '–' : t('stats.wordsPerMinute', { count: data.speed }),
      label: t('stats.speed'),
    },
  ];

  return (
    <Screen bottom>
      <AppBar title={t('more.statistics')} onBack={navigation.goBack} />
      {sessions.length === 0 ? (
        <EmptyState
          icon="chart-box-outline"
          title={t('stats.emptyTitle')}
          message={t('stats.emptyMessage')}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={[styles.card, { backgroundColor: colors.primaryContainer }]}>
            <AppText variant="label" color={colors.onPrimaryContainer}>
              {t('stats.totalTime')}
            </AppText>
            <AppText variant="headline" color={colors.onPrimaryContainer}>
              {duration(data.totals.totalMs)}
            </AppText>
            <AppText variant="label" color={colors.onPrimaryContainer}>
              {t('stats.readAndListened', {
                read: duration(data.totals.readMs),
                listened: duration(data.totals.listenMs),
              })}
            </AppText>
            {data.totals.estimatedMs > 0 ? (
              <AppText variant="label" color={colors.onPrimaryContainer}>
                {t('stats.includingEstimated', { time: duration(data.totals.estimatedMs) })}
              </AppText>
            ) : null}
          </View>

          <View style={styles.tiles}>
            {tiles.map((tile) => (
              <View
                key={tile.label}
                accessible
                accessibilityLabel={`${tile.label}, ${tile.value}`}
                style={[styles.tile, { backgroundColor: colors.surfaceVariant }]}
              >
                <Icon name={tile.icon} size={18} color={colors.textSecondary} />
                <AppText variant="bodyStrong" numberOfLines={1}>
                  {tile.value}
                </AppText>
                <AppText variant="caption" secondary numberOfLines={2}>
                  {tile.label}
                </AppText>
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
              summary={t('stats.periodTotal', { time: duration(periodTotal) })}
            />
          </Section>

          <Section title={t('stats.streaks')}>
            <View style={styles.row}>
              <View style={styles.half}>
                <AppText variant="title">
                  {t('stats.days', { count: data.streaks.current })}
                </AppText>
                <AppText variant="caption" secondary>
                  {t('stats.currentStreak')}
                </AppText>
              </View>
              <View style={styles.half}>
                <AppText variant="title">{t('stats.days', { count: data.streaks.best })}</AppText>
                <AppText variant="caption" secondary>
                  {t('stats.bestStreak')}
                </AppText>
              </View>
            </View>
            <AppText variant="caption" secondary>
              {t('stats.streakHint')}
            </AppText>
            <Heatmap
              weeks={data.weeks}
              describe={(day) =>
                `${new Date(day.start).toLocaleDateString(i18n.language, {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })} · ${duration(day.ms)}`
              }
            />
          </Section>

          <Section title={t('stats.hours')}>
            <BarChart bars={hourBars(data.hours, t)} summary={t('stats.hoursHint')} height={90} />
          </Section>

          <Section title={t('stats.ranking')}>
            {data.byNovel.map(([novelId, ms], index) => {
              const novel = labels.get(novelId);
              const share = ms / Math.max(1, data.byNovel[0][1]);
              return (
                <Pressable
                  key={novelId}
                  accessibilityRole="button"
                  accessibilityLabel={`${index + 1}. ${novel?.title ?? '?'}, ${duration(ms)}`}
                  onPress={() => navigation.navigate('novelStats', { novelId })}
                  android_ripple={{ color: colors.ripple }}
                  style={styles.rank}
                >
                  <View style={styles.rankCover}>
                    <Cover path={novel?.coverPath ?? null} title={novel?.title ?? '?'} radius={4} />
                  </View>
                  <View style={styles.rankTexts}>
                    <AppText numberOfLines={1}>{novel?.title ?? '?'}</AppText>
                    <View style={[styles.track, { backgroundColor: colors.surfaceVariant }]}>
                      <View
                        style={[
                          styles.trackFill,
                          { width: `${share * 100}%`, backgroundColor: colors.primary },
                        ]}
                      />
                    </View>
                  </View>
                  <AppText variant="label" secondary>
                    {duration(ms)}
                  </AppText>
                </Pressable>
              );
            })}
          </Section>

          <Section title={t('stats.byLanguage')}>
            <ShareRows
              rows={data.byLanguage.map(([lang, ms]) => ({
                key: lang || 'original',
                label:
                  lang === ''
                    ? t('stats.originalLanguage')
                    : t('stats.translatedInto', { language: languageInfo(lang)?.name ?? lang }),
                value: ms,
                text: duration(ms),
              }))}
            />
          </Section>

          <Section title={t('stats.bySource')}>
            <ShareRows
              rows={bySource.map(([pluginId, ms]) => ({
                key: pluginId || 'local',
                label: pluginId === '' ? t('novel.localFile') : pluginId,
                value: ms,
                text: duration(ms),
              }))}
            />
          </Section>
        </ScrollView>
      )}
    </Screen>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <AppText variant="subtitle" accessibilityRole="header">
        {title}
      </AppText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: SPACING.lg, gap: SPACING.xl, paddingBottom: SPACING.xxl },
  card: { padding: SPACING.lg, borderRadius: RADIUS.lg, gap: 2 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  tile: {
    flexBasis: '30%',
    flexGrow: 1,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    gap: 2,
  },
  section: { gap: SPACING.md },
  row: { flexDirection: 'row', gap: SPACING.md },
  half: { flex: 1 },
  rank: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, minHeight: 56 },
  rankCover: { width: 32 },
  rankTexts: { flex: 1, gap: 6 },
  track: { height: 6, borderRadius: RADIUS.pill, overflow: 'hidden' },
  trackFill: { height: 6, borderRadius: RADIUS.pill },
});
