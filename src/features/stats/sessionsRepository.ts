import { and, eq, sql } from 'drizzle-orm';

import type { AppDatabase } from '../../db/client';
import { chapters, history, novels, readingSessions, type SessionMode } from '../../db/schema';

export interface SessionInput {
  novelId: number;
  chapterId: number;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  mode: SessionMode;
  words: number;
  /** Language displayed (null = original). */
  lang: string | null;
}

type Tx = Pick<AppDatabase, 'select' | 'update' | 'insert' | 'delete'>;

const sumDuration = sql<number>`coalesce(sum(${readingSessions.durationMs}), 0)`;

/**
 * `chapters.read_ms` and `novels.total_read_ms` are always recomputed from the sessions,
 * so time can never be counted twice.
 */
export function recomputeReadTimes(db: Tx, novelId: number, chapterId: number | null): void {
  if (chapterId !== null) {
    const chapterTotal = db
      .select({ total: sumDuration })
      .from(readingSessions)
      .where(eq(readingSessions.chapterId, chapterId))
      .get();
    db.update(chapters)
      .set({ readMs: chapterTotal?.total ?? 0 })
      .where(eq(chapters.id, chapterId))
      .run();
  }
  const novelTotal = db
    .select({ total: sumDuration })
    .from(readingSessions)
    .where(eq(readingSessions.novelId, novelId))
    .get();
  db.update(novels)
    .set({ totalReadMs: novelTotal?.total ?? 0 })
    .where(eq(novels.id, novelId))
    .run();
}

/**
 * Creates a reading session, or updates it when `sessionId` is given (the reader saves
 * the running session regularly). The history entry of the chapter follows.
 * Returns the id of the session.
 */
export function saveSession(db: AppDatabase, input: SessionInput, sessionId?: number): number {
  return db.transaction((tx) => {
    let id = sessionId;
    if (id === undefined) {
      id = tx.insert(readingSessions).values(input).returning({ id: readingSessions.id }).get().id;
    } else {
      tx.update(readingSessions)
        .set({ endedAt: input.endedAt, durationMs: input.durationMs, words: input.words })
        .where(eq(readingSessions.id, id))
        .run();
    }
    recomputeReadTimes(tx, input.novelId, input.chapterId);

    const chapterTotal = tx
      .select({ readMs: chapters.readMs })
      .from(chapters)
      .where(eq(chapters.id, input.chapterId))
      .get();
    const entry = { lastReadAt: input.endedAt, totalMs: chapterTotal?.readMs ?? 0, hidden: false };
    tx.insert(history)
      .values({ novelId: input.novelId, chapterId: input.chapterId, ...entry })
      .onConflictDoUpdate({ target: history.chapterId, set: entry })
      .run();
    return id;
  });
}

/**
 * Resets the progress of a novel: every chapter becomes unread and positions go back to
 * the start. Unless `keepTimes`, the reading times of the novel leave the statistics too.
 */
export function resetNovelProgress(db: AppDatabase, novelId: number, keepTimes: boolean): void {
  db.transaction((tx) => {
    tx.update(chapters)
      .set({ isRead: false, readAt: null, progress: 0, positionAnchor: null })
      .where(eq(chapters.novelId, novelId))
      .run();
    tx.update(novels).set({ lastReadChapterId: null }).where(eq(novels.id, novelId)).run();
    if (!keepTimes) {
      tx.delete(readingSessions).where(eq(readingSessions.novelId, novelId)).run();
      tx.delete(history).where(eq(history.novelId, novelId)).run();
      tx.update(chapters)
        .set({ readMs: 0 })
        .where(and(eq(chapters.novelId, novelId)))
        .run();
      tx.update(novels).set({ totalReadMs: 0 }).where(eq(novels.id, novelId)).run();
    }
  });
}
