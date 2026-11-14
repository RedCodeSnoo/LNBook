/**
 * Writes an EPUB 3 file: metadata, cover, table of contents with volumes, images and a
 * simple stylesheet. Pure function: book in, bytes out (checked with epubcheck in CI).
 */
import { render } from 'dom-serializer';
import { isTag, type AnyNode } from 'domhandler';
import { removeElement, replaceElement } from 'domutils';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { parseDocument } from 'htmlparser2';

import { escapeHtml, Text } from '../services/html';

export interface EpubChapter {
  title: string;
  /** Index in `volumes`, or null when the chapter is outside any volume. */
  volumeIndex: number | null;
  /** Cleaned chapter HTML; local images use `images/<name>` sources. */
  html: string;
}

export interface EpubBook {
  /** Unique identifier of the publication (a UUID). */
  identifier: string;
  title: string;
  author: string | null;
  /** BCP 47 code; "und" when unknown. */
  language: string | null;
  description: string | null;
  cover: { data: Uint8Array; extension: string } | null;
  volumes: string[];
  chapters: EpubChapter[];
  /** Images referenced by the chapters, keyed by the name used after `images/`. */
  images: Map<string, Uint8Array>;
  modified: Date;
}

const MEDIA_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

const extensionOf = (name: string) => (/\.([A-Za-z0-9]+)$/.exec(name)?.[1] ?? '').toLowerCase();

const STYLESHEET = `body { margin: 5%; line-height: 1.5; }
h1 { font-size: 1.4em; line-height: 1.25; margin: 0 0 1.2em; }
p { margin: 0 0 0.8em; }
img { max-width: 100%; height: auto; }
blockquote { margin: 0.8em 0; padding-left: 1em; border-left: 3px solid #999; }
hr { border: 0; border-top: 1px solid #999; margin: 1.6em 20%; }
`;

