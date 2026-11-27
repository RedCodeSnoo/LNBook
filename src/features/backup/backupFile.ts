/**
 * Backup file: a zip with a manifest, the content of the database (one JSON file per
 * table), the files of the app (books, chapters, translations, covers, plugins, fonts)
 * and the checksums of every entry. Tables are stored by column name, so an old backup
 * can be restored into a newer schema: migrations only ever add columns.
 *
 * Nothing here holds the archive in memory: the zip is written and read as a stream by
 * an `ArchiveEngine` (native code on the phone), from files prepared in a work folder.
 */
import { sql } from 'drizzle-orm';

import type { AppDatabase } from '../../db/client';
import type { FileStore } from '../../services/fileStore';

/** Layout version. Version 1 backups (app 1.1.0 and older) have no checksums. */
export const BACKUP_FORMAT = 1;
export const MANIFEST_ENTRY = 'manifest.json';
export const CHECKSUMS_ENTRY = 'checksums.json';

/** Folders of the app storage saved in a backup. Everything else is rebuilt. */
export const FILE_ROOTS = ['novels', 'plugins', 'fonts'] as const;

/** Work folder of backups and restores, in the app storage (never saved itself). */
export const WORK_DIR = '.backup-work';

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

export interface BackupCounts {
  novels: number;
  chapters: number;
  quotes: number;
  quoteFolders: number;
  readingSessions: number;
  history: number;
  plugins: number;
  categories: number;
  /** Files of the app storage inside the backup. */
  files: number;
}

export interface BackupManifest {
  app: 'LNBook';
  format: number;
  /** Version of the database schema the data was read from. */
  schemaVersion: number;
  appVersion: string;
  createdAt: number;
  includesChapters: boolean;
  includesTranslations: boolean;
  /** Since app 1.1.1: what the backup holds, checked after it is written. */
  counts?: BackupCounts;
  /** Since app 1.1.1: name of the entry with the SHA-256 of every other entry. */
  checksums?: string;
}

export interface BackupOptions {
  schemaVersion: number;
  appVersion: string;
  includeChapters: boolean;
  includeTranslations: boolean;
  now?: number;
}

export interface ArchiveEntry {
  /** Name inside the zip. */
  name: string;
  /** Path of the file in the app storage. */
  path: string;
}

export interface ArchiveListing {
  entries: { name: string; size: number; sha256: string }[];
  manifest: string | null;
  checksums: string | null;
  skipped: string[];
  bytes: number;
}

export interface ArchiveProgress {
  phase: 'write' | 'read';
  bytes: number;
  /** -1 when unknown. */
  totalBytes: number;
}

/** Writes and reads zip archives as streams. `output` / `input` are file or content URIs. */
export interface ArchiveEngine {
  write(
    output: string,
    entries: ArchiveEntry[],
    onProgress?: (progress: ArchiveProgress) => void,
  ): Promise<{ size: number; missing: string[] }>;
  /** Lists (and checksums) every entry; with `extractTo`, also writes them there. */
  read(
    input: string,
    extractTo: string | null,
    onProgress?: (progress: ArchiveProgress) => void,
  ): Promise<ArchiveListing>;
}

export interface BackupContent {
  manifest: BackupManifest;
  tables: Record<BackupTable, Row[]>;
  /** Files by path relative to the app storage → where the extracted copy waits. */
  files: Map<string, string>;
  /** Work folder holding the extracted backup (deleted once the restore is over). */
  stagingDir: string;
}

export class BackupError extends Error {
  constructor(
    readonly code: 'notBackup' | 'tooRecent' | 'corrupted' | 'incomplete',
    message: string,
  ) {
    super(message);
    this.name = 'BackupError';
  }
}

export function readTable(db: AppDatabase, table: string): Row[] {
  return db.all<Row>(sql.raw(`SELECT * FROM "${table}"`));
}

/**
 * Every file under a path (a directory or a single file). An empty folder is not a file:
 * app 1.1.0 took one for a file and every backup then failed trying to read it.
 */
