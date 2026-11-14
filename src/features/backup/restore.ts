/** Restores a backup: replacing everything, or merging it into what is on the phone. */
import { sql } from 'drizzle-orm';

import type { AppDatabase } from '../../db/client';
import type { FileStore } from '../../services/fileStore';
import {
  BACKUP_TABLES,
  insertRow,
  readTable,
  tableColumns,
  type BackupContent,
  type BackupTable,
  type Row,
} from './backupFile';

export interface RestoreSummary {
  novelsAdded: number;
  novelsUpdated: number;
  filesWritten: number;
}

/** Chapters whose text is not on the phone are shown as not downloaded. */
function fixMissingChapterFiles(db: AppDatabase, files: FileStore): void {
  const rows = db.all<{ id: number; file_path: string }>(
    sql.raw('SELECT id, file_path FROM chapters WHERE file_path IS NOT NULL'),
  );
  for (const row of rows) {
    if (!files.exists(row.file_path)) {
      db.run(sql`UPDATE chapters SET file_path = NULL, is_downloaded = 0 WHERE id = ${row.id}`);
    }
  }
  const translations = db.all<{ chapter_id: number; lang: string; file_path: string }>(
    sql.raw('SELECT chapter_id, lang, file_path FROM chapter_translations'),
  );
  for (const row of translations) {
    if (!files.exists(row.file_path)) {
      db.run(
        sql`DELETE FROM chapter_translations WHERE chapter_id = ${row.chapter_id} AND lang = ${row.lang}`,
      );
    }
  }
}

/** Replaces everything on the phone by the content of the backup. */
export function restoreReplacing(
  db: AppDatabase,
  files: FileStore,
  backup: BackupContent,
): RestoreSummary {
  db.transaction((tx) => {
    tx.run(sql.raw('DELETE FROM downloads'));
    for (const table of [...BACKUP_TABLES].reverse()) {
      tx.run(sql.raw(`DELETE FROM "${table}"`));
    }
    for (const table of BACKUP_TABLES) {
      const columns = tableColumns(db, table);
      for (const row of backup.tables[table]) {
        insertRow(tx, table, columns, row);
      }
    }
  });
  for (const root of ['novels', 'plugins', 'fonts']) {
    files.delete(root);
  }
  for (const [path, data] of backup.files) {
    files.writeBytes(path, data);
  }
  fixMissingChapterFiles(db, files);
  return {
    novelsAdded: backup.tables.novels.length,
    novelsUpdated: 0,
    filesWritten: backup.files.size,
  };
}

const lower = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toLocaleLowerCase();

/** Identity of a novel across two phones: its source, or its title and author. */
function novelKey(row: Row): string {
  return row.origin === 'online' && row.plugin_id && row.source_path
    ? `o|${String(row.plugin_id)}|${String(row.source_path)}`
    : `l|${lower(row.title)}|${lower(row.author)}`;
}

const without = (row: Row, ...names: string[]): Row =>
  Object.fromEntries(Object.entries(row).filter(([name]) => !names.includes(name)));

function insertReturningId(db: AppDatabase, table: string, columns: Set<string>, row: Row): number {
  insertRow(db, table, columns, row);
  return db.get<{ id: number }>(sql.raw('SELECT last_insert_rowid() AS id')).id;
}

/** Path of a file of a novel, moved under the id the novel has on this phone. */
const remapPath = (path: unknown, from: number, to: number): unknown =>
  typeof path === 'string' && path.startsWith(`novels/${from}/`)
    ? `novels/${to}/${path.slice(`novels/${from}/`.length)}`
    : path;

/**
 * Adds what the backup has and the phone lacks, and keeps the most advanced reading
 * progress. Settings and what already exists on the phone are never replaced.
 */
