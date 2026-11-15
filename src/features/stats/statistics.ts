/**
 * Statistics computed from the reading sessions only (never from stored totals), so the
 * three levels — chapter, novel, everything — always agree with each other.
 */
import type { SessionMode } from '../../db/schema';

export interface SessionRow {
  novelId: number;
  chapterId: number | null;
  startedAt: number;
  durationMs: number;
  mode: SessionMode;
  words: number;
  /** Language displayed (null = original). */
  lang: string | null;
}

/** A day counts in a streak from five minutes of reading. */
export const STREAK_MIN_MS = 5 * 60 * 1000;
/** Shorter sessions say nothing about the reading speed. */
const SPEED_MIN_MS = 60 * 1000;

/** Time given by "Set my progress": no date, never read for real. */
export function isEstimated(row: Pick<SessionRow, 'mode'>): boolean {
  return row.mode === 'estimated';
}

/** Sessions really read or listened to (what days, hours and speed are made of). */
export function realSessions(rows: SessionRow[]): SessionRow[] {
  return rows.every((row) => !isEstimated(row)) ? rows : rows.filter((row) => !isEstimated(row));
}

export function dayStart(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Start of the day `offset` days after the day of `timestamp` (daylight saving safe). */
export function addDays(timestamp: number, offset: number): number {
  const date = new Date(dayStart(timestamp));
  date.setDate(date.getDate() + offset);
  return date.getTime();
}

function monthStart(timestamp: number, offset = 0): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth() + offset, 1).getTime();
}

export interface Totals {
  /** Everything, estimated time included. */
  totalMs: number;
  readMs: number;
  listenMs: number;
  /** Part of `totalMs` given by "Set my progress". */
  estimatedMs: number;
  words: number;
  /** Real sessions only. */
  sessions: number;
}

export function totals(rows: SessionRow[]): Totals {
  const result: Totals = {
    totalMs: 0,
    readMs: 0,
    listenMs: 0,
    estimatedMs: 0,
    words: 0,
    sessions: 0,
  };
  for (const row of rows) {
    result.totalMs += row.durationMs;
    if (row.mode === 'estimated') {
      result.estimatedMs += row.durationMs;
    } else {
      result.sessions += 1;
      if (row.mode === 'listen') {
        result.listenMs += row.durationMs;
      } else {
        result.readMs += row.durationMs;
      }
    }
    result.words += row.words;
  }
  return result;
}

/** Time per day (start of the local day → milliseconds); estimated time has no day. */
export function dailyTotals(rows: SessionRow[]): Map<number, number> {
  const days = new Map<number, number>();
  for (const row of realSessions(rows)) {
    const day = dayStart(row.startedAt);
    days.set(day, (days.get(day) ?? 0) + row.durationMs);
  }
  return days;
}

export type ChartPeriod = '7d' | '30d' | '12m' | 'all';

export interface ChartBar {
  /** Start of the day, month or year of the bar. */
  start: number;
  unit: 'day' | 'month' | 'year';
  ms: number;
}

/** Bars of the "time per day" chart for a period ending today. */
export function chartBars(allRows: SessionRow[], period: ChartPeriod, now: number): ChartBar[] {
  const rows = realSessions(allRows);
  if (period === '7d' || period === '30d') {
    const days = dailyTotals(rows);
    const count = period === '7d' ? 7 : 30;
    return Array.from({ length: count }, (_, index) => {
      const start = addDays(now, index - count + 1);
      return { start, unit: 'day' as const, ms: days.get(start) ?? 0 };
    });
  }
  const months = new Map<number, number>();
  let first = now;
  for (const row of rows) {
    const month = monthStart(row.startedAt);
    months.set(month, (months.get(month) ?? 0) + row.durationMs);
    first = Math.min(first, row.startedAt);
  }
  if (period === '12m') {
    return Array.from({ length: 12 }, (_, index) => {
      const start = monthStart(now, index - 11);
      return { start, unit: 'month' as const, ms: months.get(start) ?? 0 };
    });
  }
  // Everything: by month, or by year when that would be more than two years of bars.
  const firstDate = new Date(first);
  const nowDate = new Date(now);
  const span =
    (nowDate.getFullYear() - firstDate.getFullYear()) * 12 +
    nowDate.getMonth() -
    firstDate.getMonth() +
    1;
  if (span <= 24) {
    return Array.from({ length: Math.max(1, span) }, (_, index) => {
      const start = monthStart(first, index);
      return { start, unit: 'month' as const, ms: months.get(start) ?? 0 };
    });
  }
  const years = new Map<number, number>();
  for (const [month, ms] of months) {
    const year = new Date(month).getFullYear();
    years.set(year, (years.get(year) ?? 0) + ms);
  }
  const bars: ChartBar[] = [];
  for (let year = firstDate.getFullYear(); year <= nowDate.getFullYear(); year += 1) {
    bars.push({ start: new Date(year, 0, 1).getTime(), unit: 'year', ms: years.get(year) ?? 0 });
  }
  return bars;
}

export interface Streaks {
  /** Consecutive days read up to today (or yesterday when today has no reading yet). */
  current: number;
  best: number;
}

export function streaks(days: Map<number, number>, now: number): Streaks {
  const read = [...days.entries()]
    .filter(([, ms]) => ms >= STREAK_MIN_MS)
    .map(([day]) => day)
    .sort((a, b) => a - b);
  const set = new Set(read);
  let best = 0;
  let run = 0;
  let previous: number | null = null;
  for (const day of read) {
    run = previous !== null && addDays(previous, 1) === day ? run + 1 : 1;
    best = Math.max(best, run);
    previous = day;
  }
  let cursor = dayStart(now);
  if (!set.has(cursor)) {
    cursor = addDays(cursor, -1);
  }
  let current = 0;
  while (set.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }
  return { current, best };
}

