/** Sorting, filtering and searching of the library (pure functions). */
import type { LibraryNovel } from './libraryRepository';

export type LibrarySort =
  'lastRead' | 'dateAdded' | 'title' | 'unread' | 'progress' | 'timeSpent' | 'lastUpdated';

export const LIBRARY_SORTS: LibrarySort[] = [
  'lastRead',
  'dateAdded',
  'title',
  'unread',
  'progress',
  'timeSpent',
  'lastUpdated',
];

export interface LibraryFilters {
  unread: boolean;
  downloaded: boolean;
  completed: boolean;
  inProgress: boolean;
  translated: boolean;
  /** Plugin ids; 'file' stands for imported files. Empty = every source. */
  sources: string[];
  /** Original languages. Empty = every language. */
  languages: string[];
}

export const NO_FILTERS: LibraryFilters = {
  unread: false,
  downloaded: false,
  completed: false,
  inProgress: false,
  translated: false,
  sources: [],
  languages: [],
};

export interface LibraryView {
  tab: 'online' | 'local';
  /** null = every category. */
  categoryId: number | null;
  sort: LibrarySort;
  ascending: boolean;
  filters: LibraryFilters;
  search: string;
}

export function countActiveFilters(filters: LibraryFilters): number {
  return (
    [
      filters.unread,
      filters.downloaded,
      filters.completed,
      filters.inProgress,
      filters.translated,
    ].filter(Boolean).length +
    filters.sources.length +
    filters.languages.length
  );
}

export const sourceKey = (novel: Pick<LibraryNovel, 'origin' | 'pluginId'>): string =>
  novel.origin === 'local' || !novel.pluginId ? 'file' : novel.pluginId;

/** Lower case without accents, for searching and sorting. */
export function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

const unreadCount = (novel: LibraryNovel) => novel.chapterCount - novel.readCount;

function matchesFilters(novel: LibraryNovel, filters: LibraryFilters): boolean {
  const unread = unreadCount(novel);
  if (filters.unread && unread === 0) {
    return false;
  }
  if (filters.downloaded && novel.downloadedCount === 0) {
    return false;
  }
  // Completed: everything read. In progress: started but not finished.
  if (filters.completed && !(novel.chapterCount > 0 && unread === 0)) {
    return false;
  }
  if (filters.inProgress && !(novel.progress > 0 && unread > 0)) {
    return false;
  }
  if (filters.translated && novel.translatedLangs.length === 0) {
    return false;
  }
  if (filters.sources.length > 0 && !filters.sources.includes(sourceKey(novel))) {
    return false;
  }
  if (filters.languages.length > 0 && !filters.languages.includes(novel.originalLang ?? '')) {
    return false;
  }
  return true;
}

const SORTERS: Record<LibrarySort, (a: LibraryNovel, b: LibraryNovel) => number> = {
  lastRead: (a, b) => (a.lastReadAt ?? 0) - (b.lastReadAt ?? 0),
  dateAdded: (a, b) => (a.addedAt ?? a.createdAt) - (b.addedAt ?? b.createdAt),
  title: (a, b) => normalizeText(a.title).localeCompare(normalizeText(b.title)),
  unread: (a, b) => unreadCount(a) - unreadCount(b),
  progress: (a, b) => a.progress - b.progress,
  timeSpent: (a, b) => a.totalReadMs - b.totalReadMs,
  lastUpdated: (a, b) => (a.lastUpdatedAt ?? 0) - (b.lastUpdatedAt ?? 0),
};

export function applyLibraryView(all: LibraryNovel[], view: LibraryView): LibraryNovel[] {
  const search = normalizeText(view.search);
  const sorter = SORTERS[view.sort];
  return all
    .filter((novel) => (view.tab === 'local' ? novel.isLocal : !novel.isLocal))
    .filter((novel) => view.categoryId === null || novel.categoryIds.includes(view.categoryId))
    .filter((novel) => matchesFilters(novel, view.filters))
    .filter(
      (novel) =>
        search === '' ||
        normalizeText(novel.title).includes(search) ||
        normalizeText(novel.author ?? '').includes(search),
    )
    .sort((a, b) => {
      const order = sorter(a, b) * (view.ascending ? 1 : -1);
      // Stable, predictable order for equal values.
      return order !== 0
        ? order
        : normalizeText(a.title).localeCompare(normalizeText(b.title)) || a.id - b.id;
    });
}
