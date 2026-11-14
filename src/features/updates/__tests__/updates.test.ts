import { createTestDatabase } from '../../../db/testing';
import type { ChapterItem, SourcePlugin } from '../../../plugins/types';
import { saveSourceNovel, setNovelInLibrary } from '../../browse/sourceNovels';
import {
  createCategory,
  setCategoryExcluded,
  setNovelCategories,
} from '../../library/libraryRepository';
import { listChapters, setChaptersRead } from '../../novel/novelRepository';
import {
  AUTO_CHECK_INTERVAL_MS,
  checkForNewChapters,
  clearUpdates,
  countUnreadUpdates,
  groupUpdatesByDay,
  isCheckDue,
  listNovelsToCheck,
  listUpdates,
  setNovelUpdateOptions,
} from '../updateChecker';

function setup() {
  const { db } = createTestDatabase();
  /** Chapters each site currently lists, by novel path. */
  const site = new Map<string, ChapterItem[]>();
  const down = new Set<string>();
  const requests: string[] = [];

  const pluginFor = (id: string) =>
    ({
      id,
      site: `https://${id}.test`,
      parseNovel: async (path: string) => {
        requests.push(`${id}${path}`);
        if (down.has(id)) {
          throw new TypeError('Network request failed');
        }
        return { name: path, path, chapters: site.get(`${id}${path}`) ?? [] };
      },
    }) as unknown as SourcePlugin;

  const follow = (pluginId: string, path: string, count: number, inLibrary = true) => {
    const list = Array.from({ length: count }, (_, i) => ({
      name: `Chapter ${i + 1}`,
      path: `${path}/c${i + 1}`,
    }));
    site.set(`${pluginId}${path}`, list);
    const { novelId } = saveSourceNovel(
      db,
      { id: pluginId },
      path,
      { novel: { name: `${pluginId}${path}`, path }, chapters: [...list] },
      1000,
    );
    setNovelInLibrary(db, novelId, inLibrary);
    return novelId;
  };
  const publish = (pluginId: string, path: string, count: number) => {
    const list = site.get(`${pluginId}${path}`) as ChapterItem[];
    for (let i = 0; i < count; i += 1) {
      list.push({ name: `Chapter ${list.length + 1}`, path: `${path}/c${list.length + 1}` });
    }
  };

  let clock = 50_000;
  const waits: number[] = [];
  const check = () =>
    checkForNewChapters({
      db,
      getPlugin: pluginFor,
      delayMs: () => 1000,
      wait: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
      now: () => clock,
    });
  return { db, follow, publish, down, requests, waits, check };
}

describe('automatic check', () => {
  it('is due after six hours', () => {
    expect(isCheckDue(null, 0)).toBe(true);
    expect(isCheckDue(1000, 1000 + AUTO_CHECK_INTERVAL_MS - 1)).toBe(false);
    expect(isCheckDue(1000, 1000 + AUTO_CHECK_INTERVAL_MS)).toBe(true);
  });
});

describe('new chapter check', () => {
  it('finds the new chapters of followed novels only', async () => {
    const { db, follow, publish, check } = setup();
    const a = follow('alpha', '/a', 2);
    follow('alpha', '/b', 1);
    follow('alpha', '/visited', 1, false);
    publish('alpha', '/a', 3);
    publish('alpha', '/visited', 1);

    const result = await check();
    expect(result.checked).toBe(2);
    expect(result.failures).toEqual([]);
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]).toMatchObject({ novelId: a, notify: true, autoDownload: false });
    expect(result.updates[0].chapterIds).toHaveLength(3);

    const rows = listUpdates(db);
    expect(rows.map((row) => row.chapterTitle)).toEqual(['Chapter 5', 'Chapter 4', 'Chapter 3']);
    expect(countUnreadUpdates(db)).toBe(3);
    setChaptersRead(db, [rows[0].chapterId], true);
    expect(countUnreadUpdates(db)).toBe(2);
    expect(groupUpdatesByDay(listUpdates(db)).map((item) => item.type)).toEqual([
      'day',
      'chapter',
      'chapter',
      'chapter',
    ]);

    // Nothing new the second time.
    expect((await check()).updates).toEqual([]);
    clearUpdates(db);
    expect(listUpdates(db)).toEqual([]);
    expect(listChapters(db, a)).toHaveLength(5);
  });

  it('reports a failing source once and carries on with the others', async () => {
    const { follow, publish, down, requests, check } = setup();
    follow('alpha', '/a', 1);
    follow('alpha', '/b', 1);
    follow('alpha', '/c', 1);
    const other = follow('beta', '/x', 1);
    publish('beta', '/x', 1);
    down.add('alpha');

    const result = await check();
    expect(result.failures).toEqual([{ pluginId: 'alpha', kind: 'network', count: 3 }]);
    // The failing site was asked only once.
    expect(requests.filter((request) => request.startsWith('alpha'))).toHaveLength(1);
    expect(result.updates.map((update) => update.novelId)).toEqual([other]);
  });

  it('waits between two requests to the same source', async () => {
    const { follow, waits, check } = setup();
    follow('alpha', '/a', 1);
    follow('alpha', '/b', 1);
    follow('beta', '/x', 1);
    await check();
    expect(waits).toEqual([1000]);
  });

  it('skips the novels of excluded categories and keeps per novel options', async () => {
    const { db, follow, publish, check } = setup();
    const finished = follow('alpha', '/done', 1);
    const reading = follow('alpha', '/reading', 1);
    const category = createCategory(db, 'Finished');
    setCategoryExcluded(db, category.id, true);
    setNovelCategories(db, [finished], [category.id]);
    setNovelUpdateOptions(db, [reading], { notifyUpdates: false, autoDownload: true });
    publish('alpha', '/done', 1);
    publish('alpha', '/reading', 1);

    expect(listNovelsToCheck(db).map((novel) => novel.id)).toEqual([reading]);
    const result = await check();
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]).toMatchObject({
      novelId: reading,
      notify: false,
      autoDownload: true,
    });
  });
});
