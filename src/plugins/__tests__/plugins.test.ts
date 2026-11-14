import { createTestDatabase } from '../../db/testing';
import {
  cleanChapterHtml,
  fetchChapterText,
  fetchSourceNovel,
  findSourceNovel,
  resolveSourceUrl,
  saveSourceNovel,
} from '../../features/browse/sourceNovels';
import {
  getChapter,
  getNovel,
  listChapters,
  updateNovelFields,
} from '../../features/novel/novelRepository';
import { MemoryFileStore } from '../../services/fileStore';
import { compareVersions, isNewerVersion } from '../../services/version';
import { CloudflareError, isCloudflareChallenge } from '../libs/fetch';
import { isUrlAbsolute } from '../libs/isAbsoluteUrl';
import { MemoryKeyValueStore, PluginStorage } from '../libs/storage';
import { PluginError, runPluginCall, toPluginError } from '../pluginErrors';
import {
  addRepository,
  catalogLanguages,
  createDbKeyValueStore,
  DEFAULT_REPOSITORY,
  fetchCatalog,
  getInstalledPlugin,
  hasUpdate,
  installPlugin,
  listInstalledPlugins,
  listRepositories,
  loadPlugin,
  resetLoadedPlugins,
  seedDefaultRepository,
  sortSources,
  uninstallPlugin,
} from '../pluginManager';
import { loadPluginFromCode, PluginLoadError } from '../pluginRuntime';
import type { PluginItem } from '../types';

/** A plugin written like the compiled LNReader ones (CommonJS, `exports.default`). */
const pluginCode = (version = '1.0.0') => `
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var cheerio_1 = require("cheerio");
var fetch_1 = require("@libs/fetch");
var novelStatus_1 = require("@libs/novelStatus");
var filterInputs_1 = require("@libs/filterInputs");
var defaultCover_1 = require("@libs/defaultCover");
var storage_1 = require("@libs/storage");
var Demo = function () {
  this.id = "demo";
  this.name = "Demo";
  this.site = "https://demo.test/";
  this.version = "${version}";
  this.filters = { sort: { label: "Sort", type: filterInputs_1.FilterTypes.Picker, value: "new",
    options: [{ label: "New", value: "new" }] } };
};
Demo.prototype.popularNovels = async function (page, options) {
  var body = await fetch_1.fetchApi(this.site + "list?page=" + page).then(function (r) { return r.text(); });
  var $ = cheerio_1.load(body);
  storage_1.storage.set("lastPage", page);
  return $("a.novel").map(function (i, el) {
    return { name: $(el).text(), path: $(el).attr("href"), cover: defaultCover_1.defaultCover };
  }).get();
};
Demo.prototype.searchNovels = async function () { return []; };
Demo.prototype.parseNovel = async function (path) {
  return { name: "Demo novel", path: path, author: "Someone", summary: "Summary",
    genres: "Action, Drama ,", status: novelStatus_1.NovelStatus.Ongoing, cover: "https://demo.test/c.jpg",
    chapters: [{ name: "Chapter 1", path: "/c/1" }], totalPages: 2 };
};
Demo.prototype.parsePage = async function (path, page) {
  return { chapters: [{ name: "Chapter 2: Next", path: "/c/2", chapterNumber: 2 },
    { name: "Chapter 1", path: "/c/1" }] };
};
Demo.prototype.parseChapter = async function (path) {
  return fetch_1.fetchText(this.site + path.slice(1));
};
exports.default = new Demo();
`;

const response = (body: string, init: { status?: number; headers?: Record<string, string> } = {}) =>
  new Response(body, { status: init.status ?? 200, headers: init.headers });

function setup(routes: Record<string, () => Response> = {}) {
  resetLoadedPlugins();
  const { db } = createTestDatabase();
  const files = new MemoryFileStore();
  const requests: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    const route = routes[url];
    return route ? route() : response('not found', { status: 404 });
  }) as typeof fetch;
  const environment = {
    fetch: fetcher,
    getUserAgent: () => 'TestAgent/1.0',
    store: createDbKeyValueStore(db),
  };
  return { db, files, requests, deps: { db, files, environment } };
}

const item = (overrides: Partial<PluginItem> = {}): PluginItem => ({
  id: 'demo',
  name: 'Demo',
  site: 'https://demo.test/',
  lang: 'Français',
  version: '1.0.0',
  url: 'https://repo.test/demo.js',
  iconUrl: 'https://repo.test/icon.png',
  ...overrides,
});

