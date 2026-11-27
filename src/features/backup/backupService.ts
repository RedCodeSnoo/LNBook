/** Backups wired to the device: native zip engine, folder chosen by the user, sharing, restore. */
import * as Application from 'expo-application';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { create } from 'zustand';

import { nativeBackup } from '../../../modules/lnbook-system';
import { getDb } from '../../db/client';
import { invalidateAll } from '../../db/invalidation';
import { LATEST_SCHEMA_VERSION } from '../../db/migrations';
import i18n, { changeLanguage } from '../../i18n';
import { pluginDeps } from '../../plugins/pluginHost';
import {
  installPlugin,
  listInstalledPlugins,
  resetLoadedPlugins,
} from '../../plugins/pluginManager';
import type { PluginItem } from '../../plugins/types';
import { deviceFiles } from '../../services/deviceFileStore';
import { beginWork, endWork, reportWork } from '../../services/foregroundWork';
import { formatBytes } from '../../services/format';
import { readValue, writeValue } from '../settings/settingsRepository';
import { getSetting, loadSettings, setSetting } from '../settings/settingsStore';
import {
  backupFileName,
  backupsToDelete,
  isAutoBackupDue,
  type ArchiveEngine,
  type ArchiveProgress,
  type BackupContent,
} from './backupFile';
import {
  createBackupArchive,
  discardBackup,
  openBackupArchive,
  restoreBackupArchive,
  type BackupEnv,
  type CreatedBackup,
} from './backupJobs';
import {
  importLnReaderBackup,
  NotLnReaderBackupError,
  parseLnReaderBackup,
  type LnReaderImportSummary,
} from './lnreaderImport';
import type { RestoreSummary } from './restore';

const ZIP_MIME = 'application/zip';
const LAST_AUTO_BACKUP_KEY = 'lastAutoBackupAt';
const LAST_AUTO_BACKUP_ERROR_KEY = 'lastAutoBackupFailed';
/** Backup made just before installing a new version of the app (private storage). */
export const SAFETY_BACKUP_PATH = 'backups/before-update.zip';
/** Complete backup of the phone made just before a restore (private storage). */
export const RESTORE_SAFETY_PATH = 'backups/before-restore.zip';

export type BackupStep = 'preparing' | 'writing' | 'checking' | 'reading' | 'safety' | 'restoring';

export interface BackupProgressState {
  step: BackupStep | null;
  bytes: number;
  /** -1 when unknown. */
  totalBytes: number;
}

/** What the backup screen shows while a backup or a restore runs. */
export const useBackupProgress = create<BackupProgressState>(() => ({
  step: null,
  bytes: 0,
  totalBytes: -1,
}));

function setStep(step: BackupStep | null): void {
  useBackupProgress.setState({ step, bytes: 0, totalBytes: -1 });
  if (step) {
    reportWork('backup', i18n.t('backup.notificationTitle'), i18n.t(`backup.step.${step}`), 0, 0);
  }
}

/** Native engine: the zip is written and read as a stream, off the JavaScript thread. */
const deviceArchive: ArchiveEngine = {
  async write(output, entries, onProgress) {
    const subscription = nativeBackup.addListener('onBackupProgress', (event) =>
      onProgress?.(event),
    );
    try {
      const result = await nativeBackup.writeBackupZip(
        output,
        entries.map((entry) => entry.name),
        entries.map((entry) => entry.path),
      );
      return { size: result.size, missing: result.missing };
    } finally {
      subscription.remove();
    }
  },
  async read(input, extractTo, onProgress) {
    const subscription = nativeBackup.addListener('onBackupProgress', (event) =>
      onProgress?.(event),
    );
    try {
      return await nativeBackup.readBackupZip(input, extractTo);
    } finally {
      subscription.remove();
    }
  },
};

function env(): BackupEnv {
  return {
    db: getDb(),
    files: deviceFiles,
    archive: deviceArchive,
    schemaVersion: LATEST_SCHEMA_VERSION,
    appVersion: Application.nativeApplicationVersion ?? '0.0.0',
    freeSpace: () => {
      try {
        return Paths.availableDiskSpace;
      } catch {
        return null;
      }
    },
  };
}

/** Progress of the native engine, shown on screen and in the notification. */
function progressTo(step: 'writing' | 'reading' | 'safety') {
  let checking = false;
  return (progress: ArchiveProgress) => {
    // Writing is followed by reading the archive back to check it.
    const current: BackupStep =
      step === 'writing' && (checking || progress.phase === 'read') ? 'checking' : step;
    checking = current === 'checking';
    useBackupProgress.setState({
      step: current,
      bytes: progress.bytes,
      totalBytes: progress.totalBytes,
    });
    const percent =
      progress.totalBytes > 0 ? Math.round((progress.bytes / progress.totalBytes) * 100) : 0;
    reportWork(
      'backup',
      i18n.t('backup.notificationTitle'),
      `${i18n.t(`backup.step.${current}`)} · ${formatBytes(progress.bytes)}`,
      percent,
      progress.totalBytes > 0 ? 100 : 0,
    );
  };
}

