module.exports = {
    testEnvironment: 'node',

    roots: [
        '<rootDir>/test',
    ],
    testMatch: [
        '**/*.test.ts',
    ],

    transform: {
        '^.+\\.tsx?$': [
            'ts-jest',
            {
                /// TS151002 fires once per test file when ts-jest is
                /// used with `module: "NodeNext"` and isolatedModules
                /// is off; the warning is informational and unrelated
                /// to test correctness.
                diagnostics: {
                    ignoreCodes: [
                        151002,
                    ],
                },
            },
        ],
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
        /// `lcov` produces `build/coverage/lcov.info` for the
        /// Codecov upload step in `.github/workflows/ci.yml`.
        'lcov',
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
