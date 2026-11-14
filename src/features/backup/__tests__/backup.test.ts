import { eq } from 'drizzle-orm';
import { strToU8, zipSync } from 'fflate';

import type { AppDatabase } from '../../../db/client';
import {
  categories,
  chapters,
  history,
  novelCategories,
  novels,
  plugins,
  quoteFolderItems,
  quoteFolders,
  quotes,
  readingSessions,
  settings,
} from '../../../db/schema';
import { createTestDatabase } from '../../../db/testing';
import { MemoryFileStore } from '../../../services/fileStore';
import {
  BackupError,
  backupFileName,
  backupsToDelete,
  collectBackup,
  isAutoBackupDue,
  packBackup,
  unpackBackup,
} from '../backupFile';
import { importLnReaderBackup, parseLnReaderBackup } from '../lnreaderImport';
import { restoreMerging, restoreReplacing } from '../restore';

const OPTIONS = {
  schemaVersion: 1,
  appVersion: '0.4.0',
  includeChapters: true,
  includeTranslations: true,
  now: 1_000,
};

/** A phone with one imported book (3 chapters), a shelf, a quote in a folder and history. */
function seed(db: AppDatabase, files: MemoryFileStore, title = 'Sample Saga') {
  const novelId = db
    .insert(novels)
    .values({
      origin: 'local',
      title,
      author: 'Ann Author',
      inLibrary: true,
      createdAt: 1,
      updatedAt: 1,
    })
    .returning({ id: novels.id })
    .get().id;
  files.writeText(`novels/${novelId}/cover.jpg`, 'cover');
  db.update(novels)
    .set({ coverPath: `novels/${novelId}/cover.jpg` })
    .where(eq(novels.id, novelId))
    .run();
  const chapterIds: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    const id = db
      .insert(chapters)
      .values({ novelId, position: i, title: `Chapter ${i + 1}`, createdAt: 1 })
      .returning({ id: chapters.id })
      .get().id;
    const path = `novels/${novelId}/chapters/${id}.html`;
    files.writeText(path, `<p>Text ${i + 1}</p>`);
    db.update(chapters)
      .set({ filePath: path, isDownloaded: true })
      .where(eq(chapters.id, id))
      .run();
    chapterIds.push(id);
  }
  db.update(chapters)
    .set({ isRead: true, progress: 1, readAt: 50 })
    .where(eq(chapters.id, chapterIds[0]))
    .run();
  db.update(novels).set({ lastReadChapterId: chapterIds[0] }).where(eq(novels.id, novelId)).run();
  const categoryId = db
    .insert(categories)
    .values({ name: 'Reading', position: 0 })
    .returning({ id: categories.id })
    .get().id;
  db.insert(novelCategories).values({ novelId, categoryId }).run();
  db.insert(readingSessions)
    .values({
      novelId,
      chapterId: chapterIds[0],
      startedAt: 10,
      endedAt: 70_010,
      durationMs: 70_000,
      mode: 'read',
    })
    .run();
  db.insert(history)
    .values({ novelId, chapterId: chapterIds[0], lastReadAt: 70_010, totalMs: 70_000 })
    .run();
  const folderId = db
    .insert(quoteFolders)
    .values({ name: 'Theories', color: '#336699', position: 0 })
    .returning({ id: quoteFolders.id })
    .get().id;
  const quoteId = db
    .insert(quotes)
    .values({ novelId, chapterId: chapterIds[1], text: 'A line', anchor: '{}', createdAt: 5 })
    .returning({ id: quotes.id })
    .get().id;
  db.insert(quoteFolderItems).values({ quoteId, folderId }).run();
  db.insert(settings).values({ key: 'appTheme', value: '"dark"' }).run();
  db.insert(settings).values({ key: 'deeplKey', value: '"secret"' }).run();
  return { novelId, chapterIds };
}

function backupOf(db: AppDatabase, files: MemoryFileStore, options = OPTIONS) {
  return unpackBackup(packBackup(collectBackup(db, files, options)), 1);
}

