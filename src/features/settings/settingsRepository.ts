import type { AppDatabase } from '../../db/client';
import { settings as settingsTable } from '../../db/schema';
import { DEFAULT_SETTINGS, type AppSettings, type SettingKey } from './settings';

/** Reads the stored settings; missing or unreadable values fall back to the defaults. */
export function readSettings(db: AppDatabase): AppSettings {
  const result: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of db.select().from(settingsTable).all()) {
    if (!(row.key in DEFAULT_SETTINGS)) {
      continue;
    }
    try {
      const value: unknown = JSON.parse(row.value);
      if (typeof value === typeof DEFAULT_SETTINGS[row.key as SettingKey]) {
        result[row.key] = value;
      }
    } catch {
      // Corrupted value: keep the default.
    }
  }
  return result as unknown as AppSettings;
}

export function writeSetting<K extends SettingKey>(
  db: AppDatabase,
  key: K,
  value: AppSettings[K],
): void {
  const encoded = JSON.stringify(value);
  db.insert(settingsTable)
    .values({ key, value: encoded })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: encoded } })
    .run();
}

/** Raw access for values that are not user settings (timestamps of checks, flags…). */
export function readValue<T>(db: AppDatabase, key: string, fallback: T): T {
  const row = db
    .select()
    .from(settingsTable)
    .all()
    .find((candidate) => candidate.key === key);
  if (!row) {
    return fallback;
  }
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function writeValue(db: AppDatabase, key: string, value: unknown): void {
  const encoded = JSON.stringify(value);
  db.insert(settingsTable)
    .values({ key, value: encoded })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: encoded } })
    .run();
}
