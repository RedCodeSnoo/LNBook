/**
 * New chapter check wired to the device: at launch, on demand, and in the background
 * (WorkManager through expo-background-task).
 */
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { create } from 'zustand';

import { backgroundDelay } from '../../../modules/lnbook-system';
import { getDb, openAppDatabase } from '../../db/client';
import { invalidate } from '../../db/invalidation';
import i18n, { initI18n } from '../../i18n';
import { getSource } from '../../plugins/pluginHost';
import { isNetworkUsable } from '../../services/network';
import { notifyNewChapters } from '../../services/notifications';
import { checkAppUpdateIfDue } from '../appUpdate/appUpdateService';
import { isUpdateCheckDue } from '../appUpdate/releaseCheck';
import { runAutoBackupIfDue } from '../backup/backupService';
import { queueDownloads } from '../downloads/downloadService';
import { readValue, writeValue } from '../settings/settingsRepository';
import { getSetting, loadSettings, useSettingsStore } from '../settings/settingsStore';
import { checkForNewChapters, isCheckDue, type CheckResult } from './updateChecker';

export const UPDATE_TASK = 'lnbook-update-check';
const LAST_CHECK_KEY = 'lastUpdateCheckAt';
const LAST_FAILURES_KEY = 'lastUpdateFailures';

interface UpdateState {
  checking: boolean;
  /** "3 / 12 · Title" while checking. */
  progress: { done: number; total: number; title: string } | null;
}

export const useUpdateState = create<UpdateState>(() => ({ checking: false, progress: null }));

export function getLastCheckAt(): number | null {
  return readValue<number | null>(getDb(), LAST_CHECK_KEY, null);
}

export function getLastFailures(): CheckResult['failures'] {
  return readValue<CheckResult['failures']>(getDb(), LAST_FAILURES_KEY, []);
}

let running = false;

/**
 * Checks the followed novels. Returns null when a check is already running or the
 * network cannot be used. New chapters are announced and, for the chosen novels,
 * downloaded.
 */
export async function runUpdateCheck(options: { background?: boolean } = {}) {
  if (running) {
    return null;
  }
  if (!(await isNetworkUsable(options.background ? getSetting('updateWifiOnly') : false))) {
    return null;
  }
  running = true;
  useUpdateState.setState({ checking: true, progress: null });
  try {
    const result = await checkForNewChapters({
      db: getDb(),
      getPlugin: getSource,
      delayMs: () => Math.max(0, getSetting('downloadDelayMs')),
      wait: (ms) => backgroundDelay(ms),
      now: () => Date.now(),
      onProgress: (done, total, title) =>
        useUpdateState.setState({ progress: { done, total, title } }),
    });
    writeValue(getDb(), LAST_CHECK_KEY, Date.now());
    writeValue(getDb(), LAST_FAILURES_KEY, result.failures);

    const toDownload = result.updates
      .filter((update) => update.autoDownload || getSetting('autoDownloadNew'))
      .flatMap((update) => update.chapterIds);
    if (toDownload.length > 0) {
      queueDownloads(toDownload);
    }
    if (getSetting('notifyNewChapters')) {
      for (const update of result.updates.filter((item) => item.notify)) {
        await notifyNewChapters(
          i18n.t('updates.channel'),
          update.title,
          i18n.t('updates.newChapters', { count: update.chapterIds.length }),
          update.novelId,
        );
      }
    }
    invalidate('updates', 'chapters', 'library', 'novel');
    return result;
  } finally {
    running = false;
    useUpdateState.setState({ checking: false, progress: null });
  }
}

/** At launch: checks when the last check is more than six hours old. */
export function checkAtLaunchIfDue(): void {
  if (getSetting('updateCheckHours') > 0 && isCheckDue(getLastCheckAt(), Date.now())) {
    void runUpdateCheck();
  }
}

// Runs without the interface: the database and settings are opened here if needed.
TaskManager.defineTask(UPDATE_TASK, async () => {
  try {
    openAppDatabase();
    if (!useSettingsStore.getState().loaded) {
      initI18n(loadSettings().language);
    }
    // One background task for every periodic job: each one runs when its own time comes.
    if (isUpdateCheckDue(getLastCheckAt(), Date.now(), getSetting('updateCheckHours'))) {
      await runUpdateCheck({ background: true });
    }
    await checkAppUpdateIfDue();
    await runAutoBackupIfDue();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** Runs the background task as often as the most frequent check needs. */
export function backgroundIntervalHours(chapterHours: number, appHours: number): number {
  const chosen = [chapterHours, appHours].filter((hours) => hours > 0);
  return chosen.length > 0 ? Math.min(...chosen) : 0;
}

/** Applies the "check frequency" settings (chapters and app) to the background task. */
export async function syncBackgroundCheck(): Promise<void> {
  const hours = backgroundIntervalHours(
    getSetting('updateCheckHours'),
    getSetting('appUpdateHours'),
  );
  try {
    if (hours > 0) {
      await BackgroundTask.registerTaskAsync(UPDATE_TASK, { minimumInterval: hours * 60 });
    } else if (await TaskManager.isTaskRegisteredAsync(UPDATE_TASK)) {
      await BackgroundTask.unregisterTaskAsync(UPDATE_TASK);
    }
  } catch {
    // Background work is not available on this device: checks still run at launch.
  }
}