export function restoreMerging(
  db: AppDatabase,
  files: FileStore,
  backup: BackupContent,
): RestoreSummary {
  const columns = Object.fromEntries(
    BACKUP_TABLES.map((table) => [table, tableColumns(db, table)]),
  ) as Record<BackupTable, Set<string>>;
  const summary: RestoreSummary = { novelsAdded: 0, novelsUpdated: 0, filesWritten: 0 };
  /** Files to write once the database part succeeded: [path on this phone, data]. */
  const pendingFiles: [string, Uint8Array][] = [];
  const group = (rows: Row[], key: string) => {
    const map = new Map<unknown, Row[]>();
    for (const row of rows) {
      const list = map.get(row[key]) ?? [];
      list.push(row);
      map.set(row[key], list);
    }
    return map;
  };

  db.transaction((tx) => {
    const database = tx as unknown as AppDatabase;

    // Shelves and quote folders are matched by name.
    const mapByName = (table: 'categories' | 'quote_folders') => {
      const existing = new Map(readTable(database, table).map((row) => [lower(row.name), row]));
      let position = existing.size;
      const ids = new Map<unknown, number>();
      for (const row of backup.tables[table]) {
        const known = existing.get(lower(row.name));
        if (known) {
          ids.set(row.id, known.id as number);
        } else {
          const id = insertReturningId(database, table, columns[table], {
            ...without(row, 'id'),
            position,
          });
          position += 1;
          ids.set(row.id, id);
          existing.set(lower(row.name), { ...row, id });
        }
      }
      return ids;
    };
    const categoryIds = mapByName('categories');
    const folderIds = mapByName('quote_folders');

    // Sources: installed plugins and repositories the phone does not have.
    const knownPlugins = new Set(readTable(database, 'plugins').map((row) => row.id));
    for (const row of backup.tables.plugins) {
      if (!knownPlugins.has(row.id)) {
        insertRow(database, 'plugins', columns.plugins, row);
        for (const [path, data] of backup.files) {
          if (path.startsWith(`plugins/${String(row.id)}/`)) {
            pendingFiles.push([path, data]);
          }
        }
      }
    }
    const knownRepos = new Set(readTable(database, 'plugin_repos').map((row) => row.url));
    for (const row of backup.tables.plugin_repos) {
      if (!knownRepos.has(row.url)) {
        insertRow(database, 'plugin_repos', columns.plugin_repos, row);
      }
    }

    const existingNovels = new Map(
      readTable(database, 'novels').map((row) => [novelKey(row), row]),
    );
    const volumesByNovel = group(backup.tables.volumes, 'novel_id');
    const chaptersByNovel = group(backup.tables.chapters, 'novel_id');
    const translationsByChapter = group(backup.tables.chapter_translations, 'chapter_id');
    const sessionsByNovel = group(backup.tables.reading_sessions, 'novel_id');
    const historyByNovel = group(backup.tables.history, 'novel_id');
    const quotesByNovel = group(backup.tables.quotes, 'novel_id');
    const glossaryByNovel = group(backup.tables.glossary_terms, 'novel_id');
    const replacementsByNovel = group(backup.tables.text_replacements, 'novel_id');
    const linksByQuote = group(backup.tables.quote_folder_items, 'quote_id');
    const categoriesByNovel = group(backup.tables.novel_categories, 'novel_id');

    for (const novel of backup.tables.novels) {
      const oldId = novel.id as number;
      const current = existingNovels.get(novelKey(novel));

      if (current) {
        // Same novel on both sides: keep the most advanced progress of each chapter.
        const currentId = current.id as number;
        const currentChapters = db.all<Row>(
          sql`SELECT id, source_path, position, is_read, progress, is_favorite FROM chapters WHERE novel_id = ${currentId}`,
        );
        const byKey = new Map(
          currentChapters.map((row) => [
            row.source_path ? `s|${String(row.source_path)}` : `p|${String(row.position)}`,
            row,
          ]),
        );
        let changed = false;
        for (const chapter of chaptersByNovel.get(oldId) ?? []) {
          const mine = byKey.get(
            chapter.source_path
              ? `s|${String(chapter.source_path)}`
              : `p|${String(chapter.position)}`,
          );
          if (!mine) {
            continue;
          }
          const read = Number(mine.is_read) === 1 || Number(chapter.is_read) === 1;
          const progress = Math.max(Number(mine.progress) || 0, Number(chapter.progress) || 0);
          const favorite = Number(mine.is_favorite) === 1 || Number(chapter.is_favorite) === 1;
          const takeTheirs =
            (Number(chapter.is_read) === 1 && Number(mine.is_read) !== 1) ||
            (Number(chapter.progress) || 0) > (Number(mine.progress) || 0);
          if (takeTheirs || favorite !== (Number(mine.is_favorite) === 1)) {
            tx.run(
              sql`UPDATE chapters SET is_read = ${read ? 1 : 0}, progress = ${progress}, is_favorite = ${
                favorite ? 1 : 0
              }, read_at = coalesce(read_at, ${(chapter.read_at as number | null) ?? null}), position_anchor = ${
                takeTheirs
                  ? ((chapter.position_anchor as string | null) ?? null)
                  : sql`position_anchor`
              } WHERE id = ${mine.id as number}`,
            );
            changed = true;
          }
        }
        if (Number(novel.in_library) === 1 && Number(current.in_library) !== 1) {
          tx.run(sql`UPDATE novels SET in_library = 1 WHERE id = ${currentId}`);
          changed = true;
        }
        if (changed) {
          summary.novelsUpdated += 1;
        }
        continue;
      }

      // A novel the phone does not have: copied with everything attached to it.
      const newId = insertReturningId(database, 'novels', columns.novels, {
        ...without(novel, 'id', 'last_read_chapter_id'),
        cover_path: novel.cover_path,
        original_cover_path: novel.original_cover_path,
      });
      tx.run(
        sql`UPDATE novels SET cover_path = ${remapPath(novel.cover_path, oldId, newId) as string | null}, original_cover_path = ${
          remapPath(novel.original_cover_path, oldId, newId) as string | null
        } WHERE id = ${newId}`,
      );
      summary.novelsAdded += 1;
      existingNovels.set(novelKey(novel), { ...novel, id: newId });

      const volumeIds = new Map<unknown, number>();
      for (const volume of volumesByNovel.get(oldId) ?? []) {
        volumeIds.set(
          volume.id,
          insertReturningId(database, 'volumes', columns.volumes, {
            ...without(volume, 'id'),
            novel_id: newId,
          }),
        );
      }
      const chapterIds = new Map<unknown, number>();
      for (const chapter of chaptersByNovel.get(oldId) ?? []) {
        const id = insertReturningId(database, 'chapters', columns.chapters, {
          ...without(chapter, 'id'),
          novel_id: newId,
          volume_id: chapter.volume_id === null ? null : (volumeIds.get(chapter.volume_id) ?? null),
          file_path: null,
          original_file_path: null,
        });
        chapterIds.set(chapter.id, id);
        // Chapter files are named after the chapter id: they move with it.
        const rename = (path: unknown) =>
          typeof path === 'string'
            ? (remapPath(path, oldId, newId) as string).replace(
                new RegExp(`/${String(chapter.id)}(\\.original)?\\.html$`),
                `/${id}$1.html`,
              )
            : null;
        const filePath = rename(chapter.file_path);
        const originalPath = rename(chapter.original_file_path);
        tx.run(
          sql`UPDATE chapters SET file_path = ${filePath}, original_file_path = ${originalPath} WHERE id = ${id}`,
        );
        for (const [from, to] of [
          [chapter.file_path, filePath],
          [chapter.original_file_path, originalPath],
        ] as const) {
          const data = typeof from === 'string' ? backup.files.get(from) : undefined;
          if (data && to) {
            pendingFiles.push([to, data]);
          }
        }
        for (const translation of translationsByChapter.get(chapter.id) ?? []) {
          const from = String(translation.file_path);
          const to = (remapPath(from, oldId, newId) as string).replace(
            new RegExp(`/${String(chapter.id)}\\.html$`),
            `/${id}.html`,
          );
          insertRow(database, 'chapter_translations', columns.chapter_translations, {
            ...translation,
            chapter_id: id,
            file_path: to,
          });
          const data = backup.files.get(from);
          if (data) {
            pendingFiles.push([to, data]);
          }
        }
      }
      if (novel.last_read_chapter_id !== null && chapterIds.has(novel.last_read_chapter_id)) {
        tx.run(
          sql`UPDATE novels SET last_read_chapter_id = ${chapterIds.get(novel.last_read_chapter_id) as number} WHERE id = ${newId}`,
        );
      }
      // Other files of the novel: covers, images, kept stylesheet.
      for (const [path, data] of backup.files) {
        if (
          path.startsWith(`novels/${oldId}/`) &&
          !/^novels\/\d+\/(chapters|translations)\//.test(path)
        ) {
          pendingFiles.push([remapPath(path, oldId, newId) as string, data]);
        }
      }

      const mapChapter = (id: unknown) => (id === null ? null : (chapterIds.get(id) ?? null));
      for (const session of sessionsByNovel.get(oldId) ?? []) {
        insertRow(database, 'reading_sessions', columns.reading_sessions, {
          ...without(session, 'id'),
          novel_id: newId,
          chapter_id: mapChapter(session.chapter_id),
        });
      }
      for (const entry of historyByNovel.get(oldId) ?? []) {
        const chapterId = mapChapter(entry.chapter_id);
        if (chapterId !== null) {
          insertRow(database, 'history', columns.history, {
            ...without(entry, 'id'),
            novel_id: newId,
            chapter_id: chapterId,
          });
        }
      }
      for (const quote of quotesByNovel.get(oldId) ?? []) {
        const quoteId = insertReturningId(database, 'quotes', columns.quotes, {
          ...without(quote, 'id'),
          novel_id: newId,
          chapter_id: mapChapter(quote.chapter_id),
        });
        for (const link of linksByQuote.get(quote.id) ?? []) {
          const folderId = folderIds.get(link.folder_id);
          if (folderId !== undefined) {
            insertRow(database, 'quote_folder_items', columns.quote_folder_items, {
              quote_id: quoteId,
              folder_id: folderId,
            });
          }
        }
      }
      for (const term of glossaryByNovel.get(oldId) ?? []) {
        insertRow(database, 'glossary_terms', columns.glossary_terms, {
          ...without(term, 'id'),
          novel_id: newId,
        });
      }
      for (const rule of replacementsByNovel.get(oldId) ?? []) {
        insertRow(database, 'text_replacements', columns.text_replacements, {
          ...without(rule, 'id'),
          novel_id: newId,
        });
      }
      for (const link of categoriesByNovel.get(oldId) ?? []) {
        const categoryId = categoryIds.get(link.category_id);
        if (categoryId !== undefined) {
          insertRow(database, 'novel_categories', columns.novel_categories, {
            novel_id: newId,
            category_id: categoryId,
          });
        }
      }
    }

    // Global replacement rules the phone does not have yet.
    const knownRules = new Set(
      readTable(database, 'text_replacements')
        .filter((row) => row.novel_id === null)
        .map((row) => `${String(row.pattern)}|${String(row.replacement)}|${String(row.is_regex)}`),
    );
    for (const rule of replacementsByNovel.get(null) ?? []) {
      const key = `${String(rule.pattern)}|${String(rule.replacement)}|${String(rule.is_regex)}`;
      if (!knownRules.has(key)) {
        insertRow(database, 'text_replacements', columns.text_replacements, without(rule, 'id'));
      }
    }
  });

  for (const [path, data] of pendingFiles) {
    files.writeBytes(path, data);
  }
  summary.filesWritten = pendingFiles.length;
  fixMissingChapterFiles(db, files);
  return summary;
}
