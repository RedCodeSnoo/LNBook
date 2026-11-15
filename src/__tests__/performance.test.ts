/**
 * A novel of 5,000 chapters must stay fluid: importing it, listing its chapters, opening
 * one and the library stay well under the time a screen can afford.
 */
import { createTestDatabase } from '../db/testing';
import type { ParsedBook } from '../epub/types';
import { importParsedBook } from '../features/library/importBook';
import { listLibraryNovels } from '../features/library/libraryRepository';
import { buildChapterList, NO_CHAPTER_FILTERS } from '../features/novel/chapterList';
import { listChapters, listVolumes } from '../features/novel/novelRepository';
import { loadReaderContext } from '../features/reader/readerRepository';
import { MemoryFileStore } from '../services/fileStore';

const COUNT = 5000;

function bigBook(): ParsedBook {
  return {
    title: 'Endless Road',
    author: 'Long Writer',
    language: 'en',
    description: null,
    cover: null,
    volumes: Array.from({ length: 50 }, (_, index) => ({
      title: `Volume ${index + 1}`,
      origin: 'toc' as const,
    })),
    chapters: Array.from({ length: COUNT }, (_, index) => ({
      title: `Chapter ${index + 1}: A step further`,
      volumeIndex: Math.floor(index / 100),
      html: `<p>Text of chapter ${index + 1}.</p>`,
      wordCount: 4,
    })),
    images: new Map(),
    css: null,
  };
}

const time = (work: () => void) => {
  const start = performance.now();
  work();
  return performance.now() - start;
};

describe('a novel of 5,000 chapters', () => {
  const { db } = createTestDatabase();
  let novelId = 0;

  it('imports in a reasonable time', () => {
    const elapsed = time(() => {
      novelId = importParsedBook(db, new MemoryFileStore(), bigBook());
    });
    expect(listChapters(db, novelId)).toHaveLength(COUNT);
    expect(elapsed).toBeLessThan(10000);
  });

  it('builds the chapter list quickly, with volumes, search and sorting', () => {
    const chapters = listChapters(db, novelId);
    const volumes = listVolumes(db, novelId);
    let rows = 0;
    const elapsed = time(() => {
      rows = buildChapterList(chapters, volumes, {
        ascending: false,
        filters: NO_CHAPTER_FILTERS,
        search: '',
        collapsed: new Set(),
      }).length;
      buildChapterList(chapters, volumes, {
        ascending: true,
        filters: { ...NO_CHAPTER_FILTERS, unread: true },
        search: '4999',
        collapsed: new Set([volumes[0].id]),
      });
    });
    expect(rows).toBe(COUNT + volumes.length);
    expect(elapsed).toBeLessThan(500);
  });

  it('opens a chapter without reading the whole list', () => {
    const chapters = listChapters(db, novelId);
    const target = chapters[2500];
    let found = false;
    const elapsed = time(() => {
      for (let i = 0; i < 20; i += 1) {
        const context = loadReaderContext(db, target.id);
        found =
          context?.previous?.id === chapters[2499].id && context?.next?.id === chapters[2501].id;
      }
    });
    expect(found).toBe(true);
    // Twenty openings: far below the 300 ms allowed for one.
    expect(elapsed).toBeLessThan(300);
  });

  it('lists the library with its counters quickly', () => {
    let count = 0;
    const elapsed = time(() => {
      count = listLibraryNovels(db)[0]?.chapterCount ?? 0;
    });
    expect(count).toBe(COUNT);
    expect(elapsed).toBeLessThan(500);
  });
});