describe('backup file', () => {
  it('holds the database, the files and a manifest, and never the secrets', () => {
    const { db } = createTestDatabase();
    const files = new MemoryFileStore();
    const { novelId, chapterIds } = seed(db, files);
    const backup = backupOf(db, files);
    expect(backup.manifest).toMatchObject({
      app: 'LNBook',
      schemaVersion: 1,
      appVersion: '0.4.0',
      createdAt: 1_000,
      includesChapters: true,
    });
    expect(backup.tables.novels).toHaveLength(1);
    expect(backup.tables.chapters).toHaveLength(3);
    expect(backup.tables.settings.map((row) => row.key)).toEqual(['appTheme']);
    expect([...backup.files.keys()].sort()).toEqual(
      [
        `novels/${novelId}/cover.jpg`,
        ...chapterIds.map((id) => `novels/${novelId}/chapters/${id}.html`),
      ].sort(),
    );
  });

  it('can leave the chapters out', () => {
    const { db } = createTestDatabase();
    const files = new MemoryFileStore();
    const { novelId } = seed(db, files);
    const backup = backupOf(db, files, { ...OPTIONS, includeChapters: false });
    expect([...backup.files.keys()]).toEqual([`novels/${novelId}/cover.jpg`]);
    expect(backup.manifest.includesChapters).toBe(false);
  });

  it('refuses other files and backups made by a newer app', () => {
    expect(() => unpackBackup(new Uint8Array([1, 2, 3]), 1)).toThrow(BackupError);
    expect(() => unpackBackup(zipSync({ 'a.txt': strToU8('x') }), 1)).toThrow('No manifest');
    const { db } = createTestDatabase();
    const files = new MemoryFileStore();
    seed(db, files);
    const packed = packBackup(collectBackup(db, files, { ...OPTIONS, schemaVersion: 9 }));
    try {
      unpackBackup(packed, 1);
      throw new Error('should have failed');
    } catch (error) {
      expect((error as BackupError).code).toBe('tooRecent');
    }
  });

  it('names the files by date and keeps the five most recent', () => {
    const name = backupFileName(new Date(2026, 10, 14, 9, 30).getTime());
    expect(name).toBe('LNBook-2026-11-14-0930.zip');
    const names = [1, 2, 3, 4, 5, 6, 7].map((day) => `LNBook-2026-11-0${day}-0930.zip`);
    expect(backupsToDelete([...names, 'other.zip', 'notes.txt'])).toEqual([
      'LNBook-2026-11-02-0930.zip',
      'LNBook-2026-11-01-0930.zip',
    ]);
    expect(backupsToDelete(names.slice(0, 5))).toEqual([]);
  });

  it('knows when an automatic backup is due', () => {
    const day = 24 * 60 * 60 * 1000;
    expect(isAutoBackupDue('off', null, 0)).toBe(false);
    expect(isAutoBackupDue('daily', null, 0)).toBe(true);
    expect(isAutoBackupDue('daily', 0, day - 1)).toBe(false);
    expect(isAutoBackupDue('daily', 0, day)).toBe(true);
    expect(isAutoBackupDue('weekly', 0, 6 * day)).toBe(false);
    expect(isAutoBackupDue('weekly', 0, 7 * day)).toBe(true);
  });
});

