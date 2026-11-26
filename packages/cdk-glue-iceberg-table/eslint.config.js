/**
 * ESLint flat-config for the cdk-glue-iceberg-table package workspace.
 */

const {
    createConfig,
} = require('../../eslint.config');

/** @type {import('eslint').Linter.FlatConfig[]} */
module.exports = createConfig({
    extraIgnores: [
        'test/packed-consumer/**',
    ],
    project: './tsconfig.dev.json',
});
