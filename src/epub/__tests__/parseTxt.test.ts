import { strToU8 } from 'fflate';

import { decodeText, detectEncoding, isValidUtf8 } from '../encoding';
import { isChapterHeading, previewTxt, splitTxtChapters, txtToBook } from '../parseTxt';

describe('text encoding', () => {
  it('detects UTF-8, with or without byte order mark', () => {
    const bytes = strToU8('Héloïse — “œuvre”');
    expect(isValidUtf8(bytes)).toBe(true);
    expect(detectEncoding(bytes)).toBe('utf-8');
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]), 'utf-8')).toBe(
      'Héloïse — “œuvre”',
    );
  });

  it('detects and decodes Windows-1252', () => {
    // "Été – “cœur” €" in Windows-1252
    const bytes = new Uint8Array([
      0xc9, 0x74, 0xe9, 0x20, 0x96, 0x20, 0x93, 0x63, 0x9c, 0x75, 0x72, 0x94, 0x20, 0x80,
    ]);
    expect(detectEncoding(bytes)).toBe('windows-1252');
    expect(decodeText(bytes, 'windows-1252')).toBe('Été – “cœur” €');
  });
});

describe('chapter headings', () => {
  it.each([
    'Chapitre 12',
    'Chapter 12: The Return',
    'CHAPITRE XII',
    '  chapitre 3 – Le départ',
    'Chapter 1.5',
    'Volume 2 Chapter 5',
    'Prologue',
    'Épilogue',
    '第十二章 归来',
  ])('recognises "%s"', (line) => {
    expect(isChapterHeading(line)).toBe(true);
  });

  it.each([
    'He opened chapter 12 of the book.',
    'Chapters are long.',
    'Le chapitre suivant était vide.',
    'Chapter',
    '',
  ])('ignores "%s"', (line) => {
    expect(isChapterHeading(line)).toBe(false);
  });
});

describe('splitTxtChapters', () => {
  it('splits on headings and keeps the text before the first heading', () => {
    const text = 'Intro line\n\nChapitre 1\nA\nB\n\nChapitre 2 : Suite\nC\n***\nD\n';
    expect(splitTxtChapters(text, 'My book')).toEqual([
      { title: 'My book', text: 'Intro line' },
      { title: 'Chapitre 1', text: 'A\nB' },
      { title: 'Chapitre 2 : Suite', text: 'C\nD' },
    ]);
  });

  it('splits on separator lines when there is no heading', () => {
    expect(splitTxtChapters('A\n* * *\nB\r\n---\r\nC', 'T')).toEqual([
      { title: '1', text: 'A' },
      { title: '2', text: 'B' },
      { title: '3', text: 'C' },
    ]);
  });

  it('keeps a text without structure as one chapter', () => {
    expect(splitTxtChapters('Just\ntext', 'Title')).toEqual([
      { title: 'Title', text: 'Just\ntext' },
    ]);
  });
});

describe('txtToBook', () => {
  it('builds chapters as paragraphs and detects volumes', () => {
    const data = strToU8('Tome 1 Chapitre 1\nUn <deux>\n\nTome 2 Chapitre 2\nTrois quatre cinq');
    const book = txtToBook(previewTxt(data, 'file'), 'Mon livre');
    expect(book.title).toBe('Mon livre');
    expect(book.chapters).toEqual([
      { title: 'Tome 1 Chapitre 1', volumeIndex: 0, html: '<p>Un &lt;deux&gt;</p>', wordCount: 2 },
      {
        title: 'Tome 2 Chapitre 2',
        volumeIndex: 1,
        html: '<p>Trois quatre cinq</p>',
        wordCount: 3,
      },
    ]);
    expect(book.volumes.map((volume) => volume.title)).toEqual(['Tome 1', 'Tome 2']);
  });

  it('labels untitled chapters', () => {
    const book = txtToBook(previewTxt(strToU8('A\n***\nB'), 'f'), 'T', (n) => `Chapitre ${n}`);
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(['Chapitre 1', 'Chapitre 2']);
  });

  it('rejects an empty file', () => {
    expect(() => txtToBook(previewTxt(strToU8('  \n\n'), 'f'), 'T')).toThrow(/empty/);
  });
});
