/**
 * Runs the code of an LNReader plugin. A plugin is a CommonJS module calling `require`
 * for a fixed set of modules; this file provides that `require`, exactly like the
 * LNReader app does, so that plugins work without any change.
 */
import { createFetchLibrary, type FetchEnvironment } from './libs/fetch';
import { isUrlAbsolute } from './libs/isAbsoluteUrl';
import {
  PluginStorage,
  WEBVIEW_LOCAL_STORAGE,
  WEBVIEW_SESSION_STORAGE,
  WebStorage,
  type KeyValueStore,
} from './libs/storage';
import { FilterTypes, NovelStatus, type SourcePlugin } from './types';

function once<T>(load: () => T): () => T {
  let loaded = false;
  let value: T;
  return () => {
    if (!loaded) {
      value = load();
      loaded = true;
    }
    return value;
  };
}

/**
 * Third-party libraries offered to plugins. They are loaded the first time a plugin asks
 * for them: a library that cannot run on a device only affects the plugins that use it,
 * never the start of the app.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const LIBRARIES: Record<string, () => unknown> = {
  cheerio: once(() => require('cheerio')),
  htmlparser2: once(() => require('htmlparser2')),
  domhandler: once(() => require('domhandler')),
  dayjs: once(() => {
    const dayjs = require('dayjs');
    return dayjs.default ?? dayjs;
  }),
  urlencode: once(() => {
    const { encode, decode } = require('urlencode');
    return { encode, decode };
  }),
  '@libs/aes': once(() => ({ gcm: require('@noble/ciphers/aes.js').gcm })),
  '@libs/utils': once(() => {
    const { utf8ToBytes, bytesToUtf8 } = require('@noble/ciphers/utils.js');
    return { utf8ToBytes, bytesToUtf8 };
  }),
};
/* eslint-enable @typescript-eslint/no-require-imports */

export const DEFAULT_COVER =
  'https://github.com/lnreader/lnreader-plugins/blob/master/public/static/coverNotAvailable.webp?raw=true';

export interface PluginEnvironment extends FetchEnvironment {
  store: KeyValueStore;
}

export class PluginLoadError extends Error {
  constructor(
    readonly pluginId: string,
    cause: unknown,
  ) {
    super(
      `Plugin ${pluginId} could not be loaded: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'PluginLoadError';
  }
}

/** Evaluates the code of a plugin and returns its default export. */
export function loadPluginFromCode(
  pluginId: string,
  code: string,
  environment: PluginEnvironment,
): SourcePlugin {
  const packages: Record<string, () => unknown> = {
    ...LIBRARIES,
    '@libs/novelStatus': () => ({ NovelStatus }),
    '@libs/fetch': once(() => createFetchLibrary(environment)),
    '@libs/isAbsoluteUrl': () => ({ isUrlAbsolute }),
    '@libs/filterInputs': () => ({ FilterTypes }),
    '@libs/defaultCover': () => ({ defaultCover: DEFAULT_COVER }),
    '@libs/storage': once(() => ({
      storage: new PluginStorage(environment.store, pluginId),
      localStorage: new WebStorage(environment.store, pluginId + WEBVIEW_LOCAL_STORAGE),
      sessionStorage: new WebStorage(environment.store, pluginId + WEBVIEW_SESSION_STORAGE),
    })),
  };
  const requireModule = (name: string): unknown => {
    if (!Object.prototype.hasOwnProperty.call(packages, name)) {
      throw new Error(`Module not available to plugins: ${name}`);
    }
    return packages[name]();
  };

  let plugin: SourcePlugin | undefined;
  try {
    // The plugin source is data downloaded by the user: it is evaluated on purpose.
    plugin = Function(
      'require',
      'module',
      `const exports = module.exports = {};\n${code};\nreturn exports.default;`,
    )(requireModule, {}) as SourcePlugin | undefined;
  } catch (error) {
    throw new PluginLoadError(pluginId, error);
  }
  if (
    !plugin ||
    typeof plugin.popularNovels !== 'function' ||
    typeof plugin.parseNovel !== 'function' ||
    typeof plugin.parseChapter !== 'function'
  ) {
    throw new PluginLoadError(pluginId, 'no plugin exported');
  }

  // Images are requested with the same User-Agent as pages.
  const headers = { ...(plugin.imageRequestInit?.headers ?? {}) };
  if (!Object.keys(headers).some((name) => name.toLowerCase() === 'user-agent')) {
    headers['User-Agent'] = environment.getUserAgent();
  }
  plugin.imageRequestInit = { ...plugin.imageRequestInit, headers };
  return plugin;
}
