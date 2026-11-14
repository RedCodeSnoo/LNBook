/** Download queue (table `downloads`): what to fetch, in which order, and its state. */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import type { AppDatabase } from '../../db/client';
import { chapters, downloads, novels, type Chapter, type DownloadStatus } from '../../db/schema';

export const MAX_ATTEMPTS = 3;

export interface DownloadRow {
  id: number;
  chapterId: number;
  status: DownloadStatus;
  attempts: number;
  error: string | null;
  position: number;
  novelId: number;
  novelTitle: string;
  pluginId: string | null;
  chapterTitle: string;
}

/** Tasks still to do or failed, in queue order (finished ones are removed). */
export function listDownloads(db: AppDatabase): DownloadRow[] {
  return db
    .select({
      id: downloads.id,
      chapterId: downloads.chapterId,
      status: downloads.status,
      attempts: downloads.attempts,
      error: downloads.error,
      position: downloads.position,
      novelId: novels.id,
      novelTitle: novels.title,
      pluginId: novels.pluginId,
      chapterTitle: chapters.title,
    })
    .from(downloads)
    .innerJoin(chapters, eq(chapters.id, downloads.chapterId))
    .innerJoin(novels, eq(novels.id, chapters.novelId))
    .where(eq(downloads.kind, 'download'))
    .orderBy(asc(downloads.position), asc(downloads.id))
    .all();
}

/**
 * Adds chapters to the queue, in the order given. Chapters already downloaded, already
 * queued, or without a source are skipped. Returns the number of tasks added.
 */
export function enqueueChapters(db: AppDatabase, chapterIds: number[], now = Date.now()): number {
  if (chapterIds.length === 0) {
    return 0;
  }
  return db.transaction((tx) => {
    const queued = new Set(
      tx
        .select({ chapterId: downloads.chapterId })
        .from(downloads)
        .where(eq(downloads.kind, 'download'))
        .all()
        .map((row) => row.chapterId),
    );
    const eligible = new Map<number, boolean>();
    for (let start = 0; start < chapterIds.length; start += 500) {
      const rows = tx
        .select({
          id: chapters.id,
          isDownloaded: chapters.isDownloaded,
          sourcePath: chapters.sourcePath,
        })
        .from(chapters)
        .where(inArray(chapters.id, chapterIds.slice(start, start + 500)))
        .all();
      for (const row of rows) {
        eligible.set(row.id, !row.isDownloaded && !!row.sourcePath);
      }
    }
    let position =
      tx
        .select({ max: sql<number | null>`max(${downloads.position})` })
        .from(downloads)
        .get()?.max ?? 0;
    let added = 0;
    for (const chapterId of chapterIds) {
      if (!eligible.get(chapterId) || queued.has(chapterId)) {
        continue;
      }
      queued.add(chapterId);
      position += 1;
      tx.insert(downloads)
        .values({ chapterId, status: 'queued', createdAt: now, position, kind: 'download' })
        .run();
      added += 1;
    }
    return added;
  });
}

export type DownloadSelection =
  | { kind: 'all' }
  | { kind: 'unread' }
  /** The n chapters following the last one read (or the first n). */
  | { kind: 'next'; count: number }
  /** Chapters number `from` to `to` in list order (1-based, inclusive). */
  | { kind: 'range'; from: number; to: number };

/** Chapters of a novel matching a download choice, in reading order. */
export function selectChapters(
  list: Pick<Chapter, 'id' | 'isRead' | 'isDownloaded'>[],
  selection: DownloadSelection,
  lastReadChapterId: number | null,
): number[] {
  let chosen = list;
  if (selection.kind === 'unread') {
    chosen = list.filter((chapter) => !chapter.isRead);
  } else if (selection.kind === 'next') {
    const index = list.findIndex((chapter) => chapter.id === lastReadChapterId);
    // Chapters already on the phone do not use up the count.
    chosen = list
      .slice(index + 1)
      .filter((chapter) => !chapter.isDownloaded)
      .slice(0, Math.max(0, selection.count));
  } else if (selection.kind === 'range') {
    const from = Math.max(1, Math.min(selection.from, selection.to));
    const to = Math.max(selection.from, selection.to);
    chosen = list.slice(from - 1, to);
  }
  return chosen.filter((chapter) => !chapter.isDownloaded).map((chapter) => chapter.id);
}

