import { asc, desc, eq, inArray, sql } from 'drizzle-orm';

import type { AppDatabase } from '../../db/client';
import {
  chapters,
  novels,
  quoteFolderItems,
  quoteFolders,
  quotes,
  volumes,
  type QuoteFolder,
} from '../../db/schema';
import { normalizeText } from '../library/libraryView';
import { parseAnchor, type Anchor } from '../reader/readerHtml';

/** Colours offered for folders (readable on light and dark surfaces as a dot). */
export const FOLDER_COLORS = [
  '#E5484D',
  '#F76B15',
  '#D4A017',
  '#30A46C',
  '#12A594',
  '#3E63DD',
  '#8E4EC6',
  '#D6409F',
] as const;

export interface QuoteView {
  id: number;
  novelId: number;
  chapterId: number | null;
  text: string;
  anchor: Anchor | null;
  lang: string | null;
  note: string | null;
  createdAt: number;
  novelTitle: string;
  chapterTitle: string | null;
  chapterNumber: number | null;
  chapterPosition: number | null;
  volumeTitle: string | null;
  folders: QuoteFolder[];
}

export type QuoteSort = 'book' | 'date';

export interface QuoteQuery {
  novelId?: number;
  /** A folder id, 'none' for quotes without folder, undefined for all. */
  folder?: number | 'none';
  search?: string;
  sort?: QuoteSort;
}

export interface NewQuote {
  novelId: number;
  chapterId: number;
  text: string;
  anchor: Anchor;
  lang: string | null;
  note?: string | null;
  folderIds?: number[];
}

// ---------------------------------------------------------------------------
// Folders (shared by every novel)
// ---------------------------------------------------------------------------

export function listFolders(db: AppDatabase): QuoteFolder[] {
  return db.select().from(quoteFolders).orderBy(asc(quoteFolders.position)).all();
}

export function createFolder(db: AppDatabase, name: string, color?: string): QuoteFolder {
  const row = db
    .select({
      max: sql<number | null>`max(${quoteFolders.position})`,
      count: sql<number>`count(*)`,
    })
    .from(quoteFolders)
    .get();
  return db
    .insert(quoteFolders)
    .values({
      name: name.trim(),
      color: color ?? FOLDER_COLORS[(row?.count ?? 0) % FOLDER_COLORS.length],
      position: (row?.max ?? -1) + 1,
    })
    .returning()
    .get();
}

export function updateFolder(
  db: AppDatabase,
  id: number,
  patch: { name?: string; color?: string },
): void {
  const values: { name?: string; color?: string } = {};
  if (patch.name !== undefined && patch.name.trim() !== '') {
    values.name = patch.name.trim();
  }
  if (patch.color !== undefined) {
    values.color = patch.color;
  }
  if (Object.keys(values).length > 0) {
    db.update(quoteFolders).set(values).where(eq(quoteFolders.id, id)).run();
  }
}

export function reorderFolders(db: AppDatabase, orderedIds: number[]): void {
  db.transaction((tx) => {
    orderedIds.forEach((id, position) => {
      tx.update(quoteFolders).set({ position }).where(eq(quoteFolders.id, id)).run();
    });
  });
}

