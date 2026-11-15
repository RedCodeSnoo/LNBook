/**
 * Long work that must survive the screen turning off (downloads, translation of a whole
 * novel) shares one Android foreground service and its progress notification.
 */
import {
  startDownloadService,
  stopDownloadService,
  updateDownloadService,
} from '../../modules/lnbook-system';

type Owner = 'downloads' | 'translation';

const active = new Set<Owner>();

/** Shows the notification and keeps the app alive until `endWork` is called. */
export function beginWork(owner: Owner, channelName: string, title: string, text: string): void {
  const first = active.size === 0;
  active.add(owner);
  if (first) {
    startDownloadService(channelName, title, text);
  } else {
    updateDownloadService(title, text, 0, 0);
  }
}

export function reportWork(
  owner: Owner,
  title: string,
  text: string,
  progress: number,
  max: number,
): void {
  if (active.has(owner)) {
    updateDownloadService(title, text, progress, max);
  }
}

/** The service stops when nothing needs it any more. */
export function endWork(owner: Owner): void {
  active.delete(owner);
  if (active.size === 0) {
    stopDownloadService();
  }
}
