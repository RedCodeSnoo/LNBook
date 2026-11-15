import {
  checksumMatches,
  checkStatusKey,
  fetchLatestRelease,
  isUpdateAvailable,
  isFirstLaunchOfVersion,
  isUpdateCheckDue,
  parseChecksumFile,
  parseRelease,
  RELEASES_URL,
  shouldNotifyRelease,
} from '../releaseCheck';
import { compareVersions, isNewerVersion } from '../../../services/version';

const HOUR = 60 * 60 * 1000;

/** Shape of the GitHub "latest release" answer (only the fields that matter). */
const payload = (overrides: Record<string, unknown> = {}) => ({
  tag_name: 'v0.4.1',
  draft: false,
  prerelease: false,
  published_at: '2026-11-20T08:30:00Z',
  html_url: 'https://github.com/RedCodeSnoo/LNBook/releases/tag/v0.4.1',
  body: '## Changes\n\n- fix: something\n',
  assets: [
    {
      name: 'LNBook-v0.4.1.apk.sha256',
      browser_download_url: 'https://example.test/LNBook-v0.4.1.apk.sha256',
      size: 84,
    },
    {
      name: 'LNBook-v0.4.1.apk',
      browser_download_url: 'https://example.test/LNBook-v0.4.1.apk',
      size: 51_000_000,
    },
  ],
  ...overrides,
});

