module.exports = {
    testEnvironment: 'node',

    roots: [
        '<rootDir>/test',
    ],
    testMatch: [
        '**/*.test.ts',
    ],

    transform: {
        '^.+\\.tsx?$': 'ts-jest',
    },

    collectCoverage: true,
    collectCoverageFrom: [
        'lib/**/*.ts',
    ],
    coverageDirectory: 'build/coverage',
    coverageReporters: [
        'html',
        'text-summary',
        'text',
    ],
    coverageThreshold: {
        global: {
            statements: 95,
            branches: 95,
            functions: 95,
            lines: 95,
        },
    },
};
