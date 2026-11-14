import { create } from 'zustand';

import { getDb } from '../../db/client';
import { DEFAULT_SETTINGS, type AppSettings, type SettingKey } from './settings';
import { readSettings, writeSetting } from './settingsRepository';

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
}

export const useSettingsStore = create<SettingsState>(() => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
}));

/** Loads the settings from the database (called once at startup). */
export function loadSettings(): AppSettings {
  const settings = readSettings(getDb());
  useSettingsStore.setState({ settings, loaded: true });
  return settings;
}

/** Updates a setting in memory and in the database. */
export function setSetting<K extends SettingKey>(key: K, value: AppSettings[K]): void {
  useSettingsStore.setState((state) => ({ settings: { ...state.settings, [key]: value } }));
  writeSetting(getDb(), key, value);
}

export function getSetting<K extends SettingKey>(key: K): AppSettings[K] {
  return useSettingsStore.getState().settings[key];
}

export function useSetting<K extends SettingKey>(key: K): AppSettings[K] {
  return useSettingsStore((state) => state.settings[key]);
}
