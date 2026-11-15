import { and, asc, desc, eq, gt, isNull, lt, or } from 'drizzle-orm';

import type { AppDatabase } from '../../db/client';
import {
  chapters,
  novels,
  textReplacements,
  type Chapter,
  type Novel,
  type TextReplacement,
} from '../../db/schema';
import { countWords, htmlToText } from '../../services/html';
import { chapterFile, chapterOriginalFile, type FileStore } from '../../services/fileStore';
import { extractBlockTexts, searchBlocks, type SearchHit } from './blocks';
import type { Anchor } from './readerHtml';
import { applyRulesToHtml, type ReplacementRule } from './textReplacement';

export interface ReaderContext {
  novel: Novel;
  chapter: Chapter;
  previous: Chapter | null;
  next: Chapter | null;
}

/** The chapter to read with its novel and neighbours, or null when it no longer exists. */
export function loadReaderContext(db: AppDatabase, chapterId: number): ReaderContext | null {
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).get();
  if (!chapter) {
    return null;
  }
  const novel = db.select().from(novels).where(eq(novels.id, chapter.novelId)).get();
  if (!novel) {
    return null;
  }
  // Only the two neighbours are read: a novel can have thousands of chapters.
  const neighbour = (before: boolean) =>
    db
      .select()
      .from(chapters)
      .where(
        and(
          eq(chapters.novelId, chapter.novelId),
          before
            ? or(
                lt(chapters.position, chapter.position),
                and(eq(chapters.position, chapter.position), lt(chapters.id, chapter.id)),
              )
            : or(
                gt(chapters.position, chapter.position),
                and(eq(chapters.position, chapter.position), gt(chapters.id, chapter.id)),
              ),
        ),
      )
      .orderBy(
        before ? desc(chapters.position) : asc(chapters.position),
        before ? desc(chapters.id) : asc(chapters.id),
      )
      .limit(1)
      .get() ?? null;
  return { novel, chapter, previous: neighbour(true), next: neighbour(false) };
}

/**
 * Saves where the reader is in a chapter. The chapter becomes "read" once the threshold
 * is reached and stays read afterwards.
 */
export function saveReadingPosition(
  db: AppDatabase,
  chapterId: number,
  position: { progress: number; anchor: Anchor | null },
  threshold: number,
  now = Date.now(),
): { becameRead: boolean } {
  const chapter = db
    .select({ novelId: chapters.novelId, isRead: chapters.isRead })
    .from(chapters)
    .where(eq(chapters.id, chapterId))
    .get();
  if (!chapter) {
    return { becameRead: false };
  }
  const progress = Math.max(0, Math.min(1, position.progress));
  const becameRead = !chapter.isRead && progress >= threshold;
  db.transaction((tx) => {
    tx.update(chapters)
      .set({
        progress,
        positionAnchor: position.anchor ? JSON.stringify(position.anchor) : null,
        ...(becameRead ? { isRead: true, readAt: now } : {}),
      })
      .where(eq(chapters.id, chapterId))
      .run();
    tx.update(novels)
      .set({ lastReadChapterId: chapterId, lastReadAt: now })
      .where(eq(novels.id, chapter.novelId))
      .run();
  });
  return { becameRead };
}

/** Marks a chapter as read (moving on to the next one). */
export function markChapterRead(db: AppDatabase, chapterId: number, now = Date.now()): void {
  db.update(chapters)
    .set({ isRead: true, readAt: now })
    .where(and(eq(chapters.id, chapterId), eq(chapters.isRead, false)))
    .run();
}

/** Remembers the chapter being read, even before any scrolling. */
export function touchLastRead(
  db: AppDatabase,
  novelId: number,
  chapterId: number,
  now = Date.now(),
): void {
  db.update(novels)
    .set({ lastReadChapterId: chapterId, lastReadAt: now })
    .where(eq(novels.id, novelId))
    .run();
}

export function setNovelReaderSettings(
  db: AppDatabase,
  novelId: number,
  settings: object | null,
): void {
  db.update(novels)
    .set({ readerSettings: settings ? JSON.stringify(settings) : null })
    .where(eq(novels.id, novelId))
    .run();
}

// ---------------------------------------------------------------------------
// Text replacement rules
// ---------------------------------------------------------------------------

/** Global rules followed by the rules of the novel. */
export function listReplacementRules(db: AppDatabase, novelId: number | null): TextReplacement[] {
  return db
    .select()
    .from(textReplacements)
    .where(
      novelId === null
        ? isNull(textReplacements.novelId)
        : or(isNull(textReplacements.novelId), eq(textReplacements.novelId, novelId)),
    )
    .orderBy(asc(textReplacements.id))
    .all();
}

