import { strToU8 } from 'fflate';

import { parseEpub } from '../parseEpub';
import { BookImportError } from '../types';
import {
  epub2WithNcx,
  epub3WithVolumes,
  epubWithDrm,
  epubWithObfuscatedFont,
  epubWithoutToc,
  PNG_1PX,
} from './fixtures';

function errorCode(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof BookImportError ? error.code : `other: ${String(error)}`;
  }
}

describe('parseEpub – EPUB 3 with volumes', () => {
  const book = parseEpub(epub3WithVolumes());

  it('reads the metadata', () => {
    expect(book.title).toBe('The Test Chronicle');
    expect(book.author).toBe('Jane Writer, John Helper');
    expect(book.language).toBe('en');
    expect(book.description).toBe('A great story.');
  });

  it('reads the cover', () => {
    expect(book.cover?.extension).toBe('png');
    expect(book.cover?.data).toEqual(PNG_1PX);
  });

  it('builds volumes from the hierarchical table of contents', () => {
    expect(book.volumes).toEqual([
      { title: 'Volume 1 – Dawn', origin: 'toc' },
      { title: 'Volume 2 – Dusk', origin: 'toc' },
    ]);
    expect(book.chapters.map((chapter) => [chapter.title, chapter.volumeIndex])).toEqual([
      ['Prologue', null],
      ['Chapter 1: Start', 0],
      ['Chapter 2: Road', 0],
      ['Chapter 3: Night', 1],
      ['Chapter 4: End', 1],
    ]);
  });

  it('appends a spine file that is not in the table of contents to the previous chapter', () => {
    expect(book.chapters[2].html).toBe(
      '<h2>Chapter 2</h2><p>On the road.</p>\n<p>Still on the road.</p>',
    );
  });

  it('cleans the content and extracts the images', () => {
    expect(book.chapters[1].html).toBe(
      '<h2>Chapter 1</h2><p>It <i>began</i>.</p><p><img src="images/map_one.png" alt="Map" /></p>',
    );
    expect([...book.images.keys()]).toEqual(['map_one.png']);
    expect(book.chapters[1].wordCount).toBe(4);
    expect(book.css).toBeNull();
  });

  it('keeps the original formatting when asked', () => {
    const styled = parseEpub(epub3WithVolumes(), { keepFormatting: true });
    expect(styled.chapters[1].html).toContain('<p class="first">');
    expect(styled.css).toBe('p { text-indent: 1em; }');
  });
});

describe('parseEpub – EPUB 2 with NCX', () => {
  const book = parseEpub(epub2WithNcx());

  it('reads metadata and a cover whose file name case differs', () => {
    expect(book.title).toBe('Le Vieux Livre');
    expect(book.author).toBe('Élise Dupont');
    expect(book.language).toBe('fr');
    expect(book.cover?.extension).toBe('jpg');
  });

  it('splits a file holding several chapters at the anchors of the table of contents', () => {
    expect(book.volumes.map((volume) => volume.title)).toEqual(['Tome 1', 'Tome 2']);
    expect(book.chapters.map((chapter) => [chapter.title, chapter.volumeIndex])).toEqual([
      ['Tome 1', 0],
      ['Chapitre 1', 0],
      ['Chapitre 2', 0],
      ['Chapitre 3', 1],
    ]);
    expect(book.chapters[0].html).toBe('<h1>Tome 1</h1><p>Page de titre.</p>');
    expect(book.chapters[1].html).toBe('<h2>Chapitre 1</h2><p>Premier texte.</p>');
    expect(book.chapters[2].html).toBe('<div><h2>Chapitre 2</h2></div><p>Deuxième texte.</p>');
    expect(book.chapters[3].html).toBe('<h2>Chapitre 3</h2><p>Troisième texte.</p>');
  });
});

describe('parseEpub – no table of contents', () => {
  const book = parseEpub(epubWithoutToc());

  it('uses one chapter per file, titled from its heading, and skips empty files', () => {
    expect(book.chapters.map((chapter) => chapter.title)).toEqual([
      'Vol. 1 Chapter 1',
      'Vol. 1 Chapter 2',
      'Vol. 2 Chapter 3',
    ]);
  });

  it('detects volumes in the chapter titles', () => {
    expect(book.volumes).toEqual([
      { title: 'Volume 1', origin: 'detected' },
      { title: 'Volume 2', origin: 'detected' },
    ]);
    expect(book.chapters.map((chapter) => chapter.volumeIndex)).toEqual([0, 0, 1]);
  });

  it('has no author, language or cover', () => {
    expect(book.author).toBeNull();
    expect(book.language).toBeNull();
    expect(book.cover).toBeNull();
  });
});

describe('parseEpub – errors', () => {
  it('reports DRM protected files', () => {
    expect(errorCode(() => parseEpub(epubWithDrm()))).toBe('drm');
  });

  it('accepts obfuscated fonts, which are not DRM', () => {
    expect(parseEpub(epubWithObfuscatedFont()).chapters).toHaveLength(1);
  });

  it('reports files that are not zip archives', () => {
    expect(errorCode(() => parseEpub(strToU8('this is not an epub')))).toBe('corrupted');
  });

  it('reports truncated archives', () => {
    const data = epub3WithVolumes();
    expect(errorCode(() => parseEpub(data.subarray(0, data.length / 2)))).toBe('corrupted');
  });

  it('uses the fallback title', () => {
    const book = parseEpub(epubWithObfuscatedFont(), { fallbackTitle: 'my-file' });
    expect(book.title).toBe('Fonts');
  });
});
