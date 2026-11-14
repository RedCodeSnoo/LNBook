/** Backups wired to the device: files, folder chosen by the user, sharing, restore. */
import * as Application from 'expo-application';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { getDb } from '../../db/client';
import { invalidateAll } from '../../db/invalidation';
import { LATEST_SCHEMA_VERSION } from '../../db/migrations';
import { changeLanguage } from '../../i18n';
import { pluginDeps } from '../../plugins/pluginHost';
import {
  installPlugin,
  listInstalledPlugins,
  resetLoadedPlugins,
} from '../../plugins/pluginManager';
import type { PluginItem } from '../../plugins/types';
import { deviceFiles } from '../../services/deviceFileStore';
import { readValue, writeValue } from '../settings/settingsRepository';
import { getSetting, loadSettings, setSetting } from '../settings/settingsStore';
import {
  backupFileName,
  backupsToDelete,
  BackupError,
  collectBackup,
  isAutoBackupDue,
  packBackup,
  unpackBackup,
  type BackupContent,
} from './backupFile';
import {
  importLnReaderBackup,
  NotLnReaderBackupError,
  parseLnReaderBackup,
  type LnReaderImportSummary,
} from './lnreaderImport';
import { restoreMerging, restoreReplacing, type RestoreSummary } from './restore';

const ZIP_MIME = 'application/zip';
const LAST_AUTO_BACKUP_KEY = 'lastAutoBackupAt';
const LAST_AUTO_BACKUP_ERROR_KEY = 'lastAutoBackupFailed';
/** Backup made just before installing a new version of the app (private storage). */
export const SAFETY_BACKUP_PATH = 'backups/before-update.zip';

export interface BackupChoices {
  includeChapters: boolean;
  includeTranslations: boolean;
}

/** Lets the interface draw a progress indicator before the synchronous work. */
const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 50));

function buildBackup(choices: BackupChoices, now = Date.now()) {
  const content = collectBackup(getDb(), deviceFiles, {
    schemaVersion: LATEST_SCHEMA_VERSION,
    appVersion: Application.nativeApplicationVersion ?? '0.0.0',
    includeChapters: choices.includeChapters,
    includeTranslations: choices.includeTranslations,
    now,
  });
  return { name: backupFileName(now), data: packBackup(content) };
}

export type SaveOutcome = 'saved' | 'shared' | 'cancelled' | 'failed';

/** Manual backup, written in a folder chosen now or handed to another app. */
export async function createManualBackup(
  target: 'folder' | 'share',
  choices: BackupChoices,
): Promise<SaveOutcome> {
  try {
    if (target === 'folder') {
      let directory: Directory;
      try {
        directory = await Directory.pickDirectoryAsync();
      } catch {
        return 'cancelled';
      }
      await nextFrame();
      const backup = buildBackup(choices);
      directory.createFile(backup.name, ZIP_MIME).write(backup.data);
      return 'saved';
    }
    await nextFrame();
    const backup = buildBackup(choices);
    const file = new File(Paths.cache, backup.name);
    if (file.exists) {
      file.delete();
    }
    file.create();
    file.write(backup.data);
    await Sharing.shareAsync(file.uri, { mimeType: ZIP_MIME });
    return 'shared';
  } catch (error) {
    console.warn('Backup failed', error);
    return 'failed';
  }
}

/** Asks for the folder of automatic backups. Returns false when nothing was chosen. */
export async function chooseAutoBackupFolder(): Promise<boolean> {
  try {
    const directory = await Directory.pickDirectoryAsync();
    setSetting('autoBackupFolder', directory.uri);
    return true;
  } catch {
    return false;
  }
}

export function getLastAutoBackupAt(): number | null {
  return readValue<number | null>(getDb(), LAST_AUTO_BACKUP_KEY, null);
}

/** True when the last automatic backup could not be written (folder gone, no space). */
export function didLastAutoBackupFail(): boolean {
  return readValue(getDb(), LAST_AUTO_BACKUP_ERROR_KEY, false);
}

/** Readable name of a folder chosen with the Android picker. */
export function folderLabel(uri: string): string {
  const decoded = decodeURIComponent(uri);
  const tree = decoded.split('/tree/').pop() ?? decoded;
  return tree.replace(/^primary:/, '').replace(/^[^:]*:/, '') || '/';
}

let autoBackupRunning = false;

/**
 * Writes the daily or weekly backup in the chosen folder and keeps the five most recent.
 * Runs at launch and with the background check; does nothing when it is not due.
 */
