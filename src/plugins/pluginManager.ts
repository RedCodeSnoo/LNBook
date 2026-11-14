/**
 * Catalogue, installation and loading of source plugins. The code of an installed plugin
 * is stored in the app: installed sources work without downloading the catalogue again.
 */
import { asc, eq } from 'drizzle-orm';

import type { AppDatabase } from '../db/client';
import { pluginRepos, plugins, settings, type Plugin } from '../db/schema';
import type { FileStore } from '../services/fileStore';
import { isNewerVersion } from '../services/version';
import { clearPluginStorage, type KeyValueStore } from './libs/storage';
import { loadPluginFromCode, type PluginEnvironment } from './pluginRuntime';
import type { PluginItem, SourcePlugin } from './types';

/** Catalogue used by the LNReader app (manifest v3). */
export const DEFAULT_REPOSITORY = {
  name: 'LNReader',
  url: 'https://raw.githubusercontent.com/LNReader/lnreader-plugins/refs/heads/plugins/v3.0.0/.dist/plugins.json',
};

const pluginDir = (id: string) => `plugins/${id}`;
const codePath = (id: string) => `${pluginDir(id)}/index.js`;

// ---------------------------------------------------------------------------
// Storage given to plugins (rows of the settings table with a prefix)
// ---------------------------------------------------------------------------

const STORE_PREFIX = 'pluginStore:';

export function createDbKeyValueStore(db: AppDatabase): KeyValueStore {
  return {
    get: (key) =>
      db
        .select({ value: settings.value })
        .from(settings)
        .where(eq(settings.key, STORE_PREFIX + key))
        .get()?.value ?? null,
    set: (key, value) => {
      db.insert(settings)
        .values({ key: STORE_PREFIX + key, value })
        .onConflictDoUpdate({ target: settings.key, set: { value } })
        .run();
    },
    delete: (key) => {
      db.delete(settings)
        .where(eq(settings.key, STORE_PREFIX + key))
        .run();
    },
    keys: () =>
      db
        .select({ key: settings.key })
        .from(settings)
        .all()
        .filter((row) => row.key.startsWith(STORE_PREFIX))
        .map((row) => row.key.slice(STORE_PREFIX.length)),
  };
}

// ---------------------------------------------------------------------------
// Repositories and catalogue
// ---------------------------------------------------------------------------

export function listRepositories(db: AppDatabase) {
  return db.select().from(pluginRepos).orderBy(asc(pluginRepos.name)).all();
}

export function seedDefaultRepository(db: AppDatabase): void {
  db.insert(pluginRepos).values(DEFAULT_REPOSITORY).onConflictDoNothing().run();
}

export function addRepository(db: AppDatabase, url: string, name?: string): boolean {
  const cleaned = url.trim();
  if (!/^https?:\/\/\S+$/i.test(cleaned)) {
    return false;
  }
  let label = name?.trim();
  if (!label) {
    // "github.com/owner/repo" style names are the most telling part of the address.
    const match = /^https?:\/\/[^/]+\/([^/]+)/.exec(cleaned);
    label = match ? match[1] : cleaned;
  }
  db.insert(pluginRepos).values({ url: cleaned, name: label }).onConflictDoNothing().run();
  return true;
}

export function removeRepository(db: AppDatabase, url: string): void {
  db.delete(pluginRepos).where(eq(pluginRepos.url, url)).run();
}

export interface CatalogEntry extends PluginItem {
  repoUrl: string;
}

export interface CatalogResult {
  entries: CatalogEntry[];
  /** Repositories that could not be read. */
  failed: { url: string; reason: string }[];
}

function isPluginItem(value: unknown): value is PluginItem {
  const item = value as Partial<PluginItem> | null;
  return (
    !!item &&
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    typeof item.url === 'string' &&
    typeof item.version === 'string' &&
    typeof item.lang === 'string'
  );
}

/** Reads every repository; when a plugin is in several, the most recent version wins. */
export async function fetchCatalog(
  repositoryUrls: string[],
  fetcher: typeof fetch,
): Promise<CatalogResult> {
  const byId = new Map<string, CatalogEntry>();
  const failed: CatalogResult['failed'] = [];
  const results = await Promise.allSettled(
    repositoryUrls.map(async (url) => {
      const response = await fetcher(url, { headers: { 'cache-control': 'no-cache' } });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const list: unknown = await response.json();
      if (!Array.isArray(list)) {
        throw new Error('Not a plugin list');
      }
      return list.filter(isPluginItem);
    }),
  );
  results.forEach((result, index) => {
    const repoUrl = repositoryUrls[index];
    if (result.status === 'rejected') {
      failed.push({ url: repoUrl, reason: String(result.reason?.message ?? result.reason) });
      return;
    }
    for (const item of result.value) {
      const known = byId.get(item.id);
      if (!known || isNewerVersion(item.version, known.version)) {
        byId.set(item.id, { ...item, site: item.site ?? '', repoUrl });
      }
    }
  });
  return {
    entries: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name)),
    failed,
  };
}