describe('versions', () => {
  it('compares versions numerically', () => {
    expect(compareVersions('1.0.10', '1.0.9')).toBeGreaterThan(0);
    expect(compareVersions('v1.4.0', '1.4')).toBe(0);
    expect(isNewerVersion('2.0.0', '1.99.99')).toBe(true);
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
    expect(isNewerVersion('0.4.1', '0.4.0-beta')).toBe(true);
  });
});

describe('plugin runtime', () => {
  it('runs a plugin with the modules it requires', async () => {
    const { deps, db } = setup({
      'https://demo.test/list?page=3': () =>
        response('<a class="novel" href="/n/1">First</a><a class="novel" href="/n/2">Second</a>'),
    });
    const plugin = loadPluginFromCode('demo', pluginCode(), deps.environment);
    expect(plugin.imageRequestInit?.headers?.['User-Agent']).toBe('TestAgent/1.0');
    const novels = await plugin.popularNovels(3, {});
    expect(novels.map((novel) => novel.path)).toEqual(['/n/1', '/n/2']);
    // The plugin stored a value through @libs/storage: it is kept per plugin.
    expect(new PluginStorage(createDbKeyValueStore(db), 'demo').get('lastPage')).toBe(3);
    expect(new PluginStorage(createDbKeyValueStore(db), 'other').get('lastPage')).toBeUndefined();
  });

  it('rejects code that is not a plugin', () => {
    const { deps } = setup();
    expect(() => loadPluginFromCode('x', 'exports.default = 3;', deps.environment)).toThrow(
      PluginLoadError,
    );
    expect(() => loadPluginFromCode('x', 'syntax error here(', deps.environment)).toThrow(
      PluginLoadError,
    );
    expect(() =>
      loadPluginFromCode('x', 'require("fs"); exports.default = {};', deps.environment),
    ).toThrow(/not available/);
  });

  it('expires stored values', () => {
    const storage = new PluginStorage(new MemoryKeyValueStore(), 'p');
    storage.set('a', { n: 1 });
    storage.set('old', 1, Date.now() - 1000);
    expect(storage.get('a')).toEqual({ n: 1 });
    expect(storage.get('old')).toBeUndefined();
    expect(storage.getAllKeys()).toEqual(['a']);
    storage.clearAll();
    expect(storage.getAllKeys()).toEqual([]);
  });

  it('recognises absolute addresses like LNReader', () => {
    expect(isUrlAbsolute('https://a.b/c')).toBe(true);
    expect(isUrlAbsolute('//a.b/c')).toBe(true);
    expect(isUrlAbsolute('/novel/1')).toBe(false);
    expect(isUrlAbsolute('novel/1.html')).toBe(false);
  });
});

describe('errors', () => {
  it('detects a Cloudflare verification page', async () => {
    expect(
      await isCloudflareChallenge(
        response('x', { status: 403, headers: { 'cf-mitigated': 'challenge' } }),
      ),
    ).toBe(true);
    expect(
      await isCloudflareChallenge(
        response('<title>Just a moment...</title>', {
          status: 503,
          headers: { server: 'cloudflare' },
        }),
      ),
    ).toBe(true);
    expect(await isCloudflareChallenge(response('Forbidden', { status: 403 }))).toBe(false);
    expect(await isCloudflareChallenge(response('ok'))).toBe(false);
  });

  it('turns a challenge met by a plugin into a Cloudflare error with the page address', async () => {
    const { deps } = setup({
      'https://demo.test/list?page=1': () =>
        response('', { status: 403, headers: { 'cf-mitigated': 'challenge' } }),
    });
    const plugin = loadPluginFromCode('demo', pluginCode(), deps.environment);
    const error = await runPluginCall(() => plugin.popularNovels(1, {})).catch((e) => e);
    expect(error).toBeInstanceOf(PluginError);
    expect(error.kind).toBe('cloudflare');
    expect(error.url).toBe('https://demo.test/list?page=1');
  });

  it('limits the duration of a call and names the kind of failure', async () => {
    const never = new Promise<string>(() => undefined);
    await expect(runPluginCall(() => never, 20)).rejects.toMatchObject({ kind: 'timeout' });
    expect(toPluginError(new TypeError('Network request failed')).kind).toBe('network');
    expect(toPluginError(new Error("Cannot read property 'x' of undefined")).kind).toBe('plugin');
    expect(toPluginError(new CloudflareError('https://a.b')).kind).toBe('cloudflare');
  });
});

