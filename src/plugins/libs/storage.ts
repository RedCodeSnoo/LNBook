/**
 * `@libs/storage` given to plugins: a key-value store kept per plugin, plus read access
 * to what the web view recorded from the site (localStorage, sessionStorage).
 */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
  keys(): string[];
}

export class MemoryKeyValueStore implements KeyValueStore {
  private readonly map = new Map<string, string>();

  get(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  set(key: string, value: string): void {
    this.map.set(key, value);
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  keys(): string[] {
    return [...this.map.keys()];
  }
}

const PLUGIN_STORAGE = '_DB_';
export const WEBVIEW_LOCAL_STORAGE = '_LocalStorage';
export const WEBVIEW_SESSION_STORAGE = '_SessionStorage';

interface StoredItem {
  created: string;
  value: unknown;
  expires?: number;
}

export class PluginStorage {
  constructor(
    private readonly store: KeyValueStore,
    private readonly pluginId: string,
  ) {}

  private key(key: string): string {
    return this.pluginId + PLUGIN_STORAGE + key;
  }

  set(key: string, value: unknown, expires?: Date | number): void {
    const item: StoredItem = {
      created: new Date().toISOString(),
      value,
      expires: expires instanceof Date ? expires.getTime() : expires,
    };
    this.store.set(this.key(key), JSON.stringify(item));
  }

  get(key: string, raw?: boolean): unknown {
    const stored = this.store.get(this.key(key));
    if (!stored) {
      return undefined;
    }
    const item = JSON.parse(stored) as StoredItem;
    if (item.expires && Date.now() > item.expires) {
      this.delete(key);
      return undefined;
    }
    return raw ? item : item.value;
  }

  delete(key: string): void {
    this.store.delete(this.key(key));
  }

  clearAll(): void {
    for (const key of this.getAllKeys()) {
      this.delete(key);
    }
  }

  getAllKeys(): string[] {
    const prefix = this.key('');
    return this.store
      .keys()
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
  }
}

/** Read-only view of a web storage captured by the web view for this plugin. */
export class WebStorage {
  constructor(
    private readonly store: KeyValueStore,
    private readonly key: string,
  ) {}

  get(): unknown {
    const data = this.store.get(this.key);
    return data ? JSON.parse(data) : undefined;
  }
}

/** Removes everything a plugin stored (when it is uninstalled). */
export function clearPluginStorage(store: KeyValueStore, pluginId: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(pluginId + PLUGIN_STORAGE) || key.startsWith(`${pluginId}_`)) {
      store.delete(key);
    }
  }
}
