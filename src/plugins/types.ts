/**
 * Contract of LNReader source plugins (https://github.com/LNReader/lnreader-plugins, MIT).
 * The plugins are used unmodified: these types mirror what the LNReader app expects.
 */

export enum NovelStatus {
  Unknown = 'Unknown',
  Ongoing = 'Ongoing',
  Completed = 'Completed',
  Licensed = 'Licensed',
  PublishingFinished = 'Publishing Finished',
  Cancelled = 'Cancelled',
  OnHiatus = 'On Hiatus',
  STUB = 'STUB',
  Inactive = 'Inactive',
}

export enum FilterTypes {
  TextInput = 'Text',
  Picker = 'Picker',
  CheckboxGroup = 'Checkbox',
  Switch = 'Switch',
  ExcludableCheckboxGroup = 'XCheckbox',
}

export interface FilterOption {
  label: string;
  value: string;
}

export type PluginFilter =
  | { label: string; type: FilterTypes.TextInput; value: string }
  | { label: string; type: FilterTypes.Picker; value: string; options: FilterOption[] }
  | { label: string; type: FilterTypes.CheckboxGroup; value: string[]; options: FilterOption[] }
  | { label: string; type: FilterTypes.Switch; value: boolean }
  | {
      label: string;
      type: FilterTypes.ExcludableCheckboxGroup;
      value: { include?: string[]; exclude?: string[] };
      options: FilterOption[];
    };

export type PluginFilters = Record<string, PluginFilter>;
export type FilterValue = PluginFilter['value'];
/** What `popularNovels` receives: the type and the chosen value of each filter. */
export type FilterValues = Record<string, { type: FilterTypes; value: FilterValue }>;

export type PluginSetting =
  | { label: string; value: string; type?: 'Text' }
  | { label: string; value: boolean; type: 'Switch' }
  | { label: string; value: string; type: 'Select'; options: FilterOption[] }
  | { label: string; value: string[]; type: 'CheckboxGroup'; options: FilterOption[] };

export interface NovelItem {
  name: string;
  path: string;
  cover?: string;
}

export interface ChapterItem {
  name: string;
  path: string;
  chapterNumber?: number;
  releaseTime?: string | null;
  page?: string;
}

export interface SourceNovel extends NovelItem {
  genres?: string;
  summary?: string;
  author?: string;
  artist?: string;
  status?: string;
  chapters?: ChapterItem[];
  totalPages?: number;
}

/** One line of a plugin repository manifest (plugins.json). */
export interface PluginItem {
  id: string;
  name: string;
  site: string;
  lang: string;
  version: string;
  /** URL of the compiled JavaScript. */
  url: string;
  iconUrl: string;
  customJS?: string;
  customCSS?: string;
  hasSettings?: boolean;
}

export interface SourcePlugin {
  id: string;
  name: string;
  site: string;
  version: string;
  icon?: string;
  imageRequestInit?: { method?: string; headers?: Record<string, string>; body?: string };
  filters?: PluginFilters;
  pluginSettings?: Record<string, PluginSetting>;
  webStorageUtilized?: boolean;
  popularNovels(
    page: number,
    options: { showLatestNovels?: boolean; filters?: FilterValues },
  ): Promise<NovelItem[]>;
  searchNovels(term: string, page: number): Promise<NovelItem[]>;
  parseNovel(path: string): Promise<SourceNovel>;
  parsePage?(path: string, page: string): Promise<{ chapters: ChapterItem[] }>;
  parseChapter(path: string): Promise<string>;
  resolveUrl?(path: string, isNovel?: boolean): string;
}
