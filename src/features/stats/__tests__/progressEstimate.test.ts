import { history } from '../../../db/schema';
import { createTestDatabase } from '../../../db/testing';
import { epub3WithVolumes } from '../../../epub/__tests__/fixtures';
import { parseEpub } from '../../../epub/parseEpub';
import { MemoryFileStore } from '../../../services/fileStore';
import { importParsedBook } from '../../library/importBook';
import { getNovel, listChapters } from '../../novel/novelRepository';
import {
  averageWordsPerChapter,
  clampSpeed,
  DEFAULT_SPEED_WPM,
  DEFAULT_WORDS_PER_CHAPTER,
  estimateProgress,
  formatWordCount,
  readingTimeMs,
} from '../progressEstimate';
import {
  applyProgress,
  chaptersToEstimate,
  deleteEstimatedTime,
  listProgressChapters,
  loadChaptersWithRealTime,
  loadChapterWords,
  loadEstimatedTimes,
  readProgressInputs,
} from '../progressRepository';
import { saveSession } from '../sessionsRepository';
import {
  addDays,
  chartBars,
  dayStart,
  novelTimes,
  overview,
  readingSpeed,
  totals,
  type SessionRow,
} from '../statistics';
import { loadSessions } from '../statsRepository';

const MIN = 60_000;
const NOW = new Date(2026, 10, 11, 21, 0, 0).getTime();

describe('estimate of the reading time', () => {
  it('turns words into time at the chosen speed', () => {
    expect(readingTimeMs(2500, 250)).toBe(10 * MIN);
    expect(readingTimeMs(0, 250)).toBe(0);
    expect(readingTimeMs(1000, 0)).toBe(0);
    expect(clampSpeed(5)).toBe(30);
    expect(clampSpeed(99999)).toBe(2000);
    expect(clampSpeed(Number.NaN)).toBe(DEFAULT_SPEED_WPM);
  });

  it('uses the exact words when known, the estimate otherwise, and keeps real time', () => {
    const result = estimateProgress(
      [
        { id: 1, words: 3000, hasRealTime: false },
        { id: 2, words: null, hasRealTime: false },
        { id: 3, words: 0, hasRealTime: false },
        { id: 4, words: 1000, hasRealTime: true },
      ],
      250,
      2000,
    );
    expect(result.chapters).toBe(4);
    expect(result.words).toBe(3000 + 2000 + 2000 + 1000);
    expect(result.usingAverage).toBe(2);
    expect(result.keptReal).toBe(1);
    expect(result.entries).toEqual([
      { chapterId: 1, words: 3000, ms: 12 * MIN },
      { chapterId: 2, words: 2000, ms: 8 * MIN },
      { chapterId: 3, words: 2000, ms: 8 * MIN },
    ]);
    expect(result.estimatedMs).toBe(28 * MIN);
  });

  it('pre-fills the words per chapter with the novel average, else 2,500', () => {
    expect(averageWordsPerChapter([1000, null, 3000, 0])).toBe(2000);
    expect(averageWordsPerChapter([null, null])).toBe(DEFAULT_WORDS_PER_CHAPTER);
    expect(averageWordsPerChapter([])).toBe(2500);
  });

  it('writes large numbers of words briefly', () => {
    expect(formatWordCount(1_230_000, 'fr')).toBe('1,2 M');
    expect(formatWordCount(1_230_000, 'en')).toBe('1.2 M');
    expect(formatWordCount(45_400, 'fr')).toBe('45 k');
    expect(formatWordCount(980, 'fr')).toBe('980');
  });
});

