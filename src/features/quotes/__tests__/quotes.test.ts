import type { TFunction } from 'i18next';

import { createTestDatabase } from '../../../db/testing';
import { epub3WithVolumes } from '../../../epub/__tests__/fixtures';
import { parseEpub } from '../../../epub/parseEpub';
import { MemoryFileStore } from '../../../services/fileStore';
import { importParsedBook } from '../../library/importBook';
import { listChapters } from '../../novel/novelRepository';
import { exportQuotes, quoteLocation } from '../quoteFormat';
import {
  countByFolder,
  createFolder,
  createQuote,
  deleteFolder,
  deleteQuote,
  getQuoteFolderIds,
  listChapterQuoteAnchors,
  listFolders,
  listQuotes,
  reorderFolders,
  setQuoteFolders,
  updateFolder,
  updateQuoteNote,
} from '../quotesRepository';

const t = ((key: string, options?: Record<string, unknown>) =>
  key === 'novel.chapterNumber'
    ? `Chapter ${String(options?.number)}`
    : key) as unknown as TFunction;

function setup() {
  const { db } = createTestDatabase();
  const novelId = importParsedBook(db, new MemoryFileStore(), parseEpub(epub3WithVolumes()));
  const list = listChapters(db, novelId);
  const add = (chapter: number, b: number, text: string, folderIds: number[] = [], now = 0) =>
    createQuote(
      db,
      {
        novelId,
        chapterId: list[chapter].id,
        text,
        anchor: { b, o: 3, c: text.slice(0, 30), eb: b, eo: 3 + text.length },
        lang: null,
        folderIds,
      },
      now,
    );
  return { db, novelId, list, add };
}

describe('quote folders', () => {
  it('creates folders in order with different colours', () => {
    const { db } = setup();
    const a = createFolder(db, ' Tragic ');
    const b = createFolder(db, 'Theories');
    expect(a.name).toBe('Tragic');
    expect(a.color).not.toBe(b.color);
    expect(listFolders(db).map((folder) => folder.name)).toEqual(['Tragic', 'Theories']);
    reorderFolders(db, [b.id, a.id]);
    updateFolder(db, a.id, { name: 'Sad', color: '#000000' });
    expect(listFolders(db).map((folder) => `${folder.name}${folder.color}`)).toEqual([
      `Theories${b.color}`,
      'Sad#000000',
    ]);
  });

  it('keeps the quotes of a deleted folder', () => {
    const { db, add } = setup();
    const folder = createFolder(db, 'Tragic');
    const id = add(0, 1, 'A sentence', [folder.id]);
    deleteFolder(db, folder.id);
    expect(listQuotes(db).map((quote) => quote.id)).toEqual([id]);
    expect(listQuotes(db)[0].folders).toEqual([]);
  });
});

describe('quotes', () => {
  it('shows a quote stored in two folders in both of them', () => {
    const { db, add, novelId } = setup();
    const tragic = createFolder(db, 'Tragic');
    const theories = createFolder(db, 'Theories');
    const both = add(1, 2, 'In both folders', [tragic.id, theories.id]);
    const one = add(1, 4, 'Only tragic', [tragic.id]);
    const none = add(2, 0, 'No folder');

    expect(listQuotes(db, { folder: tragic.id }).map((quote) => quote.id)).toEqual([both, one]);
    expect(listQuotes(db, { folder: theories.id }).map((quote) => quote.id)).toEqual([both]);
    expect(listQuotes(db, { folder: 'none' }).map((quote) => quote.id)).toEqual([none]);
    expect(listQuotes(db, { novelId }).map((quote) => quote.id)).toEqual([both, one, none]);

    const counts = countByFolder(listQuotes(db), listFolders(db));
    expect(counts.total).toBe(3);
    expect(counts.none).toBe(1);
    expect(counts.folders.map((entry) => [entry.folder.name, entry.count])).toEqual([
      ['Tragic', 2],
      ['Theories', 1],
    ]);
  });

  it('keeps the exact place of the quote', () => {
    const { db, add, list } = setup();
    add(1, 2, 'Find me again');
    const [quote] = listQuotes(db);
    expect(quote.chapterId).toBe(list[1].id);
    expect(quote.anchor).toEqual({ b: 2, o: 3, c: 'Find me again', eb: 2, eo: 16 });
    expect(listChapterQuoteAnchors(db, list[1].id, null)).toEqual([
      { id: quote.id, a: quote.anchor },
    ]);
    // A quote of the original text is not underlined in a translation.
    expect(listChapterQuoteAnchors(db, list[1].id, 'fr')).toEqual([]);
  });

  it('sorts by place in the book or by date, and searches text and notes', () => {
    const { db, add } = setup();
    const late = add(3, 0, 'Late in the book', [], 100);
    const early = add(0, 5, 'Early in the book', [], 300);
    const earlier = add(0, 1, 'Even earlier', [], 200);
    expect(listQuotes(db).map((quote) => quote.id)).toEqual([earlier, early, late]);
    expect(listQuotes(db, { sort: 'date' }).map((quote) => quote.id)).toEqual([
      early,
      earlier,
      late,
    ]);
    updateQuoteNote(db, late, ' Foreshadowing ');
    expect(listQuotes(db, { search: 'foreshad' }).map((quote) => quote.id)).toEqual([late]);
    expect(listQuotes(db, { search: 'EARL' }).map((quote) => quote.id)).toEqual([earlier, early]);
    expect(listQuotes(db, { search: 'foreshad' })[0].note).toBe('Foreshadowing');
  });

  it('changes folders and deletes', () => {
    const { db, add } = setup();
    const a = createFolder(db, 'A');
    const b = createFolder(db, 'B');
    const id = add(0, 0, 'Text', [a.id]);
    setQuoteFolders(db, id, [b.id, b.id]);
    expect(getQuoteFolderIds(db, id)).toEqual([b.id]);
    deleteQuote(db, id);
    expect(listQuotes(db)).toEqual([]);
  });

  it('describes where the quote comes from and exports', () => {
    const { db, add } = setup();
    const folder = createFolder(db, 'Tragic');
    const id = add(1, 0, 'First line\nSecond line', [folder.id]);
    updateQuoteNote(db, id, 'My note');
    const [quote] = listQuotes(db);
    const location = quoteLocation(quote, t);
    expect(location).toContain(quote.chapterTitle);
    if (quote.volumeTitle) {
      expect(location).toContain(quote.volumeTitle);
    }

    const markdown = exportQuotes([quote], 'md', t);
    expect(markdown).toContain(`# ${quote.novelTitle}`);
    expect(markdown).toContain('> First line\n> Second line');
    expect(markdown).toContain('Tragic');
    expect(markdown).toContain('My note');
    const text = exportQuotes([quote], 'txt', t);
    expect(text).toContain('« First line\nSecond line »');
    expect(text).not.toContain('>');
  });
});
