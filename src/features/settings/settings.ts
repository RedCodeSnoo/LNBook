import { DEFAULT_READER_SETTINGS, type ReaderSettings } from '../reader/readerSettings';
import { DEFAULT_USER_AGENT } from '../../plugins/libs/fetch';
import type { TranslationEngine } from '../../db/schema';
import type { AutoBackupFrequency } from '../backup/backupFile';
import type { AccentSetting, AppThemeSetting } from '../../theme/palette';

export type LanguageSetting = 'system' | 'fr' | 'en';
export type TabName = 'library' | 'updates' | 'history' | 'browse' | 'more';
export type LibraryDisplay = 'grid' | 'compact' | 'list';
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

  // Library
  libraryDisplay: LibraryDisplay;
  /** Number of columns of the grid in portrait (2–5). */
  libraryColumns: number;
  librarySort: string;
  librarySortAscending: boolean;
  showUnreadBadge: boolean;
  showDownloadBadge: boolean;
  showLanguageBadge: boolean;
  showProgressBar: boolean;

  // Import
  /** Keep the styles of imported EPUB files instead of the reader themes. */
  keepEpubFormatting: boolean;

  /** Global reader display settings (a novel can override them). */
  reader: ReaderSettings;

  // Sources
  /** Languages shown in the plugin catalogue, as named by the plugins. */
  sourceLanguages: string[];
  /** User-Agent sent to the sites, by plugins and by the web view. */
  userAgent: string;

  // Downloads
  downloadWifiOnly: boolean;
  /** Milliseconds between two requests to the same site. */
  downloadDelayMs: number;

  // New chapters
  /** Hours between two background checks (6, 12 or 24); 0 = never. */
  updateCheckHours: number;
  updateWifiOnly: boolean;
  notifyNewChapters: boolean;

  // Voice
  /** Speech engine (Android package name); empty = the default engine of the phone. */
  ttsEngine: string;
  /** Voice remembered for each language code. */
  ttsVoices: Record<string, string>;
  /** Speed, 0.5 to 3. */
  ttsRate: number;
  /** Tone, 0.5 to 2. */
  ttsPitch: number;
  /** Silence between two paragraphs, in milliseconds. */
  ttsPauseMs: number;
  /** Go on with the next chapter when one is finished. */
  ttsAutoNext: boolean;

  // Translation
  /** Engine used unless a novel chooses another one. */
  translationEngine: TranslationEngine;
  /** Chapters translated in advance after the one being read. */
  translateAhead: number;
  /** Show the other version of each paragraph under it, in smaller text. */
  bilingualReading: boolean;

  // App updates
  /** Look for a new version of the app automatically (at most every six hours). */
  checkAppUpdates: boolean;

  // Backups
  autoBackup: AutoBackupFrequency;
  /** Folder chosen with the Android picker (content:// address); empty = none. */
  autoBackupFolder: string;
  /** Include downloaded chapters and translations in automatic backups. */
  autoBackupChapters: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'system',
  appTheme: 'system',
  accent: 'indigo',
  uiScale: 1,
  startTab: 'library',
  dateFormat: 'system',
  incognito: false,

  libraryDisplay: 'grid',
  libraryColumns: 3,
  librarySort: 'lastRead',
  librarySortAscending: false,
  showUnreadBadge: true,
  showDownloadBadge: true,
  showLanguageBadge: true,
  showProgressBar: true,

  keepEpubFormatting: false,

  reader: DEFAULT_READER_SETTINGS,

  sourceLanguages: ['Français', 'English'],
  userAgent: DEFAULT_USER_AGENT,

  downloadWifiOnly: false,
  downloadDelayMs: 1000,

  updateCheckHours: 12,
  updateWifiOnly: false,
  notifyNewChapters: true,

  ttsEngine: '',
  ttsVoices: {},
  ttsRate: 1,
  ttsPitch: 1,
  ttsPauseMs: 350,
  ttsAutoNext: true,

  translationEngine: 'mlkit',
  translateAhead: 3,
  bilingualReading: false,

  checkAppUpdates: true,

  autoBackup: 'off',
  autoBackupFolder: '',
  autoBackupChapters: false,
};

export type SettingKey = keyof AppSettings;