export function walkFiles(files: FileStore, path: string, out: string[] = []): string[] {
  const entries = files.list(path);
  if (entries.length === 0) {
    if (files.isFile(path)) {
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

export interface PreparedBackup {
  manifest: BackupManifest;
  /** Entries of the zip, manifest first. */
  entries: ArchiveEntry[];
  /** Approximate size of the content, to check the free space. */
  estimatedBytes: number;
}

/**
 * Writes the manifest and the tables in `dir` and lists every entry of the zip. The tables
 * are read in one transaction: they are consistent with each other even if something
 * writes to the database meanwhile.
 */
export function prepareBackup(
  db: AppDatabase,
  files: FileStore,
  options: BackupOptions,
  dir: string,
): PreparedBackup {
  const counts = { tables: {} as Record<BackupTable, number> };
  const tableEntries: ArchiveEntry[] = [];
  let tableBytes = 0;
  db.transaction((tx) => {
    for (const table of BACKUP_TABLES) {
      let rows = readTable(tx as unknown as AppDatabase, table);
      if (table === 'settings') {
        rows = rows.filter((row) => !EXCLUDED_SETTINGS.test(String(row.key)));
      }
      counts.tables[table] = rows.length;
      const path = `${dir}/data/${table}.json`;
      const text = JSON.stringify(rows);
      tableBytes += text.length;
      files.writeText(path, text);
      tableEntries.push({ name: `data/${table}.json`, path });
    }
  });

  const fileEntries: ArchiveEntry[] = [];
  for (const root of FILE_ROOTS) {
    for (const path of walkFiles(files, root)) {
      if (shouldInclude(path, options)) {
        fileEntries.push({ name: `files/${path}`, path });
      }
    }
  }
  const estimatedBytes =
    tableBytes + FILE_ROOTS.reduce((total, root) => total + files.size(root), 0);

  const manifest: BackupManifest = {
    app: 'LNBook',
    format: BACKUP_FORMAT,
    schemaVersion: options.schemaVersion,
    appVersion: options.appVersion,
    createdAt: options.now ?? Date.now(),
    includesChapters: options.includeChapters,
    includesTranslations: options.includeTranslations,
    counts: {
      novels: counts.tables.novels,
      chapters: counts.tables.chapters,
      quotes: counts.tables.quotes,
      quoteFolders: counts.tables.quote_folders,
      readingSessions: counts.tables.reading_sessions,
      history: counts.tables.history,
      plugins: counts.tables.plugins,
      categories: counts.tables.categories,
      files: fileEntries.length,
    },
    checksums: CHECKSUMS_ENTRY,
  };
  const manifestPath = `${dir}/${MANIFEST_ENTRY}`;
  files.writeText(manifestPath, JSON.stringify(manifest, null, 2));
  return {
    manifest,
    entries: [{ name: MANIFEST_ENTRY, path: manifestPath }, ...tableEntries, ...fileEntries],
    estimatedBytes,
  };
}

type Checksums = Record<string, { size: number; sha256: string }>;

function parseChecksums(text: string): Checksums {
  const parsed = JSON.parse(text) as { files?: Checksums };
  if (!parsed || typeof parsed.files !== 'object' || parsed.files === null) {
    throw new Error('No file list');
  }
  return parsed.files;
}

/**
 * What is wrong with an archive, compared with its own checksums and, when given, with
 * the entries that were meant to be written. Empty when everything is in order.
 */
export function checkListing(
  listing: ArchiveListing,
  expected?: { entries: ArchiveEntry[]; missing: string[]; manifest: BackupManifest },
): string[] {
  const problems: string[] = [];
  const byName = new Map(listing.entries.map((entry) => [entry.name, entry]));
  if (!listing.manifest) {
    return ['manifest.json is missing'];
  }
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(listing.manifest) as BackupManifest;
  } catch {
    return ['manifest.json is unreadable'];
  }
  if (manifest.checksums) {
    if (!listing.checksums) {
      problems.push(`${manifest.checksums} is missing`);
    } else {
      let checksums: Checksums;
      try {
        checksums = parseChecksums(listing.checksums);
      } catch {
        return [...problems, `${manifest.checksums} is unreadable`];
      }
      for (const [name, sum] of Object.entries(checksums)) {
        const found = byName.get(name);
        if (!found) {
          problems.push(`${name} is missing`);
        } else if (found.size !== sum.size || found.sha256 !== sum.sha256) {
          problems.push(`${name} is damaged (checksum)`);
        }
      }
    }
  }
  for (const table of BACKUP_TABLES) {
    if (!byName.has(`data/${table}.json`)) {
      problems.push(`data/${table}.json is missing`);
    }
  }
  if (expected) {
    const missing = new Set(expected.missing);
    for (const entry of expected.entries) {
      if (!missing.has(entry.name) && !byName.has(entry.name)) {
        problems.push(`${entry.name} is missing`);
      }
    }
    const files = listing.entries.filter((entry) => entry.name.startsWith('files/')).length;
    const expectedFiles = (expected.manifest.counts?.files ?? 0) - expected.missing.length;
    if (expected.manifest.counts && files !== expectedFiles) {
      problems.push(`${files} files instead of ${expectedFiles}`);
    }
  }
  return problems;
}

/** Reads the manifest of an archive. `supportedSchema` is the schema version of this app. */
export function parseManifest(text: string | null, supportedSchema: number): BackupManifest {
  if (text === null) {
    throw new BackupError('notBackup', 'No manifest');
  }
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(text) as BackupManifest;
  } catch {
    throw new BackupError('corrupted', 'Unreadable manifest');
  }
  if (manifest?.app !== 'LNBook' || typeof manifest.schemaVersion !== 'number') {
    throw new BackupError('notBackup', 'Not an LNBook backup');
  }
  if (manifest.format > BACKUP_FORMAT || manifest.schemaVersion > supportedSchema) {
    throw new BackupError('tooRecent', 'Backup made by a newer version of the app');
  }
  return manifest;
}

const ALLOWED_FILE = new RegExp(`^(${FILE_ROOTS.join('|')})/`);

/** The backup extracted in `dir`, checked against its checksums, with its tables read. */
export function loadExtractedBackup(
  files: FileStore,
  dir: string,
  listing: ArchiveListing,
  supportedSchema: number,
): BackupContent {
  const manifest = parseManifest(listing.manifest, supportedSchema);
  const problems = checkListing(listing).filter(
    // Tables missing from an old backup are simply empty.
    (problem) => manifest.checksums || !/^data\/.*is missing$/.test(problem),
  );
  if (problems.length > 0) {
    throw new BackupError(
      'corrupted',
      `${problems.slice(0, 5).join(', ')}${problems.length > 5 ? '…' : ''}`,
    );
  }
  const names = new Set(listing.entries.map((entry) => entry.name));
  const tables = {} as Record<BackupTable, Row[]>;
  for (const table of BACKUP_TABLES) {
    const name = `data/${table}.json`;
    try {
      const rows: unknown = names.has(name) ? JSON.parse(files.readText(`${dir}/${name}`)) : [];
      tables[table] = Array.isArray(rows) ? (rows as Row[]) : [];
    } catch {
      throw new BackupError('corrupted', `Unreadable table ${table}`);
    }
  }
  const skipped = new Set(listing.skipped);
  const stored = new Map<string, string>();
  for (const { name } of listing.entries) {
    const path = name.slice('files/'.length);
    // Paths stay inside the app folders that are saved, whatever the archive says.
    if (
      name.startsWith('files/') &&
      !skipped.has(name) &&
      ALLOWED_FILE.test(path) &&
      !path.split('/').some((part) => part === '..' || part === '.' || part === '')
    ) {
      stored.set(path, `${dir}/${name}`);
    }
  }
  return { manifest, tables, files: stored, stagingDir: dir };
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