describe('restore', () => {
  it('replaces everything on another phone', () => {
    const source = createTestDatabase();
    const sourceFiles = new MemoryFileStore();
    const { novelId, chapterIds } = seed(source.db, sourceFiles);
    const backup = backupOf(source.db, sourceFiles);

    const target = createTestDatabase();
    const targetFiles = new MemoryFileStore();
    seed(target.db, targetFiles, 'Other Book');
    targetFiles.writeText('novels/99/chapters/1.html', 'old');

    const summary = restoreReplacing(target.db, targetFiles, backup);
    expect(summary.novelsAdded).toBe(1);
    const restored = target.db.select().from(novels).all();
    expect(restored.map((novel) => novel.title)).toEqual(['Sample Saga']);
    expect(restored[0].lastReadChapterId).toBe(chapterIds[0]);
    expect(targetFiles.exists('novels/99/chapters/1.html')).toBe(false);
    expect(targetFiles.readText(`novels/${novelId}/chapters/${chapterIds[2]}.html`)).toBe(
      '<p>Text 3</p>',
    );
    expect(target.db.select().from(readingSessions).all()).toHaveLength(1);
    expect(target.db.select().from(quoteFolderItems).all()).toHaveLength(1);
    expect(
      target.db
        .select()
        .from(settings)
        .all()
        .find((row) => row.key === 'appTheme')?.value,
    ).toBe('"dark"');
  });

  it('marks chapters as not downloaded when the backup has no chapter files', () => {
    const source = createTestDatabase();
    const sourceFiles = new MemoryFileStore();
    seed(source.db, sourceFiles);
    const backup = backupOf(source.db, sourceFiles, { ...OPTIONS, includeChapters: false });
    const target = createTestDatabase();
    restoreReplacing(target.db, new MemoryFileStore(), backup);
    const restored = target.db.select().from(chapters).all();
    expect(restored).toHaveLength(3);
    expect(restored.every((chapter) => chapter.filePath === null && !chapter.isDownloaded)).toBe(
      true,
    );
    expect(restored[0].isRead).toBe(true);
  });

  it('merges: adds missing novels with their files under new ids', () => {
    const source = createTestDatabase();
    const sourceFiles = new MemoryFileStore();
    seed(source.db, sourceFiles);
    const backup = backupOf(source.db, sourceFiles);

    const target = createTestDatabase();
    const targetFiles = new MemoryFileStore();
    const mine = seed(target.db, targetFiles, 'Other Book');

    const summary = restoreMerging(target.db, targetFiles, backup);
    expect(summary).toMatchObject({ novelsAdded: 1, novelsUpdated: 0 });
    const all = target.db.select().from(novels).all();
    expect(all.map((novel) => novel.title).sort()).toEqual(['Other Book', 'Sample Saga']);
    const added = all.find((novel) => novel.title === 'Sample Saga');
    expect(added).toBeDefined();
    const addedId = added?.id as number;
    expect(addedId).not.toBe(mine.novelId);
    expect(added?.coverPath).toBe(`novels/${addedId}/cover.jpg`);
    expect(targetFiles.readText(`novels/${addedId}/cover.jpg`)).toBe('cover');

    const addedChapters = target.db
      .select()
      .from(chapters)
      .where(eq(chapters.novelId, addedId))
      .all();
    expect(addedChapters).toHaveLength(3);
    for (const chapter of addedChapters) {
      expect(chapter.filePath).toBe(`novels/${addedId}/chapters/${chapter.id}.html`);
      expect(targetFiles.readText(chapter.filePath as string)).toBe(
        `<p>Text ${chapter.position + 1}</p>`,
      );
    }
    expect(added?.lastReadChapterId).toBe(addedChapters[0].id);
    // The files of the book that was already there are untouched.
    expect(targetFiles.readText(`novels/${mine.novelId}/chapters/${mine.chapterIds[0]}.html`)).toBe(
      '<p>Text 1</p>',
    );
    // Shelves and folders with the same name are shared, not duplicated.
    expect(target.db.select().from(categories).all()).toHaveLength(1);
    expect(target.db.select().from(quoteFolders).all()).toHaveLength(1);
    expect(target.db.select().from(novelCategories).all()).toHaveLength(2);
    expect(target.db.select().from(quoteFolderItems).all()).toHaveLength(2);
    expect(target.db.select().from(readingSessions).all()).toHaveLength(2);
    // Settings of the phone win.
    expect(target.db.select().from(settings).all()).toHaveLength(2);
  });

  it('merges: keeps the most advanced progress of a novel present on both sides', () => {
    const source = createTestDatabase();
    const sourceFiles = new MemoryFileStore();
    const theirs = seed(source.db, sourceFiles);
    source.db
      .update(chapters)
      .set({ progress: 0.6, positionAnchor: '{"b":4}' })
      .where(eq(chapters.id, theirs.chapterIds[1]))
      .run();
    const backup = backupOf(source.db, sourceFiles);

    const target = createTestDatabase();
    const targetFiles = new MemoryFileStore();
    const mine = seed(target.db, targetFiles);
    target.db
      .update(chapters)
      .set({ isRead: false, progress: 0.2, readAt: null })
      .where(eq(chapters.id, mine.chapterIds[0]))
      .run();
    target.db
      .update(chapters)
      .set({ isRead: true, progress: 1 })
      .where(eq(chapters.id, mine.chapterIds[2]))
      .run();

    const summary = restoreMerging(target.db, targetFiles, backup);
    expect(summary).toMatchObject({ novelsAdded: 0, novelsUpdated: 1 });
    const rows = target.db.select().from(chapters).all();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ isRead: true, progress: 1 });
    expect(rows[1]).toMatchObject({ progress: 0.6, positionAnchor: '{"b":4}' });
    expect(rows[2]).toMatchObject({ isRead: true, progress: 1 });
    // Reading time is not counted twice.
    expect(target.db.select().from(readingSessions).all()).toHaveLength(1);
  });

  it('merges installed sources with their code', () => {
    const source = createTestDatabase();
    const sourceFiles = new MemoryFileStore();
    source.db
      .insert(plugins)
      .values({
        id: 'demo',
        name: 'Demo',
        lang: 'English',
        version: '1.0.0',
        site: 'https://demo.test',
        codePath: 'plugins/demo/index.js',
      })
      .run();
    sourceFiles.writeText('plugins/demo/index.js', 'code');
    const backup = backupOf(source.db, sourceFiles);
    const target = createTestDatabase();
    const targetFiles = new MemoryFileStore();
    restoreMerging(target.db, targetFiles, backup);
    expect(target.db.select().from(plugins).all()).toHaveLength(1);
    expect(targetFiles.readText('plugins/demo/index.js')).toBe('code');
  });
});

