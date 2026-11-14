import {
  checksumMatches,
  fetchLatestRelease,
  isUpdateAvailable,
  isUpdateCheckDue,
  parseChecksumFile,
  parseRelease,
  UPDATE_CHECK_INTERVAL_MS,
} from '../releaseCheck';

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

  it('checks at most every six hours', () => {
    expect(isUpdateCheckDue(null, 0)).toBe(true);
    expect(isUpdateCheckDue(100, 100 + UPDATE_CHECK_INTERVAL_MS - 1)).toBe(false);
    expect(isUpdateCheckDue(100, 100 + UPDATE_CHECK_INTERVAL_MS)).toBe(true);
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
