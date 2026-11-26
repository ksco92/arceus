/**
 * ESLint flat-config for the cdk-glue-iceberg-table package (ESLint ≥ v9).
 *
 * Layers:
 * 1. Base JS rules + Node globals.
 * 2. TypeScript: parser + rules from @typescript-eslint + JSDoc + style/structure rules.
 * 3. Tests: Jest plugin flat preset + combined Node/Jest globals (JSDoc and warning-comment checks relaxed).
 */

const js = require('@eslint/js');
const globalsDB = require('globals');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const jestPlugin = require('eslint-plugin-jest');
const jsdocPlugin = require('eslint-plugin-jsdoc');

const sharedStyleRules = {
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
    'quotes': [
        'error',
        'single',
        {
            avoidEscape: true,
        },
    ],
    'quote-props': [
        'error',
        'as-needed',
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
    'max-depth': [
        'error',
        4,
    ],
    'no-warning-comments': [
        'error',
        {
            terms: [
                'todo',
                'fixme',
                'xxx',
                'hack',
            ],
            location: 'start',
        },
    ],
};

const jsdocRules = {
    'jsdoc/require-jsdoc': [
        'error',
        {
            publicOnly: true,
            require: {
                FunctionDeclaration: true,
                MethodDefinition: true,
                ClassDeclaration: true,
                ArrowFunctionExpression: true,
                FunctionExpression: true,
            },
            contexts: [
                'TSInterfaceDeclaration',
                'TSTypeAliasDeclaration',
                'TSEnumDeclaration',
            ],
            checkConstructors: false,
        },
    ],
    'jsdoc/require-param': [
        'error',
        {
            checkConstructors: false,
            checkSetters: false,
            exemptedBy: [
                'internal',
                'inheritdoc',
            ],
            contexts: [
                'ExportNamedDeclaration > FunctionDeclaration',
                'ExportDefaultDeclaration > FunctionDeclaration',
                'MethodDefinition[accessibility!="private"]',
            ],
        },
    ],
    'jsdoc/require-param-description': 'error',
    'jsdoc/require-returns': [
        'error',
        {
            checkGetters: false,
            exemptedBy: [
                'internal',
                'inheritdoc',
            ],
            contexts: [
                'ExportNamedDeclaration > FunctionDeclaration',
                'ExportDefaultDeclaration > FunctionDeclaration',
                'MethodDefinition[accessibility!="private"]',
            ],
        },
    ],
    'jsdoc/require-returns-description': 'error',
    'jsdoc/no-types': 'error',
    'jsdoc/check-param-names': 'error',
    'jsdoc/check-tag-names': [
        'error',
        {
            definedTags: [
                'default',
                'internal',
                'stability',
                'experimental',
                'remarks',
            ],
        },
    ],
};

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
            'test/packed-consumer/**',
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
            ...sharedStyleRules,
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
                project: './tsconfig.dev.json',
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
            globals: {
                ...globalsDB.node,
            },
        },
        plugins: {
            '@typescript-eslint': tsPlugin,
            jsdoc: jsdocPlugin,
        },
        rules: {
            ...tsPlugin.configs.recommended.rules,
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
            ...sharedStyleRules,
            ...jsdocRules,
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
            ...jestPlugin.configs['flat/recommended'].rules,
            'no-warning-comments': 'off',
            'jsdoc/require-jsdoc': 'off',
            'jsdoc/require-param': 'off',
            'jsdoc/require-returns': 'off',
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
