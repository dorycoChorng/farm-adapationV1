// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'src/map/generated/*'],
  },
  {
    // Runs inside the map WebView; written as ES5 on purpose for older Android WebViews.
    files: ['src/map/web/**/*.js'],
    languageOptions: { globals: { window: 'readonly', document: 'readonly', URL: 'readonly', Blob: 'readonly' } },
    rules: { 'no-var': 'off' },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { Buffer: 'readonly', process: 'readonly', console: 'readonly' } },
  },
]);
