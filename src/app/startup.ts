import { openAppDatabase } from '../db/client';
import { loadSettings } from '../features/settings/settingsStore';
import { initI18n } from '../i18n';

export type StartupResult = { ok: true } | { ok: false; error: unknown };

/** Opens the database (running migrations), then loads the settings and the language. */
export function startApp(): StartupResult {
  try {
    openAppDatabase();
    const settings = loadSettings();
    initI18n(settings.language);
    return { ok: true };
  } catch (error) {
    initI18n('system');
    return { ok: false, error };
  }
}