export function saveReplacementRule(
  db: AppDatabase,
  rule: ReplacementRule & { id?: number; novelId: number | null },
): number {
  const values = {
    novelId: rule.novelId,
    pattern: rule.pattern,
    replacement: rule.replacement,
    isRegex: rule.isRegex,
    enabled: rule.enabled ?? true,
  };
  if (rule.id !== undefined) {
    db.update(textReplacements).set(values).where(eq(textReplacements.id, rule.id)).run();
    return rule.id;
  }
  return db.insert(textReplacements).values(values).returning({ id: textReplacements.id }).get().id;
}

export function deleteReplacementRule(db: AppDatabase, id: number): void {
  db.delete(textReplacements).where(eq(textReplacements.id, id)).run();
}

// ---------------------------------------------------------------------------
// Chapter content
// ---------------------------------------------------------------------------

/** HTML of a downloaded chapter as stored, or null when it is not on the device. */
export function readChapterHtml(
  files: FileStore,
  chapter: Pick<Chapter, 'filePath'>,
): string | null {
  if (!chapter.filePath || !files.exists(chapter.filePath)) {
    return null;
  }
  return files.readText(chapter.filePath);
}

/** Chapter HTML as displayed: stored content with the replacement rules applied. */
export function prepareChapterHtml(html: string, rules: ReplacementRule[]): string {
  return applyRulesToHtml(html, rules);
}

/**
 * Saves a chapter edited by the user. The first edit keeps a copy of the source content,
 * so that "back to the original" stays possible.
 */
export function saveEditedChapter(
  db: AppDatabase,
  files: FileStore,
  chapter: Chapter,
  title: string,
  html: string,
): void {
  const path = chapter.filePath ?? chapterFile(chapter.novelId, chapter.id);
  let originalPath = chapter.originalFilePath;
  if (!originalPath && chapter.filePath && files.exists(chapter.filePath)) {
    originalPath = chapterOriginalFile(chapter.novelId, chapter.id);
    // The original title is stored with the content, on the first line.
    files.writeText(
      originalPath,
      `<!--title:${encodeURIComponent(chapter.title)}-->${files.readText(chapter.filePath)}`,
    );
  }
  files.writeText(path, html);
  db.update(chapters)
    .set({
      title: title.trim() || chapter.title,
      filePath: path,
      originalFilePath: originalPath,
      isEdited: true,
      isDownloaded: true,
      wordCount: countWords(htmlToText(html)),
    })
    .where(eq(chapters.id, chapter.id))
    .run();
}

/** Restores the content and title a chapter had before it was edited. */
export function revertEditedChapter(db: AppDatabase, files: FileStore, chapter: Chapter): boolean {
  if (!chapter.originalFilePath || !chapter.filePath || !files.exists(chapter.originalFilePath)) {
    return false;
  }
  const stored = files.readText(chapter.originalFilePath);
  const match = /^<!--title:([^>]*)-->/.exec(stored);
  const html = match ? stored.slice(match[0].length) : stored;
  files.writeText(chapter.filePath, html);
  files.delete(chapter.originalFilePath);
  db.update(chapters)
    .set({
      title: match ? decodeURIComponent(match[1]) : chapter.title,
      originalFilePath: null,
      isEdited: false,
      wordCount: countWords(htmlToText(html)),
    })
    .where(eq(chapters.id, chapter.id))
    .run();
  return true;
}

export interface BookSearchResult {
  chapter: Pick<Chapter, 'id' | 'title' | 'position' | 'number'>;
  hits: SearchHit[];
}

/** Searches a text in every downloaded chapter of a novel. */
export function searchBook(
  db: AppDatabase,
  files: FileStore,
  novelId: number,
  query: string,
  rules: ReplacementRule[],
  limit = 200,
  /** Files of the translated chapters, when the book is read in a translation. */
  translated?: ReadonlyMap<number, { filePath: string; title: string | null }>,
): BookSearchResult[] {
  const results: BookSearchResult[] = [];
  if (query.trim() === '') {
    return results;
  }
  const list = db
    .select({
      id: chapters.id,
      title: chapters.title,
      position: chapters.position,
      number: chapters.number,
      filePath: chapters.filePath,
    })
    .from(chapters)
    .where(and(eq(chapters.novelId, novelId), eq(chapters.isDownloaded, true)))
    .orderBy(asc(chapters.position))
    .all();
  let remaining = limit;
  // Tags never contain the searched text as such when it has no markup characters.
  const needle = /[<>&"]/.test(query) ? '' : query.toLowerCase();
  for (const { filePath, ...chapter } of list) {
    if (remaining <= 0) {
      break;
    }
    const version = translated?.get(chapter.id);
    const html = readChapterHtml(files, { filePath: version?.filePath ?? filePath });
    if (version?.title) {
      chapter.title = version.title;
    }
    if (html === null) {
      continue;
    }
    // Cheap pre-filter, only valid when no rule rewrites the text.
    if (rules.length === 0 && !html.toLowerCase().includes(needle)) {
      continue;
    }
    const hits = searchBlocks(extractBlockTexts(prepareChapterHtml(html, rules)), query, remaining);
    if (hits.length > 0) {
      results.push({ chapter, hits });
      remaining -= hits.length;
    }
  }
  return results;
}
