/**
 * Writes a small EPUB 3 used by the emulator smoke test (and later by epubcheck):
 * two volumes, a prologue, a cover and an image.
 *
 * Usage: node scripts/make-sample-epub.js <output.epub>
 */
const fs = require('fs');
const { strToU8, zipSync } = require('fflate');

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const page = (title, body) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head><meta charset="utf-8"/><title>${title}</title></head>
<body>${body}</body>
</html>`;

const paragraphs = (seed, count) =>
  Array.from(
    { length: count },
    (_, i) =>
      `<p>${seed} paragraph ${i + 1}. The lantern swung above the quiet road while the travellers ` +
      `counted the last miles to the city, each one lost in a different thought.</p>`,
  ).join('\n');

const chapters = [
  { id: 'prologue', title: 'Prologue', volume: null },
  { id: 'c1', title: 'Chapter 1: Start', volume: 0 },
  { id: 'c2', title: 'Chapter 2: Road', volume: 0 },
  { id: 'c3', title: 'Chapter 3: Night', volume: 1 },
  { id: 'c4', title: 'Chapter 4: End', volume: 1 },
];
const volumes = ['Volume 1 – Dawn', 'Volume 2 – Dusk'];

const navItems = [
  `<li><a href="text/prologue.xhtml">Prologue</a></li>`,
  ...volumes.map((volume, index) => {
    const inside = chapters.filter((chapter) => chapter.volume === index);
    return `<li><a href="text/${inside[0].id}.xhtml">${volume}</a><ol>${inside
      .map((chapter) => `<li><a href="text/${chapter.id}.xhtml">${chapter.title}</a></li>`)
      .join('')}</ol></li>`;
  }),
].join('\n');

const files = {
  // The mimetype entry must come first and be stored without compression.
  mimetype: [strToU8('application/epub+zip'), { level: 0 }],
  'META-INF/container.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`),
  'OEBPS/content.opf': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:6f1d2c3a-8b1e-4c57-9c55-1a2b3c4d5e6f</dc:identifier>
    <dc:title>Sample Saga</dc:title>
    <dc:creator>Ada Author</dc:creator>
    <dc:language>en</dc:language>
    <dc:description>A short book used to test the app.</dc:description>
    <meta property="dcterms:modified">2026-11-14T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover" href="img/cover.png" media-type="image/png" properties="cover-image"/>
    <item id="map" href="img/map.png" media-type="image/png"/>
${chapters
  .map(
    (chapter) =>
      `    <item id="${chapter.id}" href="text/${chapter.id}.xhtml" media-type="application/xhtml+xml"/>`,
  )
  .join('\n')}
  </manifest>
  <spine>
${chapters.map((chapter) => `    <itemref idref="${chapter.id}"/>`).join('\n')}
  </spine>
</package>`),
  'OEBPS/nav.xhtml': strToU8(
    page('Contents', `<nav epub:type="toc"><h1>Contents</h1><ol>\n${navItems}\n</ol></nav>`),
  ),
  'OEBPS/img/cover.png': PNG_1PX,
  'OEBPS/img/map.png': PNG_1PX,
};

for (const chapter of chapters) {
  const image = chapter.id === 'c1' ? '<p><img src="../img/map.png" alt="Map"/></p>\n' : '';
  files[`OEBPS/text/${chapter.id}.xhtml`] = strToU8(
    page(chapter.title, `<h2>${chapter.title}</h2>\n${image}${paragraphs(chapter.title, 40)}`),
  );
}

const output = process.argv[2];
if (!output) {
  console.error('Usage: node scripts/make-sample-epub.js <output.epub>');
  process.exit(1);
}
fs.writeFileSync(output, zipSync(files));
console.log(`Wrote ${output}`);
