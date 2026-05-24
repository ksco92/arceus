/**
 * ESLint flat-config for the Arceus CDK project (ESLint ≥ v9).
 *
 * Layers:
 * 1. Base JS rules + Node globals.
 * 2. TypeScript: parser + rules from @typescript-eslint.
 * 3. Tests: Jest plugin flat preset + combined Node/Jest globals.
 */

const js = require('@eslint/js');
const globalsDB = require('globals');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const jestPlugin = require('eslint-plugin-jest');

/** @type {import('eslint').Linter.FlatConfig[]} */
module.exports = [
    {
        ignores: [
            'node_modules/**',
            'cdk.out/**',
            '.cdk.staging/**',
            '**/*.d.ts',
            '**/*.js',
            'coverage/**',
            'dist/**',
            'build/**',
        ],
    },
    {
        ...js.configs.recommended,
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globalsDB.node,
            },
        },
        rules: {
            'comma-dangle': [
                'error',
                'always-multiline',
            ],
            'indent': [
                'error',
                4,
                {
                    SwitchCase: 1,
                },
            ],
            'array-bracket-newline': [
                'error',
                {
                    minItems: 1,
                },
            ],
            'array-element-newline': [
                'error',
                {
                    minItems: 2,
                },
            ],
            'object-curly-newline': [
                'error',
                {
                    minProperties: 1,
                },
            ],
            'object-property-newline': [
                'error',
                {
                    allowAllPropertiesOnSameLine: false,
                },
            ],
        },
    },

    {
        files: [
            '**/*.ts',
            '**/*.tsx',
        ],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                project: './tsconfig.json',
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
            globals: {
                ...globalsDB.node,
            },
        },
        plugins: {
            '@typescript-eslint': tsPlugin,
        },
        rules: {
            ...tsPlugin.configs.recommended.rules,
            'comma-dangle': [
                'error',
                'always-multiline',
            ],
            'indent': [
                'error',
                4,
                {
                    SwitchCase: 1,
                },
            ],
            'array-bracket-newline': [
                'error',
                {
                    minItems: 1,
                },
            ],
            'array-element-newline': [
                'error',
                {
                    minItems: 2,
                },
            ],
            'object-curly-newline': [
                'error',
                {
                    minProperties: 1,
                },
            ],
            'object-property-newline': [
                'error',
                {
                    allowAllPropertiesOnSameLine: false,
                },
            ],
        },
    },

    {
        files: [
            '**/*.test.ts',
            '**/*.test.tsx',
        ],
        ...jestPlugin.configs['flat/recommended'],
        languageOptions: {
            globals: {
                ...globalsDB.node,
                ...globalsDB.jest,
            },
        },
        rules: {
            'jest/expect-expect': [
                'error',
                {
                    assertFunctionNames: [
                        'expect',
                        'template.*',
                    ],
                },
            ],
        },
    },
];
