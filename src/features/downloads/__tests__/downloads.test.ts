import { eq } from 'drizzle-orm';

import { chapters as chaptersTable } from '../../../db/schema';
import { createTestDatabase } from '../../../db/testing';
import { CloudflareError } from '../../../plugins/libs/fetch';
import type { SourcePlugin } from '../../../plugins/types';
import { MemoryFileStore } from '../../../services/fileStore';
import { saveSourceNovel, setNovelInLibrary } from '../../browse/sourceNovels';
import { listLibraryNovels } from '../../library/libraryRepository';
import { getChapter, listChapters, setChaptersRead } from '../../novel/novelRepository';
import { downloadChapterImages, hashName } from '../chapterDownload';
import { DownloadRunner, type RunnerProgress, type StopReason } from '../downloadRunner';
import {
  cancelDownload,
  cancelNovelDownloads,
  enqueueChapters,
  listDownloads,
  MAX_ATTEMPTS,
  moveDownload,
  pauseDownloads,
  prioritizeDownload,
  recoverInterruptedDownloads,
  resumeDownloads,
  retryFailedDownloads,
  selectChapters,
  setDownloadStatus,
  summarizeQueue,
} from '../downloadsRepository';
import { deleteChapterDownloads, deleteNovelDownloads, listNovelStorage } from '../storage';

const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

function setup(chapterCount = 5) {
  const { db } = createTestDatabase();
  const files = new MemoryFileStore();
  const { novelId } = saveSourceNovel(db, { id: 'demo' }, '/n/1', {
    novel: { name: 'Demo', path: '/n/1' },
    chapters: Array.from({ length: chapterCount }, (_, i) => ({
      name: `Chapter ${i + 1}`,
      path: `/c/${i + 1}`,
    })),
  });
  setNovelInLibrary(db, novelId, true);
  const list = listChapters(db, novelId);

  const calls: string[] = [];
  const failures = new Map<string, unknown[]>();
  const plugin = {
    id: 'demo',
    name: 'Demo',
    site: 'https://demo.test',
    version: '1.0.0',
    imageRequestInit: { headers: { Referer: 'https://demo.test/' } },
    parseChapter: async (path: string) => {
      calls.push(path);
      const queue = failures.get(path);
      if (queue && queue.length > 0) {
        throw queue.shift();
      }
      return `<p>Text of ${path}</p><p><img src="/img${path}.png"></p>`;
    },
  } as unknown as SourcePlugin;

  const imageRequests: { url: string; referer: string | undefined }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    imageRequests.push({
      url,
      referer: (init?.headers as Record<string, string> | undefined)?.Referer,
    });
    if (url.includes('broken')) {
      return new Response('', { status: 404 });
    }
    return new Response(PNG, { headers: { 'content-type': 'image/png' } });
  }) as typeof fetch;

  let clock = 0;
  const waits: number[] = [];
  const progress: RunnerProgress[] = [];
  let online = true;
  const runner = new DownloadRunner({
    db,
    files,
    fetch: fetcher,
    getPlugin: () => plugin,
    delayMs: () => 1000,
    canDownload: async () => online,
    wait: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
    now: () => clock,
    onProgress: (value) => progress.push(value),
    onChange: () => undefined,
  });
  return {
    db,
    files,
    novelId,
    list,
    calls,
    failures,
    imageRequests,
    waits,
    progress,
    runner,
    fetcher,
    setOnline: (value: boolean) => {
      online = value;
    },
  };
}

describe('download choices', () => {
  const list = [1, 2, 3, 4, 5, 6].map((id) => ({
    id,
    isRead: id <= 2,
    isDownloaded: id === 4,
  }));

  it('selects all, unread, a range and the next chapters', () => {
    expect(selectChapters(list, { kind: 'all' }, null)).toEqual([1, 2, 3, 5, 6]);
    expect(selectChapters(list, { kind: 'unread' }, null)).toEqual([3, 5, 6]);
    expect(selectChapters(list, { kind: 'range', from: 2, to: 4 }, null)).toEqual([2, 3]);
    expect(selectChapters(list, { kind: 'range', from: 5, to: 99 }, null)).toEqual([5, 6]);
    // Chapter 4 is already on the phone: it does not count among the "next 2".
    expect(selectChapters(list, { kind: 'next', count: 2 }, 2)).toEqual([3, 5]);
    expect(selectChapters(list, { kind: 'next', count: 2 }, null)).toEqual([1, 2]);
  });
});

