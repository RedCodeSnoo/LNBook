/**
 * New version of the app: check on GitHub, download with progress, checksum, backup of
 * the data, then the Android installer.
 */
import * as Application from 'expo-application';
import { AppState } from 'react-native';
import { create } from 'zustand';

import {
  addInstallStatusListener,
  canInstallUpdates,
  clearUpdateDownloads,
  downloadUpdate,
  installUpdate,
  openInstallSettings,
  type InstallStatus,
} from '../../../modules/lnbook-system';
import { getDb } from '../../db/client';
import i18n from '../../i18n';
import { notifyAppUpdate } from '../../services/notifications';
import { writeSafetyBackup } from '../backup/backupService';
import { readValue, writeValue } from '../settings/settingsRepository';
import { getSetting } from '../settings/settingsStore';
import {
  checksumMatches,
  fetchLatestRelease,
  isFirstLaunchOfVersion,
  isUpdateAvailable,
  isUpdateCheckDue,
  parseChecksumFile,
  shouldNotifyRelease,
  type AppRelease,
} from './releaseCheck';

const LAST_CHECK_KEY = 'appUpdateLastCheckAt';
const RELEASE_KEY = 'appUpdateRelease';
const IGNORED_KEY = 'appUpdateIgnoredVersion';
const NOTIFIED_KEY = 'appUpdateNotifiedVersion';
const LAST_SEEN_VERSION_KEY = 'appUpdateLastSeenVersion';

export type UpdatePhase =
  | 'idle'
  | 'downloading'
  | 'verifying'
  /** Downloaded and verified; Android must first allow this app to install packages. */
  | 'needsPermission'
  /** Handed to the Android installer. */
  | 'installing';

export type UpdateFailure = 'download' | 'checksum' | 'install' | 'cancelled';

export type CheckOutcome = 'available' | 'upToDate' | 'failed';

interface AppUpdateState {
  /** Latest release known, when it is newer than the installed version. */
  release: AppRelease | null;
  /** True when `release` was dismissed with "Ignore this version". */
  ignored: boolean;
  checking: boolean;
  /** Result of the last check made during this launch (null = none yet). */
  lastOutcome: CheckOutcome | null;
  lastCheckAt: number | null;
  phase: UpdatePhase;
  received: number;
  total: number;
  failure: UpdateFailure | null;
  /** What Android said when it refused the installation. */
  failureDetail: InstallStatus | null;
  failureMessage: string | null;
  /** Verified file waiting to be installed. */
  filePath: string | null;
}

export const useAppUpdate = create<AppUpdateState>(() => ({
  release: null,
  ignored: false,
  checking: false,
  lastOutcome: null,
  lastCheckAt: null,
  phase: 'idle',
  received: 0,
  total: 0,
  failure: null,
  failureDetail: null,
  failureMessage: null,
  filePath: null,
}));

export function installedVersion(): string {
  return Application.nativeApplicationVersion ?? '0.0.0';
}

function publish(release: AppRelease | null): void {
  const ignoredVersion = readValue<string | null>(getDb(), IGNORED_KEY, null);
  const newer = isUpdateAvailable(release, installedVersion(), null) ? release : null;
  useAppUpdate.setState({
    release: newer,
    ignored: !!newer && newer.version === ignoredVersion,
  });
}

/** Shows again the release found by an earlier check (no network needed). */
export function loadKnownRelease(): void {
  publish(readValue<AppRelease | null>(getDb(), RELEASE_KEY, null));
  useAppUpdate.setState({ lastCheckAt: readValue<number | null>(getDb(), LAST_CHECK_KEY, null) });
}

let inFlight: Promise<CheckOutcome> | null = null;

/** Asks GitHub for the latest release (a check already running is shared, not repeated). */
export function checkForAppUpdate(): Promise<CheckOutcome> {
  if (inFlight) {
    return inFlight;
  }
  useAppUpdate.setState({ checking: true });
  inFlight = (async (): Promise<CheckOutcome> => {
    try {
      const release = await fetchLatestRelease(fetch);
      const now = Date.now();
      writeValue(getDb(), LAST_CHECK_KEY, now);
      writeValue(getDb(), RELEASE_KEY, release);
      publish(release);
      const outcome = useAppUpdate.getState().release ? 'available' : 'upToDate';
      useAppUpdate.setState({ lastOutcome: outcome, lastCheckAt: now });
      return outcome;
    } catch {
      useAppUpdate.setState({ lastOutcome: 'failed' });
      return 'failed';
    } finally {
      inFlight = null;
      useAppUpdate.setState({ checking: false });
    }
  })();
  return inFlight;
}

/** "Check for updates" pressed: a version that was ignored is shown again. */
export async function checkForAppUpdateByHand(): Promise<CheckOutcome> {
  const outcome = await checkForAppUpdate();
  if (outcome === 'available') {
    stopIgnoringRelease();
  }
  return outcome;
}

/** Notification "Version X available", once per version. */
async function announce(): Promise<void> {
  const db = getDb();
  const release = readValue<AppRelease | null>(db, RELEASE_KEY, null);
  const ignored = readValue<string | null>(db, IGNORED_KEY, null);
  const notified = readValue<string | null>(db, NOTIFIED_KEY, null);
  if (!shouldNotifyRelease(release, installedVersion(), ignored, notified)) {
    return;
  }
  writeValue(db, NOTIFIED_KEY, release.version);
  await notifyAppUpdate(
    i18n.t('appUpdate.channel'),
    i18n.t('appUpdate.available', { version: release.version }),
    i18n.t('appUpdate.notificationBody'),
  );
}

