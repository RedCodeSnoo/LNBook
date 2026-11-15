import { eq } from 'drizzle-orm';

import { chapters, novels, volumes } from '../../../db/schema';
import { createTestDatabase } from '../../../db/testing';
import { epub2WithNcx, epub3WithVolumes, epubWithoutToc } from '../../../epub/__tests__/fixtures';
import { parseEpub } from '../../../epub/parseEpub';
import { MemoryFileStore } from '../../../services/fileStore';
import { findDuplicateNovel, importParsedBook } from '../importBook';
import {
  createCategory,
  deleteCategory,
  listCategories,
  listLibraryNovels,
  markNovelsRead,
  removeNovelsFromLibrary,
  renameCategory,
  reorderCategories,
  seedDefaultCategories,
  translateDefaultCategories,
  setNovelCategories,
} from '../libraryRepository';
import { applyLibraryView, NO_FILTERS, type LibraryView } from '../libraryView';

function setup() {
  const { db, sqlite } = createTestDatabase();
  const files = new MemoryFileStore();
  return { db, sqlite, files };
}

const view = (overrides: Partial<LibraryView> = {}): LibraryView => ({
  tab: 'local',
  categoryId: null,
  sort: 'title',
  ascending: true,
  filters: NO_FILTERS,
  search: '',
  ...overrides,
});

describe('importParsedBook', () => {
  it('stores the novel, its volumes, chapters, cover and images', () => {
    const { db, files } = setup();
    const id = importParsedBook(db, files, parseEpub(epub3WithVolumes()), { now: 1000 });

    const novel = db.select().from(novels).where(eq(novels.id, id)).get();
    expect(novel).toMatchObject({
      origin: 'local',
      title: 'The Test Chronicle',
      author: 'Jane Writer, John Helper',
      originalLang: 'en',
      inLibrary: true,
      coverPath: `novels/${id}/cover.png`,
      originalCoverPath: `novels/${id}/cover.png`,
      addedAt: 1000,
    });

    const volumeRows = db.select().from(volumes).where(eq(volumes.novelId, id)).all();
    expect(volumeRows.map((v) => [v.title, v.position, v.origin])).toEqual([
      ['Volume 1 – Dawn', 0, 'toc'],
      ['Volume 2 – Dusk', 1, 'toc'],
    ]);

    const chapterRows = db.select().from(chapters).where(eq(chapters.novelId, id)).all();
    expect(chapterRows.map((c) => [c.position, c.title, c.number, c.volumeId])).toEqual([
      [0, 'Prologue', null, null],
      [1, 'Chapter 1: Start', 1, volumeRows[0].id],
      [2, 'Chapter 2: Road', 2, volumeRows[0].id],
      [3, 'Chapter 3: Night', 3, volumeRows[1].id],
      [4, 'Chapter 4: End', 4, volumeRows[1].id],
    ]);
    for (const chapter of chapterRows) {
      expect(chapter.isDownloaded).toBe(true);
      expect(chapter.filePath).toBe(`novels/${id}/chapters/${chapter.id}.html`);
      expect(files.readText(chapter.filePath as string)).toContain('<p>');
    }
    expect(files.exists(`novels/${id}/images/map_one.png`)).toBe(true);
    expect(files.exists(`novels/${id}/cover.png`)).toBe(true);
  });

  it('imports the three test books with the right chapters and volumes', () => {
    const { db, files } = setup();
    const expected: [Uint8Array, number, number][] = [
      [epub3WithVolumes(), 5, 2],
      [epub2WithNcx(), 4, 2],
      [epubWithoutToc(), 3, 2],
    ];
    for (const [data, chapterCount, volumeCount] of expected) {
      const id = importParsedBook(db, files, parseEpub(data));
      expect(db.select().from(chapters).where(eq(chapters.novelId, id)).all()).toHaveLength(
        chapterCount,
      );
      expect(db.select().from(volumes).where(eq(volumes.novelId, id)).all()).toHaveLength(
        volumeCount,
      );
    }
  });

  it('detects duplicates by title and author, ignoring case', () => {
    const { db, files } = setup();
    const id = importParsedBook(db, files, parseEpub(epub2WithNcx()));
    expect(findDuplicateNovel(db, ' le vieux LIVRE ', 'élise dupont')).toBe(id);
    expect(findDuplicateNovel(db, 'Le Vieux Livre', 'Someone else')).toBeNull();
    expect(findDuplicateNovel(db, 'Other', null)).toBeNull();
  });

  it('replaces the content of an existing novel and keeps its row', () => {
    const { db, files } = setup();
    const id = importParsedBook(db, files, parseEpub(epub3WithVolumes()));
    const category = createCategory(db, 'Shelf');
    setNovelCategories(db, [id], [category.id]);
    const oldFiles = [...files.files.keys()].filter((key) => key.includes('/chapters/'));

    const again = importParsedBook(db, files, parseEpub(epub2WithNcx()), { replaceNovelId: id });

    expect(again).toBe(id);
    expect(db.select().from(novels).all()).toHaveLength(1);
    expect(db.select().from(chapters).all()).toHaveLength(4);
    expect(db.select().from(novels).get()?.title).toBe('Le Vieux Livre');
    expect(listLibraryNovels(db)[0].categoryIds).toEqual([category.id]);
    for (const path of oldFiles) {
      expect(files.files.has(path)).toBe(false);
    }
  });

  it('leaves nothing behind when the import fails', () => {
    const { db, files } = setup();
    const book = parseEpub(epub3WithVolumes());
    const failing = new MemoryFileStore();
    let writes = 0;
    failing.writeText = (path, content) => {
      writes += 1;
      if (writes === 3) {
        throw new Error('disk full');
      }
      MemoryFileStore.prototype.writeText.call(failing, path, content);
    };
    expect(() => importParsedBook(db, failing, book)).toThrow('disk full');
    expect(db.select().from(novels).all()).toEqual([]);
    expect(db.select().from(chapters).all()).toEqual([]);
    expect(failing.files.size).toBe(0);
    expect(files.files.size).toBe(0);
  });
});

