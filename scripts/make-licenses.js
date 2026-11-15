/**
 * Writes the list of the open source packages the app is built with (name, version,
 * licence), shown in More → About → Open source licences.
 *
 * Usage: node scripts/make-licenses.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const { dependencies } = require(path.join(root, 'package.json'));

const packages = Object.keys(dependencies)
  .sort((a, b) => a.localeCompare(b))
  .map((name) => {
    const manifest = require(path.join(root, 'node_modules', name, 'package.json'));
    const licence =
      typeof manifest.license === 'string'
        ? manifest.license
        : (manifest.license?.type ?? manifest.licenses?.[0]?.type ?? 'See the package');
    return { name, version: manifest.version, license: licence };
  });

fs.writeFileSync(
  path.join(root, 'src/features/more/licenses.json'),
  `${JSON.stringify(packages, null, 2)}\n`,
);
console.log(`${packages.length} packages`);