describe('estimated time in the statistics', () => {
  const at = (daysAgo: number, hour = 20) => {
    const date = new Date(addDays(NOW, -daysAgo));
    date.setHours(hour, 0, 0, 0);
    return date.getTime();
  };
  const real = (partial: Partial<SessionRow>): SessionRow => ({
    novelId: 1,
    chapterId: 1,
    startedAt: at(0),
    durationMs: 10 * MIN,
    mode: 'read',
    words: 2000,
    lang: null,
    ...partial,
  });
  const estimated = (partial: Partial<SessionRow>): SessionRow =>
    real({ startedAt: 0, mode: 'estimated', durationMs: 60 * MIN, words: 30000, ...partial });

  const rows: SessionRow[] = [
    real({ startedAt: at(0), durationMs: 10 * MIN }),
    real({ startedAt: at(1), durationMs: 6 * MIN, chapterId: 2 }),
    estimated({ chapterId: 3, lang: 'fr' }),
    estimated({ chapterId: 4, novelId: 2, durationMs: 120 * MIN }),
  ];

  it('stays out of days, streaks, calendar, hours and speed', () => {
    const view = overview(rows, NOW);
    const withoutEstimate = overview(
      rows.filter((row) => row.mode !== 'estimated'),
      NOW,
    );
    expect(view.todayMs).toBe(10 * MIN);
    expect(view.streaks).toEqual(withoutEstimate.streaks);
    expect([...view.days.values()].reduce((a, b) => a + b, 0)).toBe(16 * MIN);
    expect(view.weeks).toEqual(withoutEstimate.weeks);
    expect(view.hours).toEqual(withoutEstimate.hours);
    expect(view.hours.reduce((a, b) => a + b, 0)).toBe(16 * MIN);
    expect(view.speed).toBe(250);
    expect(readingSpeed(rows)).toBe(250);
    // The day of the epoch never gets a bar or a calendar cell.
    expect(view.days.has(dayStart(0))).toBe(false);
    for (const period of ['7d', '30d', '12m', 'all'] as const) {
      expect(chartBars(rows, period, NOW)).toEqual(
        chartBars(
          rows.filter((row) => row.mode !== 'estimated'),
          period,
          NOW,
        ),
      );
    }
  });

  it('counts in the total, the ranking, the languages and each novel', () => {
    const view = overview(rows, NOW);
    expect(view.totals.totalMs).toBe(196 * MIN);
    expect(view.totals.estimatedMs).toBe(180 * MIN);
    expect(view.totals.readMs).toBe(16 * MIN);
    expect(view.totals.sessions).toBe(2);
    expect(view.byNovel).toEqual([
      [2, 120 * MIN],
      [1, 76 * MIN],
    ]);
    expect(view.byLanguage).toEqual([
      ['', 136 * MIN],
      ['fr', 60 * MIN],
    ]);
    const novel = novelTimes(
      rows.filter((row) => row.novelId === 1),
      { total: 10, read: 3 },
    );
    expect(novel.totalMs).toBe(76 * MIN);
    expect(novel.chaptersWithTime).toBe(3);
    // Days come from real sessions only.
    expect(novel.firstDay).toBe(dayStart(at(1)));
    expect(totals(rows).words).toBe(2000 + 2000 + 30000 + 30000);
  });
});

