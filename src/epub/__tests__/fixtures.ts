/** Builds small EPUB files in memory for the tests. */
import { strToU8, zipSync } from 'fflate';

export const PNG_1PX = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

const CONTAINER = (opf: string) => `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="${opf}" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

const page = (title: string, body: string) => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title>
<link rel="stylesheet" href="../style.css"/></head><body>${body}</body></html>`;

function zip(files: Record<string, string | Uint8Array>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) {
    entries[name] = typeof content === 'string' ? strToU8(content) : content;
  }
  return zipSync(entries);
}

/** EPUB 3: nav document with two volumes, a prologue outside volumes, cover and an image. */
export function epub3WithVolumes(): Uint8Array {
  return zip({
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': CONTAINER('OEBPS/content.opf'),
    'OEBPS/content.opf': `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">urn:uuid:1</dc:identifier>
    <dc:title>The Test Chronicle</dc:title>
    <dc:creator>Jane Writer</dc:creator>
    <dc:creator>John Helper</dc:creator>
    <dc:language>en-US</dc:language>
    <dc:description>&lt;p&gt;A &lt;b&gt;great&lt;/b&gt; story.&lt;/p&gt;</dc:description>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover" href="img/cover.png" media-type="image/png" properties="cover-image"/>
    <item id="map" href="img/map%20one.png" media-type="image/png"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="pro" href="text/prologue.xhtml" media-type="application/xhtml+xml"/>
    <item id="c1" href="text/c1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/c2.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2b" href="text/c2b.xhtml" media-type="application/xhtml+xml"/>
    <item id="c3" href="text/c3.xhtml" media-type="application/xhtml+xml"/>
    <item id="c4" href="text/c4.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="pro"/><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c2b"/>
    <itemref idref="c3"/><itemref idref="c4"/>
  </spine>
</package>`,
    'OEBPS/nav.xhtml': page(
      'Contents',
      `<nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><h1>Contents</h1><ol>
        <li><a href="text/prologue.xhtml">Prologue</a></li>
        <li><span>Volume 1 – Dawn</span><ol>
          <li><a href="text/c1.xhtml">Chapter 1: Start</a></li>
          <li><a href="text/c2.xhtml">Chapter 2: Road</a></li>
        </ol></li>
        <li><a href="text/c3.xhtml">Volume 2 – Dusk</a><ol>
          <li><a href="text/c3.xhtml">Chapter 3: Night</a></li>
          <li><a href="text/c4.xhtml">Chapter 4: End</a></li>
        </ol></li>
      </ol></nav>`,
    ),
    'OEBPS/style.css': 'p { text-indent: 1em; }',
    'OEBPS/img/cover.png': PNG_1PX,
    'OEBPS/img/map one.png': PNG_1PX,
    'OEBPS/text/prologue.xhtml': page('Prologue', '<h1>Prologue</h1><p>Before everything.</p>'),
    'OEBPS/text/c1.xhtml': page(
      'c1',
      '<h2>Chapter 1</h2><p class="first">It <i>began</i>.</p><p><img src="../img/map%20one.png" alt="Map"/></p><script>bad()</script>',
    ),
    'OEBPS/text/c2.xhtml': page('c2', '<h2>Chapter 2</h2><p>On the road.</p>'),
    'OEBPS/text/c2b.xhtml': page('c2b', '<p>Still on the road.</p>'),
    'OEBPS/text/c3.xhtml': page('c3', '<h2>Chapter 3</h2><p>Night falls.</p>'),
    'OEBPS/text/c4.xhtml': page('c4', '<h2>Chapter 4</h2><p>The end.</p>'),
  });
}

/** EPUB 2: NCX table of contents with nested volumes, cover declared with <meta name="cover">. */
export function epub2WithNcx(): Uint8Array {
  return zip({
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': CONTAINER('content.opf'),
    'content.opf': `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>Le Vieux Livre</dc:title>
    <dc:creator opf:role="aut">Élise Dupont</dc:creator>
    <dc:language>fr</dc:language>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="cover-image" href="Cover.JPG" media-type="image/jpeg"/>
    <item id="p1" href="part1.html" media-type="application/xhtml+xml"/>
    <item id="p2" href="part2.html" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="p1"/><itemref idref="p2"/></spine>
</package>`,
    'toc.ncx': `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="v1" playOrder="1"><navLabel><text>Tome 1</text></navLabel><content src="part1.html"/>
      <navPoint id="a" playOrder="2"><navLabel><text>Chapitre 1</text></navLabel><content src="part1.html#ch1"/></navPoint>
      <navPoint id="b" playOrder="3"><navLabel><text>Chapitre 2</text></navLabel><content src="part1.html#ch2"/></navPoint>
    </navPoint>
    <navPoint id="v2" playOrder="4"><navLabel><text>Tome 2</text></navLabel><content src="part2.html"/>
      <navPoint id="c" playOrder="5"><navLabel><text>Chapitre 3</text></navLabel><content src="part2.html#ch3"/></navPoint>
    </navPoint>
  </navMap>
</ncx>`,
    'cover.jpg': PNG_1PX,
    'part1.html': page(
      'Tome 1',
      `<div class="wrapper"><h1>Tome 1</h1><p>Page de titre.</p>
       <h2 id="ch1">Chapitre 1</h2><p>Premier texte.</p>
       <div><a id="ch2"></a><h2>Chapitre 2</h2></div><p>Deuxième texte.</p></div>`,
    ),
    'part2.html': page('Tome 2', '<h2 id="ch3">Chapitre 3</h2><p>Troisième texte.</p>'),
  });
}

/** EPUB without table of contents: volumes are detected from the page headings. */
export function epubWithoutToc(): Uint8Array {
  const chapters = ['Vol. 1 Chapter 1', 'Vol. 1 Chapter 2', 'Vol. 2 Chapter 3'];
  const files: Record<string, string | Uint8Array> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': CONTAINER('book.opf'),
    'book.opf': `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Flat Book</dc:title></metadata>
  <manifest>${chapters
    .map((_, i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`)
    .join('')}<item id="empty" href="empty.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine>${chapters.map((_, i) => `<itemref idref="c${i}"/>`).join('')}<itemref idref="empty"/></spine>
</package>`,
    'empty.xhtml': page('Empty', '<p> </p>'),
  };
  chapters.forEach((title, i) => {
    files[`c${i}.xhtml`] = page(`file ${i}`, `<h1>${title}</h1><p>Text ${i}.</p>`);
  });
  return zip(files);
}

export function epubWithDrm(): Uint8Array {
  return zip({
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': CONTAINER('book.opf'),
    'META-INF/encryption.xml': `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#">
    <EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/>
    <CipherData><CipherReference URI="c0.xhtml"/></CipherData>
  </EncryptedData></encryption>`,
    'book.opf': '<package/>',
  });
}

export function epubWithObfuscatedFont(): Uint8Array {
  return zip({
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': CONTAINER('book.opf'),
    'META-INF/encryption.xml': `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <enc:EncryptedData xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
    <enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/>
    <enc:CipherData><enc:CipherReference URI="font.otf"/></enc:CipherData>
  </enc:EncryptedData></encryption>`,
    'book.opf': `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Fonts</dc:title></metadata>
  <manifest><item id="c" href="c.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="c"/></spine>
</package>`,
    'c.xhtml': page('c', '<p>Readable.</p>'),
  });
}
