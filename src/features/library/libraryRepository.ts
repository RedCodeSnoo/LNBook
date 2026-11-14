import { and, asc, eq, getTableColumns, inArray, sql } from 'drizzle-orm';

import type { AppDatabase } from '../../db/client';
import {
  categories,
  chapters,
  novelCategories,
  novels,
  type Category,
  type Novel,
} from '../../db/schema';
import { novelDir, type FileStore } from '../../services/fileStore';

export interface LibraryNovel extends Novel {
  chapterCount: number;
  readCount: number;
  downloadedCount: number;
  /** Average progress over all chapters (0–1). */
  progress: number;
  /** Languages with at least one translated chapter. */
  translatedLangs: string[];
  categoryIds: number[];
  /** Shown in the Local tab: imported file, or online novel fully downloaded. */
  isLocal: boolean;
}

const splitList = (value: string | null): string[] =>
  value ? value.split(',').filter(Boolean) : [];

/**
 * Every novel of the library with the counters shown on its card.
 * The sub-queries name the outer table explicitly: Drizzle omits the table name of
 * interpolated columns, which would make `id` refer to the inner table.
 */
export function listLibraryNovels(db: AppDatabase): LibraryNovel[] {
  const rows = db
    .select({
      ...getTableColumns(novels),
      chapterCount: sql<number>`(select count(*) from chapters c where c.novel_id = "novels"."id")`,
      readCount: sql<number>`(select count(*) from chapters c where c.novel_id = "novels"."id" and c.is_read = 1)`,
      downloadedCount: sql<number>`(select count(*) from chapters c where c.novel_id = "novels"."id" and c.is_downloaded = 1)`,
      progressSum: sql<number>`(select coalesce(sum(case when c.is_read = 1 then 1.0 else c.progress end), 0) from chapters c where c.novel_id = "novels"."id")`,
      langs: sql<
        string | null
      >`(select group_concat(distinct t.lang) from chapter_translations t join chapters c on c.id = t.chapter_id where c.novel_id = "novels"."id")`,
      categoryList: sql<
        string | null
      >`(select group_concat(nc.category_id) from novel_categories nc where nc.novel_id = "novels"."id")`,
    })
    .from(novels)
    .where(eq(novels.inLibrary, true))
    .all();

  return rows.map(({ progressSum, langs, categoryList, ...novel }) => ({
    ...novel,
    progress: novel.chapterCount > 0 ? Math.min(1, progressSum / novel.chapterCount) : 0,
    translatedLangs: splitList(langs),
    categoryIds: splitList(categoryList).map(Number),
    isLocal:
      novel.origin === 'local' ||
      (novel.chapterCount > 0 && novel.downloadedCount === novel.chapterCount),
  }));
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export function listCategories(db: AppDatabase): Category[] {
  return db.select().from(categories).orderBy(asc(categories.position), asc(categories.id)).all();
}

export function createCategory(db: AppDatabase, name: string): Category {
  const trimmed = name.trim();
  if (trimmed === '') {
    throw new Error('Category name is empty');
  }
  const last = db
    .select({ max: sql<number | null>`max(${categories.position})` })
    .from(categories)
    .get();
  return db
    .insert(categories)
    .values({ name: trimmed, position: (last?.max ?? -1) + 1 })
    .returning()
    .get();
}

export function renameCategory(db: AppDatabase, id: number, name: string): void {
  const trimmed = name.trim();
  if (trimmed !== '') {
    db.update(categories).set({ name: trimmed }).where(eq(categories.id, id)).run();
  }
}

export function deleteCategory(db: AppDatabase, id: number): void {
  db.delete(categories).where(eq(categories.id, id)).run();
}

/** Saves a new order: `orderedIds` lists every category id from first to last. */
export function reorderCategories(db: AppDatabase, orderedIds: number[]): void {
  db.transaction((tx) => {
    orderedIds.forEach((id, position) => {
      tx.update(categories).set({ position }).where(eq(categories.id, id)).run();
    });
  });
}

export function setCategoryExcluded(db: AppDatabase, id: number, excluded: boolean): void {
  db.update(categories).set({ excludeFromUpdates: excluded }).where(eq(categories.id, id)).run();
}

/** Creates the default shelves the first time the app starts. */
export function seedDefaultCategories(db: AppDatabase, names: string[]): void {
  if (db.select({ id: categories.id }).from(categories).limit(1).get()) {
    return;
  }
  names.forEach((name) => createCategory(db, name));
}

export function getNovelCategoryIds(db: AppDatabase, novelId: number): number[] {
  return db
    .select({ id: novelCategories.categoryId })
    .from(novelCategories)
    .where(eq(novelCategories.novelId, novelId))
    .all()
    .map((row) => row.id);
}

/** Replaces the categories of the given novels. */
export function setNovelCategories(
  db: AppDatabase,
  novelIds: number[],
  categoryIds: number[],
): void {
  if (novelIds.length === 0) {
    return;
  }
  db.transaction((tx) => {
    tx.delete(novelCategories).where(inArray(novelCategories.novelId, novelIds)).run();
    for (const novelId of novelIds) {
      for (const categoryId of categoryIds) {
        tx.insert(novelCategories).values({ novelId, categoryId }).run();
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Bulk actions on novels
// ---------------------------------------------------------------------------

export function markNovelsRead(
  db: AppDatabase,
  novelIds: number[],
  read: boolean,
  now = Date.now(),
): void {
  if (novelIds.length === 0) {
    return;
  }
  db.update(chapters)
    .set(
      read
        ? { isRead: true, readAt: now, progress: 1 }
        : { isRead: false, readAt: null, progress: 0, positionAnchor: null },
    )
    .where(inArray(chapters.novelId, novelIds))
    .run();
}

/**
 * Removes novels from the library. Imported files only exist in the library, so they are
 * deleted with their content. Online novels keep their row (history and statistics refer
 * to it) but lose their downloaded chapters.
 */
export function removeNovelsFromLibrary(
  db: AppDatabase,
  files: FileStore,
  novelIds: number[],
): void {
  if (novelIds.length === 0) {
    return;
  }
  const rows = db
    .select({ id: novels.id, origin: novels.origin })
    .from(novels)
    .where(inArray(novels.id, novelIds))
    .all();
  db.transaction((tx) => {
    for (const row of rows) {
      if (row.origin === 'local') {
        tx.delete(novels).where(eq(novels.id, row.id)).run();
      } else {
        tx.update(novels).set({ inLibrary: false }).where(eq(novels.id, row.id)).run();
        tx.update(chapters)
          .set({ isDownloaded: false, filePath: null })
          .where(and(eq(chapters.novelId, row.id), eq(chapters.isEdited, false)))
          .run();
        tx.delete(novelCategories).where(eq(novelCategories.novelId, row.id)).run();
      }
    }
  });
  for (const row of rows) {
    files.delete(novelDir(row.id));
  }
}
