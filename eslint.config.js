const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier');

module.exports = defineConfig([
  expoConfig,
  prettierConfig,
  {
    ignores: ['android/*', 'ios/*', 'dist/*', '.expo/*', 'coverage/*', 'node_modules/*'],
  },
  {
    rules: {
      // i18next is used through its default export on purpose.
      'import/no-named-as-default-member': 'off',
    },
  },
  {
    files: ['**/__tests__/**', '**/*.test.*'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        jest: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        afterAll: 'readonly',
        afterEach: 'readonly',
      },
    },
  },
]);
