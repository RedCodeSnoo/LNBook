import { eq } from 'drizzle-orm';

import { novels } from '../../../db/schema';
import { createTestDatabase } from '../../../db/testing';
import { epub2WithNcx, epub3WithVolumes } from '../../../epub/__tests__/fixtures';
import { parseEpub } from '../../../epub/parseEpub';
import { MemoryFileStore } from '../../../services/fileStore';
import { importParsedBook } from '../../library/importBook';
import { buildChapterList, findResumeChapter, NO_CHAPTER_FILTERS } from '../chapterList';
import { chapterNumberFromTitle, formatChapterNumber } from '../chapterNumber';
import {
  applySourceMetadata,
  createManualVolume,
  deleteVolume,
  getNovel,
  listChapters,
  listVolumes,
  markPreviousChaptersRead,
  mergeVolumes,
  moveChaptersToVolume,
  parseEditedFields,
  renameVolume,
  restoreOriginalCover,
  setChaptersRead,
  setCustomCover,
  updateNovelFields,
} from '../novelRepository';

function setup(data = epub3WithVolumes()) {
  const { db } = createTestDatabase();
  const files = new MemoryFileStore();
  const novelId = importParsedBook(db, files, parseEpub(data));
  return { db, files, novelId };
}

const options = (overrides = {}) => ({
  ascending: true,
  filters: NO_CHAPTER_FILTERS,
  search: '',
  collapsed: new Set<number>(),
  ...overrides,
});

describe('chapter numbers', () => {
  it.each([
    ['Chapter 12: The Return', 12],
    ['Chapitre 12,5 – Suite', 12.5],
    ['Ch. 7', 7],
    ['Volume 2 Chapter 30', 30],
    ['第12章 归来', 12],
    ['104 - Title', 104],
    ['Prologue', null],
    ['The 3 kings', null],
  ])('%s → %s', (title, number) => {
    expect(chapterNumberFromTitle(title)).toBe(number);
  });

  it('formats numbers without useless decimals', () => {
    expect(formatChapterNumber(12)).toBe('12');
    expect(formatChapterNumber(12.5)).toBe('12.5');
  });
});

describe('novel edition', () => {
  it('remembers edited fields and protects them from source refreshes', () => {
    const { db, novelId } = setup();
    updateNovelFields(db, novelId, { title: '  My title ', author: '' });
    let novel = getNovel(db, novelId);
    expect(novel?.title).toBe('My title');
    expect(novel?.author).toBeNull();
    expect(parseEditedFields(novel!).sort()).toEqual(['author', 'title']);

    applySourceMetadata(db, novelId, {
      title: 'Source title',
      author: 'Source',
      status: 'Ongoing',
    });
    novel = getNovel(db, novelId);
    expect(novel?.title).toBe('My title');
    expect(novel?.author).toBeNull();
    expect(novel?.status).toBe('Ongoing');
  });

  it('never saves an empty title', () => {
    const { db, novelId } = setup();
    updateNovelFields(db, novelId, { title: '   ' });
    expect(getNovel(db, novelId)?.title).toBe('The Test Chronicle');
  });

  it('sets a custom cover and restores the original one', () => {
    const { db, files, novelId } = setup();
    const original = getNovel(db, novelId)?.coverPath as string;
    const custom = setCustomCover(db, files, novelId, new Uint8Array([1, 2]), 'jpg', 5);
    expect(getNovel(db, novelId)?.coverPath).toBe(custom);
    expect(files.exists(original)).toBe(true);
    const second = setCustomCover(db, files, novelId, new Uint8Array([3]), 'png', 6);
    expect(files.exists(custom)).toBe(false);

    restoreOriginalCover(db, files, novelId);
    const novel = getNovel(db, novelId);
    expect(novel?.coverPath).toBe(original);
    expect(files.exists(second)).toBe(false);
    expect(parseEditedFields(novel!)).not.toContain('cover');
  });

  it('adds a cover to a novel that had none', () => {
    const { db, files, novelId } = setup(epub2WithNcx());
    db.update(novels)
      .set({ coverPath: null, originalCoverPath: null })
      .where(eq(novels.id, novelId))
      .run();
    restoreOriginalCover(db, files, novelId);
    expect(getNovel(db, novelId)?.coverPath).toBeNull();
    const path = setCustomCover(db, files, novelId, new Uint8Array([1]), 'png');
    expect(getNovel(db, novelId)?.coverPath).toBe(path);
  });
});

