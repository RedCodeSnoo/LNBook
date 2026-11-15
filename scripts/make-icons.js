/**
 * Renders the app icon, the adaptive icon layers and the splash image from the SVG
 * drawings in assets/src.
 *
 * Usage: npm install --no-save sharp && node scripts/make-icons.js
 */
const path = require('path');
const sharp = require('sharp');

const assets = path.join(__dirname, '..', 'assets');
const targets = [
  ['icon.svg', 'icon.png', 1024],
  ['android-icon-background.svg', 'android-icon-background.png', 1024],
  ['android-icon-foreground.svg', 'android-icon-foreground.png', 1024],
  ['android-icon-monochrome.svg', 'android-icon-monochrome.png', 1024],
  ['splash-icon.svg', 'splash-icon.png', 1024],
  ['icon.svg', 'favicon.png', 48],
];

Promise.all(
  targets.map(([source, output, size]) =>
    sharp(path.join(assets, 'src', source), { density: 144 })
      .resize(size, size)
      .png()
      .toFile(path.join(assets, output)),
  ),
).then(() => console.log(`${targets.length} images written`));
