import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    // Generated files and private tooling are not lint targets.
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.wrangler/**',
      '**/.ai/**',
      '**/worker-configuration.d.ts'
    ]
  },
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      // The codebase deliberately uses non-null assertions for lazy-init
      // state (Durable Object loadState/ensureSchema patterns and length
      // checks immediately above the access). strict's blanket ban is a
      // style decision this repo has not adopted.
      '@typescript-eslint/no-non-null-assertion': 'off'
    }
  },
  {
    // Browser dashboard: plain JS modules served as-is.
    files: ['pages/dashboard/**/*.js'],
    languageOptions: { globals: globals.browser }
  },
  {
    // Node maintenance scripts.
    files: ['scripts/**/*.js', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node }
  },
  {
    // Tests stub external surfaces aggressively; `any` and empty mock
    // classes are acceptable there.
    files: ['**/*.test.ts', '**/__tests__/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-extraneous-class': 'off'
    }
  }
);