/** Runs a backup task with the notification that keeps the app alive with the screen off. */
async function withWork<T>(first: BackupStep, task: () => Promise<T>): Promise<T> {
  beginWork(
    'backup',
    i18n.t('backup.channel'),
    i18n.t('backup.notificationTitle'),
    i18n.t(`backup.step.${first}`),
  );
  setStep(first);
  try {
    return await task();
  } finally {
    setStep(null);
    endWork('backup');
  }
}

/** Stops the backup or restore being written or read (nothing is changed on the phone). */
export function cancelBackupWork(): void {
  nativeBackup.cancelBackupWork();
}

export interface SavedBackup {
  outcome: 'saved' | 'shared';
  backup: CreatedBackup;
  name: string;
}

/**
 * Manual backup, always complete (books, chapters, translations, covers, sources), written
 * in a folder chosen now or handed to another app (Drive, mail…). Returns null when the
 * user cancelled the choice of folder. Throws with the cause when it fails.
 */
export async function createManualBackup(target: 'folder' | 'share'): Promise<SavedBackup | null> {
  const now = Date.now();
  const name = backupFileName(now);
  let directory: Directory | null = null;
  if (target === 'folder') {
    try {
      directory = await Directory.pickDirectoryAsync();
    } catch {
      return null;
    }
  }
  return withWork('preparing', async () => {
    const options = { includeChapters: true, includeTranslations: true };
    if (directory) {
      const file = directory.createFile(name, ZIP_MIME);
      try {
        const backup = await createBackupArchive(env(), file.uri, {
          ...options,
          localOutput: false,
          onProgress: progressTo('writing'),
        });
        return { outcome: 'saved' as const, backup, name: file.name || name };
      } catch (error) {
        // No half-written file that would look like a backup in the chosen folder.
        nativeBackup.deleteDocument(file.uri);
        throw error;
      }
    }
    clearSharedBackups();
    const file = new File(Paths.cache, 'backups', name);
    const backup = await createBackupArchive(env(), file.uri, {
      ...options,
      localOutput: true,
      onProgress: progressTo('writing'),
    });
    await Sharing.shareAsync(file.uri, { mimeType: ZIP_MIME, dialogTitle: name });
    return { outcome: 'shared' as const, backup, name };
  });
}

/** Backups handed to another app are kept in the cache until the next one. */
function clearSharedBackups(): void {
  try {
    const directory = new Directory(Paths.cache, 'backups');
    if (directory.exists) {
      directory.delete();
    }
  } catch {
    // The cache is cleaned by Android anyway.
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
  if (
    autoBackupRunning ||
    useBackupProgress.getState().step !== null ||
    !folder ||
    !isAutoBackupDue(frequency, getLastAutoBackupAt(), now)
  ) {
    return false;
  }
  autoBackupRunning = true;
  try {
    const directory = new Directory(folder);
    const file = directory.createFile(backupFileName(now), ZIP_MIME);
    try {
      await createBackupArchive({ ...env(), now: () => now }, file.uri, {
        includeChapters: getSetting('autoBackupChapters'),
        includeTranslations: getSetting('autoBackupChapters'),
        localOutput: false,
      });
    } catch (error) {
      nativeBackup.deleteDocument(file.uri);
      throw error;
    }
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
    console.error('Automatic backup failed', describeError(error), error);
    writeValue(getDb(), LAST_AUTO_BACKUP_ERROR_KEY, true);
    return false;
  } finally {
    autoBackupRunning = false;
  }
}

/**
 * Backup kept in the private storage of the app before a new version is installed:
 * database, covers and sources (the chapters stay in place during an update).
 */
export async function writeSafetyBackup(): Promise<boolean> {
  try {
    await createBackupArchive(env(), new File(Paths.document, SAFETY_BACKUP_PATH).uri, {
      includeChapters: false,
      includeTranslations: false,
      localOutput: true,
    });
    return true;
  } catch (error) {
    console.error('Safety backup failed', describeError(error), error);
    return false;
  }
}

export type PickedBackup =
  | { kind: 'lnbook'; name: string; content: BackupContent }
  | { kind: 'lnreader'; name: string; data: Uint8Array }
  | { kind: 'cancelled' };

/**
 * Lets the user choose a file, then extracts and checks it in a work folder (nothing on
 * the phone changes). Throws with the cause when the file cannot be used.
 */
export async function pickBackupFile(): Promise<PickedBackup> {
  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    // Read where it is: a copy in the cache would need the space of the backup twice.
    copyToCacheDirectory: false,
    multiple: false,
  });
  if (result.canceled || result.assets.length === 0) {
    return { kind: 'cancelled' };
  }
  const asset = result.assets[0];
  const opened = await withWork('reading', () =>
    openBackupArchive(env(), asset.uri, progressTo('reading'), asset.size ?? undefined),
  );
  if (opened.kind === 'lnbook') {
    return { kind: 'lnbook', name: asset.name, content: opened.content };
  }
  // Not an LNBook backup: maybe one of LNReader (small, read in memory).
  const data = await new File(asset.uri).bytes();
  try {
    parseLnReaderBackup(data);
  } catch (error) {
    if (error instanceof NotLnReaderBackupError) {
      throw new NotABackupError();
    }
    throw error;
  }
  return { kind: 'lnreader', name: asset.name, data };
}

