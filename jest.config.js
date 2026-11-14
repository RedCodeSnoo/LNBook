const preset = require('jest-expo/jest-preset');

// ESM-only packages that must be compiled for Jest.
const ESM_PACKAGES = [
  'htmlparser2',
  'domhandler',
  'domutils',
  'dom-serializer',
  'domelementtype',
  'entities',
  '@noble/ciphers',
];

module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: preset.transformIgnorePatterns.map((pattern) =>
    pattern.startsWith('/node_modules/(?!')
      ? pattern.replace('/node_modules/(?!', `/node_modules/(?!(${ESM_PACKAGES.join('|')})/|`)
      : pattern,
  ),
  testMatch: ['**/*.test.[jt]s?(x)'],
  testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/'],
};
