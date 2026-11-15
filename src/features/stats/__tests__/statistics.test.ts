import { createTestDatabase } from '../../../db/testing';
import { epub3WithVolumes } from '../../../epub/__tests__/fixtures';
import { parseEpub } from '../../../epub/parseEpub';
import { MemoryFileStore } from '../../../services/fileStore';
import { importParsedBook } from '../../library/importBook';
import { listChapters, setChaptersRead } from '../../novel/novelRepository';
import { saveSession } from '../sessionsRepository';
import {
  addDays,
  chartBars,
  dailyTotals,
  dayStart,
  heatmap,
  hourlyTotals,
  novelTimes,
  readingSpeed,
  streaks,
  totals,
  totalsBy,
  type SessionRow,
} from '../statistics';
import {
  loadChapterCounts,
  loadChapterTimes,
  loadCounts,
  loadNovelLabels,
  loadSessions,
} from '../statsRepository';

const MIN = 60_000;
/** Wednesday 11 November 2026, 21:00 local time. */
const NOW = new Date(2026, 10, 11, 21, 0, 0).getTime();
const at = (daysAgo: number, hour = 20, minute = 0) => {
  const date = new Date(addDays(NOW, -daysAgo));
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
};

const row = (partial: Partial<SessionRow> & { startedAt: number }): SessionRow => ({
  novelId: 1,
  chapterId: 1,
  durationMs: 10 * MIN,
  mode: 'read',
  words: 2000,
  lang: null,
  ...partial,
});

describe('statistics', () => {
  const rows: SessionRow[] = [
    row({ startedAt: at(0), durationMs: 30 * MIN, words: 6000 }),
    row({ startedAt: at(1), durationMs: 12 * MIN, words: 2400, chapterId: 2 }),
    row({ startedAt: at(1, 8), durationMs: 20 * MIN, mode: 'listen', words: 3000, chapterId: 2 }),
    row({ startedAt: at(2), durationMs: 4 * MIN, words: 800, chapterId: 3 }),
    row({ startedAt: at(3), durationMs: 6 * MIN, words: 1200, chapterId: 3, lang: 'fr' }),
    row({ startedAt: at(4), durationMs: 50 * MIN, words: 9000, novelId: 2, chapterId: 9 }),
    row({ startedAt: at(40), durationMs: 90 * MIN, words: 15000, novelId: 2, chapterId: 10 }),
    row({ startedAt: at(0, 9), durationMs: 30_000, words: 500 }),
  ];

  it('splits the total time between reading and listening', () => {
    const result = totals(rows);
    expect(result.totalMs).toBe(212 * MIN + 30_000);
    expect(result.listenMs).toBe(20 * MIN);
    expect(result.readMs).toBe(result.totalMs - result.listenMs);
    expect(result.words).toBe(37900);
    expect(totals([]).totalMs).toBe(0);
  });

  it('adds up the time of each day', () => {
    const days = dailyTotals(rows);
    expect(days.get(dayStart(NOW))).toBe(30 * MIN + 30_000);
    expect(days.get(addDays(NOW, -1))).toBe(32 * MIN);
    expect(days.get(addDays(NOW, -5))).toBeUndefined();
  });

  it('builds the bars of each period', () => {
    const week = chartBars(rows, '7d', NOW);
    expect(week).toHaveLength(7);
    expect(week[6]).toMatchObject({ start: dayStart(NOW), unit: 'day', ms: 30 * MIN + 30_000 });
    expect(week[0].ms).toBe(0);
    expect(week.reduce((sum, bar) => sum + bar.ms, 0)).toBe(122 * MIN + 30_000);

    const month = chartBars(rows, '30d', NOW);
    expect(month).toHaveLength(30);
    expect(month.reduce((sum, bar) => sum + bar.ms, 0)).toBe(122 * MIN + 30_000);

    const year = chartBars(rows, '12m', NOW);
    expect(year).toHaveLength(12);
    expect(year[11].ms).toBe(122 * MIN + 30_000);
    expect(year[10].ms).toBe(90 * MIN);
    expect(year.every((bar) => bar.unit === 'month')).toBe(true);

    const all = chartBars(rows, 'all', NOW);
    expect(all).toHaveLength(2);
    expect(all.reduce((sum, bar) => sum + bar.ms, 0)).toBe(totals(rows).totalMs);

    const old = [...rows, row({ startedAt: new Date(2022, 4, 3).getTime(), durationMs: MIN })];
    const years = chartBars(old, 'all', NOW);
    expect(years.map((bar) => new Date(bar.start).getFullYear())).toEqual([
      2022, 2023, 2024, 2025, 2026,
    ]);
    expect(years[0]).toMatchObject({ unit: 'year', ms: MIN });
    expect(chartBars([], 'all', NOW)).toHaveLength(1);
  });

  it('counts streaks of days with at least five minutes', () => {
    const days = dailyTotals(rows);
    // Today and yesterday count; two days ago only has four minutes.
    expect(streaks(days, NOW)).toEqual({ current: 2, best: 2 });
    // Nothing read yet today: the streak of yesterday still stands.
    expect(streaks(days, addDays(NOW, 1) + 3600_000)).toEqual({ current: 2, best: 2 });
    // One more day without reading ends it.
    expect(streaks(days, addDays(NOW, 2) + 3600_000)).toEqual({ current: 0, best: 2 });
    const long = dailyTotals([10, 9, 8, 7, 5, 4].map((daysAgo) => row({ startedAt: at(daysAgo) })));
    expect(streaks(long, NOW)).toEqual({ current: 0, best: 4 });
    expect(streaks(new Map(), NOW)).toEqual({ current: 0, best: 0 });
  });

  it('lays the days out as a calendar of weeks starting on Monday', () => {
    const weeks = heatmap(dailyTotals(rows), NOW, 4);
    expect(weeks).toHaveLength(4);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(new Date(weeks[0][0].start).getDay()).toBe(1);
    const last = weeks[3];
    // 11 November 2026 is a Wednesday: third day of the last week.
    expect(last[2]).toMatchObject({ start: dayStart(NOW), level: 3, future: false });
    expect(last[3].future).toBe(true);
    expect(last[0].level).toBe(1);
    expect(weeks[2][4].level).toBe(0);
  });

  it('measures the reading speed on real reading sessions only', () => {
    // Listening, and the session of thirty seconds, are left out.
    expect(readingSpeed(rows)).toBe(Math.round(34400 / 192));
    expect(readingSpeed([row({ startedAt: NOW, mode: 'listen' })])).toBeNull();
  });

  it('spreads the time over the hours of the day', () => {
    const hours = hourlyTotals([
      row({ startedAt: at(0, 20, 50), durationMs: 30 * MIN }),
      row({ startedAt: at(1, 8), durationMs: 20 * MIN }),
    ]);
    expect(hours[20]).toBe(10 * MIN);
    expect(hours[21]).toBe(20 * MIN);
    expect(hours[8]).toBe(20 * MIN);
    expect(hours.reduce((sum, value) => sum + value, 0)).toBe(50 * MIN);
  });

  it('ranks novels and languages by time', () => {
    expect(totalsBy(rows, (item) => item.novelId)).toEqual([
      [2, 140 * MIN],
      [1, 72 * MIN + 30_000],
    ]);
    const byLanguage = new Map(totalsBy(rows, (item) => item.lang ?? 'original'));
    expect(byLanguage.get('fr')).toBe(6 * MIN);
  });

  it('summarises a novel', () => {
    const mine = rows.filter((item) => item.novelId === 1);
    const result = novelTimes(mine, { total: 10, read: 2 });
    expect(result.totalMs).toBe(72 * MIN + 30_000);
    expect(result.firstDay).toBe(addDays(NOW, -3));
    expect(result.lastDay).toBe(dayStart(NOW));
    expect(result.chaptersWithTime).toBe(3);
    expect(result.averagePerChapterMs).toBe(Math.round((72 * MIN + 30_000) / 3));
    expect(result.remainingMs).toBe(Math.round(((72 * MIN + 30_000) / 3) * 8));
    expect(novelTimes([], { total: 10, read: 0 })).toMatchObject({
      firstDay: null,
      averagePerChapterMs: null,
      remainingMs: null,
    });
  });
});

