import { strToU8, zipSync } from 'fflate';

import { createTestDatabase } from '../../../db/testing';
import { saveSourceNovel } from '../../browse/sourceNovels';
import { listCategories, listLibraryNovels } from '../../library/libraryRepository';
import { listChapters } from '../../novel/novelRepository';
import {
  importLnReaderBackup,
  NotLnReaderBackupError,
  parseLnReaderBackup,
} from '../lnreaderImport';

const json = (value: unknown) => strToU8(JSON.stringify(value));

/** Files of an LNReader backup (format 2), as written by its `prepareBackupData`. */
const backupFiles = () => ({
  'Version.json': json({ appVersion: '2.1.0', formatVersion: 2, sections: {} }),
  'NovelAndChapters/3.json': json({
    id: 3,
    path: '/novel/hero',
    pluginId: 'novelfrance',
    name: 'The Hero',
    cover: 'https://site.test/hero.jpg',
    summary: 'A summary',
    author: 'An author',
    status: 'Ongoing',
    genres: 'Action,Drama',
    inLibrary: 1,
    isLocal: 0,
    chapters: [
      { path: '/c/2', name: 'Chapter 2', position: 1, unread: 1, progress: 40, bookmark: 1 },
      {
        path: '/c/1',
        name: 'Chapter 1',
        position: 0,
        unread: 0,
        progress: 100,
        readTime: '2026-11-01 10:00:00',
        chapterNumber: 1,
      },
      { path: '/c/3', name: 'Chapter 3', position: 2, unread: 1, progress: null },
    ],
  }),
  'NovelAndChapters/5.json': json({
    id: 5,
    path: 'file.epub',
    pluginId: 'local',
    name: 'Imported file',
    isLocal: 1,
    inLibrary: 1,
    chapters: [],
  }),
  'NovelAndChapters/6.json': strToU8('{broken'),
  'Category.json': json([
    { id: 1, name: 'Default', sort: 0, novelIds: [3] },
    { id: 4, name: 'Reading', sort: 2, novelIds: [3, 5, 99] },
    { id: 5, name: 'Empty', sort: 3, novelIds: [] },
  ]),
  'Setting.json': json({ APP_THEME: 'dark' }),
  'Plugins.json': json([
    { id: 'novelfrance', name: 'NovelFrance', url: 'https://repo.test/nf.js', version: '1.0.2' },
    { id: 'unused', name: 'Unused', url: 'https://repo.test/unused.js', version: '1.0.0' },
  ]),
  'Covers/3': new Uint8Array([1, 2, 3]),
  'download.zip': new Uint8Array([80, 75]),
  'notes.txt': strToU8('hello'),
});

describe('LNReader backup', () => {
  it('reads novels, categories and sources, listing what is skipped', () => {
    const backup = parseLnReaderBackup(zipSync(backupFiles()));
    expect(backup.appVersion).toBe('2.1.0');
    expect(backup.novels.map((novel) => novel.name)).toEqual(['The Hero']);
    expect(backup.plugins.map((plugin) => plugin.id)).toEqual(['novelfrance', 'unused']);
    expect(backup.ignored).toEqual(
      expect.arrayContaining([
        { kind: 'localNovel', name: 'Imported file' },
        { kind: 'invalidNovel', name: '6.json' },
        { kind: 'settings' },
        { kind: 'downloads' },
        { kind: 'covers' },
        { kind: 'unknownFile', name: 'notes.txt' },
      ]),
    );
  });

  it('accepts a folder prefix and the older nested archive', () => {
    const prefixed = Object.fromEntries(
      Object.entries(backupFiles()).map(([name, data]) => [`BackupData/${name}`, data]),
    );
    expect(parseLnReaderBackup(zipSync(prefixed)).novels).toHaveLength(1);
    const legacy = zipSync({
      'data.zip': zipSync(backupFiles()),
      'download.zip': new Uint8Array(),
    });
    expect(parseLnReaderBackup(legacy).novels).toHaveLength(1);
  });

  it('refuses other files', () => {
    expect(() => parseLnReaderBackup(new Uint8Array([1, 2, 3]))).toThrow(NotLnReaderBackupError);
    expect(() => parseLnReaderBackup(zipSync({ 'readme.txt': strToU8('x') }))).toThrow(
      NotLnReaderBackupError,
    );
  });

  it('imports the library with its progress and categories', () => {
    const { db } = createTestDatabase();
    const summary = importLnReaderBackup(
      db,
      parseLnReaderBackup(zipSync(backupFiles())),
      new Set(),
      5000,
    );
    expect(summary).toMatchObject({
      novelsAdded: 1,
      novelsMerged: 0,
      chapters: 3,
      categoriesAdded: 1,
      sources: ['novelfrance'],
    });
    expect(summary.installable.map((plugin) => plugin.id)).toEqual(['novelfrance']);

    const [novel] = listLibraryNovels(db);
    expect(novel).toMatchObject({
      title: 'The Hero',
      origin: 'online',
      pluginId: 'novelfrance',
      sourcePath: '/novel/hero',
      author: 'An author',
      coverPath: 'https://site.test/hero.jpg',
    });
    expect(
      listChapters(db, novel.id).map((chapter) => [
        chapter.title,
        chapter.isRead,
        chapter.progress,
        chapter.isFavorite,
      ]),
    ).toEqual([
      ['Chapter 1', true, 1, false],
      ['Chapter 2', false, 0.4, true],
      ['Chapter 3', false, 0, false],
    ]);
    expect(listChapters(db, novel.id)[0].readAt).toBe(Date.parse('2026-11-01T10:00:00Z'));
    // "Default" is LNReader's own shelf; "Empty" has no novel.
    expect(listCategories(db).map((category) => category.name)).toEqual(['Reading']);
    expect(novel.categoryIds).toHaveLength(1);
  });

  it('completes a novel already on the phone without duplicating it', () => {
    const { db } = createTestDatabase();
    saveSourceNovel(db, { id: 'novelfrance' }, '/novel/hero', {
      novel: { name: 'The Hero (mine)', path: '/novel/hero' },
      chapters: [
        { name: 'Chapter 1', path: '/c/1' },
        { name: 'Chapter 2', path: '/c/2' },
      ],
    });
    const summary = importLnReaderBackup(
      db,
      parseLnReaderBackup(zipSync(backupFiles())),
      new Set(['novelfrance']),
    );
    expect(summary).toMatchObject({ novelsAdded: 0, novelsMerged: 1, chapters: 1 });
    expect(summary.installable).toEqual([]);
    const [novel] = listLibraryNovels(db);
    expect(novel.title).toBe('The Hero (mine)');
    const chapters = listChapters(db, novel.id);
    expect(chapters).toHaveLength(3);
    expect(chapters[0].isRead).toBe(true);
    expect(chapters[1].progress).toBe(0.4);
  });
});