describe('download queue', () => {
  it('adds each chapter once, in order, skipping downloaded chapters', () => {
    const { db, list } = setup();
    expect(enqueueChapters(db, [list[2].id, list[0].id])).toBe(2);
    expect(enqueueChapters(db, [list[0].id, list[1].id, 9999])).toBe(1);
    expect(listDownloads(db).map((row) => row.chapterTitle)).toEqual([
      'Chapter 3',
      'Chapter 1',
      'Chapter 2',
    ]);
    expect(listDownloads(db)[0]).toMatchObject({ novelTitle: 'Demo', pluginId: 'demo' });
  });

  it('reorders, pauses, resumes and cancels', () => {
    const { db, list, novelId } = setup();
    enqueueChapters(
      db,
      list.map((chapter) => chapter.id),
    );
    const ids = () => listDownloads(db).map((row) => row.chapterTitle.replace('Chapter ', ''));
    const [first, second, , , last] = listDownloads(db);
    moveDownload(db, second.id, -1);
    expect(ids().join('')).toBe('21345');
    moveDownload(db, first.id, 1);
    expect(ids().join('')).toBe('23145');
    prioritizeDownload(db, last.id);
    expect(ids().join('')).toBe('52314');

    setDownloadStatus(db, first.id, 'running');
    pauseDownloads(db);
    expect(summarizeQueue(listDownloads(db))).toEqual({ waiting: 0, paused: 5, failed: 0 });
    resumeDownloads(db);
    expect(summarizeQueue(listDownloads(db)).waiting).toBe(5);

    setDownloadStatus(db, second.id, 'running');
    recoverInterruptedDownloads(db);
    expect(listDownloads(db).every((row) => row.status === 'queued')).toBe(true);

    cancelDownload(db, last.id);
    expect(listDownloads(db)).toHaveLength(4);
    cancelNovelDownloads(db, novelId);
    expect(listDownloads(db)).toHaveLength(0);
  });
});

describe('chapter images', () => {
  it('stores images locally with the headers of the plugin', async () => {
    const { files, fetcher, imageRequests } = setup();
    const result = await downloadChapterImages(
      files,
      7,
      '<p>A<img src="https://x.y/a.png"/><img src="images/local.png"/><img src="https://x.y/broken.jpg"/></p>',
      fetcher,
      { headers: { Referer: 'https://x.y/' } },
    );
    expect(result.downloaded).toBe(1);
    expect(result.failed).toBe(1);
    const name = `${hashName('https://x.y/a.png')}.png`;
    expect(result.html).toContain(`src="images/${name}"`);
    expect(result.html).toContain('src="images/local.png"');
    // An image that could not be fetched keeps its web address.
    expect(result.html).toContain('https://x.y/broken.jpg');
    expect(files.readBytes(`novels/7/images/${name}`)).toEqual(PNG);
    expect(imageRequests.map((request) => request.referer)).toEqual([
      'https://x.y/',
      'https://x.y/',
    ]);
    expect(hashName('a')).not.toBe(hashName('b'));
  });
});

