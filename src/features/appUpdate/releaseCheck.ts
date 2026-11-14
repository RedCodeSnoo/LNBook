/** Reads the latest GitHub release and decides whether it is an update for this app. */
import { GITHUB_OWNER, GITHUB_REPOSITORY } from '../../services/appInfo';
import { isNewerVersion } from '../../services/version';

export const RELEASES_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPOSITORY}/releases/latest`;
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

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

/** Automatic checks happen at most once every six hours. */
export function isUpdateCheckDue(lastCheckAt: number | null, now: number): boolean {
  return lastCheckAt === null || now - lastCheckAt >= UPDATE_CHECK_INTERVAL_MS;
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
    headers: { Accept: 'application/vnd.github+json' },
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
