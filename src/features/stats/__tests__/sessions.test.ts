import { createTestDatabase } from '../../../db/testing';
import { history, readingSessions } from '../../../db/schema';
import { epub3WithVolumes } from '../../../epub/__tests__/fixtures';
import { parseEpub } from '../../../epub/parseEpub';
import { MemoryFileStore } from '../../../services/fileStore';
import {
  groupHistoryByDay,
  hideAllHistory,
  hideNovelHistory,
  listHistory,
  setHistoryEntryHidden,
} from '../../history/historyRepository';
import { importParsedBook } from '../../library/importBook';
import { getChapter, getNovel, listChapters, setChaptersRead } from '../../novel/novelRepository';
import { IDLE_LIMIT_MS, ReadingTimer } from '../readingTimer';
import { resetNovelProgress, saveSession } from '../sessionsRepository';

const MINUTE = 60_000;

function setup() {
  const { db } = createTestDatabase();
  const novelId = importParsedBook(db, new MemoryFileStore(), parseEpub(epub3WithVolumes()));
  return { db, novelId, list: listChapters(db, novelId) };
}

const session = (novelId: number, chapterId: number, startedAt: number, durationMs: number) => ({
  novelId,
  chapterId,
  startedAt,
  endedAt: startedAt + durationMs,
  durationMs,
  mode: 'read' as const,
  words: 100,
  lang: null,
});

describe('ReadingTimer', () => {
  it('counts the time between interactions', () => {
    const timer = new ReadingTimer(0);
    timer.activity(MINUTE);
    timer.activity(2 * MINUTE);
    expect(timer.elapsed(2 * MINUTE + 30_000)).toBe(2 * MINUTE + 30_000);
  });

  it('pauses after 3 minutes without interaction', () => {
    const timer = new ReadingTimer(0);
    expect(timer.elapsed(10 * MINUTE)).toBe(IDLE_LIMIT_MS);
    expect(timer.endedAt(10 * MINUTE)).toBe(IDLE_LIMIT_MS);
    // Coming back starts counting again, the silent time is lost.
    timer.activity(10 * MINUTE);
    timer.activity(11 * MINUTE);
    expect(timer.elapsed(11 * MINUTE)).toBe(IDLE_LIMIT_MS + MINUTE);
  });

  it('does not count the time spent in the background', () => {
    const timer = new ReadingTimer(0);
    timer.activity(MINUTE);
    timer.pause(MINUTE + 10_000);
    expect(timer.elapsed(30 * MINUTE)).toBe(MINUTE + 10_000);
    expect(timer.endedAt(30 * MINUTE)).toBe(MINUTE + 10_000);
    timer.activity(30 * MINUTE);
    expect(timer.elapsed(30 * MINUTE + 5000)).toBe(MINUTE + 15_000);
  });
});

describe('reading sessions', () => {
  it('recomputes chapter and novel times from the sessions', () => {
    const { db, novelId, list } = setup();
    saveSession(db, session(novelId, list[0].id, 1000, 5 * MINUTE));
    saveSession(db, session(novelId, list[0].id, 900_000, 2 * MINUTE));
    saveSession(db, session(novelId, list[1].id, 2_000_000, 10 * MINUTE));
    expect(getChapter(db, list[0].id)?.readMs).toBe(7 * MINUTE);
    expect(getChapter(db, list[1].id)?.readMs).toBe(10 * MINUTE);
    expect(getNovel(db, novelId)?.totalReadMs).toBe(17 * MINUTE);
  });

  it('updates a running session without counting it twice', () => {
    const { db, novelId, list } = setup();
    const id = saveSession(db, session(novelId, list[0].id, 1000, MINUTE));
    expect(saveSession(db, session(novelId, list[0].id, 1000, 4 * MINUTE), id)).toBe(id);
    expect(db.select().from(readingSessions).all()).toHaveLength(1);
    expect(getChapter(db, list[0].id)?.readMs).toBe(4 * MINUTE);
    expect(getNovel(db, novelId)?.totalReadMs).toBe(4 * MINUTE);
  });

  it('keeps one history entry per chapter with the time spent on it', () => {
    const { db, novelId, list } = setup();
    saveSession(db, session(novelId, list[0].id, 1000, 5 * MINUTE));
    saveSession(db, session(novelId, list[1].id, 500_000, MINUTE));
    saveSession(db, session(novelId, list[0].id, 900_000, 2 * MINUTE));
    const rows = listHistory(db);
    expect(rows.map((row) => row.chapterId)).toEqual([list[0].id, list[1].id]);
    expect(rows[0].totalMs).toBe(7 * MINUTE);
    expect(rows[0].lastReadAt).toBe(900_000 + 2 * MINUTE);
    expect(rows[0].novelTitle).toBe(getNovel(db, novelId)?.title);
  });
});

