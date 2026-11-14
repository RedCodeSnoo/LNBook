import { createTestDatabase } from '../../../db/testing';
import { epub3WithVolumes } from '../../../epub/__tests__/fixtures';
import { parseEpub } from '../../../epub/parseEpub';
import { MemoryFileStore } from '../../../services/fileStore';
import { importParsedBook } from '../../library/importBook';
import { getChapter, getNovel, listChapters } from '../../novel/novelRepository';
import { extractBlockTexts } from '../blocks';
import {
  deleteReplacementRule,
  listReplacementRules,
  loadReaderContext,
  markChapterRead,
  readChapterHtml,
  revertEditedChapter,
  saveEditedChapter,
  saveReadingPosition,
  saveReplacementRule,
  searchBook,
} from '../readerRepository';
import {
  DEFAULT_READER_SETTINGS,
  normalizeReaderSettings,
  resolveReaderSettings,
} from '../readerSettings';

function setup() {
  const { db } = createTestDatabase();
  const files = new MemoryFileStore();
  const novelId = importParsedBook(db, files, parseEpub(epub3WithVolumes()));
  return { db, files, novelId, list: listChapters(db, novelId) };
}

describe('reader context', () => {
  it('gives the neighbours of a chapter', () => {
    const { db, list } = setup();
    const middle = loadReaderContext(db, list[2].id);
    expect(middle?.previous?.id).toBe(list[1].id);
    expect(middle?.next?.id).toBe(list[3].id);
    expect(loadReaderContext(db, list[0].id)?.previous).toBeNull();
    expect(loadReaderContext(db, list[4].id)?.next).toBeNull();
    expect(loadReaderContext(db, 9999)).toBeNull();
  });
});

describe('reading position', () => {
  it('saves the position and the last chapter read', () => {
    const { db, novelId, list } = setup();
    const anchor = { b: 3, o: 12, c: 'some text' };
    const result = saveReadingPosition(db, list[1].id, { progress: 0.4, anchor }, 0.95, 500);
    expect(result.becameRead).toBe(false);
    const chapter = getChapter(db, list[1].id);
    expect(chapter).toMatchObject({ progress: 0.4, isRead: false });
    expect(JSON.parse(chapter?.positionAnchor as string)).toEqual(anchor);
    expect(getNovel(db, novelId)).toMatchObject({ lastReadChapterId: list[1].id, lastReadAt: 500 });
  });

  it('marks the chapter read at the threshold and keeps it read when going back', () => {
    const { db, list } = setup();
    expect(
      saveReadingPosition(db, list[1].id, { progress: 0.96, anchor: null }, 0.95, 7).becameRead,
    ).toBe(true);
    expect(getChapter(db, list[1].id)).toMatchObject({ isRead: true, readAt: 7 });
    expect(
      saveReadingPosition(db, list[1].id, { progress: 0.1, anchor: null }, 0.95, 9).becameRead,
    ).toBe(false);
    expect(getChapter(db, list[1].id)).toMatchObject({ isRead: true, readAt: 7, progress: 0.1 });
  });

  it('marks a chapter read when moving to the next one', () => {
    const { db, list } = setup();
    markChapterRead(db, list[0].id, 3);
    markChapterRead(db, list[0].id, 4);
    expect(getChapter(db, list[0].id)).toMatchObject({ isRead: true, readAt: 3 });
  });
});

describe('replacement rules', () => {
  it('lists global rules and the rules of the novel', () => {
    const { db, novelId } = setup();
    const global = saveReplacementRule(db, {
      novelId: null,
      pattern: 'ad',
      replacement: '',
      isRegex: false,
    });
    const own = saveReplacementRule(db, { novelId, pattern: 'x', replacement: 'y', isRegex: true });
    saveReplacementRule(db, {
      novelId: importParsedBook(db, new MemoryFileStore(), parseEpub(epub3WithVolumes())),
      pattern: 'other',
      replacement: '',
      isRegex: false,
    });
    expect(listReplacementRules(db, novelId).map((rule) => rule.id)).toEqual([global, own]);
    expect(listReplacementRules(db, null).map((rule) => rule.id)).toEqual([global]);

    saveReplacementRule(db, {
      id: own,
      novelId,
      pattern: 'z',
      replacement: 'y',
      isRegex: true,
      enabled: false,
    });
    expect(listReplacementRules(db, novelId)[1]).toMatchObject({ pattern: 'z', enabled: false });
    deleteReplacementRule(db, global);
    expect(listReplacementRules(db, novelId).map((rule) => rule.id)).toEqual([own]);
  });
});