const xml = (text: string) => escapeHtml(text).replace(/'/g, '&#39;');

/** Attributes that exist in the cleaned HTML but are not allowed in EPUB content documents. */
const DROPPED_ATTRIBUTES = /^(on|data-)/i;

/**
 * Turns cleaned HTML into well-formed XHTML. Images that are not part of the book
 * (remote addresses of chapters read online) are replaced by their description.
 * Returns the XHTML and the names of the local images it uses.
 */
export function toXhtml(html: string, images: ReadonlyMap<string, Uint8Array>) {
  const document = parseDocument(html, { decodeEntities: true });
  const used = new Set<string>();
  const visit = (node: AnyNode) => {
    if (!isTag(node)) {
      return;
    }
    for (const name of Object.keys(node.attribs)) {
      // XML names only, and nothing scripted.
      if (DROPPED_ATTRIBUTES.test(name) || !/^[A-Za-z_][\w.-]*$/.test(name)) {
        delete node.attribs[name];
      }
    }
    if (node.name === 'img') {
      const match = /^images\/(.+)$/.exec(node.attribs.src ?? '');
      const name = match ? decodeURIComponent(match[1]) : null;
      if (name && images.has(name) && MEDIA_TYPES[extensionOf(name)]) {
        used.add(name);
        node.attribs.src = `../images/${encodeURIComponent(name)}`;
        node.attribs.alt = node.attribs.alt ?? '';
      } else {
        const alt = (node.attribs.alt ?? '').trim();
        if (alt) {
          replaceElement(node, new Text(alt));
        } else {
          removeElement(node);
        }
      }
      return;
    }
    if (node.name === 'a') {
      const href = node.attribs.href ?? '';
      if (!/^https?:\/\//i.test(href)) {
        delete node.attribs.href;
      }
    }
    for (const child of [...node.children]) {
      visit(child);
    }
  };
  for (const child of [...document.children]) {
    visit(child);
  }
  return {
    xhtml: render(document.children, {
      // Non-ASCII characters become numeric references: always valid XML.
      xmlMode: true,
      selfClosingTags: true,
    }),
    used,
  };
}

function startsWithHeading(html: string): boolean {
  return /^\s*(?:<div[^>]*>\s*)*<h[1-3][\s>]/i.test(html);
}

function page(title: string, language: string, body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${language}" xml:lang="${language}">
<head><meta charset="utf-8"/><title>${xml(title)}</title><link rel="stylesheet" type="text/css" href="../style.css"/></head>
<body>
${body}
</body>
</html>`;
}

/** Nested list of the table of contents: volumes hold their chapters. */
function navList(book: EpubBook, fileOf: (index: number) => string): string {
  const lines: string[] = [];
  let openVolume: number | null = null;
  book.chapters.forEach((chapter, index) => {
    const volume =
      chapter.volumeIndex !== null && book.volumes[chapter.volumeIndex] !== undefined
        ? chapter.volumeIndex
        : null;
    if (volume !== openVolume) {
      if (openVolume !== null) {
        lines.push('</ol></li>');
      }
      if (volume !== null) {
        lines.push(`<li><a href="${fileOf(index)}">${xml(book.volumes[volume])}</a><ol>`);
      }
      openVolume = volume;
    }
    lines.push(`<li><a href="${fileOf(index)}">${xml(chapter.title)}</a></li>`);
  });
  if (openVolume !== null) {
    lines.push('</ol></li>');
  }
  return lines.join('\n');
}

export function buildEpub(book: EpubBook): Uint8Array {
  const language = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(book.language ?? '')
    ? (book.language as string)
    : 'und';
  const chapterFile = (index: number) => `text/c${String(index + 1).padStart(5, '0')}.xhtml`;
  const usedImages = new Set<string>();

  const files: Zippable = {
    // The mimetype entry must come first and be stored without compression.
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`),
    'OEBPS/style.css': strToU8(STYLESHEET),
  };

  book.chapters.forEach((chapter, index) => {
    const { xhtml, used } = toXhtml(chapter.html, book.images);
    used.forEach((name) => usedImages.add(name));
    const heading = startsWithHeading(chapter.html) ? '' : `<h1>${xml(chapter.title)}</h1>\n`;
    files[`OEBPS/${chapterFile(index)}`] = strToU8(page(chapter.title, language, heading + xhtml));
  });

  const manifest: string[] = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
  ];
  const coverType = book.cover ? MEDIA_TYPES[book.cover.extension.toLowerCase()] : undefined;
  if (book.cover && coverType) {
    const name = `cover.${book.cover.extension.toLowerCase()}`;
    files[`OEBPS/${name}`] = [book.cover.data, { level: 0 }];
    manifest.push(
      `<item id="cover-image" href="${name}" media-type="${coverType}" properties="cover-image"/>`,
    );
  }
  [...usedImages].sort().forEach((name, index) => {
    files[`OEBPS/images/${name}`] = [book.images.get(name) as Uint8Array, { level: 0 }];
    manifest.push(
      `<item id="img${index + 1}" href="images/${encodeURIComponent(name)}" media-type="${MEDIA_TYPES[extensionOf(name)]}"/>`,
    );
  });
  book.chapters.forEach((_chapter, index) => {
    manifest.push(
      `<item id="c${index + 1}" href="${chapterFile(index)}" media-type="application/xhtml+xml"/>`,
    );
  });

  const modified = book.modified.toISOString().replace(/\.\d+Z$/, 'Z');
  files['OEBPS/content.opf'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${language}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:${xml(book.identifier)}</dc:identifier>
    <dc:title>${xml(book.title || 'Untitled')}</dc:title>
    <dc:language>${language}</dc:language>${book.author ? `\n    <dc:creator>${xml(book.author)}</dc:creator>` : ''}${
      book.description ? `\n    <dc:description>${xml(book.description)}</dc:description>` : ''
    }
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    ${manifest.join('\n    ')}
  </manifest>
  <spine>
    ${book.chapters.map((_chapter, index) => `<itemref idref="c${index + 1}"/>`).join('\n    ')}
  </spine>
</package>`);

  files['OEBPS/nav.xhtml'] = strToU8(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${language}" xml:lang="${language}">
<head><meta charset="utf-8"/><title>${xml(book.title || 'Untitled')}</title></head>
<body>
<nav epub:type="toc"><h1>${xml(book.title || 'Untitled')}</h1><ol>
${navList(book, chapterFile)}
</ol></nav>
</body>
</html>`);

  return zipSync(files);
}
