/**
 * Novels coming from a source plugin: fetching their details, keeping the database in
 * sync with the source, and fetching the text of a chapter.
 */
import { and, eq, isNull } from 'drizzle-orm';

import type { AppDatabase } from '../../db/client';
import { chapters, novels, type Chapter, type Novel } from '../../db/schema';
import { isUrlAbsolute } from '../../plugins/libs/isAbsoluteUrl';
import { runPluginCall } from '../../plugins/pluginErrors';
import type { ChapterItem, SourceNovel, SourcePlugin } from '../../plugins/types';
import { chapterFile, type FileStore } from '../../services/fileStore';
import { countWords, htmlToText, sanitizeHtml } from '../../services/html';
import { chapterNumberFromTitle } from '../novel/chapterNumber';
import { applySourceMetadata, parseEditedFields } from '../novel/novelRepository';
import { languageCodeFromName } from '../translation/languages';

/** Absolute address of a novel or chapter page of a source. */
export function resolveSourceUrl(
  plugin: Pick<SourcePlugin, 'site' | 'resolveUrl'>,
  path: string,
  isNovel = false,
): string {
  try {
    const resolved = plugin.resolveUrl?.(path, isNovel);
    if (resolved) {
      return resolved;
    }
  } catch {
    // Fall back to the default rule below.
  }
  if (isUrlAbsolute(path)) {
    return path.startsWith('//') ? `https:${path}` : path;
  }
  return `${plugin.site.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function absoluteUrl(url: string, base: string): string | null {
  if (/^data:/i.test(url)) {
    return url;
  }
  try {
    return new URL(url, base).toString();
  } catch {
    return null;
  }
}

export interface FetchedNovel {
  novel: SourceNovel;
  chapters: ChapterItem[];
}

/** Details and full chapter list of a novel (every page of paginated sources). */
export async function fetchSourceNovel(
  plugin: SourcePlugin,
  path: string,
  onPage?: (page: number, total: number) => void,
): Promise<FetchedNovel> {
  const novel = await runPluginCall(() => plugin.parseNovel(path));
  const list: ChapterItem[] = [...(novel.chapters ?? [])];
  const totalPages = novel.totalPages ?? 0;
  if (totalPages > 0 && plugin.parsePage) {
    const parsePage = plugin.parsePage.bind(plugin);
    // The first page often comes with the novel itself.
    for (let page = list.length > 0 ? 2 : 1; page <= totalPages; page += 1) {
      onPage?.(page, totalPages);
      const result = await runPluginCall(() => parsePage(path, String(page)));
      list.push(...(result.chapters ?? []));
    }
  }
  // Some sites list a chapter twice: the path identifies it.
  const seen = new Set<string>();
  const unique = list.filter((chapter) => {
    if (!chapter?.path || seen.has(chapter.path)) {
      return false;
    }
    seen.add(chapter.path);
    return true;
  });
  return { novel, chapters: unique };
}

export function findSourceNovel(db: AppDatabase, pluginId: string, path: string): Novel | null {
  return (
    db
      .select()
      .from(novels)
      .where(and(eq(novels.pluginId, pluginId), eq(novels.sourcePath, path)))
      .get() ?? null
  );
}

const cleanGenres = (genres: string | undefined) =>
  genres
    ? genres
        .split(',')
        .map((genre) => genre.trim())
        .filter(Boolean)
        .join(',')
    : null;

export interface SaveResult {
  novelId: number;
  /** Chapters that were not known before this call. */
  addedChapterIds: number[];
  /** True when the novel itself was created by this call. */
  created: boolean;
}

/**
 * Creates or updates a novel of a source and its chapter list. Fields edited by the user
 * are never overwritten, existing chapters keep their progress, and chapters that
 * disappeared from the site are kept.
 */
export function saveSourceNovel(
  db: AppDatabase,
  plugin: { id: string; lang?: string },
  path: string,
  fetched: FetchedNovel,
  now = Date.now(),
): SaveResult {
  const { novel: source } = fetched;
  return db.transaction((tx) => {
    const database = tx as unknown as AppDatabase;
    const existing = findSourceNovel(database, plugin.id, path);
    let novelId: number;
    if (existing) {
      novelId = existing.id;
    } else {
      novelId = tx
        .insert(novels)
        .values({
          origin: 'online',
          pluginId: plugin.id,
          sourcePath: path,
          title: source.name?.trim() || path,
          originalLang: languageCodeFromName(plugin.lang ?? ''),
          inLibrary: false,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: novels.id })
        .get().id;
    }
    applySourceMetadata(
      database,
      novelId,
      {
        title: source.name?.trim() || undefined,
        author: source.author?.trim() || null,
        description: source.summary?.trim() || null,
        genres: cleanGenres(source.genres),
        status: source.status ?? null,
      },
      now,
    );
    if (source.cover) {
      // A cover chosen by the user stays; the one of the source is kept to undo it.
      const customCover = parseEditedFields(existing ?? { editedFields: '[]' }).includes('cover');
      tx.update(novels)
        .set({
          originalCoverPath: source.cover,
          ...(customCover ? {} : { coverPath: source.cover }),
        })
        .where(eq(novels.id, novelId))
        .run();
    }

    const known = new Map(
      tx
        .select({ id: chapters.id, sourcePath: chapters.sourcePath, position: chapters.position })
        .from(chapters)
        .where(eq(chapters.novelId, novelId))
        .all()
        .map((chapter) => [chapter.sourcePath, chapter]),
    );
    const hadChapters = known.size > 0;
    const addedChapterIds: number[] = [];
    fetched.chapters.forEach((item, position) => {
      const current = known.get(item.path);
      if (current) {
        if (current.position !== position) {
          tx.update(chapters).set({ position }).where(eq(chapters.id, current.id)).run();
        }
        return;
      }
      const title = item.name?.trim() || `#${position + 1}`;
      const id = tx
        .insert(chapters)
        .values({
          novelId,
          position,
          number:
            typeof item.chapterNumber === 'number' && Number.isFinite(item.chapterNumber)
              ? item.chapterNumber
              : chapterNumberFromTitle(title),
          title,
          sourcePath: item.path,
          releaseTime: item.releaseTime ?? null,
          // Only chapters found by a later check count as "new chapters".
          foundAt: hadChapters ? now : null,
          createdAt: now,
        })
        .returning({ id: chapters.id })
        .get().id;
      addedChapterIds.push(id);
    });
    tx.update(novels)
      .set({
        lastCheckedAt: now,
        ...(hadChapters && addedChapterIds.length > 0 ? { lastUpdatedAt: now } : {}),
      })
      .where(eq(novels.id, novelId))
      .run();
    return { novelId, addedChapterIds, created: !existing };
  });
}

