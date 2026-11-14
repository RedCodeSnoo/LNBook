// Tests that need the network (real plugins against real sites): `npm run test:live`.
// They run in plain Node, without the React Native preset, to use the real `fetch`.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/*.live.ts'],
  transform: { '\\.[jt]sx?$': ['babel-jest', { presets: ['babel-preset-expo'] }] },
  transformIgnorePatterns: [
    '/node_modules/(?!(htmlparser2|domhandler|domutils|dom-serializer|domelementtype|entities|@noble/ciphers)/)',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/'],
};
