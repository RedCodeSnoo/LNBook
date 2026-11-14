import { getDb, openAppDatabase } from '../db/client';
import { seedDefaultCategories } from '../features/library/libraryRepository';
import { readValue, writeValue } from '../features/settings/settingsRepository';
import { loadSettings } from '../features/settings/settingsStore';
import i18n, { initI18n } from '../i18n';

/** Creates the default shelves on the very first launch only. */
function seedDefaults(): void {
  const db = getDb();
  if (readValue(db, 'defaultsSeeded', false)) {
    return;
  }
  seedDefaultCategories(db, [
    i18n.t('categories.defaultReading'),
    i18n.t('categories.defaultToRead'),
    i18n.t('categories.defaultFinished'),
  ]);
  writeValue(db, 'defaultsSeeded', true);
}

export type StartupResult = { ok: true } | { ok: false; error: unknown };

/** Opens the database (running migrations), then loads the settings and the language. */
export function startApp(): StartupResult {
  try {
    openAppDatabase();
    const settings = loadSettings();
    initI18n(settings.language);
    seedDefaults();
    return { ok: true };
  } catch (error) {
    initI18n('system');
    return { ok: false, error };
  }
}
