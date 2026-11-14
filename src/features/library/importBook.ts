import { eq } from 'drizzle-orm';

import type { AppDatabase } from '../../db/client';
import { chapters, novels, volumes } from '../../db/schema';
import type { ParsedBook } from '../../epub/types';
import {
  chapterFile,
  imageFile,
  novelCssFile,
  novelDir,
  type FileStore,
} from '../../services/fileStore';
import { chapterNumberFromTitle } from '../novel/chapterNumber';

export interface ImportOptions {
  /** Replace the content of this novel (same title and author) instead of creating one. */
  replaceNovelId?: number;
  now?: number;
}

const normalize = (value: string | null) => (value ?? '').trim().toLocaleLowerCase();

/** Finds an imported novel with the same title and author (case insensitive). */
export function findDuplicateNovel(
  db: AppDatabase,
  title: string,
  author: string | null,
): number | null {
  // Compared in JavaScript: SQLite lower() only handles ASCII letters.
  const match = db
    .select({ id: novels.id, title: novels.title, author: novels.author })
    .from(novels)
    .where(eq(novels.origin, 'local'))
    .all()
    .find(
      (novel) =>
        normalize(novel.title) === normalize(title) &&
        normalize(novel.author) === normalize(author),
    );
  return match?.id ?? null;
}

/**
 * Stores a parsed book: metadata in the database, chapter content and images as files.
 * The book file itself is not kept: everything needed has been copied.
 * Returns the id of the novel.
 */
export function importParsedBook(
  db: AppDatabase,
  files: FileStore,
  book: ParsedBook,
  options: ImportOptions = {},
): number {
  const now = options.now ?? Date.now();
  const written: string[] = [];

  try {
    return db.transaction((tx) => {
      let novelId: number;
      if (options.replaceNovelId !== undefined) {
        novelId = options.replaceNovelId;
        // Replacing keeps the novel row (categories, reading time) but renews its content.
        tx.delete(chapters).where(eq(chapters.novelId, novelId)).run();
        tx.delete(volumes).where(eq(volumes.novelId, novelId)).run();
        files.delete(`${novelDir(novelId)}/chapters`);
        files.delete(`${novelDir(novelId)}/images`);
        tx.update(novels)
          .set({
            title: book.title,
            author: book.author,
            description: book.description,
            originalLang: book.language,
            lastReadChapterId: null,
            updatedAt: now,
          })
          .where(eq(novels.id, novelId))
          .run();
      } else {
        novelId = tx
          .insert(novels)
          .values({
            origin: 'local',
            title: book.title,
            author: book.author,
            description: book.description,
            originalLang: book.language,
            inLibrary: true,
            addedAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: novels.id })
          .get().id;
      }

      if (book.cover) {
        const coverPath = `${novelDir(novelId)}/cover.${book.cover.extension}`;
        files.writeBytes(coverPath, book.cover.data);
        written.push(coverPath);
        tx.update(novels)
          .set({ coverPath, originalCoverPath: coverPath })
          .where(eq(novels.id, novelId))
          .run();
      }

      for (const [name, data] of book.images) {
        const path = imageFile(novelId, name);
        files.writeBytes(path, data);
        written.push(path);
      }
      if (book.css) {
        files.writeText(novelCssFile(novelId), book.css);
        written.push(novelCssFile(novelId));
      }

      const volumeIds = book.volumes.map(
        (volume, position) =>
          tx
            .insert(volumes)
            .values({ novelId, title: volume.title, position, origin: volume.origin })
            .returning({ id: volumes.id })
            .get().id,
      );

      book.chapters.forEach((chapter, position) => {
        const chapterId = tx
          .insert(chapters)
          .values({
            novelId,
            volumeId: chapter.volumeIndex === null ? null : volumeIds[chapter.volumeIndex],
            position,
            number: chapterNumberFromTitle(chapter.title),
            title: chapter.title,
            isDownloaded: true,
            wordCount: chapter.wordCount,
            createdAt: now,
          })
          .returning({ id: chapters.id })
          .get().id;
        const path = chapterFile(novelId, chapterId);
        files.writeText(path, chapter.html);
        written.push(path);
        tx.update(chapters).set({ filePath: path }).where(eq(chapters.id, chapterId)).run();
      });

      return novelId;
    });
  } catch (error) {
    // The transaction was rolled back: remove the files that were already written.
    for (const path of written) {
      files.delete(path);
    }
    throw error;
  }
}