/**
 * Automatic check, when the chosen interval has passed: at launch, when the app comes
 * back to the screen and in the background. A new version is announced by notification.
 */
export async function checkAppUpdateIfDue(): Promise<void> {
  const last = readValue<number | null>(getDb(), LAST_CHECK_KEY, null);
  if (!isUpdateCheckDue(last, Date.now(), getSetting('appUpdateHours'))) {
    return;
  }
  if ((await checkForAppUpdate()) === 'available') {
    await announce();
  }
}

let watchingForeground = false;

/**
 * At launch. The first launch of a new version forgets what the previous version had
 * found (and its downloaded file), then checks at once.
 */
export function checkAppUpdateAtLaunch(): void {
  const db = getDb();
  const installed = installedVersion();
  if (
    isFirstLaunchOfVersion(readValue<string | null>(db, LAST_SEEN_VERSION_KEY, null), installed)
  ) {
    writeValue(db, LAST_SEEN_VERSION_KEY, installed);
    writeValue(db, LAST_CHECK_KEY, null);
    try {
      clearUpdateDownloads();
    } catch {
      // Nothing to remove.
    }
  }
  loadKnownRelease();
  void checkAppUpdateIfDue();
  if (!watchingForeground) {
    watchingForeground = true;
    // An app left open for days must notice new versions too.
    AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void checkAppUpdateIfDue();
      }
    });
  }
}

export function ignoreRelease(version: string): void {
  writeValue(getDb(), IGNORED_KEY, version);
  useAppUpdate.setState({ ignored: true });
}

export function stopIgnoringRelease(): void {
  writeValue(getDb(), IGNORED_KEY, null);
  useAppUpdate.setState({ ignored: false });
}

let statusSubscription: { remove(): void } | null = null;

/** What Android reports about an installation started with a session. */
function onInstallStatus(status: InstallStatus, message: string | null): void {
  if (status === 'confirm' || status === 'success') {
    useAppUpdate.setState({ phase: 'installing' });
    return;
  }
  useAppUpdate.setState({
    phase: 'idle',
    failure: status === 'aborted' ? 'cancelled' : 'install',
    failureDetail: status,
    failureMessage: message,
  });
}

function launchInstaller(path: string): void {
  try {
    if (!canInstallUpdates()) {
      useAppUpdate.setState({ phase: 'needsPermission', filePath: path });
      return;
    }
  } catch {
    useAppUpdate.setState({ phase: 'idle', failure: 'install' });
    return;
  }
  statusSubscription ??= addInstallStatusListener(onInstallStatus);
  useAppUpdate.setState({ phase: 'installing', filePath: path });
  installUpdate(path).catch((error: unknown) =>
    useAppUpdate.setState({
      phase: 'idle',
      failure: 'install',
      failureDetail: 'failure',
      failureMessage: error instanceof Error ? error.message : null,
    }),
  );
}

/**
 * Downloads the release, checks its SHA-256 against the published `.sha256` file, saves
 * the data, then opens the Android installer.
 */
export async function downloadAndInstall(): Promise<void> {
  if (['downloading', 'verifying'].includes(useAppUpdate.getState().phase)) {
    return;
  }
  // A release found long ago may have been replaced by a newer one since.
  const { lastCheckAt } = useAppUpdate.getState();
  if (lastCheckAt === null || Date.now() - lastCheckAt > 15 * 60 * 1000) {
    await checkForAppUpdate();
  }
  const { release, phase } = useAppUpdate.getState();
  if (!release || phase === 'downloading' || phase === 'verifying') {
    return;
  }
  useAppUpdate.setState({
    phase: 'downloading',
    received: 0,
    total: release.apkSize,
    failure: null,
    failureDetail: null,
    failureMessage: null,
    filePath: null,
  });
  let downloaded;
  try {
    downloaded = await downloadUpdate(release.apkUrl, release.apkName, (received, total) =>
      useAppUpdate.setState({ received, total: total > 0 ? total : release.apkSize }),
    );
  } catch {
    useAppUpdate.setState({ phase: 'idle', failure: 'download' });
    return;
  }

  useAppUpdate.setState({ phase: 'verifying' });
  let expected: string | null = null;
  try {
    if (release.checksumUrl) {
      const response = await fetch(release.checksumUrl);
      if (response.ok) {
        expected = parseChecksumFile(await response.text());
      }
    }
  } catch {
    expected = null;
  }
  // A file that cannot be verified is never installed.
  if (!checksumMatches(expected, downloaded.sha256)) {
    useAppUpdate.setState({ phase: 'idle', failure: 'checksum' });
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, 50));
  // Never blocks the installation: the data stays in place during an update anyway.
  try {
    await writeSafetyBackup();
  } catch {
    // Already logged by the backup.
  }
  launchInstaller(downloaded.path);
}

/** Opens the "Install unknown apps" setting of this app. */
export function openInstallPermission(): void {
  try {
    openInstallSettings();
  } catch {
    // The setting screen does not exist on this device.
  }
}

/** After the permission screen (or a cancelled installation): tries to install again. */
export function retryInstall(): void {
  const { filePath } = useAppUpdate.getState();
  if (filePath) {
    launchInstaller(filePath);
  }
}

export function dismissInstallPrompt(): void {
  useAppUpdate.setState({ phase: 'idle' });
}
