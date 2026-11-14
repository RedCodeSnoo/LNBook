import type { AccentSetting, AppThemeSetting } from '../../theme/palette';

export type LanguageSetting = 'system' | 'fr' | 'en';
export type TabName = 'library' | 'updates' | 'history' | 'browse' | 'more';
export type DateFormatSetting = 'system' | 'dmy' | 'mdy' | 'ymd';

/** Every app setting with its type. New settings are added here with a default value. */
export interface AppSettings {
  language: LanguageSetting;
  appTheme: AppThemeSetting;
  accent: AccentSetting;
  /** Multiplier applied to the interface text size (0.85 – 1.3). */
  uiScale: number;
  startTab: TabName;
  dateFormat: DateFormatSetting;
  incognito: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'system',
  appTheme: 'system',
  accent: 'indigo',
  uiScale: 1,
  startTab: 'library',
  dateFormat: 'system',
  incognito: false,
};

export type SettingKey = keyof AppSettings;
