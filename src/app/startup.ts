import { getDb, openAppDatabase } from '../db/client';
import {
  DEFAULT_CATEGORY_KEYS,
  seedDefaultCategories,
} from '../features/library/libraryRepository';
import { readValue, writeValue } from '../features/settings/settingsRepository';
import { loadSettings } from '../features/settings/settingsStore';
import i18n, { initI18n } from '../i18n';
import { removeVisitedNovels } from '../features/browse/sourceNovels';
import { seedDefaultRepository } from '../plugins/pluginManager';
import { errorLog } from '../services/deviceErrorLog';
import { installErrorLog } from '../services/errorLog';

/** Creates the default shelves on the very first launch only. */
function seedDefaults(): void {
  const db = getDb();
  if (readValue(db, 'defaultsSeeded', false)) {
    return;
  }
  seedDefaultCategories(
    db,
    DEFAULT_CATEGORY_KEYS.map((key) => i18n.t(key)),
  );
  writeValue(db, 'defaultsSeeded', true);
}

export type StartupResult = { ok: true } | { ok: false; error: unknown };

/** Opens the database (running migrations), then loads the settings and the language. */
export function startApp(): StartupResult {
  installErrorLog(errorLog);
  try {
    openAppDatabase();
    const settings = loadSettings();
    initI18n(settings.language);
    seedDefaults();
    seedDefaultRepository(getDb());
    // Novels only looked at while browsing are not kept from one launch to the next.
    removeVisitedNovels(getDb());
    return { ok: true };
  } catch (error) {
    console.error('Startup failed', error);
    initI18n('system');
    return { ok: false, error };
  }
}
