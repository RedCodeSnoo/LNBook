/** Looks for new chapters of the followed novels and lists them for the Updates tab. */
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';

import type { AppDatabase } from '../../db/client';
import { categories, chapters, novelCategories, novels, type Novel } from '../../db/schema';
import { PluginError, toPluginError } from '../../plugins/pluginErrors';
import type { SourcePlugin } from '../../plugins/types';
import { startOfDay } from '../../services/format';
import { fetchSourceNovel, saveSourceNovel } from '../browse/sourceNovels';

export const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** True when the last check is old enough for an automatic check at launch. */
export function isCheckDue(lastCheckAt: number | null, now: number): boolean {
  return lastCheckAt === null || now - lastCheckAt >= AUTO_CHECK_INTERVAL_MS;
}

type Followed = Pick<
  Novel,
  'id' | 'title' | 'pluginId' | 'sourcePath' | 'notifyUpdates' | 'autoDownload'
>;

/**
 * Novels of the library linked to a source (online ones, and downloaded ones that became
 * local), except those placed in a category excluded from the check.
 */
export function listNovelsToCheck(db: AppDatabase): Followed[] {
  const excluded = new Set(
    db
      .select({ novelId: novelCategories.novelId })
      .from(novelCategories)
      .innerJoin(categories, eq(categories.id, novelCategories.categoryId))
      .where(eq(categories.excludeFromUpdates, true))
      .all()
      .map((row) => row.novelId),
  );
  return db
    .select({
      id: novels.id,
      title: novels.title,
      pluginId: novels.pluginId,
      sourcePath: novels.sourcePath,
      notifyUpdates: novels.notifyUpdates,
      autoDownload: novels.autoDownload,
    })
    .from(novels)
    .where(
      and(eq(novels.inLibrary, true), isNotNull(novels.pluginId), isNotNull(novels.sourcePath)),
    )
    .all()
    .filter((novel) => !excluded.has(novel.id));
}

export interface NovelUpdate {
  novelId: number;
  title: string;
  chapterIds: number[];
  notify: boolean;
  autoDownload: boolean;
}

export interface SourceFailure {
  pluginId: string;
  kind: PluginError['kind'];
  /** Novels of this source that could not be checked. */
  count: number;
}

export interface CheckResult {
  checked: number;
  updates: NovelUpdate[];
  failures: SourceFailure[];
}

export interface CheckDeps {
  db: AppDatabase;
  getPlugin(pluginId: string): SourcePlugin;
  /** Milliseconds between two requests to the same source. */
  delayMs(): number;
  wait(ms: number): Promise<void>;
  now(): number;
  onProgress?(done: number, total: number, title: string): void;
  /** Lets the caller interrupt a long check. */
  shouldStop?(): boolean;
}

/**
 * Checks every followed novel, one after the other. A source that fails is reported and
 * skipped for the rest of the check; the others carry on.
 */
export async function checkForNewChapters(deps: CheckDeps): Promise<CheckResult> {
  const followed = listNovelsToCheck(deps.db);
  const updates: NovelUpdate[] = [];
  const failures = new Map<string, SourceFailure>();
  const lastRequest = new Map<string, number>();
  let checked = 0;

  for (const [index, novel] of followed.entries()) {
    if (deps.shouldStop?.()) {
      break;
    }
    const pluginId = novel.pluginId as string;
    const failure = failures.get(pluginId);
    if (failure) {
      // The site is down or blocked: do not hammer it for every novel.
      failure.count += 1;
      continue;
    }
    deps.onProgress?.(index, followed.length, novel.title);
    const since = deps.now() - (lastRequest.get(pluginId) ?? -Infinity);
    if (since < deps.delayMs()) {
      await deps.wait(deps.delayMs() - since);
    }
    try {
      const plugin = deps.getPlugin(pluginId);
      const fetched = await fetchSourceNovel(plugin, novel.sourcePath as string);
      const saved = saveSourceNovel(
        deps.db,
        { id: pluginId },
        novel.sourcePath as string,
        fetched,
        deps.now(),
      );
      checked += 1;
      if (saved.addedChapterIds.length > 0) {
        updates.push({
          novelId: novel.id,
          title: novel.title,
          chapterIds: saved.addedChapterIds,
          notify: novel.notifyUpdates,
          autoDownload: novel.autoDownload,
        });
      }
    } catch (error) {
      failures.set(pluginId, { pluginId, kind: toPluginError(error).kind, count: 1 });
    }
    lastRequest.set(pluginId, deps.now());
  }
  return { checked, updates, failures: [...failures.values()] };
}

export interface UpdateRow {
  chapterId: number;
  novelId: number;
  novelTitle: string;
  coverPath: string | null;
  chapterTitle: string;
  foundAt: number;
  isRead: boolean;
  isDownloaded: boolean;
}

/** New chapters found by the checks, most recent first. */
export function listUpdates(db: AppDatabase, limit = 500): UpdateRow[] {
  return db
    .select({
      chapterId: chapters.id,
      novelId: novels.id,
      novelTitle: novels.title,
      coverPath: novels.coverPath,
      chapterTitle: chapters.title,
      foundAt: chapters.foundAt,
      isRead: chapters.isRead,
      isDownloaded: chapters.isDownloaded,
    })
    .from(chapters)
    .innerJoin(novels, eq(novels.id, chapters.novelId))
    .where(and(isNotNull(chapters.foundAt), eq(novels.inLibrary, true)))
    .orderBy(desc(chapters.foundAt), desc(chapters.position))
    .limit(limit)
    .all() as UpdateRow[];
}

/** Number shown on the Updates tab: new chapters not read yet. */
export function countUnreadUpdates(db: AppDatabase): number {
  return listUpdates(db).filter((row) => !row.isRead).length;
}

export type UpdateItem =
  { type: 'day'; key: string; day: number } | { type: 'chapter'; key: string; row: UpdateRow };

export function groupUpdatesByDay(rows: UpdateRow[]): UpdateItem[] {
  const items: UpdateItem[] = [];
  let currentDay: number | null = null;
  for (const row of rows) {
    const day = startOfDay(row.foundAt);
    if (day !== currentDay) {
      currentDay = day;
      items.push({ type: 'day', key: `d${day}`, day });
    }
    items.push({ type: 'chapter', key: `c${row.chapterId}`, row });
  }
  return items;
}

/** Empties the Updates tab (the chapters themselves are kept). */
export function clearUpdates(db: AppDatabase): void {
  db.update(chapters).set({ foundAt: null }).where(isNotNull(chapters.foundAt)).run();
}

export function setNovelUpdateOptions(
  db: AppDatabase,
  novelIds: number[],
  options: { notifyUpdates?: boolean; autoDownload?: boolean },
): void {
  if (novelIds.length > 0 && Object.keys(options).length > 0) {
    db.update(novels).set(options).where(inArray(novels.id, novelIds)).run();
  }
}