/** Languages present in a catalogue, as written by the plugins ("Français", "English"…). */
export function catalogLanguages(entries: PluginItem[]): string[] {
  return [...new Set(entries.map((entry) => entry.lang))].sort((a, b) => a.localeCompare(b));
}

export function hasUpdate(installed: Pick<Plugin, 'version'>, entry: PluginItem): boolean {
  return isNewerVersion(entry.version, installed.version);
}

// ---------------------------------------------------------------------------
// Installed plugins
// ---------------------------------------------------------------------------

export interface PluginManagerDeps {
  db: AppDatabase;
  files: FileStore;
  environment: PluginEnvironment;
}

export function listInstalledPlugins(db: AppDatabase): Plugin[] {
  return db.select().from(plugins).orderBy(asc(plugins.name)).all();
}

export function getInstalledPlugin(db: AppDatabase, id: string): Plugin | null {
  return db.select().from(plugins).where(eq(plugins.id, id)).get() ?? null;
}

const loaded = new Map<string, SourcePlugin>();

/** Forgets the loaded plugins (tests, and after a restore). */
export function resetLoadedPlugins(): void {
  loaded.clear();
}

async function download(fetcher: typeof fetch, url: string): Promise<string> {
  const response = await fetcher(url, {
    headers: { pragma: 'no-cache', 'cache-control': 'no-cache' },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.text();
}

/** Downloads a plugin (or its new version), checks that it loads, and stores it. */
export async function installPlugin(
  deps: PluginManagerDeps,
  entry: PluginItem & { repoUrl?: string },
  now = Date.now(),
): Promise<Plugin> {
  const { db, files, environment } = deps;
  const code = await download(environment.fetch, entry.url);
  // Throws when the code is not a usable plugin: nothing is stored in that case.
  const plugin = loadPluginFromCode(entry.id, code, environment);

  files.writeText(codePath(entry.id), code);
  let customJsPath: string | null = null;
  let customCssPath: string | null = null;
  if (entry.customJS) {
    customJsPath = `${pluginDir(entry.id)}/custom.js`;
    files.writeText(customJsPath, await download(environment.fetch, entry.customJS));
  }
  if (entry.customCSS) {
    customCssPath = `${pluginDir(entry.id)}/custom.css`;
    files.writeText(customCssPath, await download(environment.fetch, entry.customCSS));
  }

  const values = {
    name: entry.name,
    lang: entry.lang,
    version: entry.version,
    site: entry.site || plugin.site || '',
    iconUrl: entry.iconUrl ?? null,
    codePath: codePath(entry.id),
    repoUrl: entry.repoUrl ?? null,
    customJsPath,
    customCssPath,
    hasSettings: Boolean(entry.hasSettings || plugin.pluginSettings),
  };
  db.insert(plugins)
    .values({ id: entry.id, ...values, installedAt: now })
    .onConflictDoUpdate({ target: plugins.id, set: values })
    .run();
  loaded.set(entry.id, plugin);
  return getInstalledPlugin(db, entry.id) as Plugin;
}

export function uninstallPlugin(deps: PluginManagerDeps, id: string): void {
  loaded.delete(id);
  deps.files.delete(pluginDir(id));
  clearPluginStorage(deps.environment.store, id);
  deps.db.delete(plugins).where(eq(plugins.id, id)).run();
}

/** The runnable plugin of an installed source, loaded from its stored code. */
export function loadPlugin(deps: PluginManagerDeps, id: string): SourcePlugin | null {
  const cached = loaded.get(id);
  if (cached) {
    return cached;
  }
  const row = getInstalledPlugin(deps.db, id);
  if (!row || !deps.files.exists(row.codePath)) {
    return null;
  }
  const plugin = loadPluginFromCode(id, deps.files.readText(row.codePath), deps.environment);
  loaded.set(id, plugin);
  return plugin;
}

export function setPluginPinned(db: AppDatabase, id: string, pinned: boolean): void {
  db.update(plugins).set({ pinned }).where(eq(plugins.id, id)).run();
}

export function touchPlugin(db: AppDatabase, id: string, now = Date.now()): void {
  db.update(plugins).set({ lastUsedAt: now }).where(eq(plugins.id, id)).run();
}

/** Pinned sources first, then the last one used, then by name. */
export function sortSources(list: Plugin[]): Plugin[] {
  const lastUsed = list.reduce<Plugin | null>(
    (best, plugin) =>
      plugin.lastUsedAt && (!best || plugin.lastUsedAt > (best.lastUsedAt ?? 0)) ? plugin : best,
    null,
  );
  const rank = (plugin: Plugin) => (plugin.pinned ? 0 : plugin.id === lastUsed?.id ? 1 : 2);
  return [...list].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
