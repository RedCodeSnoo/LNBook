/** Space used by the novels and removal of downloaded content. */
import { and, eq, inArray } from 'drizzle-orm';

import type { AppDatabase } from '../../db/client';
import { chapters, novels } from '../../db/schema';
import { novelDir, type FileStore } from '../../services/fileStore';

export interface NovelStorage {
  novelId: number;
  title: string;
  coverPath: string | null;
  origin: 'local' | 'online';
  bytes: number;
  downloaded: number;
  downloadedRead: number;
}

/** Space used by each novel that has files, largest first. */
export function listNovelStorage(db: AppDatabase, files: FileStore): NovelStorage[] {
  const counts = new Map<number, { downloaded: number; downloadedRead: number }>();
  for (const row of db
    .select({ novelId: chapters.novelId, isRead: chapters.isRead })
    .from(chapters)
    .where(eq(chapters.isDownloaded, true))
    .all()) {
    const entry = counts.get(row.novelId) ?? { downloaded: 0, downloadedRead: 0 };
    entry.downloaded += 1;
    entry.downloadedRead += row.isRead ? 1 : 0;
    counts.set(row.novelId, entry);
  }
  return db
    .select({
      novelId: novels.id,
      title: novels.title,
      coverPath: novels.coverPath,
      origin: novels.origin,
    })
    .from(novels)
    .all()
    .map((novel) => ({
      ...novel,
      bytes: files.size(novelDir(novel.novelId)),
      ...(counts.get(novel.novelId) ?? { downloaded: 0, downloadedRead: 0 }),
    }))
    .filter((novel) => novel.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);
}

/**
 * Removes the downloaded text of chapters of online novels (the chapters stay in the
 * list and can be read online again). Chapters edited by the user and imported files
 * are kept: they could not be fetched again. Returns the number of chapters removed.
 */
export function deleteChapterDownloads(
  db: AppDatabase,
  files: FileStore,
  chapterIds: number[],
): number {
  let removed = 0;
  for (let start = 0; start < chapterIds.length; start += 500) {
    const rows = db
      .select({
        id: chapters.id,
        filePath: chapters.filePath,
        isEdited: chapters.isEdited,
        sourcePath: chapters.sourcePath,
      })
      .from(chapters)
      .where(inArray(chapters.id, chapterIds.slice(start, start + 500)))
      .all()
      .filter((row) => !row.isEdited && !!row.sourcePath && !!row.filePath);
    for (const row of rows) {
      files.delete(row.filePath as string);
    }
    if (rows.length > 0) {
      db.update(chapters)
        .set({ isDownloaded: false, filePath: null })
        .where(
          inArray(
            chapters.id,
            rows.map((row) => row.id),
          ),
        )
        .run();
      removed += rows.length;
    }
  }
  return removed;
}

/** Removes the downloads of a novel: all of them, or only the chapters already read. */
export function deleteNovelDownloads(
  db: AppDatabase,
  files: FileStore,
  novelId: number,
  onlyRead: boolean,
): number {
  const ids = db
    .select({ id: chapters.id })
    .from(chapters)
    .where(
      and(
        eq(chapters.novelId, novelId),
        eq(chapters.isDownloaded, true),
        ...(onlyRead ? [eq(chapters.isRead, true)] : []),
      ),
    )
    .all()
    .map((row) => row.id);
  const removed = deleteChapterDownloads(db, files, ids);
  // Images are shared by the chapters: they go once no downloaded chapter is left.
  const left = db
    .select({ id: chapters.id })
    .from(chapters)
    .where(and(eq(chapters.novelId, novelId), eq(chapters.isDownloaded, true)))
    .all().length;
  const origin = db
    .select({ origin: novels.origin })
    .from(novels)
    .where(eq(novels.id, novelId))
    .get()?.origin;
  if (left === 0 && origin === 'online') {
    files.delete(`${novelDir(novelId)}/images`);
  }
  return removed;
}
