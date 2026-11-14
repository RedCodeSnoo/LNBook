/**
 * Config plugin: copies the reading fonts into the Android assets, where the reader web
 * view loads them from (file:///android_asset/reader-fonts/<name>).
 */
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const google = (pkg, family, target) => [
  [`@expo-google-fonts/${pkg}/400Regular/${family}_400Regular.ttf`, `${target}-Regular.ttf`],
  [
    `@expo-google-fonts/${pkg}/400Regular_Italic/${family}_400Regular_Italic.ttf`,
    `${target}-Italic.ttf`,
  ],
  [`@expo-google-fonts/${pkg}/700Bold/${family}_700Bold.ttf`, `${target}-Bold.ttf`],
];

const FONTS = [
  ...google('literata', 'Literata', 'Literata'),
  ...google('merriweather', 'Merriweather', 'Merriweather'),
  ...google('lora', 'Lora', 'Lora'),
  ...google('atkinson-hyperlegible', 'AtkinsonHyperlegible', 'AtkinsonHyperlegible'),
  [
    '@fontsource/opendyslexic/files/opendyslexic-latin-400-normal.woff2',
    'OpenDyslexic-Regular.woff2',
  ],
  [
    '@fontsource/opendyslexic/files/opendyslexic-latin-400-italic.woff2',
    'OpenDyslexic-Italic.woff2',
  ],
  ['@fontsource/opendyslexic/files/opendyslexic-latin-700-normal.woff2', 'OpenDyslexic-Bold.woff2'],
];

function withReaderFonts(config) {
  return withDangerousMod(config, [
    'android',
    (mod) => {
      const projectRoot = mod.modRequest.projectRoot;
      const target = path.join(
        mod.modRequest.platformProjectRoot,
        'app/src/main/assets/reader-fonts',
      );
      fs.mkdirSync(target, { recursive: true });
      for (const [source, name] of FONTS) {
        const from = path.join(projectRoot, 'node_modules', source);
        if (!fs.existsSync(from)) {
          throw new Error(`withReaderFonts: missing font file ${source}`);
        }
        fs.copyFileSync(from, path.join(target, name));
      }
      return mod;
    },
  ]);
}

module.exports = withReaderFonts;
module.exports.FONTS = FONTS;
