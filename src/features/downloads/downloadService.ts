/** The download queue wired to the device: network, foreground service, interface state. */
import { create } from 'zustand';

import {
  startDownloadService,
  stopDownloadService,
  updateDownloadService,
} from '../../../modules/lnbook-system';
import { getDb } from '../../db/client';
import { invalidate } from '../../db/invalidation';
import i18n from '../../i18n';
import { getSource, pluginDeps } from '../../plugins/pluginHost';
import { deviceFiles } from '../../services/deviceFileStore';
import { isNetworkUsable } from '../../services/network';
import { ensureNotificationPermission } from '../../services/notifications';
import { getSetting } from '../settings/settingsStore';
import { DownloadRunner, type RunnerProgress, type StopReason } from './downloadRunner';
import {
  enqueueChapters,
  nextDownload,
  pauseDownloads,
  recoverInterruptedDownloads,
  resumeDownloads,
} from './downloadsRepository';

interface DownloadState {
  running: boolean;
  progress: RunnerProgress | null;
  /** Why the queue stopped last time (shown when it is waiting for something). */
  lastStop: StopReason | null;
}

export const useDownloadState = create<DownloadState>(() => ({
  running: false,
  progress: null,
  lastStop: null,
}));

let runner: DownloadRunner | null = null;

function getRunner(): DownloadRunner {
  runner ??= new DownloadRunner({
    db: getDb(),
    files: deviceFiles,
    fetch: (input, init) => pluginDeps().environment.fetch(input, init),
    getPlugin: getSource,
    delayMs: () => Math.max(0, getSetting('downloadDelayMs')),
    canDownload: () => isNetworkUsable(getSetting('downloadWifiOnly')),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    onProgress: (progress) => {
      useDownloadState.setState({ progress });
      updateDownloadService(
        progress.novelTitle,
        `${progress.done} / ${progress.total} · ${progress.chapterTitle}`,
        progress.done,
        progress.total,
      );
    },
    onChange: () => invalidate('downloads', 'chapters', 'library'),
  });
  return runner;
}

/** Starts processing the queue if it is not already running. */
export async function startDownloads(): Promise<void> {
  const current = getRunner();
  if (current.isRunning || !nextDownload(getDb())) {
    return;
  }
  useDownloadState.setState({ running: true, lastStop: null });
  // The progress notification needs the permission on Android 13+; downloads work without.
  await ensureNotificationPermission();
  startDownloadService(
    i18n.t('downloads.channel'),
    i18n.t('downloads.notificationTitle'),
    i18n.t('downloads.notificationStarting'),
  );
  let reason: StopReason = 'stopped';
  try {
    reason = await current.run();
  } finally {
    stopDownloadService();
    useDownloadState.setState({ running: false, progress: null, lastStop: reason });
    invalidate('downloads', 'chapters', 'library', 'novel');
  }
}

/** Adds chapters to the queue and starts it. Returns the number of chapters added. */
export function queueDownloads(chapterIds: number[]): number {
  const added = enqueueChapters(getDb(), chapterIds);
  invalidate('downloads');
  void startDownloads();
  return added;
}

export function pauseAllDownloads(): void {
  pauseDownloads(getDb());
  runner?.stop();
  invalidate('downloads');
}

export function resumeAllDownloads(): void {
  resumeDownloads(getDb());
  invalidate('downloads');
  void startDownloads();
}

/** At launch: tasks interrupted by the end of the app continue. */
export function resumeDownloadsAtLaunch(): void {
  recoverInterruptedDownloads(getDb());
  void startDownloads();
}
