import { createTestDatabase } from '../../../db/testing';
import { DEFAULT_SETTINGS } from '../settings';
import { readSettings, readValue, writeSetting, writeValue } from '../settingsRepository';

describe('settings repository', () => {
  it('returns the defaults for an empty database', () => {
    const { db } = createTestDatabase();
    expect(readSettings(db)).toEqual(DEFAULT_SETTINGS);
  });

  it('stores and overwrites a setting', () => {
    const { db } = createTestDatabase();
    writeSetting(db, 'appTheme', 'dark');
    writeSetting(db, 'appTheme', 'amoled');
    writeSetting(db, 'uiScale', 1.15);
    expect(readSettings(db)).toEqual({ ...DEFAULT_SETTINGS, appTheme: 'amoled', uiScale: 1.15 });
  });

  it('ignores corrupted, mistyped and unknown values', () => {
    const { db, sqlite } = createTestDatabase();
    sqlite.exec(`
      INSERT INTO settings (key, value) VALUES ('appTheme', '{not json');
      INSERT INTO settings (key, value) VALUES ('uiScale', '"big"');
      INSERT INTO settings (key, value) VALUES ('removedSetting', '1');
    `);
    expect(readSettings(db)).toEqual(DEFAULT_SETTINGS);
  });

  it('stores arbitrary values', () => {
    const { db } = createTestDatabase();
    expect(readValue(db, 'lastCheck', 0)).toBe(0);
    writeValue(db, 'lastCheck', 1234);
    expect(readValue(db, 'lastCheck', 0)).toBe(1234);
  });
});