export interface HeatmapDay {
  start: number;
  ms: number;
  /** 0 (nothing) to 4 (an hour or more). */
  level: 0 | 1 | 2 | 3 | 4;
  /** Days after today, drawn empty to complete the last week. */
  future: boolean;
}

function heatLevel(ms: number): HeatmapDay['level'] {
  if (ms <= 0) {
    return 0;
  }
  if (ms < STREAK_MIN_MS) {
    return 1;
  }
  if (ms < 20 * 60 * 1000) {
    return 2;
  }
  return ms < 60 * 60 * 1000 ? 3 : 4;
}

/** Calendar of the last weeks, one array of seven days (Monday first) per week. */
export function heatmap(days: Map<number, number>, now: number, weeks = 18): HeatmapDay[][] {
  const today = dayStart(now);
  // Monday of the current week.
  const weekday = (new Date(today).getDay() + 6) % 7;
  const firstDay = addDays(today, -weekday - (weeks - 1) * 7);
  return Array.from({ length: weeks }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => {
      const start = addDays(firstDay, week * 7 + day);
      const ms = days.get(start) ?? 0;
      return { start, ms, level: heatLevel(ms), future: start > today };
    }),
  );
}

/** Average reading speed in words per minute, or null when nothing can be measured. */
export function readingSpeed(rows: SessionRow[]): number | null {
  let words = 0;
  let ms = 0;
  for (const row of rows) {
    if (row.mode === 'read' && row.durationMs >= SPEED_MIN_MS && row.words > 0) {
      words += row.words;
      ms += row.durationMs;
    }
  }
  return ms > 0 ? Math.round(words / (ms / 60000)) : null;
}

/** Time per hour of the day (24 values), each session being spread over the hours it covers. */
export function hourlyTotals(rows: SessionRow[]): number[] {
  const hours = new Array<number>(24).fill(0);
  for (const row of realSessions(rows)) {
    let cursor = row.startedAt;
    let left = row.durationMs;
    // Pauses are not known here: the active time is laid out from the start of the session.
    while (left > 0) {
      const date = new Date(cursor);
      const nextHour = new Date(cursor);
      nextHour.setMinutes(60, 0, 0);
      const slice = Math.min(left, nextHour.getTime() - cursor);
      hours[date.getHours()] += slice;
      left -= slice;
      cursor = nextHour.getTime();
    }
  }
  return hours;
}

/** Time per key, largest first. */
export function totalsBy<K>(rows: SessionRow[], key: (row: SessionRow) => K): [K, number][] {
  const map = new Map<K, number>();
  for (const row of rows) {
    const k = key(row);
    map.set(k, (map.get(k) ?? 0) + row.durationMs);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

export interface NovelTimes extends Totals {
  firstDay: number | null;
  lastDay: number | null;
  /** Chapters with time spent on them. */
  chaptersWithTime: number;
  /** Average time per chapter read; null when no chapter is read. */
  averagePerChapterMs: number | null;
  /** Average × chapters left; null when it cannot be estimated. */
  remainingMs: number | null;
}

export function novelTimes(
  rows: SessionRow[],
  chapterCounts: { total: number; read: number },
): NovelTimes {
  const base = totals(rows);
  let first: number | null = null;
  let last: number | null = null;
  const chapters = new Set<number>();
  for (const row of rows) {
    // Estimated time has no reading date.
    if (!isEstimated(row)) {
      first = first === null ? row.startedAt : Math.min(first, row.startedAt);
      last = last === null ? row.startedAt : Math.max(last, row.startedAt);
    }
    if (row.chapterId !== null) {
      chapters.add(row.chapterId);
    }
  }
  // Chapters marked as read without being opened took no time: the average uses the
  // chapters that were really read or listened to.
  const measured = chapters.size;
  const average = measured > 0 ? base.totalMs / measured : null;
  const left = Math.max(0, chapterCounts.total - chapterCounts.read);
  return {
    ...base,
    firstDay: first === null ? null : dayStart(first),
    lastDay: last === null ? null : dayStart(last),
    chaptersWithTime: chapters.size,
    averagePerChapterMs: average === null ? null : Math.round(average),
    remainingMs: average === null ? null : Math.round(average * left),
  };
}

export interface Overview {
  totals: Totals;
  days: Map<number, number>;
  todayMs: number;
  streaks: Streaks;
  weeks: HeatmapDay[][];
  speed: number | null;
  hours: number[];
  byNovel: [number, number][];
  /** '' = original language. */
  byLanguage: [string, number][];
}

/**
 * Everything the statistics screen shows. Estimated time ("Set my progress") counts in the
 * totals, the ranking, the time per novel and per language, never in what depends on a
 * real day or hour: streaks, today, time per day, calendar, favourite hours and speed.
 */
export function overview(rows: SessionRow[], now: number): Overview {
  const days = dailyTotals(rows);
  return {
    totals: totals(rows),
    days,
    todayMs: days.get(dayStart(now)) ?? 0,
    streaks: streaks(days, now),
    weeks: heatmap(days, now),
    speed: readingSpeed(rows),
    hours: hourlyTotals(rows),
    byNovel: totalsBy(rows, (row) => row.novelId),
    byLanguage: totalsBy(rows, (row) => row.lang ?? ''),
  };
}
