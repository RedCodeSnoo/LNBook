/** The plugin engine wired to the device: database, files, network and settings. */
import { getDb } from '../db/client';
import { getSetting } from '../features/settings/settingsStore';
import { deviceFiles } from '../services/deviceFileStore';
import { DEFAULT_USER_AGENT } from './libs/fetch';
import { PluginError } from './pluginErrors';
import { createDbKeyValueStore, loadPlugin, type PluginManagerDeps } from './pluginManager';
import type { SourcePlugin } from './types';

export function getUserAgent(): string {
  return getSetting('userAgent').trim() || DEFAULT_USER_AGENT;
}

let deps: PluginManagerDeps | null = null;

export function pluginDeps(): PluginManagerDeps {
  const db = getDb();
  if (!deps || deps.db !== db) {
    deps = {
      db,
      files: deviceFiles,
      environment: {
        // Resolved at call time: the global fetch shares its cookies with the web view.
        fetch: (input, init) => fetch(input, init),
        getUserAgent,
        store: createDbKeyValueStore(db),
      },
    };
  }
  return deps;
}

/** The runnable plugin of an installed source. */
export function getSource(pluginId: string): SourcePlugin {
  let plugin: SourcePlugin | null;
  try {
    plugin = loadPlugin(pluginDeps(), pluginId);
  } catch (error) {
    throw new PluginError('plugin', error instanceof Error ? error.message : String(error));
  }
  if (!plugin) {
    throw new PluginError('notInstalled', `Source ${pluginId} is not installed`);
  }
  return plugin;
}
