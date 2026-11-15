/** Reads the latest GitHub release and decides whether it is an update for this app. */
import { GITHUB_OWNER, GITHUB_REPOSITORY } from '../../services/appInfo';
import { isNewerVersion } from '../../services/version';

export const RELEASES_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPOSITORY}/releases/latest`;
/** Choices of the automatic check, in hours (0 = never). */
export const APP_UPDATE_INTERVALS = [1, 6, 12, 24, 0] as const;
const HOUR_MS = 60 * 60 * 1000;
/**
 * Android starts background work a little early or late: a check that is almost due is
 * done now rather than one whole period later.
 */
const DUE_TOLERANCE_MS = 10 * 60 * 1000;

export interface AppRelease {
  /** Version without the leading "v". */
  version: string;
  tag: string;
  publishedAt: number | null;
  /** Changelog of the release (Markdown). */
  notes: string;
  apkUrl: string;
  apkName: string;
  apkSize: number;
  /** Address of the `.sha256` file published next to the APK. */
  checksumUrl: string | null;
  pageUrl: string | null;
}

interface GithubAsset {
  name?: unknown;
  browser_download_url?: unknown;
  size?: unknown;
}

/** Extracts what the app needs from the GitHub API answer; null when it is not a usable release. */
export function parseRelease(payload: unknown): AppRelease | null {
  const release = payload as {
    tag_name?: unknown;
    draft?: unknown;
    prerelease?: unknown;
    published_at?: unknown;
    body?: unknown;
    html_url?: unknown;
    assets?: unknown;
  } | null;
  if (!release || typeof release.tag_name !== 'string' || release.draft === true) {
    return null;
  }
  const tag = release.tag_name;
  if (!/^v?\d+\.\d+\.\d+$/.test(tag) || release.prerelease === true) {
    return null;
  }
  const assets = (Array.isArray(release.assets) ? release.assets : []) as GithubAsset[];
  const named = assets.filter(
    (asset): asset is { name: string; browser_download_url: string; size?: unknown } =>
      typeof asset?.name === 'string' && typeof asset.browser_download_url === 'string',
  );
  const apk = named.find((asset) => asset.name.toLowerCase().endsWith('.apk'));
  if (!apk) {
    return null;
  }
  const checksum = named.find((asset) => asset.name === `${apk.name}.sha256`);
  const published =
    typeof release.published_at === 'string' ? Date.parse(release.published_at) : NaN;
  return {
    version: tag.replace(/^v/, ''),
    tag,
    publishedAt: Number.isFinite(published) ? published : null,
    notes: typeof release.body === 'string' ? release.body.trim() : '',
    apkUrl: apk.browser_download_url,
    apkName: apk.name,
    apkSize: typeof apk.size === 'number' ? apk.size : 0,
    checksumUrl: checksum ? checksum.browser_download_url : null,
    pageUrl: typeof release.html_url === 'string' ? release.html_url : null,
  };
}

/** True when the release is newer than the installed version and was not dismissed. */
export function isUpdateAvailable(
  release: AppRelease | null,
  installedVersion: string,
  ignoredVersion: string | null,
): release is AppRelease {
  return (
    !!release &&
    isNewerVersion(release.version, installedVersion) &&
    release.version !== ignoredVersion
  );
}

/**
 * True when an automatic check should run: never when turned off (0 hours), always the
 * first time, otherwise once the chosen number of hours has passed. A clock moved back
 * (last check in the future) also makes it due.
 */
export function isUpdateCheckDue(lastCheckAt: number | null, now: number, hours: number): boolean {
  if (hours <= 0) {
    return false;
  }
  if (lastCheckAt === null || lastCheckAt > now) {
    return true;
  }
  return now - lastCheckAt >= hours * HOUR_MS - DUE_TOLERANCE_MS;
}

/**
 * What the app remembers between launches is only valid for the version that stored it:
 * after an update (or a downgrade), the next automatic check runs at once.
 */
export function isFirstLaunchOfVersion(lastSeenVersion: string | null, installed: string): boolean {
  return lastSeenVersion !== installed;
}

/** A new version is announced by notification once, and never when it was ignored. */
export function shouldNotifyRelease(
  release: AppRelease | null,
  installedVersion: string,
  ignoredVersion: string | null,
  notifiedVersion: string | null,
): release is AppRelease {
  return (
    isUpdateAvailable(release, installedVersion, ignoredVersion) &&
    release.version !== notifiedVersion
  );
}

/** Translation key of the line shown under "Check for updates". */
export function checkStatusKey(
  checking: boolean,
  outcome: 'available' | 'upToDate' | 'failed' | null,
  availableVersion: string | null,
): { key: string; version?: string } | null {
  if (checking) {
    return { key: 'appUpdate.checking' };
  }
  if (availableVersion) {
    return { key: 'appUpdate.available', version: availableVersion };
  }
  if (outcome === 'failed') {
    return { key: 'appUpdate.checkFailed' };
  }
  if (outcome === 'upToDate') {
    return { key: 'appUpdate.upToDate' };
  }
  return null;
}

/** SHA-256 written in a `sha256sum` file ("<hash>  <file name>"), lower case, or null. */
export function parseChecksumFile(content: string): string | null {
  const match = /^\s*([a-fA-F0-9]{64})\b/.exec(content);
  return match ? match[1].toLowerCase() : null;
}

export function checksumMatches(expected: string | null, actual: string): boolean {
  return !!expected && expected.toLowerCase() === actual.trim().toLowerCase();
}

/** Fetches the latest release. Throws when GitHub cannot be reached. */
export async function fetchLatestRelease(fetcher: typeof fetch): Promise<AppRelease | null> {
  const response = await fetcher(RELEASES_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      // Never an answer kept by an HTTP cache: a release published a minute ago counts.
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  });
  if (response.status === 404) {
    // No release published yet.
    return null;
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return parseRelease(await response.json());
}