export async function runAutoBackupIfDue(now = Date.now()): Promise<boolean> {
  const frequency = getSetting('autoBackup');
  const folder = getSetting('autoBackupFolder');
  if (autoBackupRunning || !folder || !isAutoBackupDue(frequency, getLastAutoBackupAt(), now)) {
    return false;
  }
  autoBackupRunning = true;
  try {
    await nextFrame();
    const directory = new Directory(folder);
    const backup = buildBackup(
      {
        includeChapters: getSetting('autoBackupChapters'),
        includeTranslations: getSetting('autoBackupChapters'),
      },
      now,
    );
    directory.createFile(backup.name, ZIP_MIME).write(backup.data);
    writeValue(getDb(), LAST_AUTO_BACKUP_KEY, now);
    writeValue(getDb(), LAST_AUTO_BACKUP_ERROR_KEY, false);
    try {
      const entries = directory.list();
      const old = new Set(backupsToDelete(entries.map((entry) => entry.name)));
      for (const entry of entries) {
        if (old.has(entry.name)) {
          entry.delete();
        }
      }
    } catch {
      // Old files that cannot be removed do not make the backup fail.
    }
    return true;
  } catch (error) {
    console.warn('Automatic backup failed', error);
    writeValue(getDb(), LAST_AUTO_BACKUP_ERROR_KEY, true);
    return false;
  } finally {
    autoBackupRunning = false;
  }
}

/** Backup kept in the private storage of the app before a new version is installed. */
export function writeSafetyBackup(): boolean {
  try {
    const backup = buildBackup({ includeChapters: false, includeTranslations: false });
    deviceFiles.writeBytes(SAFETY_BACKUP_PATH, backup.data);
    return true;
  } catch (error) {
    console.warn('Safety backup failed', error);
    return false;
  }
}

export type PickedBackup =
  | { kind: 'lnbook'; name: string; content: BackupContent }
  | { kind: 'lnreader'; name: string; data: Uint8Array }
  | { kind: 'cancelled' }
  | { kind: 'error'; reason: 'notBackup' | 'tooRecent' | 'corrupted' | 'unreadable' };

/** Lets the user choose a file and recognises what it is. */
export async function pickBackupFile(): Promise<PickedBackup> {
  let name: string;
  let data: Uint8Array;
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || result.assets.length === 0) {
      return { kind: 'cancelled' };
    }
    const asset = result.assets[0];
    name = asset.name;
    const file = new File(asset.uri);
    data = file.bytesSync();
    try {
      file.delete();
    } catch {
      // The cache is cleaned by Android anyway.
    }
  } catch (error) {
    console.warn('Cannot read the chosen file', error);
    return { kind: 'error', reason: 'unreadable' };
  }
  await nextFrame();
  try {
    return { kind: 'lnbook', name, content: unpackBackup(data, LATEST_SCHEMA_VERSION) };
  } catch (error) {
    if (!(error instanceof BackupError)) {
      return { kind: 'error', reason: 'corrupted' };
    }
    if (error.code !== 'notBackup') {
      return { kind: 'error', reason: error.code };
    }
  }
  try {
    parseLnReaderBackup(data);
    return { kind: 'lnreader', name, data };
  } catch (error) {
    return {
      kind: 'error',
      reason: error instanceof NotLnReaderBackupError ? 'notBackup' : 'corrupted',
    };
  }
}

/** Everything shown on screen is read again after the data changed underneath. */
function refreshAfterRestore(): void {
  const settings = loadSettings();
  changeLanguage(settings.language);
  resetLoadedPlugins();
  invalidateAll();
}

export async function restoreBackup(
  content: BackupContent,
  mode: 'replace' | 'merge',
): Promise<RestoreSummary> {
  await nextFrame();
  // The folder of automatic backups belongs to this phone: it survives a full restore.
  const folder = getSetting('autoBackupFolder');
  const frequency = getSetting('autoBackup');
  try {
    return mode === 'replace'
      ? restoreReplacing(getDb(), deviceFiles, content)
      : restoreMerging(getDb(), deviceFiles, content);
  } finally {
    refreshAfterRestore();
    if (mode === 'replace') {
      setSetting('autoBackupFolder', folder);
      setSetting('autoBackup', folder ? frequency : 'off');
    }
  }
}

export async function importLnReader(data: Uint8Array): Promise<LnReaderImportSummary> {
  await nextFrame();
  const db = getDb();
  const installed = new Set(listInstalledPlugins(db).map((plugin) => plugin.id));
  const summary = importLnReaderBackup(db, parseLnReaderBackup(data), installed);
  invalidateAll();
  return summary;
}

/** Installs the sources an LNReader backup used. Returns the names that failed. */
export async function installSources(list: PluginItem[]): Promise<string[]> {
  const failed: string[] = [];
  for (const plugin of list) {
    try {
      await installPlugin(pluginDeps(), plugin);
    } catch {
      failed.push(plugin.name || plugin.id);
    }
  }
  invalidateAll();
  return failed;
}