describe('history', () => {
  it('hides entries without touching progress or times', () => {
    const { db, novelId, list } = setup();
    saveSession(db, session(novelId, list[0].id, 1000, 5 * MINUTE));
    setChaptersRead(db, [list[0].id], true);
    const [entry] = listHistory(db);
    setHistoryEntryHidden(db, entry.id, true);
    expect(listHistory(db)).toHaveLength(0);
    expect(getChapter(db, list[0].id)?.readMs).toBe(5 * MINUTE);
    expect(getChapter(db, list[0].id)?.isRead).toBe(true);
    expect(getNovel(db, novelId)?.totalReadMs).toBe(5 * MINUTE);
    expect(db.select().from(readingSessions).all()).toHaveLength(1);

    // Undo.
    setHistoryEntryHidden(db, entry.id, false);
    expect(listHistory(db)).toHaveLength(1);
  });

  it('shows a hidden chapter again once it is read again', () => {
    const { db, novelId, list } = setup();
    saveSession(db, session(novelId, list[0].id, 1000, MINUTE));
    hideAllHistory(db);
    expect(listHistory(db)).toHaveLength(0);
    saveSession(db, session(novelId, list[0].id, 800_000, MINUTE));
    expect(listHistory(db)).toHaveLength(1);
    expect(listHistory(db)[0].totalMs).toBe(2 * MINUTE);
  });

  it('hides the history of one novel and searches by novel title', () => {
    const { db, novelId, list } = setup();
    saveSession(db, session(novelId, list[0].id, 1000, MINUTE));
    const title = getNovel(db, novelId)?.title ?? '';
    expect(listHistory(db, title.slice(0, 4).toUpperCase())).toHaveLength(1);
    expect(listHistory(db, 'zzzz')).toHaveLength(0);
    hideNovelHistory(db, novelId);
    expect(listHistory(db)).toHaveLength(0);
  });

  it('groups entries by day', () => {
    const { db, novelId, list } = setup();
    const day = 24 * 60 * MINUTE;
    const base = new Date(2026, 10, 9, 12).getTime();
    saveSession(db, session(novelId, list[0].id, base, MINUTE));
    saveSession(db, session(novelId, list[1].id, base + 2 * MINUTE, MINUTE));
    saveSession(db, session(novelId, list[2].id, base + day, MINUTE));
    expect(groupHistoryByDay(listHistory(db)).map((item) => item.type)).toEqual([
      'day',
      'entry',
      'day',
      'entry',
      'entry',
    ]);
  });
});

describe('progress reset', () => {
  it('keeps the times in the statistics by default', () => {
    const { db, novelId, list } = setup();
    saveSession(db, session(novelId, list[0].id, 1000, 5 * MINUTE));
    setChaptersRead(db, [list[0].id, list[1].id], true);
    resetNovelProgress(db, novelId, true);
    expect(listChapters(db, novelId).every((chapter) => !chapter.isRead)).toBe(true);
    expect(getChapter(db, list[0].id)?.progress).toBe(0);
    expect(getNovel(db, novelId)?.lastReadChapterId).toBeNull();
    expect(getNovel(db, novelId)?.totalReadMs).toBe(5 * MINUTE);
    expect(db.select().from(readingSessions).all()).toHaveLength(1);
  });

  it('forgets the times when asked', () => {
    const { db, novelId, list } = setup();
    saveSession(db, session(novelId, list[0].id, 1000, 5 * MINUTE));
    resetNovelProgress(db, novelId, false);
    expect(getNovel(db, novelId)?.totalReadMs).toBe(0);
    expect(getChapter(db, list[0].id)?.readMs).toBe(0);
    expect(db.select().from(readingSessions).all()).toHaveLength(0);
    expect(db.select().from(history).all()).toHaveLength(0);
  });
});
