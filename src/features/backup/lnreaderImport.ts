/**
 * Import of a backup made by the LNReader app: library, categories, reading progress and
 * the sources used. What LNBook has no equivalent for is skipped and listed.
 *
 * Format (LNReader `src/services/backup`): a zip holding `Version.json`, `Category.json`,
 * `Setting.json`, `Plugins.json`, a `NovelAndChapters/<id>.json` file per novel (the novel
 * fields plus its `chapters`), and `Covers/`. Older backups nest these in a `data.zip`.
 */
import { and, eq } from 'drizzle-orm';
import { strFromU8, unzipSync } from 'fflate';

import type { AppDatabase } from '../../db/client';
import { categories, chapters, novelCategories, novels } from '../../db/schema';
import type { PluginItem } from '../../plugins/types';
import { chapterNumberFromTitle } from '../novel/chapterNumber';

interface LnChapter {
  path?: unknown;
  name?: unknown;
  releaseTime?: unknown;
  bookmark?: unknown;
  unread?: unknown;
  readTime?: unknown;
  chapterNumber?: unknown;
  position?: unknown;
  progress?: unknown;
}

interface LnNovel {
  id?: unknown;
  path?: unknown;
  pluginId?: unknown;
  name?: unknown;
  cover?: unknown;
  summary?: unknown;
  author?: unknown;
  status?: unknown;
  genres?: unknown;
  inLibrary?: unknown;
  isLocal?: unknown;
  chapters?: unknown;
}

interface LnCategory {
  name?: unknown;
  sort?: unknown;
  novelIds?: unknown;
}

export interface LnReaderBackup {
  appVersion: string | null;
  novels: LnNovel[];
  categories: LnCategory[];
  /** Sources that were installed in LNReader, with the address of their code. */
  plugins: PluginItem[];
  /** Parts of the file that are not imported (shown in the summary). */
  ignored: IgnoredItem[];
}

export type IgnoredItem =
  | { kind: 'settings' | 'downloads' | 'covers' }
  | { kind: 'localNovel' | 'invalidNovel' | 'unknownFile'; name: string };

export class NotLnReaderBackupError extends Error {
  constructor() {
    super('Not an LNReader backup');
    this.name = 'NotLnReaderBackupError';
  }
}

const truthy = (value: unknown) => value === true || value === 1 || value === '1';
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

function parseJson(data: Uint8Array | undefined): unknown {
  if (!data) {
    return undefined;
  }
  try {
    return JSON.parse(strFromU8(data));
  } catch {
    return undefined;
  }
}