describe('set my progress', () => {
  function setup() {
    const { db } = createTestDatabase();
    const files = new MemoryFileStore();
    const novelId = importParsedBook(db, files, parseEpub(epub3WithVolumes()));
    return { db, files, novelId, list: listChapters(db, novelId) };
  }

  it('marks the chapters, adds estimated time only where there is none, and replaces it', () => {
    const { db, files, novelId, list } = setup();
    // Real time on the first chapter: it is kept.
    saveSession(db, {
      novelId,
      chapterId: list[0].id,
      startedAt: NOW,
      endedAt: NOW + 5 * MIN,
      durationMs: 5 * MIN,
      mode: 'read',
      words: 100,
      lang: null,
    });
    const historyBefore = db.select().from(history).all().length;
    const chapters = listProgressChapters(db, novelId);
    const target = chapters[2];
    const words = loadChapterWords(db, files, novelId, null);
    const input = chaptersToEstimate(
      chapters,
      target.id,
      words,
      loadChaptersWithRealTime(db, novelId),
    );
    expect(input.map((chapter) => chapter.id)).toEqual(chapters.slice(0, 3).map((c) => c.id));
    const estimate = estimateProgress(input, 250, 2500);
    expect(estimate.keptReal).toBe(1);
    applyProgress(db, {
      novelId,
      lastChapterId: target.id,
      entries: estimate.entries,
      inputs: { lastChapterId: target.id, speedWpm: 250, wordsPerChapter: 2500, lang: 'fr' },
      now: NOW,
    });

    const after = listChapters(db, novelId);
    expect(after.map((chapter) => chapter.isRead)).toEqual(after.map((_, index) => index <= 2));
    expect(getNovel(db, novelId)?.lastReadChapterId).toBe(target.id);
    expect(after[0].readMs).toBe(5 * MIN);
    const estimated = loadEstimatedTimes(db, novelId);
    expect(estimated.chapterIds).toEqual(new Set([after[1].id, after[2].id]));
    expect(estimated.totalMs).toBe(estimate.estimatedMs);
    expect(getNovel(db, novelId)?.totalReadMs).toBe(5 * MIN + estimate.estimatedMs);
    // Nothing in the history, no reading date.
    expect(db.select().from(history).all()).toHaveLength(historyBefore);
    const stored = loadSessions(db, novelId).filter((row) => row.mode === 'estimated');
    expect(stored.every((row) => row.startedAt === 0 && row.lang === 'fr')).toBe(true);
    expect(readProgressInputs(db, novelId)).toEqual({
      lastChapterId: target.id,
      speedWpm: 250,
      wordsPerChapter: 2500,
      lang: 'fr',
    });

    // Setting it again replaces the previous estimate (here: only the second chapter).
    const again = estimateProgress(
      chaptersToEstimate(chapters, chapters[1].id, words, loadChaptersWithRealTime(db, novelId)),
      500,
      2500,
    );
    applyProgress(db, {
      novelId,
      lastChapterId: chapters[1].id,
      entries: again.entries,
      inputs: { lastChapterId: chapters[1].id, speedWpm: 500, wordsPerChapter: 2500, lang: null },
    });
    expect(loadEstimatedTimes(db, novelId).chapterIds).toEqual(new Set([chapters[1].id]));
    expect(listChapters(db, novelId)[2].isRead).toBe(false);
    expect(listChapters(db, novelId)[2].readMs).toBe(0);

    // Reading a chapter for real replaces its estimate.
    saveSession(db, {
      novelId,
      chapterId: chapters[1].id,
      startedAt: NOW,
      endedAt: NOW + MIN,
      durationMs: MIN,
      mode: 'read',
      words: 50,
      lang: null,
    });
    expect(loadEstimatedTimes(db, novelId).totalMs).toBe(0);
    expect(listChapters(db, novelId)[1].readMs).toBe(MIN);
  });

  it('deletes the estimated time and keeps the chapters read', () => {
    const { db, files, novelId } = setup();
    const chapters = listProgressChapters(db, novelId);
    const last = chapters[chapters.length - 1];
    const estimate = estimateProgress(
      chaptersToEstimate(chapters, last.id, loadChapterWords(db, files, novelId, null), new Set()),
      250,
      2500,
    );
    applyProgress(db, {
      novelId,
      lastChapterId: last.id,
      entries: estimate.entries,
      inputs: { lastChapterId: last.id, speedWpm: 250, wordsPerChapter: 2500, lang: null },
    });
    expect(getNovel(db, novelId)?.totalReadMs).toBeGreaterThan(0);
    deleteEstimatedTime(db, novelId);
    expect(getNovel(db, novelId)?.totalReadMs).toBe(0);
    expect(
      listChapters(db, novelId).every((chapter) => chapter.isRead && chapter.readMs === 0),
    ).toBe(true);
  });

  it('counts the words of the translated text in the chosen language', () => {
    const { db, files, novelId, list } = setup();
    const original = loadChapterWords(db, files, novelId, null);
    expect(original.get(list[0].id)).toBe(list[0].wordCount ?? null);
    expect(loadChapterWords(db, files, novelId, 'fr').get(list[0].id)).toBe(
      original.get(list[0].id),
    );
  });
});