/** Next task to run, or null when nothing is waiting. */
export function nextDownload(db: AppDatabase): DownloadRow | null {
  return listDownloads(db).find((row) => row.status === 'queued') ?? null;
}

export function setDownloadStatus(db: AppDatabase, id: number, status: DownloadStatus): void {
  db.update(downloads).set({ status }).where(eq(downloads.id, id)).run();
}

/** A finished task leaves the queue. */
export function completeDownload(db: AppDatabase, id: number): void {
  db.delete(downloads).where(eq(downloads.id, id)).run();
}

/**
 * Records a failed attempt. The task goes back to the queue until the maximum number of
 * attempts is reached, then stays as failed. Returns true when it will be tried again.
 */
export function failDownload(db: AppDatabase, id: number, error: string): boolean {
  const row = db
    .select({ attempts: downloads.attempts })
    .from(downloads)
    .where(eq(downloads.id, id))
    .get();
  if (!row) {
    return false;
  }
  const attempts = row.attempts + 1;
  const retry = attempts < MAX_ATTEMPTS;
  db.update(downloads)
    .set({ attempts, error: error.slice(0, 300), status: retry ? 'queued' : 'failed' })
    .where(eq(downloads.id, id))
    .run();
  return retry;
}

/** Tasks interrupted when the app was closed go back to the queue. */
export function recoverInterruptedDownloads(db: AppDatabase): void {
  db.update(downloads).set({ status: 'queued' }).where(eq(downloads.status, 'running')).run();
}

export function pauseDownloads(db: AppDatabase): void {
  db.update(downloads)
    .set({ status: 'paused' })
    .where(inArray(downloads.status, ['queued', 'running']))
    .run();
}

export function resumeDownloads(db: AppDatabase): void {
  db.update(downloads).set({ status: 'queued' }).where(eq(downloads.status, 'paused')).run();
}

/** Failed tasks get their attempts back and return to the queue. */
export function retryFailedDownloads(db: AppDatabase): void {
  db.update(downloads)
    .set({ status: 'queued', attempts: 0, error: null })
    .where(eq(downloads.status, 'failed'))
    .run();
}

export function cancelDownload(db: AppDatabase, id: number): void {
  db.delete(downloads).where(eq(downloads.id, id)).run();
}

export function cancelAllDownloads(db: AppDatabase): void {
  db.delete(downloads).where(eq(downloads.kind, 'download')).run();
}

export function cancelNovelDownloads(db: AppDatabase, novelId: number): void {
  const ids = db
    .select({ id: downloads.id })
    .from(downloads)
    .innerJoin(chapters, eq(chapters.id, downloads.chapterId))
    .where(and(eq(chapters.novelId, novelId), eq(downloads.kind, 'download')))
    .all()
    .map((row) => row.id);
  if (ids.length > 0) {
    db.delete(downloads).where(inArray(downloads.id, ids)).run();
  }
}

/** Moves a task one place up or down among the tasks of the queue. */
export function moveDownload(db: AppDatabase, id: number, offset: -1 | 1): void {
  const list = listDownloads(db);
  const index = list.findIndex((row) => row.id === id);
  const other = list[index + offset];
  if (index === -1 || !other) {
    return;
  }
  db.transaction((tx) => {
    tx.update(downloads).set({ position: other.position }).where(eq(downloads.id, id)).run();
    tx.update(downloads)
      .set({ position: list[index].position })
      .where(eq(downloads.id, other.id))
      .run();
  });
}

/** Puts a task at the head of the queue. */
export function prioritizeDownload(db: AppDatabase, id: number): void {
  const min =
    db
      .select({ min: sql<number | null>`min(${downloads.position})` })
      .from(downloads)
      .get()?.min ?? 0;
  db.update(downloads)
    .set({ position: min - 1 })
    .where(eq(downloads.id, id))
    .run();
}

export interface QueueSummary {
  waiting: number;
  paused: number;
  failed: number;
}

export function summarizeQueue(rows: Pick<DownloadRow, 'status'>[]): QueueSummary {
  return {
    waiting: rows.filter((row) => row.status === 'queued' || row.status === 'running').length,
    paused: rows.filter((row) => row.status === 'paused').length,
    failed: rows.filter((row) => row.status === 'failed').length,
  };
}