describe('GitHub release', () => {
  it('reads the version, the changelog, the APK and its checksum file', () => {
    expect(parseRelease(payload())).toEqual({
      version: '0.4.1',
      tag: 'v0.4.1',
      publishedAt: Date.parse('2026-11-20T08:30:00Z'),
      notes: '## Changes\n\n- fix: something',
      apkUrl: 'https://example.test/LNBook-v0.4.1.apk',
      apkName: 'LNBook-v0.4.1.apk',
      apkSize: 51_000_000,
      checksumUrl: 'https://example.test/LNBook-v0.4.1.apk.sha256',
      pageUrl: 'https://github.com/RedCodeSnoo/LNBook/releases/tag/v0.4.1',
    });
  });

  it('ignores drafts, pre-releases, odd tags and releases without APK', () => {
    expect(parseRelease(payload({ draft: true }))).toBeNull();
    expect(parseRelease(payload({ prerelease: true }))).toBeNull();
    expect(parseRelease(payload({ tag_name: 'nightly' }))).toBeNull();
    expect(parseRelease(payload({ assets: [] }))).toBeNull();
    expect(parseRelease({ message: 'Not Found' })).toBeNull();
    expect(parseRelease(null)).toBeNull();
    expect(parseRelease(payload({ assets: [payload().assets[1]] }))?.checksumUrl).toBeNull();
  });

  it('compares with the installed version and the ignored version', () => {
    const release = parseRelease(payload());
    expect(isUpdateAvailable(release, '0.4.0', null)).toBe(true);
    expect(isUpdateAvailable(release, '0.4.1', null)).toBe(false);
    expect(isUpdateAvailable(release, '0.10.0', null)).toBe(false);
    expect(isUpdateAvailable(release, '0.4.0', '0.4.1')).toBe(false);
    expect(isUpdateAvailable(release, '0.4.0', '0.4.0')).toBe(true);
    expect(isUpdateAvailable(null, '0.4.0', null)).toBe(false);
  });

  it('finds every published release newer than the installed one', () => {
    // The versions really published: each one must be offered to all the older ones.
    const published = [
      '0.1.0',
      '0.2.0',
      '0.3.0',
      '0.4.0',
      '0.5.0',
      '0.6.0',
      '0.7.0',
      '1.0.0',
      '1.0.1',
    ];
    published.forEach((installed, index) => {
      for (const candidate of published.slice(index + 1)) {
        const release = parseRelease(
          payload({
            tag_name: `v${candidate}`,
            assets: [{ name: 'a.apk', browser_download_url: 'https://x/a.apk' }],
          }),
        );
        expect(isUpdateAvailable(release, installed, null)).toBe(true);
      }
    });
    // Dismissing 0.6.0 does not hide 0.7.0.
    const next = parseRelease(payload({ tag_name: 'v0.7.0' }));
    expect(isUpdateAvailable(next, '0.5.0', '0.6.0')).toBe(true);
  });

  it('runs the automatic check at the chosen interval', () => {
    expect(isUpdateCheckDue(null, 0, 6)).toBe(true);
    expect(isUpdateCheckDue(0, 5 * HOUR, 6)).toBe(false);
    expect(isUpdateCheckDue(0, 6 * HOUR, 6)).toBe(true);
    // Background work started a few minutes early still counts.
    expect(isUpdateCheckDue(0, 6 * HOUR - 5 * 60 * 1000, 6)).toBe(true);
    expect(isUpdateCheckDue(0, HOUR, 1)).toBe(true);
    expect(isUpdateCheckDue(0, 23 * HOUR, 24)).toBe(false);
    // "Never".
    expect(isUpdateCheckDue(null, 0, 0)).toBe(false);
    expect(isUpdateCheckDue(0, 1000 * HOUR, 0)).toBe(false);
    // Clock moved back.
    expect(isUpdateCheckDue(10 * HOUR, HOUR, 6)).toBe(true);
  });

  it('checks again at once after the app was updated', () => {
    expect(isFirstLaunchOfVersion(null, '1.0.1')).toBe(true);
    expect(isFirstLaunchOfVersion('1.0.0', '1.0.1')).toBe(true);
    expect(isFirstLaunchOfVersion('1.0.1', '1.0.1')).toBe(false);
  });

  it('announces a new version once, unless it was ignored', () => {
    const release = parseRelease(payload());
    expect(shouldNotifyRelease(release, '0.4.0', null, null)).toBe(true);
    expect(shouldNotifyRelease(release, '0.4.0', null, '0.4.1')).toBe(false);
    expect(shouldNotifyRelease(release, '0.4.0', '0.4.1', null)).toBe(false);
    expect(shouldNotifyRelease(release, '0.4.1', null, null)).toBe(false);
    expect(shouldNotifyRelease(null, '0.4.0', null, null)).toBe(false);
  });

  it('reads and compares the SHA-256 of the APK', () => {
    const hash = 'ab'.repeat(32);
    expect(parseChecksumFile(`${hash}  LNBook-v0.4.1.apk\n`)).toBe(hash);
    expect(parseChecksumFile(`${hash.toUpperCase()} *file`)).toBe(hash);
    expect(parseChecksumFile('not a checksum')).toBeNull();
    expect(checksumMatches(hash, ` ${hash.toUpperCase()}\n`)).toBe(true);
    expect(checksumMatches(hash, 'cd'.repeat(32))).toBe(false);
    expect(checksumMatches(null, hash)).toBe(false);
  });

  it('asks GitHub without any key', async () => {
    const calls: string[] = [];
    const answer = (status: number, body: unknown) =>
      (async (url: RequestInfo | URL) => {
        calls.push(String(url));
        return new Response(JSON.stringify(body), { status });
      }) as typeof fetch;
    expect((await fetchLatestRelease(answer(200, payload())))?.version).toBe('0.4.1');
    expect(calls[0]).toBe('https://api.github.com/repos/RedCodeSnoo/LNBook/releases/latest');
    expect(await fetchLatestRelease(answer(404, { message: 'Not Found' }))).toBeNull();
    await expect(fetchLatestRelease(answer(403, {}))).rejects.toThrow('HTTP 403');
  });
});

describe('check result', () => {
  it('says whether the app is up to date', () => {
    expect(checkStatusKey(true, null, null)?.key).toBe('appUpdate.checking');
    expect(checkStatusKey(false, 'upToDate', null)?.key).toBe('appUpdate.upToDate');
    expect(checkStatusKey(false, 'available', '1.0.1')).toEqual({
      key: 'appUpdate.available',
      version: '1.0.1',
    });
    expect(checkStatusKey(false, 'failed', null)?.key).toBe('appUpdate.checkFailed');
    // A version found earlier stays announced when a later check fails.
    expect(checkStatusKey(false, 'failed', '1.0.1')?.key).toBe('appUpdate.available');
    expect(checkStatusKey(false, null, null)).toBeNull();
  });
});

