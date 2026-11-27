/**
 * The backup code of app 1.1.0, unchanged: it reproduces the bug (an empty folder made every
 * backup fail; the whole archive was built in memory) and makes real 1.1.0 backups for the
 * restore tests.
 */
import { strToU8, zipSync, type Zippable } from 'fflate';

import type { AppDatabase } from '../../../../db/client';
import type { FileStore } from '../../../../services/fileStore';
import { BACKUP_TABLES, readTable, type BackupTable, type Row } from '../../backupFile';

interface LegacyOptions {
  schemaVersion: number;
  appVersion: string;
  includeChapters: boolean;
  includeTranslations: boolean;
  now?: number;
}

function walkFiles(files: FileStore, path: string, out: string[] = []): string[] {
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

function shouldInclude(path: string, options: LegacyOptions): boolean {
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
  return true;
}

const EXCLUDED_SETTINGS = /^(deepl|secret)/i;

/** `collectBackup` + `packBackup` of app 1.1.0. */
export function legacyBackup(
  db: AppDatabase,
  files: FileStore,
  options: LegacyOptions,
): Uint8Array {
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
  const manifest = {
    app: 'LNBook',
    format: 1,
    schemaVersion: options.schemaVersion,
    appVersion: options.appVersion,
    createdAt: options.now ?? Date.now(),
    includesChapters: options.includeChapters,
    includesTranslations: options.includeTranslations,
  };
  const entries: Zippable = { 'manifest.json': strToU8(JSON.stringify(manifest, null, 2)) };
  for (const table of BACKUP_TABLES) {
    entries[`data/${table}.json`] = strToU8(JSON.stringify(tables[table]));
  }
  for (const [path, data] of stored) {
    entries[`files/${path}`] = [data, { level: /\.(html|css|js|json)$/.test(path) ? 6 : 0 }];
  }
  return zipSync(entries);
}