/** Cleans the HTML given by a plugin; image and link addresses become absolute. */
export function cleanChapterHtml(html: string, pageUrl: string): string {
  return sanitizeHtml(html, {
    resolveImage: (src) => (src ? absoluteUrl(src, pageUrl) : null),
    resolveLink: (href) => {
      const url = absoluteUrl(href, pageUrl);
      return url && /^https?:/i.test(url) ? url : null;
    },
  });
}

export class EmptyChapterError extends Error {
  constructor() {
    super('The source returned an empty chapter');
    this.name = 'EmptyChapterError';
  }
}

/**
 * Fetches the text of a chapter and stores it in the app. `downloaded` is false for the
 * copy kept while reading online, true for an explicit download.
 */
export async function fetchChapterText(
  db: AppDatabase,
  files: FileStore,
  plugin: SourcePlugin,
  chapter: Pick<Chapter, 'id' | 'novelId' | 'sourcePath'>,
  downloaded = false,
): Promise<string> {
  if (!chapter.sourcePath) {
    throw new EmptyChapterError();
  }
  const sourcePath = chapter.sourcePath;
  const raw = await runPluginCall(() => plugin.parseChapter(sourcePath));
  const html = cleanChapterHtml(raw ?? '', resolveSourceUrl(plugin, sourcePath));
  const text = htmlToText(html);
  if (text.trim() === '' && !/<img\b/i.test(html)) {
    throw new EmptyChapterError();
  }
  const path = chapterFile(chapter.novelId, chapter.id);
  files.writeText(path, html);
  db.update(chapters)
    .set({
      filePath: path,
      wordCount: countWords(text),
      ...(downloaded ? { isDownloaded: true } : {}),
    })
    .where(eq(chapters.id, chapter.id))
    .run();
  return html;
}

/**
 * Shows a novel found while browsing right away, before its details are fetched.
 * Returns the id of the novel (existing or new).
 */
export function ensureSourceNovel(
  db: AppDatabase,
  plugin: { id: string; lang?: string },
  item: { name: string; path: string; cover?: string },
  now = Date.now(),
): number {
  const existing = findSourceNovel(db, plugin.id, item.path);
  if (existing) {
    return existing.id;
  }
  return db
    .insert(novels)
    .values({
      origin: 'online',
      pluginId: plugin.id,
      sourcePath: item.path,
      title: item.name?.trim() || item.path,
      coverPath: item.cover || null,
      originalCoverPath: item.cover || null,
      originalLang: languageCodeFromName(plugin.lang ?? ''),
      inLibrary: false,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: novels.id })
    .get().id;
}

/** Deletes online novels that were opened from a source but neither kept nor read. */
export function removeVisitedNovels(db: AppDatabase): void {
  db.delete(novels)
    .where(
      and(
        eq(novels.origin, 'online'),
        eq(novels.inLibrary, false),
        isNull(novels.lastReadChapterId),
      ),
    )
    .run();
}

/** Paths of the novels of a source that are in the library (to mark search results). */
export function listLibraryPaths(db: AppDatabase, pluginId: string): Set<string> {
  return new Set(
    db
      .select({ path: novels.sourcePath })
      .from(novels)
      .where(and(eq(novels.pluginId, pluginId), eq(novels.inLibrary, true)))
      .all()
      .flatMap((row) => (row.path ? [row.path] : [])),
  );
}

export function setNovelInLibrary(
  db: AppDatabase,
  novelId: number,
  inLibrary: boolean,
  now = Date.now(),
): void {
  db.update(novels)
    .set({ inLibrary, ...(inLibrary ? { addedAt: now } : {}) })
    .where(eq(novels.id, novelId))
    .run();
}
