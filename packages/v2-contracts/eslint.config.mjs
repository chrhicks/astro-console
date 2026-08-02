import js from '@eslint/js'
import tseslint from 'typescript-eslint'

const local = {
  rules: {
    'no-import-aliases': {
      create(context) {
        return {
          ImportSpecifier(node) {
            if (node.imported.name !== node.local.name) {
              context.report({
                node,
                message: 'Import aliases are not allowed.',
              })
            }
          },
        }
      },
    },
  },
}

const importRules = {
  'local/no-import-aliases': 'error',
  'no-restricted-syntax': [
    'error',
    {
      selector: 'ImportNamespaceSpecifier',
      message: 'Namespace imports are not allowed.',
    },
  ],
}

export default tseslint.config(
  {
    ignores: ['dist/', 'node_modules/'],
  },
  {
    files: ['**/*.mjs'],
    ...js.configs.recommended,
    plugins: { local },
    rules: importRules,
  },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { local },
    rules: {
      ...importRules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unsafe-type-assertion': 'error',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [
            { from: 'package', package: 'node:test', name: 'test' },
            { from: 'package', package: 'node:test', name: 'it' },
            { from: 'package', package: 'node:test', name: 'describe' },
          ],
        },
      ],
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'off',
      'prefer-const': 'error',
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...importRules['no-restricted-syntax'].slice(1),
        {
          selector: "BinaryExpression[left.property.name='_tag']",
          message:
            'Use Effect tagged-union matching rather than _tag comparisons.',
        },
        {
          selector: "BinaryExpression[right.property.name='_tag']",
          message:
            'Use Effect tagged-union matching rather than _tag comparisons.',
        },
        {
          selector: "SwitchStatement[discriminant.property.name='_tag']",
          message:
            'Use Effect tagged-union matching rather than _tag switch dispatch.',
        },
      ],
    },
  },
)
