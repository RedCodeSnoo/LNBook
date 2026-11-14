/**
 * New version of the app: check on GitHub, download with progress, checksum, backup of
 * the data, then the Android installer.
 */
import * as Application from 'expo-application';
import { create } from 'zustand';

import {
  canInstallUpdates,
  downloadUpdate,
  installUpdate,
  openInstallSettings,
} from '../../../modules/lnbook-system';
import { getDb } from '../../db/client';
import { writeSafetyBackup } from '../backup/backupService';
import { readValue, writeValue } from '../settings/settingsRepository';
import { getSetting } from '../settings/settingsStore';
import {
  checksumMatches,
  fetchLatestRelease,
  isUpdateAvailable,
  isUpdateCheckDue,
  parseChecksumFile,
  type AppRelease,
} from './releaseCheck';

const LAST_CHECK_KEY = 'appUpdateLastCheckAt';
const RELEASE_KEY = 'appUpdateRelease';
const IGNORED_KEY = 'appUpdateIgnoredVersion';

export type UpdatePhase =
  | 'idle'
  | 'downloading'
  | 'verifying'
  /** Downloaded and verified; Android must first allow this app to install packages. */
  | 'needsPermission'
  /** Handed to the Android installer. */
  | 'installing';

export type UpdateFailure = 'download' | 'checksum' | 'install';

interface AppUpdateState {
  /** Latest release known, when it is newer than the installed version. */
  release: AppRelease | null;
  /** True when `release` was dismissed with "Ignore this version". */
  ignored: boolean;
  checking: boolean;
  phase: UpdatePhase;
  received: number;
  total: number;
  failure: UpdateFailure | null;
  /** Verified file waiting to be installed. */
  filePath: string | null;
}

export const useAppUpdate = create<AppUpdateState>(() => ({
  release: null,
  ignored: false,
  checking: false,
  phase: 'idle',
  received: 0,
  total: 0,
  failure: null,
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
}

export type CheckOutcome = 'available' | 'upToDate' | 'failed';

/** Asks GitHub for the latest release. */
export async function checkForAppUpdate(): Promise<CheckOutcome> {
  if (useAppUpdate.getState().checking) {
    return useAppUpdate.getState().release ? 'available' : 'upToDate';
  }
  useAppUpdate.setState({ checking: true });
  try {
    const release = await fetchLatestRelease(fetch);
    writeValue(getDb(), LAST_CHECK_KEY, Date.now());
    writeValue(getDb(), RELEASE_KEY, release);
    publish(release);
    return useAppUpdate.getState().release ? 'available' : 'upToDate';
  } catch {
    return 'failed';
  } finally {
    useAppUpdate.setState({ checking: false });
  }
}

/** At launch: at most one automatic check every six hours, unless turned off. */
export function checkAppUpdateAtLaunch(): void {
  loadKnownRelease();
  const last = readValue<number | null>(getDb(), LAST_CHECK_KEY, null);
  if (getSetting('checkAppUpdates') && isUpdateCheckDue(last, Date.now())) {
    void checkForAppUpdate();
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

function launchInstaller(path: string): void {
  try {
    if (!canInstallUpdates()) {
      useAppUpdate.setState({ phase: 'needsPermission', filePath: path });
      return;
    }
    installUpdate(path);
    useAppUpdate.setState({ phase: 'installing', filePath: path });
  } catch {
    useAppUpdate.setState({ phase: 'idle', failure: 'install' });
  }
}

/**
 * Downloads the release, checks its SHA-256 against the published `.sha256` file, saves
 * the data, then opens the Android installer.
 */
export async function downloadAndInstall(): Promise<void> {
  const { release, phase } = useAppUpdate.getState();
  if (!release || phase === 'downloading' || phase === 'verifying') {
    return;
  }
  useAppUpdate.setState({
    phase: 'downloading',
    received: 0,
    total: release.apkSize,
    failure: null,
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
  writeSafetyBackup();
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