describe('library listing and view', () => {
  it('computes the counters of each novel', () => {
    const { db, files } = setup();
    const id = importParsedBook(db, files, parseEpub(epub3WithVolumes()));
    const rows = db.select().from(chapters).where(eq(chapters.novelId, id)).all();
    db.update(chapters).set({ isRead: true, progress: 1 }).where(eq(chapters.id, rows[0].id)).run();
    db.update(chapters).set({ progress: 0.5 }).where(eq(chapters.id, rows[1].id)).run();

    const [novel] = listLibraryNovels(db);
    expect(novel).toMatchObject({
      chapterCount: 5,
      readCount: 1,
      downloadedCount: 5,
      isLocal: true,
      translatedLangs: [],
      categoryIds: [],
    });
    expect(novel.progress).toBeCloseTo(0.3);
  });

  it('separates the Online and Local tabs', () => {
    const { db, files, sqlite } = setup();
    importParsedBook(db, files, parseEpub(epub3WithVolumes()));
    sqlite.exec(`
      INSERT INTO novels (id, origin, plugin_id, title, in_library, created_at, updated_at)
        VALUES (50, 'online', 'src', 'Partial', 1, 1, 1), (51, 'online', 'src', 'Full', 1, 1, 1),
               (52, 'online', 'src', 'Not in library', 0, 1, 1);
      INSERT INTO chapters (novel_id, position, title, is_downloaded) VALUES
        (50, 0, 'a', 1), (50, 1, 'b', 0), (51, 0, 'a', 1), (51, 1, 'b', 1);
    `);
    const all = listLibraryNovels(db);
    expect(applyLibraryView(all, view({ tab: 'local' })).map((n) => n.title)).toEqual([
      'Full',
      'The Test Chronicle',
    ]);
    expect(applyLibraryView(all, view({ tab: 'online' })).map((n) => n.title)).toEqual(['Partial']);
  });

  it('sorts, filters and searches', () => {
    const { db, files } = setup();
    const a = importParsedBook(db, files, parseEpub(epub3WithVolumes()), { now: 1 });
    const b = importParsedBook(db, files, parseEpub(epub2WithNcx()), { now: 2 });
    const c = importParsedBook(db, files, parseEpub(epubWithoutToc()), { now: 3 });
    markNovelsRead(db, [b], true);
    db.update(novels).set({ lastReadAt: 10, totalReadMs: 500 }).where(eq(novels.id, c)).run();
    const all = listLibraryNovels(db);
    const titles = (overrides: Partial<LibraryView>) =>
      applyLibraryView(all, view(overrides)).map((novel) => novel.id);

    expect(titles({ sort: 'title' })).toEqual([c, b, a]);
    expect(titles({ sort: 'dateAdded', ascending: false })).toEqual([c, b, a]);
    expect(titles({ sort: 'lastRead', ascending: false })[0]).toBe(c);
    expect(titles({ sort: 'timeSpent', ascending: false })[0]).toBe(c);
    expect(titles({ sort: 'unread', ascending: false })).toEqual([a, c, b]);
    expect(titles({ sort: 'progress', ascending: false })[0]).toBe(b);

    expect(titles({ filters: { ...NO_FILTERS, unread: true } })).toEqual([c, a]);
    expect(titles({ filters: { ...NO_FILTERS, completed: true } })).toEqual([b]);
    expect(titles({ filters: { ...NO_FILTERS, inProgress: true } })).toEqual([]);
    expect(titles({ filters: { ...NO_FILTERS, languages: ['fr'] } })).toEqual([b]);
    expect(titles({ filters: { ...NO_FILTERS, sources: ['file'] } })).toHaveLength(3);
    expect(titles({ filters: { ...NO_FILTERS, sources: ['plugin'] } })).toEqual([]);
    expect(titles({ filters: { ...NO_FILTERS, translated: true } })).toEqual([]);

    expect(titles({ search: 'VIEUX' })).toEqual([b]);
    expect(titles({ search: 'elise' })).toEqual([b]);
    expect(titles({ search: 'zzz' })).toEqual([]);
  });

  it('filters by category and removes novels', () => {
    const { db, files } = setup();
    const a = importParsedBook(db, files, parseEpub(epub3WithVolumes()));
    const b = importParsedBook(db, files, parseEpub(epub2WithNcx()));
    seedDefaultCategories(db, ['Reading', 'To read', 'Done']);
    seedDefaultCategories(db, ['Ignored']);
    const cats = listCategories(db);
    expect(cats.map((category) => category.name)).toEqual(['Reading', 'To read', 'Done']);

    setNovelCategories(db, [a, b], [cats[0].id]);
    setNovelCategories(db, [b], [cats[0].id, cats[2].id]);
    const all = listLibraryNovels(db);
    expect(applyLibraryView(all, view({ categoryId: cats[0].id }))).toHaveLength(2);
    expect(applyLibraryView(all, view({ categoryId: cats[2].id })).map((n) => n.id)).toEqual([b]);
    expect(applyLibraryView(all, view({ categoryId: cats[1].id }))).toEqual([]);

    renameCategory(db, cats[1].id, ' Later ');
    reorderCategories(db, [cats[2].id, cats[0].id, cats[1].id]);
    expect(listCategories(db).map((category) => category.name)).toEqual([
      'Done',
      'Reading',
      'Later',
    ]);
    deleteCategory(db, cats[2].id);
    expect(listLibraryNovels(db).find((n) => n.id === b)?.categoryIds).toEqual([cats[0].id]);

    removeNovelsFromLibrary(db, files, [a]);
    expect(listLibraryNovels(db).map((n) => n.id)).toEqual([b]);
    expect(files.exists(`novels/${a}`)).toBe(false);
    expect(files.exists(`novels/${b}`)).toBe(true);
    expect(db.select().from(chapters).where(eq(chapters.novelId, a)).all()).toEqual([]);
  });

  it('translates the default categories that kept their name', () => {
    const { db } = createTestDatabase();
    seedDefaultCategories(db, ['Reading', 'To read', 'Finished']);
    const [reading] = listCategories(db);
    renameCategory(db, reading.id, 'My shelf');
    expect(
      translateDefaultCategories(
        db,
        ['Reading', 'To read', 'Finished'],
        ['En cours', 'À lire', 'Terminés'],
      ),
    ).toBe(2);
    expect(listCategories(db).map((category) => category.name)).toEqual([
      'My shelf',
      'À lire',
      'Terminés',
    ]);
  });
});