describe('catalogue and installation', () => {
  it('keeps the default repository and accepts others', () => {
    const { db } = setup();
    seedDefaultRepository(db);
    seedDefaultRepository(db);
    expect(listRepositories(db).map((repo) => repo.url)).toEqual([DEFAULT_REPOSITORY.url]);
    expect(addRepository(db, 'not a url')).toBe(false);
    expect(addRepository(db, ' https://example.org/owner/plugins.json ')).toBe(true);
    expect(listRepositories(db)).toHaveLength(2);
  });

  it('merges repositories, keeping the most recent version of a plugin', async () => {
    const { deps } = setup({
      'https://a.test/plugins.json': () =>
        response(JSON.stringify([item(), item({ id: 'en', name: 'Alpha', lang: 'English' })])),
      'https://b.test/plugins.json': () =>
        response(JSON.stringify([item({ version: '1.2.0' }), { broken: true }])),
      'https://c.test/plugins.json': () => response('oops', { status: 500 }),
    });
    const catalog = await fetchCatalog(
      ['https://a.test/plugins.json', 'https://b.test/plugins.json', 'https://c.test/plugins.json'],
      deps.environment.fetch,
    );
    expect(catalog.entries.map((entry) => `${entry.id}@${entry.version}`)).toEqual([
      'en@1.0.0',
      'demo@1.2.0',
    ]);
    expect(catalog.entries[1].repoUrl).toBe('https://b.test/plugins.json');
    expect(catalog.failed).toEqual([{ url: 'https://c.test/plugins.json', reason: 'HTTP 500' }]);
    expect(catalogLanguages(catalog.entries)).toEqual(['English', 'Français']);
  });

  it('installs, updates and uninstalls a plugin, working offline once installed', async () => {
    let version = '1.0.0';
    const { deps, db, files, requests } = setup({
      'https://repo.test/demo.js': () => response(pluginCode(version)),
      'https://repo.test/custom.css': () => response('p{}'),
    });
    const installed = await installPlugin(deps, {
      ...item({ customCSS: 'https://repo.test/custom.css' }),
      repoUrl: 'https://a.test/plugins.json',
    });
    expect(installed.version).toBe('1.0.0');
    expect(installed.customCssPath).toBe('plugins/demo/custom.css');
    expect(files.exists('plugins/demo/index.js')).toBe(true);
    expect(hasUpdate(installed, item({ version: '1.1.0' }))).toBe(true);
    expect(hasUpdate(installed, item())).toBe(false);

    // Loaded from the stored code, without any request.
    resetLoadedPlugins();
    const before = requests.length;
    expect(loadPlugin(deps, 'demo')?.version).toBe('1.0.0');
    expect(requests.length).toBe(before);

    version = '1.1.0';
    await installPlugin(deps, item({ version: '1.1.0' }));
    expect(listInstalledPlugins(db)).toHaveLength(1);
    expect(getInstalledPlugin(db, 'demo')?.version).toBe('1.1.0');
    expect(loadPlugin(deps, 'demo')?.version).toBe('1.1.0');

    new PluginStorage(deps.environment.store, 'demo').set('token', 'abc');
    uninstallPlugin(deps, 'demo');
    expect(listInstalledPlugins(db)).toHaveLength(0);
    expect(files.exists('plugins/demo/index.js')).toBe(false);
    expect(loadPlugin(deps, 'demo')).toBeNull();
    expect(deps.environment.store.keys()).toEqual([]);
  });

  it('stores nothing when the downloaded code is not a plugin', async () => {
    const { deps, db, files } = setup({
      'https://repo.test/demo.js': () => response('<html>404</html>'),
    });
    await expect(installPlugin(deps, item())).rejects.toBeInstanceOf(PluginLoadError);
    expect(listInstalledPlugins(db)).toHaveLength(0);
    expect(files.exists('plugins/demo/index.js')).toBe(false);
  });

  it('orders sources: pinned, last used, then by name', async () => {
    const base = { pinned: false, lastUsedAt: null as number | null };
    const list = [
      { ...base, id: 'c', name: 'Charlie' },
      { ...base, id: 'a', name: 'Alpha', lastUsedAt: 5 },
      { ...base, id: 'b', name: 'Bravo', lastUsedAt: 9 },
      { ...base, id: 'd', name: 'Delta', pinned: true },
    ] as unknown as Parameters<typeof sortSources>[0];
    expect(sortSources(list).map((plugin) => plugin.id)).toEqual(['d', 'b', 'a', 'c']);
  });
});