/** Reads an LNReader backup file. Throws when the file is something else. */
export function parseLnReaderBackup(data: Uint8Array): LnReaderBackup {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data);
  } catch {
    throw new NotLnReaderBackupError();
  }
  // Older backups keep the data in a nested archive.
  const nested = Object.keys(entries).find((name) => /(^|\/)data\.zip$/.test(name));
  if (nested) {
    try {
      entries = { ...entries, ...unzipSync(entries[nested]) };
    } catch {
      throw new NotLnReaderBackupError();
    }
  }
  // Entries may be prefixed by the name of the zipped folder.
  const find = (name: string) =>
    Object.keys(entries).find((entry) => entry === name || entry.endsWith(`/${name}`));
  const novelFiles = Object.keys(entries).filter((name) =>
    /(^|\/)NovelAndChapters\/[^/]+\.json$/.test(name),
  );
  const versionEntry = find('Version.json');
  if (!versionEntry && novelFiles.length === 0) {
    throw new NotLnReaderBackupError();
  }

  const ignored: IgnoredItem[] = [];
  const version = parseJson(versionEntry ? entries[versionEntry] : undefined) as
    { appVersion?: unknown; version?: unknown } | undefined;

  const parsedNovels: LnNovel[] = [];
  for (const name of novelFiles) {
    const novel = parseJson(entries[name]) as LnNovel | undefined;
    const label = text(novel?.name) ?? name.split('/').pop() ?? name;
    if (!novel || typeof novel !== 'object') {
      ignored.push({ kind: 'invalidNovel', name: label });
    } else if (truthy(novel.isLocal) || novel.pluginId === 'local') {
      // Files imported into LNReader: their content is not in a form LNBook can reuse.
      ignored.push({ kind: 'localNovel', name: label });
    } else if (!text(novel.pluginId) || !text(novel.path)) {
      ignored.push({ kind: 'invalidNovel', name: label });
    } else {
      parsedNovels.push(novel);
    }
  }

  const categoryEntry = find('Category.json');
  const categoryList = parseJson(categoryEntry ? entries[categoryEntry] : undefined);
  const pluginEntry = find('Plugins.json');
  let pluginList = parseJson(pluginEntry ? entries[pluginEntry] : undefined);
  if (typeof pluginList === 'string') {
    try {
      pluginList = JSON.parse(pluginList);
    } catch {
      pluginList = [];
    }
  }

  if (find('Setting.json')) {
    ignored.push({ kind: 'settings' });
  }
  const names = Object.keys(entries);
  if (names.some((name) => /(^|\/)(download|novel-files)\.zip$/.test(name))) {
    ignored.push({ kind: 'downloads' });
  }
  if (names.some((name) => /(^|\/)Covers\/[^/]+$/.test(name))) {
    ignored.push({ kind: 'covers' });
  }
  for (const name of names) {
    const base = name.split('/').pop() ?? '';
    if (
      base !== '' &&
      !/(^|\/)(NovelAndChapters|Covers)\//.test(name) &&
      !/^(Version|Category|Setting|Plugins)\.json$/.test(base) &&
      !/\.zip$/.test(base)
    ) {
      ignored.push({ kind: 'unknownFile', name: base });
    }
  }

  return {
    appVersion: text(version?.appVersion) ?? text(version?.version),
    novels: parsedNovels,
    categories: Array.isArray(categoryList) ? (categoryList as LnCategory[]) : [],
    plugins: (Array.isArray(pluginList) ? pluginList : []).filter(
      (plugin): plugin is PluginItem =>
        !!plugin && typeof plugin.id === 'string' && typeof plugin.url === 'string',
    ),
    ignored,
  };
}

export interface LnReaderImportSummary {
  novelsAdded: number;
  /** Novels already on the phone whose progress was completed. */
  novelsMerged: number;
  chapters: number;
  categoriesAdded: number;
  /** Sources used by the imported novels, by plugin id. */
  sources: string[];
  /** Sources that can be installed from the backup (address of their code known). */
  installable: PluginItem[];
  ignored: IgnoredItem[];
}

