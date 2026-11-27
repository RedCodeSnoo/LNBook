/**
 * Writes a large EPUB 3 for the emulator upgrade test: many chapters and images that do
 * not compress (like the photos of an illustrated book), to build a library of several
 * hundred megabytes from a few files.
 *
 * Usage: node scripts/make-big-epub.js <output.epub> <title> <megabytes of images> <chapters>
 */
const crypto = require('crypto');
const fs = require('fs');
const { strToU8, zipSync } = require('fflate');

const [output, title, megabytes = '60', chapterCount = '120'] = process.argv.slice(2);
if (!output || !title) {
  console.error('Usage: node scripts/make-big-epub.js <output.epub> <title> <MB> <chapters>');
  process.exit(1);
}
const chapters = Number(chapterCount);
const imageCount = Math.max(1, Math.round(Number(megabytes) / 2));
const imageSize = Math.round((Number(megabytes) * 1024 * 1024) / imageCount);
const id = crypto.createHash('sha1').update(title).digest('hex');

const page = (heading, body) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="fr" xml:lang="fr">
<head><meta charset="utf-8"/><title>${heading}</title></head>
<body>${body}</body>
</html>`;

const files = {
  mimetype: [strToU8('application/epub+zip'), { level: 0 }],
  'META-INF/container.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`),
};
const manifest = [];
const spine = [];
const nav = [];
for (let i = 0; i < imageCount; i += 1) {
  // Names with spaces and accents, as found in real books.
  const name = `img/Illustration ${i + 1} (été).jpg`;
  files[`OEBPS/${name}`] = [crypto.randomBytes(imageSize), { level: 0 }];
  manifest.push(`<item id="img${i}" href="${encodeURI(name)}" media-type="image/jpeg"/>`);
}
for (let c = 0; c < chapters; c += 1) {
  const image =
    c < imageCount
      ? `<p><img src="../${encodeURI(`img/Illustration ${c + 1} (été).jpg`)}" alt=""/></p>`
      : '';
  const body = Array.from(
    { length: 30 },
    (_, p) =>
      `<p>${title}, chapitre ${c + 1}, paragraphe ${p + 1} : la lanterne oscillait au-dessus de la route.</p>`,
  ).join('\n');
  files[`OEBPS/text/c${c}.xhtml`] = strToU8(
    page(`Chapitre ${c + 1}`, `<h2>Chapitre ${c + 1}</h2>${image}${body}`),
  );
  manifest.push(`<item id="c${c}" href="text/c${c}.xhtml" media-type="application/xhtml+xml"/>`);
  spine.push(`<itemref idref="c${c}"/>`);
  nav.push(`<li><a href="text/c${c}.xhtml">Chapitre ${c + 1}</a></li>`);
}
files['OEBPS/nav.xhtml'] = strToU8(
  page(
    'Table',
    `<nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><ol>${nav.join('')}</ol></nav>`,
  ),
);
files['OEBPS/content.opf'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="fr">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:sha1:${id}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:creator>Test Upgrade</dc:creator>
    <dc:language>fr</dc:language>
    <meta property="dcterms:modified">2026-11-27T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${manifest.join('\n    ')}
  </manifest>
  <spine>${spine.join('')}</spine>
</package>`);
fs.writeFileSync(output, zipSync(files));
console.log(`Wrote ${output} (${(fs.statSync(output).size / 1024 / 1024).toFixed(1)} MB)`);