describe('novels of a source', () => {
  async function demo() {
    const context = setup({
      'https://demo.test/c/1': () =>
        response('<div><p>Hello <b>world</b></p><img src="/img/a.png"><script>x()</script></div>'),
      'https://demo.test/c/2': () => response('<p> </p>'),
    });
    const plugin = loadPluginFromCode('demo', pluginCode(), context.deps.environment);
    return { ...context, plugin };
  }

  it('reads every page of chapters once', async () => {
    const { plugin } = await demo();
    const fetched = await fetchSourceNovel(plugin, '/n/1');
    expect(fetched.chapters.map((chapter) => chapter.path)).toEqual(['/c/1', '/c/2']);
  });

  it('creates the novel, then only adds what is new', async () => {
    const { plugin, db } = await demo();
    const fetched = await fetchSourceNovel(plugin, '/n/1');
    const first = saveSourceNovel(db, { id: 'demo', lang: 'Français' }, '/n/1', fetched, 1000);
    expect(first.created).toBe(true);
    expect(first.addedChapterIds).toHaveLength(2);
    const novel = getNovel(db, first.novelId);
    expect(novel).toMatchObject({
      origin: 'online',
      pluginId: 'demo',
      title: 'Demo novel',
      author: 'Someone',
      genres: 'Action,Drama',
      status: 'Ongoing',
      coverPath: 'https://demo.test/c.jpg',
      originalLang: 'fr',
      inLibrary: false,
    });
    const list = listChapters(db, first.novelId);
    expect(list.map((chapter) => [chapter.title, chapter.number, chapter.foundAt])).toEqual([
      ['Chapter 1', 1, null],
      ['Chapter 2: Next', 2, null],
    ]);

    // The user renames the novel; the site then publishes a third chapter.
    updateNovelFields(db, first.novelId, { title: 'My title' });
    fetched.chapters.push({ name: 'Chapter 3', path: '/c/3' });
    const second = saveSourceNovel(db, { id: 'demo' }, '/n/1', fetched, 2000);
    expect(second.created).toBe(false);
    expect(second.novelId).toBe(first.novelId);
    expect(second.addedChapterIds).toHaveLength(1);
    expect(getNovel(db, first.novelId)?.title).toBe('My title');
    expect(getNovel(db, first.novelId)?.lastUpdatedAt).toBe(2000);
    expect(getChapter(db, second.addedChapterIds[0])?.foundAt).toBe(2000);
    expect(findSourceNovel(db, 'demo', '/n/1')?.id).toBe(first.novelId);
    expect(findSourceNovel(db, 'demo', '/n/404')).toBeNull();
  });

  it('fetches, cleans and stores the text of a chapter', async () => {
    const { plugin, db, files } = await demo();
    const saved = saveSourceNovel(
      db,
      { id: 'demo' },
      '/n/1',
      await fetchSourceNovel(plugin, '/n/1'),
    );
    const [one, two] = listChapters(db, saved.novelId);
    const html = await fetchChapterText(db, files, plugin, one);
    expect(html).toContain('Hello <b>world</b>');
    expect(html).toContain('src="https://demo.test/img/a.png"');
    expect(html).not.toContain('script');
    const stored = getChapter(db, one.id);
    expect(stored?.filePath).toBeTruthy();
    expect(stored?.isDownloaded).toBe(false);
    expect(stored?.wordCount).toBe(2);
    expect(files.readText(stored?.filePath as string)).toBe(html);

    await fetchChapterText(db, files, plugin, one, true);
    expect(getChapter(db, one.id)?.isDownloaded).toBe(true);
    await expect(fetchChapterText(db, files, plugin, two)).rejects.toThrow(/empty/);
  });

  it('builds absolute addresses', () => {
    expect(resolveSourceUrl({ site: 'https://demo.test/' }, '/n/1')).toBe('https://demo.test/n/1');
    expect(resolveSourceUrl({ site: 'https://demo.test' }, 'https://x.y/z')).toBe('https://x.y/z');
    expect(
      resolveSourceUrl(
        { site: 'https://demo.test', resolveUrl: (path) => `https://r.t${path}` },
        '/a',
      ),
    ).toBe('https://r.t/a');
    expect(
      cleanChapterHtml('<p><a href="/x">l</a><a href="javascript:1">j</a></p>', 'https://a.b/c/'),
    ).toBe('<p><a href="https://a.b/x">l</a>j</p>');
  });
});