describe('chapter edition', () => {
  it('saves an edited chapter and restores the original', () => {
    const { db, files, list } = setup();
    const chapter = list[1];
    const original = readChapterHtml(files, chapter) as string;

    saveEditedChapter(db, files, chapter, 'My title', '<p>Rewritten text.</p>');
    let stored = getChapter(db, chapter.id)!;
    expect(stored).toMatchObject({ title: 'My title', isEdited: true, wordCount: 2 });
    expect(readChapterHtml(files, stored)).toBe('<p>Rewritten text.</p>');

    // A second edit keeps the first original.
    saveEditedChapter(db, files, stored, 'Other title', '<p>Again.</p>');
    stored = getChapter(db, chapter.id)!;

    expect(revertEditedChapter(db, files, stored)).toBe(true);
    stored = getChapter(db, chapter.id)!;
    expect(stored).toMatchObject({
      title: 'Chapter 1: Start',
      isEdited: false,
      originalFilePath: null,
    });
    expect(readChapterHtml(files, stored)).toBe(original);
    expect(revertEditedChapter(db, files, stored)).toBe(false);
  });
});

describe('search in the book', () => {
  it('returns the matches of every chapter with anchors', () => {
    const { db, files, novelId, list } = setup();
    const results = searchBook(db, files, novelId, 'road', []);
    expect(results.map((result) => [result.chapter.id, result.hits.length])).toEqual([
      [list[2].id, 2],
    ]);
    const hit = results[0].hits[0];
    const blocks = extractBlockTexts(readChapterHtml(files, list[2]) as string);
    expect(blocks[hit.anchor.b].substr(hit.anchor.o, 4).toLowerCase()).toBe('road');
    expect(searchBook(db, files, novelId, '  ', [])).toEqual([]);
    expect(searchBook(db, files, novelId, 'zzzz', [])).toEqual([]);
  });

  it('searches the text as displayed, after the replacement rules', () => {
    const { db, files, novelId } = setup();
    const rules = [{ pattern: 'road', replacement: 'path', isRegex: false }];
    expect(searchBook(db, files, novelId, 'road', rules).flatMap((r) => r.hits)).toHaveLength(0);
    expect(searchBook(db, files, novelId, 'path', rules).flatMap((r) => r.hits)).toHaveLength(2);
  });
});

describe('reader settings', () => {
  it('completes stored settings and ignores wrong types', () => {
    const settings = normalizeReaderSettings({
      fontSize: 24,
      mode: 12,
      brightness: 0.5,
      unknown: 1,
    });
    expect(settings).toEqual({ ...DEFAULT_READER_SETTINGS, fontSize: 24, brightness: 0.5 });
    expect(normalizeReaderSettings(null)).toEqual(DEFAULT_READER_SETTINGS);
  });

  it('applies the settings specific to a novel over the global ones', () => {
    const global = { ...DEFAULT_READER_SETTINGS, fontSize: 20 };
    expect(resolveReaderSettings(global, null)).toEqual({ settings: global, perNovel: false });
    const resolved = resolveReaderSettings(
      global,
      JSON.stringify({ fontSize: 30, themeId: 'night' }),
    );
    expect(resolved.perNovel).toBe(true);
    expect(resolved.settings).toMatchObject({ fontSize: 30, themeId: 'night', lineHeight: 1.6 });
    expect(resolveReaderSettings(global, '{broken')).toEqual({ settings: global, perNovel: false });
  });
});
