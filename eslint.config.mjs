import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

const frameworkImports = [
  {
    group: [
      'socket.io',
      'socket.io/*',
      'express',
      'express/*',
      'http',
      'https',
      'node:http',
      'node:https',
    ],
    message: 'Domain und Application bleiben frei von Framework- und Netzwerk-Imports (NFA-08).',
  },
];

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      'no-console': 'off',
    },
  },
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...frameworkImports,
            {
              group: ['**/adapters', '**/adapters/**', '**/application', '**/application/**'],
              message: 'Domain darf weder Adapter noch Application importieren.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...frameworkImports,
            {
              group: ['**/adapters', '**/adapters/**'],
              message: 'Application darf keine Adapter importieren.',
            },
          ],
        },
      ],
    },
  },
);