describe('LNReader backup', () => {
  const lnBackup = () =>
    zipSync({
      'Version.json': strToU8(JSON.stringify({ version: '2.0.3' })),
      'Category.json': strToU8(
        JSON.stringify([
          { id: 1, name: 'Default', sort: 0, novelIds: [7] },
          { id: 3, name: 'Favourites', sort: 2, novelIds: [7, 8] },
        ]),
      ),
      'Setting.json': strToU8('{}'),
      'Plugins.json': strToU8(
        JSON.stringify([
          {
            id: 'demo',
            name: 'Demo',
            site: 'https://demo.test',
            lang: 'English',
            version: '1.0.0',
            url: 'https://example.test/demo.js',
            iconUrl: '',
          },
        ]),
      ),
      'NovelAndChapters/7.json': strToU8(
        JSON.stringify({
          id: 7,
          path: '/novel/7',
          pluginId: 'demo',
          name: 'Online Tale',
          cover: 'https://demo.test/cover.jpg',
          author: 'Someone',
          inLibrary: 1,
          isLocal: 0,
          chapters: [
            { id: 1, path: '/c/1', name: 'Chapter 1', unread: 0, position: 0, progress: 100 },
            { id: 2, path: '/c/2', name: 'Chapter 2', unread: 1, position: 1, progress: 40 },
            { id: 3, path: '/c/3', name: 'Chapter 3', unread: 1, position: 2, bookmark: 1 },
          ],
        }),
      ),
      'NovelAndChapters/8.json': strToU8(
        JSON.stringify({ id: 8, path: 'x', pluginId: 'local', name: 'My file', isLocal: 1 }),
      ),
      'Covers/7.png': new Uint8Array([1]),
    });

  it('is recognised, with what cannot be imported listed', () => {
    const backup = parseLnReaderBackup(lnBackup());
    expect(backup.appVersion).toBe('2.0.3');
    expect(backup.novels).toHaveLength(1);
    expect(backup.plugins.map((plugin) => plugin.id)).toEqual(['demo']);
    expect(backup.ignored).toEqual(
      expect.arrayContaining([
        { kind: 'localNovel', name: 'My file' },
        { kind: 'settings' },
        { kind: 'covers' },
      ]),
    );
    expect(() => parseLnReaderBackup(zipSync({ 'a.txt': strToU8('x') }))).toThrow(
      'Not an LNReader backup',
    );
  });

  it('brings the library, the categories, the progress and the sources', () => {
    const { db } = createTestDatabase();
    const summary = importLnReaderBackup(db, parseLnReaderBackup(lnBackup()), new Set(), 500);
    expect(summary).toMatchObject({
      novelsAdded: 1,
      novelsMerged: 0,
      chapters: 3,
      categoriesAdded: 1,
      sources: ['demo'],
    });
    expect(summary.installable.map((plugin) => plugin.id)).toEqual(['demo']);
    const novel = db.select().from(novels).get();
    expect(novel).toMatchObject({
      origin: 'online',
      pluginId: 'demo',
      sourcePath: '/novel/7',
      title: 'Online Tale',
      inLibrary: true,
    });
    const rows = db.select().from(chapters).all();
    expect(rows.map((row) => [row.isRead, row.progress, row.isFavorite])).toEqual([
      [true, 1, false],
      [false, 0.4, false],
      [false, 0, true],
    ]);
    expect(
      db
        .select()
        .from(categories)
        .all()
        .map((row) => row.name),
    ).toEqual(['Favourites']);

    // A second import adds nothing and keeps the progress made since.
    db.update(chapters).set({ isRead: true, progress: 1 }).where(eq(chapters.id, rows[1].id)).run();
    const again = importLnReaderBackup(db, parseLnReaderBackup(lnBackup()), new Set(['demo']));
    expect(again).toMatchObject({ novelsAdded: 0, novelsMerged: 1, chapters: 0, installable: [] });
    expect(db.select().from(chapters).all()[1]).toMatchObject({ isRead: true, progress: 1 });
  });
});
