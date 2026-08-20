import reactPlugin from 'eslint-plugin-react';
import importPlugin from 'eslint-plugin-import';
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y';
import hooksPlugin from 'eslint-plugin-react-hooks';
import prettierPlugin from 'eslint-plugin-prettier';
import typescriptParser from '@typescript-eslint/parser';
import typescriptPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
  },
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parser: typescriptParser,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    plugins: {
      react: reactPlugin,
      import: importPlugin,
      prettier: prettierPlugin,
      'jsx-a11y': jsxA11yPlugin,
      'react-hooks': hooksPlugin,
      '@typescript-eslint': typescriptPlugin,
    },
    rules: {
      ...hooksPlugin.configs.recommended.rules,
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'no-console': 'warn',
      'react/prop-types': 'off',
      'prettier/prettier': 'warn',
      'react/react-in-jsx-scope': 'off',
      'react/jsx-no-target-blank': 'off',
      'react/require-default-props': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'jsx-a11y/label-has-associated-control': 'off',
      'react/function-component-definition': 'off',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
      },
    },
  },
];
