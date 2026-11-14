import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { strFromU8, unzipSync } from 'fflate';

import { createTestDatabase } from '../../db/testing';
import { importParsedBook } from '../../features/library/importBook';
import { epubFileName, exportNovelEpub } from '../../features/novel/exportEpub';
import {
  createManualVolume,
  listChapters,
  updateNovelFields,
} from '../../features/novel/novelRepository';
import { MemoryFileStore } from '../../services/fileStore';
import { buildEpub, toXhtml, type EpubBook } from '../buildEpub';
import { parseEpub } from '../parseEpub';

const IDENTIFIER = '6f1d2c3a-8b1e-4c57-9c55-1a2b3c4d5e6f';

function sample() {
  const output = join(mkdtempSync(join(tmpdir(), 'lnbook-')), 'sample.epub');
  execFileSync('node', [join(__dirname, '../../../scripts/make-sample-epub.js'), output]);
  const { db } = createTestDatabase();
  const files = new MemoryFileStore();
  const novelId = importParsedBook(db, files, parseEpub(new Uint8Array(readFileSync(output))));
  return { db, files, novelId };
}

const book = (overrides: Partial<EpubBook> = {}): EpubBook => ({
  identifier: IDENTIFIER,
  title: 'A & B <test>',
  author: null,
  language: null,
  description: null,
  cover: null,
  volumes: [],
  chapters: [{ title: 'One', volumeIndex: null, html: '<p>Text</p>' }],
  images: new Map(),
  modified: new Date('2026-11-14T10:20:30.456Z'),
  ...overrides,
});

describe('XHTML conversion', () => {
  it('produces well-formed XML from cleaned HTML', () => {
    const images = new Map([['a b.png', new Uint8Array([1])]]);
    const { xhtml, used } = toXhtml(
      '<p>Caf&eacute;&nbsp;&amp; <br>tea<img src="images/a%20b.png"><hr></p>' +
        '<p><img src="https://x.y/remote.jpg" alt="Remote picture"><img src="images/missing.png"></p>' +
        '<p onclick="x()" data-b="3"><a href="javascript:1">j</a><a href="https://x.y/">ok</a></p>',
      images,
    );
    expect(xhtml).toContain('<br/>');
    expect(xhtml).toContain('<hr/>');
    expect(xhtml).toContain('Caf&#xe9;&#xa0;&amp;');
    expect(xhtml).not.toContain('&nbsp;');
    expect(xhtml).toContain('src="../images/a%20b.png" alt=""');
    expect(xhtml).toContain('Remote picture');
    expect(xhtml).not.toContain('remote.jpg');
    expect(xhtml).not.toContain('missing.png');
    expect(xhtml).not.toContain('onclick');
    expect(xhtml).not.toContain('data-b');
    expect(xhtml).not.toContain('javascript');
    expect(xhtml).toContain('<a href="https://x.y/">ok</a>');
    expect([...used]).toEqual(['a b.png']);
  });
});

describe('EPUB writer', () => {
  it('stores the mimetype first and escapes metadata', () => {
    const data = buildEpub(book());
    // Local file header, then the name of the first entry.
    expect(strFromU8(data.subarray(30, 38))).toBe('mimetype');
    const files = unzipSync(data);
    expect(strFromU8(files.mimetype)).toBe('application/epub+zip');
    const opf = strFromU8(files['OEBPS/content.opf']);
    expect(opf).toContain('<dc:title>A &amp; B &lt;test&gt;</dc:title>');
    expect(opf).toContain('<dc:language>und</dc:language>');
    expect(opf).toContain('<meta property="dcterms:modified">2026-11-14T10:20:30Z</meta>');
    expect(strFromU8(files['OEBPS/text/c00001.xhtml'])).toContain('<h1>One</h1>');
  });

  it('can be read back with the same structure', () => {
    const data = buildEpub(
      book({
        title: 'Round trip',
        author: 'Someone',
        language: 'fr',
        description: 'About',
        volumes: ['Tome 1', 'Tome 2'],
        chapters: [
          { title: 'Prologue', volumeIndex: null, html: '<p>Zero</p>' },
          { title: 'Chapitre 1', volumeIndex: 0, html: '<h2>Chapitre 1</h2><p>One</p>' },
          { title: 'Chapitre 2', volumeIndex: 1, html: '<p>Two <img src="images/m.png"/></p>' },
        ],
        images: new Map([
          ['m.png', new Uint8Array([137, 80, 78, 71])],
          ['unused.png', new Uint8Array([1])],
        ]),
        cover: { data: new Uint8Array([137, 80, 78, 71]), extension: 'png' },
      }),
    );
    const parsed = parseEpub(data);
    expect(parsed.title).toBe('Round trip');
    expect(parsed.author).toBe('Someone');
    expect(parsed.language).toBe('fr');
    expect(parsed.description).toBe('About');
    expect(parsed.cover).not.toBeNull();
    expect(parsed.volumes.map((volume) => volume.title)).toEqual(['Tome 1', 'Tome 2']);
    expect(parsed.chapters.map((chapter) => [chapter.title, chapter.volumeIndex])).toEqual([
      ['Prologue', null],
      ['Chapitre 1', 0],
      ['Chapitre 2', 1],
    ]);
    // Only the images used by a chapter are packed.
    expect(Object.keys(unzipSync(data)).filter((name) => name.includes('/images/'))).toEqual([
      'OEBPS/images/m.png',
    ]);
  });
});

describe('export of a novel', () => {
  it('exports the library content, edits included', () => {
    const { db, files, novelId } = sample();
    updateNovelFields(db, novelId, { title: 'Sample Saga: Edited' });
    const chapters = listChapters(db, novelId);
    createManualVolume(db, novelId, 'Extras', [chapters[0].id]);

    const exported = exportNovelEpub(db, files, novelId, { identifier: IDENTIFIER });
    expect(exported?.missing).toBe(0);
    expect(exported?.fileName).toBe('Sample Saga Edited.epub');
    const parsed = parseEpub(exported?.data as Uint8Array);
    expect(parsed.title).toBe('Sample Saga: Edited');
    expect(parsed.chapters).toHaveLength(5);
    expect(parsed.volumes.map((volume) => volume.title)).toEqual([
      'Extras',
      'Volume 1 – Dawn',
      'Volume 2 – Dusk',
    ]);
    expect(parsed.images.size).toBe(1);
    expect(parsed.cover).not.toBeNull();

    // The CI validates this very file with epubcheck.
    if (process.env.EPUB_OUT) {
      writeFileSync(process.env.EPUB_OUT, exported?.data as Uint8Array);
    }
  });

  it('exports a range and reports chapters that are not on the phone', () => {
    const { db, files, novelId } = sample();
    const chapters = listChapters(db, novelId);
    files.delete(chapters[2].filePath as string);
    const exported = exportNovelEpub(db, files, novelId, {
      identifier: IDENTIFIER,
      from: 2,
      to: 4,
    });
    expect(exported?.missing).toBe(1);
    expect(parseEpub(exported?.data as Uint8Array).chapters.map((c) => c.title)).toEqual([
      'Chapter 1: Start',
      'Chapter 3: Night',
    ]);
    expect(exportNovelEpub(db, files, 999, { identifier: IDENTIFIER })).toBeNull();
  });

  it('builds safe file names', () => {
    expect(epubFileName('A/B: C?')).toBe('A B C.epub');
    expect(epubFileName('   ')).toBe('novel.epub');
  });
});
