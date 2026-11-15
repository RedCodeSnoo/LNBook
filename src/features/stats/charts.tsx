/** Small charts drawn with plain views: bars, a calendar of days, a split bar. */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '../../theme/components';
import { useTheme } from '../../theme/ThemeProvider';
import { RADIUS, SPACING } from '../../theme/typography';
import type { HeatmapDay } from './statistics';

export interface Bar {
  key: string;
  /** Short text under the bar ('' = none). */
  label: string;
  /** Full description, read by screen readers and shown when the bar is pressed. */
  description: string;
  value: number;
}

/**
 * Vertical bars. Pressing a bar shows its exact value above the chart; without a
 * selection the line shows `summary`.
 */
export function BarChart({
  bars,
  summary,
  height = 140,
}: {
  bars: Bar[];
  summary: string;
  height?: number;
}) {
  const { colors } = useTheme();
  const [selected, setSelected] = useState<string | null>(null);
  const max = Math.max(1, ...bars.map((bar) => bar.value));
  const active = bars.find((bar) => bar.key === selected) ?? null;

  return (
    <View style={styles.chart}>
      <AppText variant="label" secondary accessibilityLiveRegion="polite">
        {active ? active.description : summary}
      </AppText>
      <View style={[styles.bars, { height }]}>
        {bars.map((bar) => (
          <Pressable
            key={bar.key}
            accessibilityRole="button"
            accessibilityLabel={bar.description}
            onPress={() => setSelected(bar.key === selected ? null : bar.key)}
            style={styles.barSlot}
          >
            <View
              style={[
                styles.bar,
                {
                  // An empty day keeps a thin line so that the axis stays readable.
                  height: bar.value > 0 ? Math.max(3, (bar.value / max) * (height - 4)) : 2,
                  backgroundColor:
                    bar.value === 0
                      ? colors.border
                      : bar.key === selected
                        ? colors.text
                        : colors.primary,
                },
              ]}
            />
          </Pressable>
        ))}
      </View>
      <View style={styles.labels}>
        {bars.map((bar) => (
          <AppText
            key={bar.key}
            variant="caption"
            secondary
            center
            numberOfLines={1}
            style={styles.barLabel}
          >
            {bar.label}
          </AppText>
        ))}
      </View>
    </View>
  );
}

/** Calendar of the last weeks: one column per week, darker = more time read. */
export function Heatmap({
  weeks,
  describe,
}: {
  weeks: HeatmapDay[][];
  describe: (day: HeatmapDay) => string;
}) {
  const { colors } = useTheme();
  const [selected, setSelected] = useState<HeatmapDay | null>(null);
  const opacity = [0, 0.25, 0.5, 0.75, 1];

  return (
    <View style={styles.chart}>
      <View style={styles.weeks}>
        {weeks.map((week) => (
          <View key={week[0].start} style={styles.week}>
            {week.map((day) => (
              <Pressable
                key={day.start}
                disabled={day.future}
                accessibilityLabel={day.future ? undefined : describe(day)}
                onPress={() => setSelected(selected?.start === day.start ? null : day)}
                style={[
                  styles.day,
                  { backgroundColor: colors.surfaceVariant },
                  day.future && styles.future,
                  selected?.start === day.start && { borderWidth: 2, borderColor: colors.text },
                ]}
              >
                {day.level > 0 ? (
                  <View
                    style={[
                      styles.dayFill,
                      { backgroundColor: colors.primary, opacity: opacity[day.level] },
                    ]}
                  />
                ) : null}
              </Pressable>
            ))}
          </View>
        ))}
      </View>
      {selected ? (
        <AppText variant="label" secondary accessibilityLiveRegion="polite">
          {describe(selected)}
        </AppText>
      ) : null}
    </View>
  );
}

export interface Share {
  key: string;
  label: string;
  value: number;
  /** Text shown at the right of the row, e.g. "3 h 20 min". */
  text: string;
}

/** Horizontal bars comparing a few values (languages, sources, read and listened). */
export function ShareRows({ rows }: { rows: Share[] }) {
  const { colors } = useTheme();
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <View style={styles.shares}>
      {rows.map((row) => (
        <View key={row.key} accessible accessibilityLabel={`${row.label}, ${row.text}`}>
          <View style={styles.shareHead}>
            <AppText variant="label" numberOfLines={1} style={styles.shareLabel}>
              {row.label}
            </AppText>
            <AppText variant="label" secondary>
              {row.text}
            </AppText>
          </View>
          <View style={[styles.track, { backgroundColor: colors.surfaceVariant }]}>
            <View
              style={[
                styles.trackFill,
                { width: `${(row.value / max) * 100}%`, backgroundColor: colors.primary },
              ]}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  chart: { gap: SPACING.sm },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  barSlot: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { borderTopLeftRadius: 3, borderTopRightRadius: 3, minWidth: 2 },
  labels: { flexDirection: 'row', gap: 2 },
  barLabel: { flex: 1, fontSize: 10, lineHeight: 13 },
  weeks: { flexDirection: 'row', gap: 3 },
  week: { flex: 1, gap: 3 },
  day: { aspectRatio: 1, borderRadius: 3, overflow: 'hidden' },
  dayFill: { flex: 1 },
  future: { opacity: 0 },
  shares: { gap: SPACING.md },
  shareHead: { flexDirection: 'row', justifyContent: 'space-between', gap: SPACING.sm },
  shareLabel: { flex: 1 },
  track: { height: 8, borderRadius: RADIUS.pill, overflow: 'hidden', marginTop: 4 },
  trackFill: { height: 8, borderRadius: RADIUS.pill },
});
