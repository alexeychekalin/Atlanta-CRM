/* ESLint 9 (flat config). Проверяет серверный и клиентский JS. */
const js = require('@eslint/js');

const nodeGlobals = {
  require: 'readonly',
  module: 'writable',
  exports: 'writable',
  __dirname: 'readonly',
  __filename: 'readonly',
  process: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  fetch: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  AbortController: 'readonly',
};

const baseRules = {
  ...js.configs.recommended.rules,
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
  'no-empty': 'off',
  'no-useless-escape': 'off',
  'no-control-regex': 'off',
};

module.exports = [
  {
    ignores: ['node_modules/**', 'uploads/**', '.pglite/**', 'assets/**', 'coverage/**'],
  },
  {
    files: ['src/**/*.js', 'dev/**/*.js', 'test/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: nodeGlobals,
    },
    rules: baseRules,
  },
];