describe('download runner', () => {
  it('downloads the queue, making the novel local once complete', async () => {
    const { db, files, list, runner, waits, progress, novelId, imageRequests } = setup(3);
    expect(listLibraryNovels(db)[0].isLocal).toBe(false);
    enqueueChapters(
      db,
      list.map((chapter) => chapter.id),
    );
    expect(await runner.run()).toBe<StopReason>('done');

    expect(listDownloads(db)).toHaveLength(0);
    const chapters = listChapters(db, novelId);
    expect(chapters.every((chapter) => chapter.isDownloaded)).toBe(true);
    const html = files.readText(chapters[0].filePath as string);
    expect(html).toContain('Text of /c/1');
    expect(html).toMatch(/src="images\/[a-z0-9]+\.png"/);
    expect(imageRequests[0].referer).toBe('https://demo.test/');
    // One second between two requests to the same source.
    expect(waits).toEqual([1000, 1000]);
    expect(progress.map((value) => `${value.done}/${value.total}`)).toEqual(['0/3', '1/3', '2/3']);
    // Fully downloaded: the novel is now listed in the Local tab.
    expect(listLibraryNovels(db)[0].isLocal).toBe(true);
  });

  it('retries a failing chapter with increasing waits, then gives up on it only', async () => {
    const { db, list, runner, failures, calls, waits } = setup(2);
    failures.set('/c/1', [new Error('boom'), new Error('boom'), new Error('boom')]);
    enqueueChapters(
      db,
      list.map((chapter) => chapter.id),
    );
    expect(await runner.run()).toBe('done');
    expect(calls.filter((path) => path === '/c/1')).toHaveLength(MAX_ATTEMPTS);
    expect(waits.filter((ms) => ms >= 4000)).toEqual([4000, 8000]);
    const rows = listDownloads(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'failed', attempts: 3, error: 'boom' });
    expect(getChapter(db, list[0].id)?.isDownloaded).toBe(false);
    expect(getChapter(db, list[1].id)?.isDownloaded).toBe(true);

    retryFailedDownloads(db);
    expect(await runner.run()).toBe('done');
    expect(getChapter(db, list[0].id)?.isDownloaded).toBe(true);
  });

  it('pauses everything when the site asks for a verification', async () => {
    const { db, list, runner, failures } = setup(3);
    failures.set('/c/1', [new CloudflareError('https://demo.test/c/1')]);
    enqueueChapters(
      db,
      list.map((chapter) => chapter.id),
    );
    expect(await runner.run()).toBe('cloudflare');
    expect(summarizeQueue(listDownloads(db))).toEqual({ waiting: 0, paused: 3, failed: 0 });
    resumeDownloads(db);
    expect(await runner.run()).toBe('done');
    expect(listDownloads(db)).toHaveLength(0);
  });

  it('waits for the network and can be stopped', async () => {
    const { db, list, runner, setOnline } = setup(3);
    setChaptersRead(db, [list[0].id], true);
    enqueueChapters(
      db,
      list.map((chapter) => chapter.id),
    );
    setOnline(false);
    expect(await runner.run()).toBe('offline');
    expect(listDownloads(db)).toHaveLength(3);

    setOnline(true);
    const running = runner.run();
    runner.stop();
    expect(await running).toBe('stopped');
    expect(runner.isRunning).toBe(false);
    expect(listDownloads(db).length).toBeGreaterThan(0);
  });
});

describe('storage', () => {
  it('lists the space used and removes downloads, keeping edited chapters', async () => {
    const { db, files, list, runner, novelId } = setup(3);
    enqueueChapters(
      db,
      list.map((chapter) => chapter.id),
    );
    await runner.run();
    setChaptersRead(db, [list[0].id], true);
    db.update(chaptersTable).set({ isEdited: true }).where(eq(chaptersTable.id, list[1].id)).run();

    const [usage] = listNovelStorage(db, files);
    expect(usage).toMatchObject({ novelId, downloaded: 3, downloadedRead: 1 });
    expect(usage.bytes).toBeGreaterThan(0);

    expect(deleteNovelDownloads(db, files, novelId, true)).toBe(1);
    expect(getChapter(db, list[0].id)).toMatchObject({ isDownloaded: false, filePath: null });
    expect(files.list(`novels/${novelId}/images`).length).toBeGreaterThan(0);

    // The edited chapter cannot be fetched again: it stays.
    expect(deleteNovelDownloads(db, files, novelId, false)).toBe(1);
    expect(getChapter(db, list[1].id)?.isDownloaded).toBe(true);
    expect(getChapter(db, list[2].id)?.isDownloaded).toBe(false);
    expect(deleteChapterDownloads(db, files, [9999])).toBe(0);
  });
});