describe('statistics read from the database', () => {
  it('agrees with the times stored on chapters and novels', () => {
    const { db } = createTestDatabase();
    const novelId = importParsedBook(db, new MemoryFileStore(), parseEpub(epub3WithVolumes()));
    const list = listChapters(db, novelId);
    const save = (
      chapter: number,
      startedAt: number,
      durationMs: number,
      mode: 'read' | 'listen',
    ) =>
      saveSession(db, {
        novelId,
        chapterId: list[chapter].id,
        startedAt,
        endedAt: startedAt + durationMs,
        durationMs,
        mode,
        words: 100,
        lang: null,
      });
    save(0, at(1), 10 * MIN, 'read');
    save(0, at(0), 5 * MIN, 'listen');
    save(1, at(0), 7 * MIN, 'read');
    setChaptersRead(db, [list[0].id], true);

    const sessions = loadSessions(db);
    expect(loadSessions(db, novelId)).toHaveLength(3);
    expect(loadSessions(db, novelId + 1)).toHaveLength(0);
    const result = totals(sessions);
    expect(result.totalMs).toBe(22 * MIN);
    expect(loadNovelLabels(db).get(novelId)?.title).toBeTruthy();

    // The three levels agree: chapters, novel, everything.
    const times = loadChapterTimes(db, novelId);
    expect(times.map((chapter) => chapter.readMs)).toEqual([15 * MIN, 7 * MIN]);
    expect(times.reduce((sum, chapter) => sum + chapter.readMs, 0)).toBe(result.totalMs);

    expect(loadChapterCounts(db, novelId)).toEqual({ total: list.length, read: 1 });
    expect(loadCounts(db)).toEqual({
      chaptersRead: 1,
      novelsStarted: 1,
      novelsFinished: 0,
      quotes: 0,
    });
    setChaptersRead(
      db,
      list.map((chapter) => chapter.id),
      true,
    );
    expect(loadCounts(db).novelsFinished).toBe(1);
  });
});