describe('read state', () => {
  it('marks chapters read, unread and all previous ones', () => {
    const { db, novelId } = setup();
    const list = listChapters(db, novelId);
    markPreviousChaptersRead(db, list[3].id, 99);
    expect(listChapters(db, novelId).map((c) => c.isRead)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
    setChaptersRead(db, [list[0].id], false);
    const first = listChapters(db, novelId)[0];
    expect(first).toMatchObject({ isRead: false, progress: 0, readAt: null });
  });
});

describe('volumes', () => {
  it('creates, renames, merges and deletes volumes', () => {
    const { db, novelId } = setup();
    const list = listChapters(db, novelId);
    const [first, second] = listVolumes(db, novelId);

    const manual = createManualVolume(db, novelId, 'Intro', [list[0].id, list[1].id]);
    expect(listVolumes(db, novelId).map((v) => [v.title, v.origin])).toEqual([
      ['Volume 1 – Dawn', 'toc'],
      ['Volume 2 – Dusk', 'toc'],
      ['Intro', 'manual'],
    ]);
    renameVolume(db, manual, 'Opening');

    // Moving the last chapter of a volume away removes the empty volume.
    moveChaptersToVolume(db, novelId, [list[2].id], manual);
    expect(listVolumes(db, novelId).map((v) => v.title)).toEqual(['Volume 2 – Dusk', 'Opening']);
    expect(listVolumes(db, novelId).some((v) => v.id === first.id)).toBe(false);

    mergeVolumes(db, novelId, [manual, second.id]);
    expect(listVolumes(db, novelId).map((v) => v.title)).toEqual(['Opening']);
    expect(listChapters(db, novelId).every((c) => c.volumeId === manual)).toBe(true);

    deleteVolume(db, manual);
    expect(listVolumes(db, novelId)).toEqual([]);
    expect(listChapters(db, novelId)).toHaveLength(5);
    expect(listChapters(db, novelId).every((c) => c.volumeId === null)).toBe(true);
  });
});

describe('buildChapterList', () => {
  it('groups chapters by volume, keeping loose chapters in place', () => {
    const { db, novelId } = setup();
    const items = buildChapterList(listChapters(db, novelId), listVolumes(db, novelId), options());
    expect(
      items.map((item) => (item.type === 'volume' ? `# ${item.volume.title}` : item.chapter.title)),
    ).toEqual([
      'Prologue',
      '# Volume 1 – Dawn',
      'Chapter 1: Start',
      'Chapter 2: Road',
      '# Volume 2 – Dusk',
      'Chapter 3: Night',
      'Chapter 4: End',
    ]);
  });

  it('sorts descending, collapses volumes, filters and searches', () => {
    const { db, novelId } = setup();
    const volumeList = listVolumes(db, novelId);
    const list = listChapters(db, novelId);
    setChaptersRead(db, [list[1].id], true);
    const fresh = listChapters(db, novelId);
    const titles = (overrides: object) =>
      buildChapterList(fresh, volumeList, options(overrides)).map((item) =>
        item.type === 'volume'
          ? `# ${item.volume.title} ${item.readCount}/${item.chapterCount}`
          : item.chapter.title,
      );

    expect(titles({ ascending: false })).toEqual([
      '# Volume 2 – Dusk 0/2',
      'Chapter 4: End',
      'Chapter 3: Night',
      '# Volume 1 – Dawn 1/2',
      'Chapter 2: Road',
      'Chapter 1: Start',
      'Prologue',
    ]);
    expect(titles({ collapsed: new Set([volumeList[0].id]) })).toEqual([
      'Prologue',
      '# Volume 1 – Dawn 1/2',
      '# Volume 2 – Dusk 0/2',
      'Chapter 3: Night',
      'Chapter 4: End',
    ]);
    expect(titles({ filters: { ...NO_CHAPTER_FILTERS, unread: true } })).not.toContain(
      'Chapter 1: Start',
    );
    expect(titles({ search: 'night' })).toEqual(['# Volume 2 – Dusk 0/2', 'Chapter 3: Night']);
    expect(titles({ search: '4' })).toEqual(['# Volume 2 – Dusk 0/2', 'Chapter 4: End']);
    expect(titles({ filters: { ...NO_CHAPTER_FILTERS, favorite: true } })).toEqual([]);
  });
});

describe('findResumeChapter', () => {
  it('starts at the first chapter of an unread novel', () => {
    const { db, novelId } = setup();
    const list = listChapters(db, novelId);
    expect(findResumeChapter(list, null)).toEqual({ chapter: list[0], started: false });
    expect(findResumeChapter([], null)).toBeNull();
  });

  it('resumes the last chapter read, or the next one when it is finished', () => {
    const { db, novelId } = setup();
    let list = listChapters(db, novelId);
    expect(findResumeChapter(list, list[2].id)).toEqual({ chapter: list[2], started: true });
    setChaptersRead(db, [list[2].id], true);
    list = listChapters(db, novelId);
    expect(findResumeChapter(list, list[2].id)?.chapter.id).toBe(list[3].id);
  });
});
