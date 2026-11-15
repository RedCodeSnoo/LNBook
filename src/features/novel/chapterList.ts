/** Builds the rows of the chapter list: volume headers and chapters (pure functions). */
import type { Chapter, Volume } from '../../db/schema';
import { normalizeText } from '../library/libraryView';
import { formatChapterNumber } from './chapterNumber';

export interface ChapterFilters {
  unread: boolean;
  downloaded: boolean;
  favorite: boolean;
}

export const NO_CHAPTER_FILTERS: ChapterFilters = {
  unread: false,
  downloaded: false,
  favorite: false,
};

export interface ChapterListOptions {
  ascending: boolean;
  filters: ChapterFilters;
  search: string;
  /** Ids of the collapsed volumes. */
  collapsed: ReadonlySet<number>;
}

export type ChapterListItem =
  | {
      type: 'volume';
      key: string;
      volume: Volume;
      chapterCount: number;
      readCount: number;
      collapsed: boolean;
    }
  | { type: 'chapter'; key: string; chapter: Chapter };

function matches(chapter: Chapter, filters: ChapterFilters, search: string): boolean {
  if (filters.unread && chapter.isRead) {
    return false;
  }
  if (filters.downloaded && !chapter.isDownloaded) {
    return false;
  }
  if (filters.favorite && !chapter.isFavorite) {
    return false;
  }
  if (search === '') {
    return true;
  }
  if (/^\d+([.,]\d+)?$/.test(search)) {
    const wanted = search.replace(',', '.');
    const number = chapter.number ?? chapter.position + 1;
    if (formatChapterNumber(number) === wanted || formatChapterNumber(number).startsWith(wanted)) {
      return true;
    }
  }
  return normalizeText(chapter.title).includes(search);
}

interface Section {
  volume: Volume | null;
  chapters: Chapter[];
}

/**
 * `chapters` must be sorted by position. Sections follow the order in which volumes
 * first appear; chapters outside volumes stay where they are between volumes.
 */
export function buildChapterList(
  chapters: Chapter[],
  volumes: Volume[],
  options: ChapterListOptions,
): ChapterListItem[] {
  const search = normalizeText(options.search);
  const volumeById = new Map(volumes.map((volume) => [volume.id, volume]));
  const sections: Section[] = [];
  const sectionByVolume = new Map<number, Section>();

  for (const chapter of chapters) {
    const volume = chapter.volumeId !== null ? volumeById.get(chapter.volumeId) : undefined;
    if (volume) {
      let section = sectionByVolume.get(volume.id);
      if (!section) {
        section = { volume, chapters: [] };
        sectionByVolume.set(volume.id, section);
        sections.push(section);
      }
      section.chapters.push(chapter);
    } else {
      const last = sections[sections.length - 1];
      if (last && last.volume === null) {
        last.chapters.push(chapter);
      } else {
        sections.push({ volume: null, chapters: [chapter] });
      }
    }
  }

  const ordered = options.ascending ? sections : [...sections].reverse();
  const items: ChapterListItem[] = [];
  for (const section of ordered) {
    const visible = section.chapters.filter((chapter) => matches(chapter, options.filters, search));
    if (visible.length === 0) {
      continue;
    }
    const collapsed = section.volume !== null && options.collapsed.has(section.volume.id);
    if (section.volume) {
      items.push({
        type: 'volume',
        key: `v${section.volume.id}`,
        volume: section.volume,
        chapterCount: section.chapters.length,
        readCount: section.chapters.filter((chapter) => chapter.isRead).length,
        collapsed,
      });
    }
    if (!collapsed) {
      const list = options.ascending ? visible : [...visible].reverse();
      for (const chapter of list) {
        items.push({ type: 'chapter', key: `c${chapter.id}`, chapter });
      }
    }
  }
  return items;
}

/** The chapter to open with "Continue": the last one read, else the first unread one. */
export function findResumeChapter(
  chapters: Chapter[],
  lastReadChapterId: number | null,
): { chapter: Chapter; started: boolean } | null {
  if (chapters.length === 0) {
    return null;
  }
  const last =
    lastReadChapterId !== null ? chapters.find((c) => c.id === lastReadChapterId) : undefined;
  if (last) {
    if (!last.isRead) {
      return { chapter: last, started: true };
    }
    const next = chapters.find((c) => c.position > last.position && !c.isRead);
    return { chapter: next ?? last, started: true };
  }
  const started = chapters.some((chapter) => chapter.isRead || chapter.progress > 0);
  const firstUnread = chapters.find((chapter) => !chapter.isRead);
  return { chapter: firstUnread ?? chapters[chapters.length - 1], started };
}

export interface ScrollerLabel {
  /** Number of the chapter ("12", "12.5"), null when the row is a volume without chapters. */
  number: string | null;
  /** Volume of the row, when the novel has volumes. */
  volume: string | null;
}

/** Row reached for a position of the fast scroller (0 = top, 1 = bottom). */
export function scrollerIndex(fraction: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  const clamped = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  return Math.round(clamped * (count - 1));
}

/** Bubble shown next to the fast scroller: chapter number and volume of the row. */
export function scrollerLabel(
  items: ChapterListItem[],
  index: number,
  volumes: Volume[],
): ScrollerLabel | null {
  const item = items[index];
  if (!item) {
    return null;
  }
  if (item.type === 'volume') {
    const next = items[index + 1];
    return {
      number:
        next?.type === 'chapter'
          ? formatChapterNumber(next.chapter.number ?? next.chapter.position + 1)
          : null,
      volume: item.volume.title,
    };
  }
  const { chapter } = item;
  const volume =
    chapter.volumeId !== null
      ? (volumes.find((candidate) => candidate.id === chapter.volumeId)?.title ?? null)
      : null;
  return { number: formatChapterNumber(chapter.number ?? chapter.position + 1), volume };
}