describe('version numbers', () => {
  it('compares each part as a number', () => {
    expect(isNewerVersion('0.10.0', '0.9.0')).toBe(true);
    expect(isNewerVersion('1.0.0', '0.7.0')).toBe(true);
    expect(isNewerVersion('1.0.1', '1.0.0')).toBe(true);
    expect(isNewerVersion('v1.0.1', '1.0.1')).toBe(false);
    expect(isNewerVersion('1.0', '1.0.0')).toBe(false);
    expect(isNewerVersion('1.0.0-beta', '1.0.0')).toBe(false);
    expect(compareVersions('0.7.0', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '10.0.0')).toBeLessThan(0);
  });
});

describe('GitHub API answer', () => {
  it('reads a real "latest release" answer of the repository', () => {
    // Trimmed copy of https://api.github.com/repos/RedCodeSnoo/LNBook/releases/latest.
    const answer = {
      url: 'https://api.github.com/repos/RedCodeSnoo/LNBook/releases/1',
      html_url: 'https://github.com/RedCodeSnoo/LNBook/releases/tag/v1.0.0',
      tag_name: 'v1.0.0',
      target_commitish: 'main',
      name: 'LNBook v1.0.0',
      draft: false,
      immutable: false,
      prerelease: false,
      created_at: '2026-11-15T15:01:00Z',
      published_at: '2026-11-15T15:10:12Z',
      assets: [
        {
          name: 'LNBook-v1.0.0.apk',
          content_type: 'application/vnd.android.package-archive',
          state: 'uploaded',
          size: 98_765_432,
          browser_download_url:
            'https://github.com/RedCodeSnoo/LNBook/releases/download/v1.0.0/LNBook-v1.0.0.apk',
        },
        {
          name: 'LNBook-v1.0.0.apk.sha256',
          content_type: 'application/octet-stream',
          state: 'uploaded',
          size: 84,
          browser_download_url:
            'https://github.com/RedCodeSnoo/LNBook/releases/download/v1.0.0/LNBook-v1.0.0.apk.sha256',
        },
      ],
      body: '## Changes\n\n- feat: add the app icon',
    };
    const release = parseRelease(answer);
    expect(release).toMatchObject({
      version: '1.0.0',
      apkName: 'LNBook-v1.0.0.apk',
      apkSize: 98_765_432,
      checksumUrl:
        'https://github.com/RedCodeSnoo/LNBook/releases/download/v1.0.0/LNBook-v1.0.0.apk.sha256',
    });
    expect(isUpdateAvailable(release, '0.5.0', null)).toBe(true);
    expect(isUpdateAvailable(release, '1.0.0', null)).toBe(false);
  });

  it('never uses a cached answer', async () => {
    let headers: Record<string, string> = {};
    const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      headers = init?.headers as Record<string, string>;
      return new Response(JSON.stringify(payload()), { status: 200 });
    }) as typeof fetch;
    await fetchLatestRelease(fetcher);
    expect(headers['Cache-Control']).toBe('no-cache');
    expect(RELEASES_URL).toContain('/releases/latest');
  });
});

describe('release notes', () => {
  it('keeps headings, bullet points and plain text', () => {
    const { parseReleaseNotes } =
      jest.requireActual<typeof import('../releaseNotes')>('../releaseNotes');
    expect(
      parseReleaseNotes(
        '## Changes\n\n- feat: **bold** thing\n* fix: `code` and [link](https://x.test)\n\nThanks!\n---',
      ),
    ).toEqual([
      { kind: 'heading', text: 'Changes' },
      { kind: 'bullet', text: 'feat: bold thing' },
      { kind: 'bullet', text: 'fix: code and link' },
      { kind: 'text', text: 'Thanks!' },
    ]);
  });
});
