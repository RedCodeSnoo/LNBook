/** What to tell the user when a backup or a restore fails: the real cause, in plain words. */
import type { TFunction } from 'i18next';

import { formatBytes } from '../../services/format';
import { BackupError } from './backupFile';
import { NotEnoughSpaceError, SafetyBackupError, VerificationError } from './backupJobs';

type Translate = TFunction | ((key: string, options?: Record<string, unknown>) => string);

function nativeCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.startsWith('ERR_BACKUP_') ? code : null;
}

/** Message of the Java exception, without the "Call to function … rejected" wrapping. */
function nativeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const caused = /Caused by: (.*)$/s.exec(message);
  return (caused ? caused[1] : message).trim().split('\n')[0];
}

/** Readable cause of a failure. `detail` is the technical message (also in the journal). */
export function backupErrorText(error: unknown, t: Translate): { message: string; detail: string } {
  const detail = nativeMessage(error);
  if (error instanceof SafetyBackupError) {
    const inner = backupErrorText(error.reason, t);
    return { message: t('backup.errors.safety', { reason: inner.message }), detail: inner.detail };
  }
  if (error instanceof NotEnoughSpaceError) {
    return {
      message: t('backup.errors.space', {
        needed: formatBytes(error.needed),
        available: formatBytes(error.available),
      }),
      detail,
    };
  }
  if (error instanceof VerificationError) {
    return { message: t('backup.errors.verify'), detail: error.problems.slice(0, 3).join(', ') };
  }
  if (error instanceof BackupError) {
    const key =
      error.code === 'tooRecent'
        ? 'backup.errorTooRecent'
        : error.code === 'notBackup'
          ? 'backup.errorNotBackup'
          : 'backup.errorCorrupted';
    return { message: t(key), detail };
  }
  if (error instanceof Error && error.name === 'NotABackupError') {
    return { message: t('backup.errorNotBackup'), detail };
  }
  switch (nativeCode(error)) {
    case 'ERR_BACKUP_NO_SPACE':
      return { message: t('backup.errors.noSpace'), detail };
    case 'ERR_BACKUP_PERMISSION':
      return { message: t('backup.errors.permission'), detail };
    case 'ERR_BACKUP_NOT_FOUND':
      return { message: t('backup.errors.notFound'), detail };
    case 'ERR_BACKUP_CORRUPTED':
      return { message: t('backup.errorCorrupted'), detail };
    case 'ERR_BACKUP_MEMORY':
      return { message: t('backup.errors.memory'), detail };
    case 'ERR_BACKUP_CANCELLED':
      return { message: t('backup.errors.cancelled'), detail };
    case 'ERR_BACKUP_IO':
      return { message: t('backup.errors.io'), detail };
    default:
      return { message: t('backup.errors.unknown'), detail };
  }
}

/** True when the user stopped the work: no error to show. */
export function isCancelled(error: unknown): boolean {
  return (
    nativeCode(error) === 'ERR_BACKUP_CANCELLED' ||
    (error instanceof SafetyBackupError && nativeCode(error.reason) === 'ERR_BACKUP_CANCELLED')
  );
}