const toTime = (value: unknown): number | null => {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  // SQLite "YYYY-MM-DD HH:MM:SS" (UTC) or ISO.
  const parsed = Date.parse(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Writes the content of an LNReader backup into the library. */
export function importLnReaderBackup(
  db: AppDatabase,
  backup: LnReaderBackup,
  installedPluginIds: ReadonlySet<string>,
  now = Date.now(),
): LnReaderImportSummary {
  const summary: LnReaderImportSummary = {
    novelsAdded: 0,
    novelsMerged: 0,
    chapters: 0,
    categoriesAdded: 0,
    sources: [],
    installable: [],
    ignored: backup.ignored,
  };
  const novelIds = new Map<unknown, number>();
  const sources = new Set<string>();

  db.transaction((tx) => {
    for (const source of backup.novels) {
      const pluginId = String(source.pluginId);
      const path = String(source.path);
      sources.add(pluginId);
      const list = (Array.isArray(source.chapters) ? source.chapters : []) as LnChapter[];
      const existing = tx
        .select({ id: novels.id, inLibrary: novels.inLibrary })
        .from(novels)
        .where(and(eq(novels.pluginId, pluginId), eq(novels.sourcePath, path)))
        .get();

      let novelId: number;
      if (existing) {
        novelId = existing.id;
        summary.novelsMerged += 1;
        if (truthy(source.inLibrary) && !existing.inLibrary) {
          tx.update(novels)
            .set({ inLibrary: true, addedAt: now })
            .where(eq(novels.id, novelId))
            .run();
        }
      } else {
        const cover = text(source.cover);
        novelId = tx
          .insert(novels)
          .values({
            origin: 'online',
            pluginId,
            sourcePath: path,
            title: text(source.name) ?? path,
            author: text(source.author),
            description: text(source.summary),
            status: text(source.status),
            genres: text(source.genres),
            // Covers stored inside LNReader are not reusable: the source gives it again.
            coverPath: cover && /^https?:\/\//i.test(cover) ? cover : null,
            inLibrary: truthy(source.inLibrary),
            addedAt: truthy(source.inLibrary) ? now : null,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: novels.id })
          .get().id;
        summary.novelsAdded += 1;
      }
      novelIds.set(source.id, novelId);

      const known = new Map(
        tx
          .select({
            id: chapters.id,
            sourcePath: chapters.sourcePath,
            isRead: chapters.isRead,
            progress: chapters.progress,
            isFavorite: chapters.isFavorite,
          })
          .from(chapters)
          .where(eq(chapters.novelId, novelId))
          .all()
          .map((row) => [row.sourcePath, row]),
      );
      const ordered = [...list].sort(
        (a, b) => (Number(a.position) || 0) - (Number(b.position) || 0),
      );
      ordered.forEach((chapter, index) => {
        const chapterPath = text(chapter.path);
        if (!chapterPath) {
          return;
        }
        const isRead = chapter.unread !== undefined && !truthy(chapter.unread);
        // LNReader stores the progress as a percentage.
        const progress = Math.max(0, Math.min(1, (Number(chapter.progress) || 0) / 100));
        const favorite = truthy(chapter.bookmark);
        const mine = known.get(chapterPath);
        if (mine) {
          if (
            (isRead && !mine.isRead) ||
            progress > mine.progress ||
            (favorite && !mine.isFavorite)
          ) {
            tx.update(chapters)
              .set({
                isRead: mine.isRead || isRead,
                progress: Math.max(mine.progress, progress),
                isFavorite: mine.isFavorite || favorite,
              })
              .where(eq(chapters.id, mine.id))
              .run();
          }
          return;
        }
        const title = text(chapter.name) ?? `#${index + 1}`;
        const number = Number(chapter.chapterNumber);
        tx.insert(chapters)
          .values({
            novelId,
            position: known.size + index,
            number:
              chapter.chapterNumber !== null &&
              chapter.chapterNumber !== undefined &&
              Number.isFinite(number)
                ? number
                : chapterNumberFromTitle(title),
            title,
            sourcePath: chapterPath,
            releaseTime: text(chapter.releaseTime),
            isRead,
            readAt: isRead ? (toTime(chapter.readTime) ?? now) : null,
            progress: isRead ? 1 : progress,
            isFavorite: favorite,
            createdAt: now,
          })
          .run();
        summary.chapters += 1;
      });
    }

    // Categories are matched by name; LNReader's built-in ones have no meaning here.
    const existingCategories = new Map(
      tx
        .select()
        .from(categories)
        .all()
        .map((category) => [category.name.trim().toLocaleLowerCase(), category.id]),
    );
    let position = existingCategories.size;
    for (const category of backup.categories) {
      const name = text(category.name);
      const members = (Array.isArray(category.novelIds) ? category.novelIds : [])
        .map((id) => novelIds.get(id))
        .filter((id): id is number => id !== undefined);
      if (!name || members.length === 0 || /^(default|local)$/i.test(name)) {
        continue;
      }
      let categoryId = existingCategories.get(name.toLocaleLowerCase());
      if (categoryId === undefined) {
        categoryId = tx
          .insert(categories)
          .values({ name, position })
          .returning({ id: categories.id })
          .get().id;
        position += 1;
        existingCategories.set(name.toLocaleLowerCase(), categoryId);
        summary.categoriesAdded += 1;
      }
      for (const novelId of members) {
        tx.insert(novelCategories).values({ novelId, categoryId }).onConflictDoNothing().run();
      }
    }
  });

  summary.sources = [...sources].sort();
  summary.installable = backup.plugins.filter(
    (plugin) => sources.has(plugin.id) && !installedPluginIds.has(plugin.id),
  );
  return summary;
}
