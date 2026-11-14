import { and, desc, eq } from 'drizzle-orm';

import type { AppDatabase } from '../../db/client';
import { chapters, history, novels } from '../../db/schema';
import { startOfDay } from '../../services/format';
import { normalizeText } from '../library/libraryView';

export interface HistoryRow {
  id: number;
  novelId: number;
  chapterId: number;
  lastReadAt: number;
  totalMs: number;
  novelTitle: string;
  coverPath: string | null;
  chapterTitle: string;
  chapterNumber: number | null;
  chapterPosition: number;
  progress: number;
}

/** Visible history entries, most recent first, optionally filtered by novel title. */
export function listHistory(db: AppDatabase, search = ''): HistoryRow[] {
  const rows = db
    .select({
      id: history.id,
      novelId: history.novelId,
      chapterId: history.chapterId,
      lastReadAt: history.lastReadAt,
      totalMs: history.totalMs,
      novelTitle: novels.title,
      coverPath: novels.coverPath,
      chapterTitle: chapters.title,
      chapterNumber: chapters.number,
      chapterPosition: chapters.position,
      progress: chapters.progress,
    })
    .from(history)
    .innerJoin(novels, eq(novels.id, history.novelId))
    .innerJoin(chapters, eq(chapters.id, history.chapterId))
    .where(eq(history.hidden, false))
    .orderBy(desc(history.lastReadAt))
    .all();
  const needle = normalizeText(search);
  return needle === ''
    ? rows
    : rows.filter((row) => normalizeText(row.novelTitle).includes(needle));
}

export type HistoryItem =
  { type: 'day'; key: string; day: number } | { type: 'entry'; key: string; row: HistoryRow };

/** Inserts a header before the first entry of each day. */
export function groupHistoryByDay(rows: HistoryRow[]): HistoryItem[] {
  const items: HistoryItem[] = [];
  let currentDay: number | null = null;
  for (const row of rows) {
    const day = startOfDay(row.lastReadAt);
    if (day !== currentDay) {
      currentDay = day;
      items.push({ type: 'day', key: `d${day}`, day });
    }
    items.push({ type: 'entry', key: `e${row.id}`, row });
  }
  return items;
}

/**
 * Removing from the history only hides the entry: reading progress and statistics are
 * untouched, and "Undo" can bring it back.
 */
export function setHistoryEntryHidden(db: AppDatabase, id: number, hidden: boolean): void {
  db.update(history).set({ hidden }).where(eq(history.id, id)).run();
}

export function hideNovelHistory(db: AppDatabase, novelId: number): void {
  db.update(history)
    .set({ hidden: true })
    .where(and(eq(history.novelId, novelId), eq(history.hidden, false)))
    .run();
}

export function hideAllHistory(db: AppDatabase): void {
  db.update(history).set({ hidden: true }).where(eq(history.hidden, false)).run();
}
