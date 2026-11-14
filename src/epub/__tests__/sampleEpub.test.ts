import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { parseEpub } from '../parseEpub';

describe('sample EPUB used by the emulator smoke test', () => {
  it('is generated and parsed with its volumes', () => {
    const output = join(mkdtempSync(join(tmpdir(), 'lnbook-')), 'sample.epub');
    execFileSync('node', [join(__dirname, '../../../scripts/make-sample-epub.js'), output]);
    const book = parseEpub(new Uint8Array(readFileSync(output)));

    expect(book.title).toBe('Sample Saga');
    expect(book.author).toBe('Ada Author');
    expect(book.cover).not.toBeNull();
    expect(book.volumes.map((volume) => volume.title)).toEqual([
      'Volume 1 – Dawn',
      'Volume 2 – Dusk',
    ]);
    expect(book.chapters.map((chapter) => [chapter.title, chapter.volumeIndex])).toEqual([
      ['Prologue', null],
      ['Chapter 1: Start', 0],
      ['Chapter 2: Road', 0],
      ['Chapter 3: Night', 1],
      ['Chapter 4: End', 1],
    ]);
    expect(book.images.size).toBe(1);
  });
});