/** Deleting a folder keeps its quotes: they only lose that folder. */
export function deleteFolder(db: AppDatabase, id: number): void {
  db.delete(quoteFolders).where(eq(quoteFolders.id, id)).run();
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

export function createQuote(db: AppDatabase, quote: NewQuote, now = Date.now()): number {
  return db.transaction((tx) => {
    const id = tx
      .insert(quotes)
      .values({
        novelId: quote.novelId,
        chapterId: quote.chapterId,
        text: quote.text.trim(),
        anchor: JSON.stringify(quote.anchor),
        lang: quote.lang,
        note: quote.note?.trim() || null,
        createdAt: now,
      })
      .returning({ id: quotes.id })
      .get().id;
    for (const folderId of new Set(quote.folderIds ?? [])) {
      tx.insert(quoteFolderItems).values({ quoteId: id, folderId }).run();
    }
    return id;
  });
}

export function updateQuoteNote(db: AppDatabase, id: number, note: string): void {
  db.update(quotes)
    .set({ note: note.trim() || null })
    .where(eq(quotes.id, id))
    .run();
}

export function setQuoteFolders(db: AppDatabase, id: number, folderIds: number[]): void {
  db.transaction((tx) => {
    tx.delete(quoteFolderItems).where(eq(quoteFolderItems.quoteId, id)).run();
    for (const folderId of new Set(folderIds)) {
      tx.insert(quoteFolderItems).values({ quoteId: id, folderId }).run();
    }
  });
}

export function deleteQuote(db: AppDatabase, id: number): void {
  db.delete(quotes).where(eq(quotes.id, id)).run();
}

export function getQuoteFolderIds(db: AppDatabase, id: number): number[] {
  return db
    .select({ folderId: quoteFolderItems.folderId })
    .from(quoteFolderItems)
    .where(eq(quoteFolderItems.quoteId, id))
    .all()
    .map((row) => row.folderId);
}

/** Novels that have quotes, with how many, by title. */
export function listQuoteNovels(db: AppDatabase): { id: number; title: string; count: number }[] {
  return db
    .select({ id: novels.id, title: novels.title, count: sql<number>`count(*)` })
    .from(quotes)
    .innerJoin(novels, eq(novels.id, quotes.novelId))
    .groupBy(novels.id)
    .orderBy(asc(novels.title))
    .all();
}

/** Quotes with their chapter, volume and folders, filtered and sorted. */
export function listQuotes(db: AppDatabase, query: QuoteQuery = {}): QuoteView[] {
  const rows = db
    .select({
      id: quotes.id,
      novelId: quotes.novelId,
      chapterId: quotes.chapterId,
      text: quotes.text,
      anchor: quotes.anchor,
      lang: quotes.lang,
      note: quotes.note,
      createdAt: quotes.createdAt,
      novelTitle: novels.title,
      chapterTitle: chapters.title,
      chapterNumber: chapters.number,
      chapterPosition: chapters.position,
      volumeTitle: volumes.title,
    })
    .from(quotes)
    .innerJoin(novels, eq(novels.id, quotes.novelId))
    .leftJoin(chapters, eq(chapters.id, quotes.chapterId))
    .leftJoin(volumes, eq(volumes.id, chapters.volumeId))
    .where(query.novelId === undefined ? undefined : eq(quotes.novelId, query.novelId))
    .orderBy(desc(quotes.createdAt), desc(quotes.id))
    .all();

  const folderById = new Map(listFolders(db).map((folder) => [folder.id, folder]));
  const foldersByQuote = new Map<number, QuoteFolder[]>();
  const ids = rows.map((row) => row.id);
  // Chunks keep the statement under the SQLite variable limit.
  for (let start = 0; start < ids.length; start += 500) {
    const links = db
      .select()
      .from(quoteFolderItems)
      .where(inArray(quoteFolderItems.quoteId, ids.slice(start, start + 500)))
      .all();
    for (const link of links) {
      const folder = folderById.get(link.folderId);
      if (folder) {
        const list = foldersByQuote.get(link.quoteId) ?? [];
        list.push(folder);
        foldersByQuote.set(link.quoteId, list);
      }
    }
  }

  const needle = normalizeText(query.search ?? '');
  const list = rows
    .map((row): QuoteView => ({
      ...row,
      anchor: parseAnchor(row.anchor),
      folders: (foldersByQuote.get(row.id) ?? []).sort((a, b) => a.position - b.position),
    }))
    .filter((quote) => {
      if (query.folder === 'none' && quote.folders.length > 0) {
        return false;
      }
      if (
        typeof query.folder === 'number' &&
        !quote.folders.some((folder) => folder.id === query.folder)
      ) {
        return false;
      }
      return (
        needle === '' ||
        normalizeText(quote.text).includes(needle) ||
        normalizeText(quote.note ?? '').includes(needle)
      );
    });

  if ((query.sort ?? 'book') === 'book') {
    // Order of the book: novel, chapter, then place in the chapter.
    list.sort(
      (a, b) =>
        a.novelTitle.localeCompare(b.novelTitle) ||
        a.novelId - b.novelId ||
        (a.chapterPosition ?? Number.MAX_SAFE_INTEGER) -
          (b.chapterPosition ?? Number.MAX_SAFE_INTEGER) ||
        (a.anchor?.b ?? 0) - (b.anchor?.b ?? 0) ||
        (a.anchor?.o ?? 0) - (b.anchor?.o ?? 0) ||
        a.id - b.id,
    );
  }
  return list;
}

/** Quotes of a chapter with their place, for the underline in the reader. */
export function listChapterQuoteAnchors(
  db: AppDatabase,
  chapterId: number,
  lang: string | null,
): { id: number; a: Anchor }[] {
  return db
    .select({ id: quotes.id, anchor: quotes.anchor, lang: quotes.lang })
    .from(quotes)
    .where(eq(quotes.chapterId, chapterId))
    .all()
    .filter((row) => (row.lang ?? null) === lang)
    .flatMap((row) => {
      const anchor = parseAnchor(row.anchor);
      return anchor ? [{ id: row.id, a: anchor }] : [];
    });
}

export interface FolderCount {
  folder: QuoteFolder;
  count: number;
}

/** Folder chips: total, quotes without folder, and each folder that has quotes. */
export function countByFolder(all: QuoteView[], folders: QuoteFolder[]) {
  const counts = new Map<number, number>();
  let none = 0;
  for (const quote of all) {
    if (quote.folders.length === 0) {
      none += 1;
    }
    for (const folder of quote.folders) {
      counts.set(folder.id, (counts.get(folder.id) ?? 0) + 1);
    }
  }
  return {
    total: all.length,
    none,
    folders: folders
      // Empty folders stay listed: they can be prepared before any quote exists.
      .map((folder): FolderCount => ({ folder, count: counts.get(folder.id) ?? 0 })),
  };
}
