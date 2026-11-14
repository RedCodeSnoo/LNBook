/**
 * Backup file: a zip with the content of the database (one JSON file per table), the
 * files of the app (covers, plugins, fonts and, optionally, chapters and translations)
 * and a manifest. Tables are stored by column name, so an old backup can be restored
 * into a newer schema: migrations only ever add columns.
 */
import { sql } from 'drizzle-orm';
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';

import type { AppDatabase } from '../../db/client';
import type { FileStore } from '../../services/fileStore';

export const BACKUP_FORMAT = 1;

/** Tables saved, in an order that respects their references (parents first). */
export const BACKUP_TABLES = [
  'categories',
  'novels',
  'volumes',
  'chapters',
  'chapter_translations',
  'glossary_terms',
  'novel_categories',
  'reading_sessions',
  'history',
  'quote_folders',
  'quotes',
  'quote_folder_items',
  'plugins',
  'plugin_repos',
  'text_replacements',
  'settings',
] as const;

export type BackupTable = (typeof BACKUP_TABLES)[number];
export type Row = Record<string, unknown>;

export interface BackupManifest {
  app: 'LNBook';
  format: number;
  /** Version of the database schema the data was read from. */
  schemaVersion: number;
  appVersion: string;
  createdAt: number;
  includesChapters: boolean;
  includesTranslations: boolean;
}

export interface BackupOptions {
  schemaVersion: number;
  appVersion: string;
  includeChapters: boolean;
  includeTranslations: boolean;
  now?: number;
}

export interface BackupContent {
  manifest: BackupManifest;
  tables: Record<BackupTable, Row[]>;
  /** Files by path relative to the app storage. */
  files: Map<string, Uint8Array>;
}

export class BackupError extends Error {
  constructor(
    readonly code: 'notBackup' | 'tooRecent' | 'corrupted',
    message: string,
  ) {
    super(message);
    this.name = 'BackupError';
  }
}

export function readTable(db: AppDatabase, table: string): Row[] {
  return db.all<Row>(sql.raw(`SELECT * FROM "${table}"`));
}

/** Every file under a path (a directory or a single file). */
export function walkFiles(files: FileStore, path: string, out: string[] = []): string[] {
  const entries = files.list(path);
  if (entries.length === 0) {
    if (files.exists(path)) {
      out.push(path);
    }
    return out;
  }
  for (const name of entries) {
    walkFiles(files, `${path}/${name}`, out);
  }
  return out;
}

function shouldInclude(path: string, options: BackupOptions): boolean {
  const match = /^novels\/\d+\/([^/]+)/.exec(path);
  if (!match) {
    return true;
  }
  if (match[1] === 'chapters' || match[1] === 'images') {
    return options.includeChapters;
  }
  if (match[1] === 'translations') {
    return options.includeTranslations;
  }
  // Covers and the kept stylesheet of imported books.
  return true;
}

/** Secrets never leave the phone: the DeepL key lives in the secure store, not here. */
const EXCLUDED_SETTINGS = /^(deepl|secret)/i;

export function collectBackup(
  db: AppDatabase,
  files: FileStore,
  options: BackupOptions,
): BackupContent {
  const tables = {} as Record<BackupTable, Row[]>;
  for (const table of BACKUP_TABLES) {
    tables[table] = readTable(db, table);
  }
  tables.settings = tables.settings.filter((row) => !EXCLUDED_SETTINGS.test(String(row.key)));

  const stored = new Map<string, Uint8Array>();
  for (const root of ['novels', 'plugins', 'fonts']) {
    for (const path of walkFiles(files, root)) {
      if (shouldInclude(path, options)) {
        stored.set(path, files.readBytes(path));
      }
    }
  }
  return {
    manifest: {
      app: 'LNBook',
      format: BACKUP_FORMAT,
      schemaVersion: options.schemaVersion,
      appVersion: options.appVersion,
      createdAt: options.now ?? Date.now(),
      includesChapters: options.includeChapters,
      includesTranslations: options.includeTranslations,
    },
    tables,
    files: stored,
  };
}

