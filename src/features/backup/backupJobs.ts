/**
 * The steps of a backup and of a restore, independent of the phone: the archive engine,
 * the database and the file store are given, so the whole path runs in the tests too.
 */
import type { AppDatabase } from '../../db/client';
import type { FileStore } from '../../services/fileStore';
import {
  checkListing,
  loadExtractedBackup,
  prepareBackup,
  WORK_DIR,
  type ArchiveEngine,
  type ArchiveProgress,
  type BackupContent,
  type BackupManifest,
} from './backupFile';
import { restoreMerging, restoreReplacing, type RestoreSummary } from './restore';

export interface BackupEnv {
  db: AppDatabase;
  files: FileStore;
  archive: ArchiveEngine;
  schemaVersion: number;
  appVersion: string;
  now?: () => number;
  /** Free bytes where the app storage and its cache are, or null when unknown. */
  freeSpace?: () => number | null;
}

/** Room kept free on the phone besides the backup itself. */
const SPACE_MARGIN = 50 * 1024 * 1024;

export class NotEnoughSpaceError extends Error {
  constructor(
    readonly needed: number,
    readonly available: number,
  ) {
    super(`Not enough space: ${needed} bytes needed, ${available} available`);
    this.name = 'NotEnoughSpaceError';
  }
}

/** The archive was written but reading it back did not give the same content. */
export class VerificationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Backup check failed: ${problems.slice(0, 5).join(', ')}`);
    this.name = 'VerificationError';
  }
}

/** The safety copy of the phone could not be made: nothing was restored. */
export class SafetyBackupError extends Error {
  readonly cause: unknown;

  constructor(readonly reason: unknown) {
    super(`Safety backup failed: ${reason instanceof Error ? reason.message : String(reason)}`);
    this.name = 'SafetyBackupError';
    this.cause = reason;
  }
}

export interface CreatedBackup {
  /** Size of the zip, in bytes. */
  size: number;
  manifest: BackupManifest;
  /** Files deleted while the backup was written (left out). */
  missing: string[];
}

export interface CreateOptions {
  includeChapters: boolean;
  includeTranslations: boolean;
  /** True when the zip goes to the storage of the phone (cache or private folder). */
  localOutput: boolean;
  onProgress?: (progress: ArchiveProgress) => void;
}

let workCounter = 0;
const workDir = (env: BackupEnv, kind: string) =>
  `${WORK_DIR}/${kind}-${env.now?.() ?? Date.now()}-${(workCounter += 1)}`;

function checkSpace(env: BackupEnv, needed: number): void {
  const available = env.freeSpace?.() ?? null;
  if (available !== null && needed + SPACE_MARGIN > available) {
    throw new NotEnoughSpaceError(needed + SPACE_MARGIN, available);
  }
}

/**
 * Writes a complete backup to `output`, then reads it back and checks every entry against
 * its checksum and the manifest. Only a backup that passed the check is reported done.
 */
export async function createBackupArchive(
  env: BackupEnv,
  output: string,
  options: CreateOptions,
): Promise<CreatedBackup> {
  const dir = workDir(env, 'create');
  try {
    const prepared = prepareBackup(
      env.db,
      env.files,
      {
        schemaVersion: env.schemaVersion,
        appVersion: env.appVersion,
        includeChapters: options.includeChapters,
        includeTranslations: options.includeTranslations,
        now: env.now?.(),
      },
      dir,
    );
    if (options.localOutput) {
      checkSpace(env, prepared.estimatedBytes);
    }
    const written = await env.archive.write(output, prepared.entries, options.onProgress);
    const listing = await env.archive.read(output, null, options.onProgress);
    const problems = checkListing(listing, {
      entries: prepared.entries,
      missing: written.missing,
      manifest: prepared.manifest,
    });
    if (problems.length > 0) {
      throw new VerificationError(problems);
    }
    return { size: written.size, manifest: prepared.manifest, missing: written.missing };
  } finally {
    env.files.delete(dir);
  }
}

export type OpenedBackup = { kind: 'lnbook'; content: BackupContent } | { kind: 'other' };

/**
 * Extracts a backup into a work folder and checks it. Nothing of the phone is touched;
 * `discardBackup` or a restore removes the folder. A zip without LNBook manifest (an
 * LNReader backup, any other file) gives `other`.
 */
export async function openBackupArchive(
  env: BackupEnv,
  input: string,
  onProgress?: (progress: ArchiveProgress) => void,
  sizeHint?: number,
): Promise<OpenedBackup> {
  if (sizeHint !== undefined && sizeHint > 0) {
    // The extracted content is about as large as the zip.
    checkSpace(env, sizeHint);
  }
  const dir = workDir(env, 'restore');
  try {
    const listing = await env.archive.read(input, dir, onProgress);
    if (!listing.manifest) {
      env.files.delete(dir);
      return { kind: 'other' };
    }
    return {
      kind: 'lnbook',
      content: loadExtractedBackup(env.files, dir, listing, env.schemaVersion),
    };
  } catch (error) {
    env.files.delete(dir);
    throw error;
  }
}

export function discardBackup(files: FileStore, content: BackupContent): void {
  files.delete(content.stagingDir);
}

/**
 * Restores an opened backup. A complete safety backup of the phone is written to
 * `safetyOutput` first; if it fails, nothing is restored.
 */
export async function restoreBackupArchive(
  env: BackupEnv,
  content: BackupContent,
  mode: 'replace' | 'merge',
  safetyOutput: string,
  onProgress?: (progress: ArchiveProgress) => void,
  /** Called once the safety backup is written, before the (synchronous) restore. */
  beforeRestore?: () => Promise<void>,
): Promise<RestoreSummary> {
  try {
    try {
      await createBackupArchive(env, safetyOutput, {
        includeChapters: true,
        includeTranslations: true,
        localOutput: true,
        onProgress,
      });
    } catch (error) {
      throw new SafetyBackupError(error);
    }
    await beforeRestore?.();
    return mode === 'replace'
      ? restoreReplacing(env.db, env.files, content)
      : restoreMerging(env.db, env.files, content);
  } finally {
    discardBackup(env.files, content);
  }
}

/**
 * Removes what an interrupted backup left in the work folder. A folder holding the data
 * moved aside by an interrupted restore ("previous") is kept: it may be the only copy.
 */
export function cleanBackupWork(files: FileStore): void {
  for (const name of files.list(WORK_DIR)) {
    if (!files.exists(`${WORK_DIR}/${name}/previous`)) {
      files.delete(`${WORK_DIR}/${name}`);
    }
  }
}
