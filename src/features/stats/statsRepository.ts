/** Reads what the statistics screens need from the database. */
import { and, asc, eq, gt, sql } from 'drizzle-orm';

import type { AppDatabase } from '../../db/client';
import { chapters, novels, quotes, readingSessions } from '../../db/schema';
import type { SessionRow } from './statistics';

/** Every reading session (of one novel when given), oldest first. */
export function loadSessions(db: AppDatabase, novelId?: number): SessionRow[] {
  return db
    .select({
      novelId: readingSessions.novelId,
      chapterId: readingSessions.chapterId,
      startedAt: readingSessions.startedAt,
      durationMs: readingSessions.durationMs,
      mode: readingSessions.mode,
      words: readingSessions.words,
      lang: readingSessions.lang,
    })
    .from(readingSessions)
    .where(novelId === undefined ? undefined : eq(readingSessions.novelId, novelId))
    .orderBy(asc(readingSessions.startedAt))
    .all();
}

export interface LibraryCounts {
  chaptersRead: number;
  /** Novels with at least one chapter read or started. */
  novelsStarted: number;
  /** Novels whose every chapter is read. */
  novelsFinished: number;
  quotes: number;
}

export function loadCounts(db: AppDatabase): LibraryCounts {
  const perNovel = db
    .select({
      total: sql<number>`count(*)`,
      read: sql<number>`coalesce(sum(${chapters.isRead}), 0)`,
      started: sql<number>`coalesce(sum(${chapters.isRead} or ${chapters.progress} > 0), 0)`,
    })
    .from(chapters)
    .groupBy(chapters.novelId)
    .all();
  const quoteCount = db
    .select({ count: sql<number>`count(*)` })
    .from(quotes)
    .get();
  return {
    chaptersRead: perNovel.reduce((sum, row) => sum + row.read, 0),
    novelsStarted: perNovel.filter((row) => row.started > 0).length,
    novelsFinished: perNovel.filter((row) => row.total > 0 && row.read === row.total).length,
    quotes: quoteCount?.count ?? 0,
  };
}

export interface NovelLabel {
  id: number;
  title: string;
  coverPath: string | null;
  /** Plugin of the source, or null for an imported file. */
  pluginId: string | null;
}

/** Title, cover and source of every novel, by id. */
export function loadNovelLabels(db: AppDatabase): Map<number, NovelLabel> {
  return new Map(
    db
      .select({
        id: novels.id,
        title: novels.title,
        coverPath: novels.coverPath,
        pluginId: novels.pluginId,
      })
      .from(novels)
      .all()
      .map((row) => [row.id, row]),
  );
}

export interface ChapterTime {
  id: number;
  title: string;
  number: number | null;
  position: number;
  readMs: number;
}

/** Chapters of a novel with time spent on them, in the order of the book. */
export function loadChapterTimes(db: AppDatabase, novelId: number): ChapterTime[] {
  return db
    .select({
      id: chapters.id,
      title: chapters.title,
      number: chapters.number,
      position: chapters.position,
      readMs: chapters.readMs,
    })
    .from(chapters)
    .where(and(eq(chapters.novelId, novelId), gt(chapters.readMs, 0)))
    .orderBy(asc(chapters.position), asc(chapters.id))
    .all();
}

export function loadChapterCounts(
  db: AppDatabase,
  novelId: number,
): { total: number; read: number } {
  const row = db
    .select({
      total: sql<number>`count(*)`,
      read: sql<number>`coalesce(sum(${chapters.isRead}), 0)`,
    })
    .from(chapters)
    .where(eq(chapters.novelId, novelId))
    .get();
  return { total: row?.total ?? 0, read: row?.read ?? 0 };
}
