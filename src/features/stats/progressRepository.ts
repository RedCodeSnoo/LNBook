/**
 * "Set my progress" in the database: chapters marked as read up to a chapter, and an
 * estimated session (mode 'estimated', no reading date) for each one without real time.
 * Nothing goes to the history.
 */
import { and, asc, eq, gt, lte, ne, sql } from 'drizzle-orm';

import type { AppDatabase } from '../../db/client';
import { chapters, novels, readingSessions } from '../../db/schema';
import type { FileStore } from '../../services/fileStore';
import { countWords, htmlToText } from '../../services/html';
import { readValue, writeValue } from '../settings/settingsRepository';
import { listTranslationFiles } from '../translation/translationRepository';
import type { EstimateChapter, EstimateEntry, ProgressInputs } from './progressEstimate';

const inputsKey = (novelId: number) => `progressEstimate:${novelId}`;

export function readProgressInputs(db: AppDatabase, novelId: number): ProgressInputs | null {
  return readValue<ProgressInputs | null>(db, inputsKey(novelId), null);
}

export interface ProgressChapter {
  id: number;
  title: string;
  number: number | null;
  position: number;
  isRead: boolean;
}

/** Chapters of the novel in the order of the book (for the chapter picker). */
export function listProgressChapters(db: AppDatabase, novelId: number): ProgressChapter[] {
  return db
    .select({
      id: chapters.id,
      title: chapters.title,
      number: chapters.number,
      position: chapters.position,
      isRead: chapters.isRead,
    })
    .from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.position), asc(chapters.id))
    .all();
}

/**
 * Words of each chapter of the novel in a language (null = original), null when its
 * text is not on the phone. A translated chapter counts its translated text; without
 * translation, the original text is used when it is known.
 */
export function loadChapterWords(
  db: AppDatabase,
  files: FileStore,
  novelId: number,
  lang: string | null,
): Map<number, number | null> {
  const words = new Map<number, number | null>(
    db
      .select({ id: chapters.id, wordCount: chapters.wordCount })
      .from(chapters)
      .where(eq(chapters.novelId, novelId))
      .all()
      .map((row) => [row.id, row.wordCount && row.wordCount > 0 ? row.wordCount : null]),
  );
  if (lang !== null) {
    for (const [chapterId, file] of listTranslationFiles(db, novelId, lang)) {
      try {
        words.set(chapterId, countWords(htmlToText(files.readText(file.filePath))));
      } catch {
        // Missing file: the original count (or the estimate) is used.
      }
    }
  }
  return words;
}

/** Chapters of the novel with real (not estimated) time. */
export function loadChaptersWithRealTime(db: AppDatabase, novelId: number): Set<number> {
  return new Set(
    db
      .selectDistinct({ id: readingSessions.chapterId })
      .from(readingSessions)
      .where(
        and(
          eq(readingSessions.novelId, novelId),
          ne(readingSessions.mode, 'estimated'),
          gt(readingSessions.durationMs, 0),
        ),
      )
      .all()
      .map((row) => row.id)
      .filter((id): id is number => id !== null),
  );
}

/** Builds the input of `estimateProgress` for the chapters up to `lastChapterId`. */
export function chaptersToEstimate(
  list: ProgressChapter[],
  lastChapterId: number,
  words: Map<number, number | null>,
  withRealTime: Set<number>,
): EstimateChapter[] {
  const last = list.find((chapter) => chapter.id === lastChapterId);
  if (!last) {
    return [];
  }
  return list
    .filter((chapter) => chapter.position <= last.position)
    .map((chapter) => ({
      id: chapter.id,
      words: words.get(chapter.id) ?? null,
      hasRealTime: withRealTime.has(chapter.id),
    }));
}

/** `read_ms` of every chapter and the total of the novel, from the sessions. */
function recomputeNovelTimes(db: Pick<AppDatabase, 'update'>, novelId: number): void {
  db.update(chapters)
    .set({
      readMs: sql`(select coalesce(sum(${readingSessions.durationMs}), 0) from ${readingSessions} where ${readingSessions.chapterId} = ${chapters.id})`,
    })
    .where(eq(chapters.novelId, novelId))
    .run();
  db.update(novels)
    .set({
      totalReadMs: sql`(select coalesce(sum(${readingSessions.durationMs}), 0) from ${readingSessions} where ${readingSessions.novelId} = ${novelId})`,
    })
    .where(eq(novels.id, novelId))
    .run();
}

/**
 * Applies "Set my progress": chapters up to `lastChapterId` become read, the following
 * ones unread; the previous estimate of the novel is replaced by `entries`.
 */
export function applyProgress(
  db: AppDatabase,
  input: {
    novelId: number;
    lastChapterId: number;
    entries: EstimateEntry[];
    inputs: ProgressInputs;
    now?: number;
  },
): void {
  const { novelId, lastChapterId, entries, inputs } = input;
  const now = input.now ?? Date.now();
  db.transaction((tx) => {
    const last = tx
      .select({ position: chapters.position })
      .from(chapters)
      .where(and(eq(chapters.id, lastChapterId), eq(chapters.novelId, novelId)))
      .get();
    if (!last) {
      return;
    }
    tx.update(chapters)
      .set({ isRead: true, readAt: now, progress: 1 })
      .where(
        and(
          eq(chapters.novelId, novelId),
          lte(chapters.position, last.position),
          eq(chapters.isRead, false),
        ),
      )
      .run();
    tx.update(chapters)
      .set({ isRead: false, readAt: null, progress: 0, positionAnchor: null })
      .where(and(eq(chapters.novelId, novelId), gt(chapters.position, last.position)))
      .run();
    tx.update(novels).set({ lastReadChapterId: lastChapterId }).where(eq(novels.id, novelId)).run();

    tx.delete(readingSessions)
      .where(and(eq(readingSessions.novelId, novelId), eq(readingSessions.mode, 'estimated')))
      .run();
    const rows = entries
      .filter((entry) => entry.ms > 0)
      .map((entry) => ({
        novelId,
        chapterId: entry.chapterId,
        // No real reading date: estimated time stays out of days and hours.
        startedAt: 0,
        endedAt: 0,
        durationMs: entry.ms,
        mode: 'estimated' as const,
        words: entry.words,
        lang: inputs.lang,
      }));
    for (let index = 0; index < rows.length; index += 200) {
      tx.insert(readingSessions)
        .values(rows.slice(index, index + 200))
        .run();
    }
    recomputeNovelTimes(tx, novelId);
    writeValue(tx as AppDatabase, inputsKey(novelId), { ...inputs, lastChapterId });
  });
}

/** "Delete the estimated time": the chapters stay read. */
export function deleteEstimatedTime(db: AppDatabase, novelId: number): void {
  db.transaction((tx) => {
    tx.delete(readingSessions)
      .where(and(eq(readingSessions.novelId, novelId), eq(readingSessions.mode, 'estimated')))
      .run();
    recomputeNovelTimes(tx, novelId);
  });
}

/** Estimated part of the time of a novel, and the chapters it concerns. */
export function loadEstimatedTimes(
  db: AppDatabase,
  novelId: number,
): { totalMs: number; chapterIds: Set<number> } {
  const rows = db
    .select({ chapterId: readingSessions.chapterId, durationMs: readingSessions.durationMs })
    .from(readingSessions)
    .where(and(eq(readingSessions.novelId, novelId), eq(readingSessions.mode, 'estimated')))
    .all();
  return {
    totalMs: rows.reduce((sum, row) => sum + row.durationMs, 0),
    chapterIds: new Set(rows.map((row) => row.chapterId).filter((id): id is number => id !== null)),
  };
}