export class NotABackupError extends Error {
  constructor() {
    super('This file is not a backup');
    this.name = 'NotABackupError';
  }
}

/** The user closed the restore dialog: the extracted backup is removed. */
export function discardPickedBackup(content: BackupContent): void {
  try {
    discardBackup(deviceFiles, content);
  } catch (error) {
    console.warn('Cannot remove the extracted backup', error);
  }
}

/** Everything shown on screen is read again after the data changed underneath. */
function refreshAfterRestore(): void {
  const settings = loadSettings();
  changeLanguage(settings.language);
  resetLoadedPlugins();
  invalidateAll();
}

/**
 * Restores an opened backup, after a complete safety backup of the phone
 * (`backups/before-restore.zip`, which can be shared or restored from the backup screen).
 */
export async function restoreBackup(
  content: BackupContent,
  mode: 'replace' | 'merge',
): Promise<RestoreSummary> {
  // The folder of automatic backups belongs to this phone: it survives a full restore.
  const folder = getSetting('autoBackupFolder');
  const frequency = getSetting('autoBackup');
  let restored = false;
  const safetyProgress = progressTo('safety');
  try {
    const summary = await withWork('safety', async () => {
      const result = await restoreBackupArchive(
        env(),
        content,
        mode,
        new File(Paths.document, RESTORE_SAFETY_PATH).uri,
        (progress) => {
          if (progress.phase === 'write') {
            safetyProgress(progress);
          }
        },
        async () => {
          setStep('restoring');
          // Lets the screen show the step before the restore holds the JavaScript thread.
          await new Promise((resolve) => setTimeout(resolve, 50));
        },
      );
      return result;
    });
    restored = true;
    return summary;
  } finally {
    refreshAfterRestore();
    if (restored && mode === 'replace') {
      setSetting('autoBackupFolder', folder);
      setSetting('autoBackup', folder ? frequency : 'off');
    }
  }
}

export interface SafetyBackupInfo {
  date: number;
  size: number;
}

/** The backup made before the last restore, if any. */
export function getRestoreSafetyBackup(): SafetyBackupInfo | null {
  try {
    const file = new File(Paths.document, RESTORE_SAFETY_PATH);
    if (!file.exists) {
      return null;
    }
    return { date: file.modificationTime ?? 0, size: file.size };
  } catch {
    return null;
  }
}

export async function shareRestoreSafetyBackup(): Promise<void> {
  const source = new File(Paths.document, RESTORE_SAFETY_PATH);
  const target = new File(Paths.cache, 'backups', 'LNBook-before-restore.zip');
  clearSharedBackups();
  new Directory(Paths.cache, 'backups').create({ intermediates: true, idempotent: true });
  source.copy(target);
  await Sharing.shareAsync(target.uri, { mimeType: ZIP_MIME });
}

/**
 * Opens the safety backup like a picked file, to undo the last restore. It is extracted
 * before the restore starts, so the new safety backup can take its place.
 */
export async function openRestoreSafetyBackup(): Promise<PickedBackup> {
  const source = new File(Paths.document, RESTORE_SAFETY_PATH);
  const opened = await withWork('reading', () =>
    openBackupArchive(env(), source.uri, progressTo('reading'), source.size),
  );
  if (opened.kind !== 'lnbook') {
    throw new NotABackupError();
  }
  return { kind: 'lnbook', name: 'before-restore.zip', content: opened.content };
}

export async function importLnReader(data: Uint8Array): Promise<LnReaderImportSummary> {
  await new Promise((resolve) => setTimeout(resolve, 50));
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

/** Technical description of a failure, for the journal and the "details" line. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    const cause = (error as { cause?: unknown }).cause;
    return [
      typeof code === 'string' ? `[${code}]` : '',
      `${error.name}: ${error.message}`,
      cause instanceof Error ? `(cause: ${describeError(cause)})` : '',
    ]
      .filter(Boolean)
      .join(' ');
  }
  return String(error);
}
