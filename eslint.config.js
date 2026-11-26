/**
 * ESLint flat-config for the Arceus CDK monorepo (ESLint >= v9).
 *
 * Layers:
 * 1. Base JS recommended rules + style/structure rules + Node globals.
 * 2. TypeScript: parser + eslint-recommended/ts-recommended + JSDoc rules.
 * 3. Tests: Jest plugin flat preset + Jest globals (JSDoc and warning-comment checks relaxed).
 */

const js = require('@eslint/js');
const globalsDB = require('globals');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const jestPlugin = require('eslint-plugin-jest');
const jsdocPlugin = require('eslint-plugin-jsdoc');

const publicCallableContexts = [
    'ExportNamedDeclaration > FunctionDeclaration',
    'ExportDefaultDeclaration > FunctionDeclaration',
    'ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > ArrowFunctionExpression',
    'ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > FunctionExpression',
    'ExportDefaultDeclaration > ArrowFunctionExpression',
    'ExportDefaultDeclaration > FunctionExpression',
    'MethodDefinition[accessibility!="private"]',
];

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
            contexts: publicCallableContexts,
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
            contexts: publicCallableContexts,
        },
    ],
    'jsdoc/require-returns-description': 'error',
    'jsdoc/no-types': 'error',
    'jsdoc/check-param-names': 'error',
    'jsdoc/check-tag-names': 'error',
};

/**
 * Build the shared ESLint flat-config array for a workspace in this repo.
 *
 * @param options Workspace-specific ignore patterns and tsconfig path.
 * @returns ESLint flat-config array.
 */
function createConfig(options) {
    return [
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
                ...options.extraIgnores,
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
                ...js.configs.recommended.rules,
                'comma-dangle': [
                    'error',
                    'always-multiline',
                ],
                indent: [
                    'error',
                    4,
                    {
                        SwitchCase: 1,
                    },
                ],
                quotes: [
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
                    project: options.project,
                    ecmaVersion: 'latest',
                    sourceType: 'module',
                },
            },
            plugins: {
                '@typescript-eslint': tsPlugin,
                jsdoc: jsdocPlugin,
            },
            rules: {
                ...tsPlugin.configs['flat/eslint-recommended'].rules,
                ...tsPlugin.configs.recommended.rules,
                '@typescript-eslint/no-unused-vars': [
                    'error',
                    {
                        argsIgnorePattern: '^_',
                        varsIgnorePattern: '^_',
                        caughtErrorsIgnorePattern: '^_',
                    },
                ],
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
}

/** @type {import('eslint').Linter.FlatConfig[]} */
const rootConfig = createConfig({
    extraIgnores: [
        // The package workspace has its own eslint config + tsconfig
        // and is linted by `npm run lint --workspace cdk-glue-iceberg-table`.
        'packages/**',
    ],
    project: './tsconfig.json',
});
rootConfig.createConfig = createConfig;

module.exports = rootConfig;
