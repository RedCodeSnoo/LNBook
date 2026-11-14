/**
 * Runs real, unmodified LNReader plugins against the real sites.
 * Not part of `npm test` (needs the network): run with `npm run test:live`.
 */
import { MemoryKeyValueStore } from '../libs/storage';
import { DEFAULT_USER_AGENT } from '../libs/fetch';
import { loadPluginFromCode } from '../pluginRuntime';
import type { PluginItem, SourcePlugin } from '../types';

const MANIFEST =
  'https://raw.githubusercontent.com/LNReader/lnreader-plugins/refs/heads/plugins/v3.0.0/.dist/plugins.json';

/** French sources checked; NovelFrance is required by the specification. */
const PLUGIN_IDS = (process.env.LIVE_PLUGINS ?? 'novelfrance,chireads,noveldeglace').split(',');

jest.setTimeout(120_000);

describe.each<string>(PLUGIN_IDS)('plugin %s', (pluginId: string) => {
  let plugin: SourcePlugin;
  let novelPath = '';
  let chapterPath = '';

  beforeAll(async () => {
    const manifest = (await (await fetch(MANIFEST)).json()) as PluginItem[];
    const item = manifest.find((entry) => entry.id === pluginId);
    if (!item) {
      throw new Error(`Plugin ${pluginId} is not in the catalogue`);
    }
    const code = await (await fetch(item.url)).text();
    plugin = loadPluginFromCode(pluginId, code, {
      fetch,
      getUserAgent: () => DEFAULT_USER_AGENT,
      store: new MemoryKeyValueStore(),
    });
  });

  it('lists popular novels', async () => {
    const filters = Object.fromEntries(
      Object.entries(plugin.filters ?? {}).map(([key, filter]) => [
        key,
        { type: filter.type, value: filter.value },
      ]),
    );
    const novels = await plugin.popularNovels(1, { showLatestNovels: false, filters });
    expect(novels.length).toBeGreaterThan(0);
    expect(novels[0].name).toBeTruthy();
    expect(novels[0].path).toBeTruthy();
    novelPath = novels[0].path;
  });

  it('parses a novel with its chapters', async () => {
    const novel = await plugin.parseNovel(novelPath);
    expect(novel.name).toBeTruthy();
    let chapters = novel.chapters ?? [];
    if (chapters.length === 0 && novel.totalPages && plugin.parsePage) {
      chapters = (await plugin.parsePage(novelPath, '1')).chapters;
    }
    expect(chapters.length).toBeGreaterThan(0);
    chapterPath = chapters[0].path;
  });

  it('parses a chapter', async () => {
    const html = await plugin.parseChapter(chapterPath);
    expect(html.replace(/<[^>]+>/g, '').trim().length).toBeGreaterThan(50);
  });
});