export function packBackup(content: BackupContent): Uint8Array {
  const entries: Zippable = {
    'manifest.json': strToU8(JSON.stringify(content.manifest, null, 2)),
  };
  for (const table of BACKUP_TABLES) {
    entries[`data/${table}.json`] = strToU8(JSON.stringify(content.tables[table]));
  }
  for (const [path, data] of content.files) {
    entries[`files/${path}`] = [data, { level: /\.(html|css|js|json)$/.test(path) ? 6 : 0 }];
  }
  return zipSync(entries);
}

/** Reads a backup file. `supportedSchema` is the schema version of this app. */
export function unpackBackup(data: Uint8Array, supportedSchema: number): BackupContent {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data);
  } catch {
    throw new BackupError('notBackup', 'Not a zip file');
  }
  if (!entries['manifest.json']) {
    throw new BackupError('notBackup', 'No manifest');
  }
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(strFromU8(entries['manifest.json'])) as BackupManifest;
  } catch {
    throw new BackupError('corrupted', 'Unreadable manifest');
  }
  if (manifest.app !== 'LNBook' || typeof manifest.schemaVersion !== 'number') {
    throw new BackupError('notBackup', 'Not an LNBook backup');
  }
  if (manifest.format > BACKUP_FORMAT || manifest.schemaVersion > supportedSchema) {
    throw new BackupError('tooRecent', 'Backup made by a newer version of the app');
  }
  const tables = {} as Record<BackupTable, Row[]>;
  for (const table of BACKUP_TABLES) {
    const entry = entries[`data/${table}.json`];
    try {
      // A table missing from an old backup is simply empty.
      const rows: unknown = entry ? JSON.parse(strFromU8(entry)) : [];
      tables[table] = Array.isArray(rows) ? (rows as Row[]) : [];
    } catch {
      throw new BackupError('corrupted', `Unreadable table ${table}`);
    }
  }
  const files = new Map<string, Uint8Array>();
  for (const [name, content] of Object.entries(entries)) {
    // Paths stay inside the app storage whatever the archive says.
    if (name.startsWith('files/') && !name.endsWith('/') && !name.includes('..')) {
      files.set(name.slice('files/'.length), content);
    }
  }
  return { manifest, tables, files };
}

/** Names of the columns a table has in this version of the app. */
export function tableColumns(db: AppDatabase, table: string): Set<string> {
  return new Set(
    db.all<{ name: string }>(sql.raw(`PRAGMA table_info("${table}")`)).map((row) => row.name),
  );
}

/** Inserts a row given by column name, ignoring columns this version does not know. */
export function insertRow(
  db: Pick<AppDatabase, 'run'>,
  table: string,
  columns: ReadonlySet<string>,
  row: Row,
): void {
  const names = Object.keys(row).filter((name) => columns.has(name));
  if (names.length === 0) {
    return;
  }
  db.run(
    sql`INSERT INTO ${sql.identifier(table)} (${sql.join(
      names.map((name) => sql.identifier(name)),
      sql`, `,
    )}) VALUES (${sql.join(
      names.map((name) => sql`${row[name] as string | number | null}`),
      sql`, `,
    )})`,
  );
}

/** File name proposed for a backup: "LNBook-2026-11-14-0930.zip". */
export function backupFileName(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `LNBook-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}.zip`;
}

/** Among automatic backups, the names to delete so that only the most recent `keep` stay. */
export function backupsToDelete(names: string[], keep = 5): string[] {
  return names
    .filter((name) => /^LNBook-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/.test(name))
    .sort()
    .reverse()
    .slice(keep);
}

export type AutoBackupFrequency = 'off' | 'daily' | 'weekly';

const DAY_MS = 24 * 60 * 60 * 1000;

/** True when the automatic backup has to run again. */
export function isAutoBackupDue(
  frequency: AutoBackupFrequency,
  lastBackupAt: number | null,
  now: number,
): boolean {
  if (frequency === 'off') {
    return false;
  }
  const interval = frequency === 'daily' ? DAY_MS : 7 * DAY_MS;
  return lastBackupAt === null || now - lastBackupAt >= interval;
}
