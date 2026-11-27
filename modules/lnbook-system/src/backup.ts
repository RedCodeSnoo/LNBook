import { requireNativeModule, type EventSubscription } from 'expo-modules-core';

export interface NativeBackupProgress {
  phase: 'write' | 'read';
  bytes: number;
  /** -1 when the size of the archive being read is unknown. */
  totalBytes: number;
  entries: number;
  totalEntries: number;
}

export interface NativeZipEntry {
  name: string;
  size: number;
  sha256: string;
}

export interface NativeZipListing {
  entries: NativeZipEntry[];
  /** Text of manifest.json, or null when the archive has none. */
  manifest: string | null;
  checksums: string | null;
  /** Entries left out of the extraction because their name was unsafe. */
  skipped: string[];
  bytes: number;
}

interface LnbookBackupModule {
  writeBackupZip(
    output: string,
    names: string[],
    paths: string[],
  ): Promise<{ size: number; entries: number; missing: string[] }>;
  readBackupZip(input: string, extractTo: string | null): Promise<NativeZipListing>;
  cancelBackupWork(): void;
  movePath(from: string, to: string): void;
  deleteDocument(uri: string): boolean;
  addListener(
    event: 'onBackupProgress',
    listener: (event: NativeBackupProgress) => void,
  ): EventSubscription;
}

/**
 * Backups as streams, off the JavaScript thread. Storage paths are relative to the
 * document directory of the app. Errors carry a code: ERR_BACKUP_NO_SPACE,
 * ERR_BACKUP_PERMISSION, ERR_BACKUP_NOT_FOUND, ERR_BACKUP_CORRUPTED, ERR_BACKUP_MEMORY,
 * ERR_BACKUP_CANCELLED or ERR_BACKUP_IO, with the Java exception as message.
 */
export const nativeBackup = requireNativeModule<LnbookBackupModule>('LnbookBackup');
