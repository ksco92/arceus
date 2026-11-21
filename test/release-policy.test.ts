import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    execFileSync,
} from 'child_process';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const policy = require('../.github/scripts/release-policy.js');

const MANIFEST = 'packages/cdk-glue-iceberg-table/package.json';
const LIB_FILE = 'packages/cdk-glue-iceberg-table/lib/iceberg/iceberg-table.ts';

const changelog = (unreleased: string[], ...released: [string, string[]][]): string => [
    '# Changelog',
    '',
    '## Unreleased',
    '',
    ...unreleased,
    ...released.flatMap(([
        version,
        lines,
    ]) => [
        '',
        `## ${version}`,
        '',
        ...lines,
    ]),
    '',
].join('\n');

const manifest = (version: string, extra: object = {}) => ({
    name: 'cdk-glue-iceberg-table',
    version,
    peerDependencies: {
        constructs: '^10.8.1',
    },
    devDependencies: {
        jest: '^30.0.0',
    },
    ...extra,
});

const PATCH = '- (patch) Fix a thing';
const MINOR = '- (minor) Add a thing';
const BREAKING = '- (breaking) Remove a thing';

const change = (opts: {
    files?: object[];
    baseLines?: string[];
    headLines?: string[];
    baseVersion?: string;
    headVersion?: string;
    baseManifest?: object;
    headManifest?: object;
}) => ({
    files: opts.files ?? [],
    base: {
        changelog: changelog(opts.baseLines ?? []),
        manifest: opts.baseManifest ?? manifest(opts.baseVersion ?? '0.22.1'),
    },
    head: {
        changelog: changelog(opts.headLines ?? opts.baseLines ?? []),
        manifest: opts.headManifest ?? manifest(opts.headVersion ?? opts.baseVersion ?? '0.22.1'),
    },
});

const file = (filename: string) => ({
    filename,
});

describe('a pull request that leaves the version alone', () => {
    test('changing no published file needs no line', () => {
        expect(policy.check(change({
            files: [
                file('README.md'),
                file('lib/arceus-stack.ts'),
            ],
        }))).toEqual([]);
    });

    test.each([
        LIB_FILE,
        'packages/cdk-glue-iceberg-table/README.md',
        'packages/cdk-glue-iceberg-table/LICENSE',
    ])('changing %s needs a line', (filename) => {
        expect(policy.check(change({
            files: [
                file(filename),
            ],
        }))).toHaveLength(1);
    });

    test.each([
        PATCH,
        MINOR,
        BREAKING,
    ])('changing a published file with the added line "%s" passes', (line) => {
        expect(policy.check(change({
            files: [
                file(LIB_FILE),
            ],
            headLines: [
                line,
            ],
        }))).toEqual([]);
    });

    test('a line already pending on the base does not count', () => {
        expect(policy.check(change({
            files: [
                file(LIB_FILE),
            ],
            baseLines: [
                PATCH,
            ],
        }))).toHaveLength(1);
    });

    test('a base with no changelog yet takes the first line', () => {
        const input = change({
            files: [
                file(LIB_FILE),
            ],
            headLines: [
                PATCH,
            ],
        });
        input.base.changelog = '';
        expect(policy.check(input)).toEqual([]);
    });

    test('editing only devDependencies in the manifest needs no line', () => {
        expect(policy.check(change({
            files: [
                file(MANIFEST),
            ],
            headManifest: manifest('0.22.1', {
                devDependencies: {
                    jest: '^31.0.0',
                },
            }),
        }))).toEqual([]);
    });

    test('editing peerDependencies in the manifest needs a line', () => {
        expect(policy.check(change({
            files: [
                file(MANIFEST),
            ],
            headManifest: manifest('0.22.1', {
                peerDependencies: {
                    constructs: '^10.9.0',
                },
            }),
        }))).toHaveLength(1);
    });

    test('a published file renamed out of the package counts on the old path', () => {
        expect(policy.check(change({
            files: [
                {
                    filename: 'docs/table.ts',
                    previous_filename: LIB_FILE,
                },
            ],
        }))).toHaveLength(1);
    });

    test('a manifest renamed into place counts even with the same content', () => {
        expect(policy.check(change({
            files: [
                {
                    filename: MANIFEST,
                    previous_filename: 'old/package.json',
                },
            ],
        }))).toHaveLength(1);
    });

    test('a file renamed into the package counts on the new path', () => {
        expect(policy.check(change({
            files: [
                {
                    filename: LIB_FILE,
                    previous_filename: 'docs/table.ts',
                },
            ],
        }))).toHaveLength(1);
    });

    test('a rename between unpublished paths needs no line', () => {
        expect(policy.check(change({
            files: [
                {
                    filename: 'docs/b.md',
                    previous_filename: 'docs/a.md',
                },
            ],
        }))).toEqual([]);
    });

    test.each([
        '- (fix) Fix a thing',
        '- (patch)',
        '(patch) Fix a thing',
        '- Fix a thing',
        'Fix a thing',
    ])('the line "%s" under Unreleased fails even with no published file changed', (line) => {
        expect(policy.check(change({
            headLines: [
                line,
            ],
        }))).toHaveLength(1);
    });

    test('a changelog with no Unreleased heading fails', () => {
        const input = change({});
        input.head.changelog = '# Changelog\n';
        expect(policy.check(input)).toHaveLength(1);
    });
});

describe('a release pull request', () => {
    const release = (opts: {
        pending?: string[];
        version?: string;
        files?: object[];
        headChangelog?: string;
        headManifest?: object;
    }) => {
        const pending = opts.pending ?? [
            PATCH,
        ];
        const version = opts.version ?? '0.22.2';
        const input = change({
            baseLines: pending,
            headVersion: version,
            files: opts.files ?? [
                file(MANIFEST),
                file('CHANGELOG.md'),
            ],
        });
        input.head.changelog = opts.headChangelog ?? changelog([], [
            version,
            pending,
        ]);
        input.head.manifest = opts.headManifest ?? manifest(version);
        return input;
    };

    test('a patch release of patch lines passes', () => {
        expect(policy.check(release({}))).toEqual([]);
    });

    test.each([
        [
            MINOR,
        ],
        [
            BREAKING,
        ],
        [
            PATCH,
            MINOR,
        ],
    ])('a minor release of %s passes', (...pending) => {
        expect(policy.check(release({
            pending,
            version: '0.23.0',
        }))).toEqual([]);
    });

    test('the lockfile and UPGRADING.md may change with it', () => {
        const files = [
            file(MANIFEST),
            file('CHANGELOG.md'),
            file('package-lock.json'),
            file('UPGRADING.md'),
        ];
        expect(policy.check(release({
            files,
        }))).toEqual([]);
    });

    test.each([
        [
            'a patch bump of a minor line',
            [
                MINOR,
            ],
            '0.22.2',
        ],
        [
            'a patch bump of a breaking line',
            [
                BREAKING,
            ],
            '0.22.2',
        ],
        [
            'a minor bump of patch lines',
            [
                PATCH,
            ],
            '0.23.0',
        ],
        [
            'a major bump',
            [
                BREAKING,
            ],
            '1.0.0',
        ],
    ])('%s fails', (_name, pending, version) => {
        expect(policy.check(release({
            pending,
            version,
        }))).toHaveLength(1);
    });

    test.each([
        '0.22.0',
        '0.21.9',
        'next',
        '0.22.2-rc.1',
    ])('the version %s fails', (version) => {
        expect(policy.check(release({
            version,
        }))).not.toEqual([]);
    });

    test('a release with no pending lines fails', () => {
        expect(policy.check(release({
            pending: [],
        }))).not.toEqual([]);
    });

    test.each([
        LIB_FILE,
        'README.md',
        'packages/cdk-glue-iceberg-table/README.md',
    ])('editing %s fails', (filename) => {
        expect(policy.check(release({
            files: [
                file(MANIFEST),
                file('CHANGELOG.md'),
                file(filename),
            ],
        }))).toHaveLength(1);
    });

    test('a file renamed out of the release set fails', () => {
        const files = [
            file(MANIFEST),
            file('CHANGELOG.md'),
            {
                filename: 'docs/x.md',
                previous_filename: 'UPGRADING.md',
            },
        ];
        expect(policy.check(release({
            files,
        }))).toHaveLength(1);
    });

    test.each([
        [
            'peerDependencies',
            {
                peerDependencies: {
                    constructs: '^10.9.0',
                },
            },
        ],
        [
            'devDependencies',
            {
                devDependencies: {
                    jest: '^31.0.0',
                },
            },
        ],
    ])('editing %s in the manifest fails', (_name, extra) => {
        expect(policy.check(release({
            headManifest: manifest('0.22.2', extra),
        }))).toHaveLength(1);
    });

    test.each([
        [
            'pending lines left under Unreleased',
            changelog([
                PATCH,
            ], [
                '0.22.2',
                [
                    PATCH,
                ],
            ]),
        ],
        [
            'no section for the new version',
            changelog([]),
        ],
        [
            'a section for another version',
            changelog([], [
                '0.22.3',
                [
                    PATCH,
                ],
            ]),
        ],
        [
            'a section that is not directly under Unreleased',
            changelog([], [
                '0.22.1',
                [],
            ], [
                '0.22.2',
                [
                    PATCH,
                ],
            ]),
        ],
        [
            'changed lines under the new version',
            changelog([], [
                '0.22.2',
                [
                    '- (patch) Fix another thing',
                ],
            ]),
        ],
        [
            'a dropped line under the new version',
            changelog([], [
                '0.22.2',
                [],
            ]),
        ],
        [
            'no Unreleased heading',
            '# Changelog\n\n## 0.22.2\n\n' + PATCH + '\n',
        ],
    ])('%s fails', (_name, headChangelog) => {
        expect(policy.check(release({
            headChangelog,
        }))).toHaveLength(1);
    });
});

describe('parseChangelog', () => {
    test('keeps the headings in order with their non-blank lines', () => {
        expect(policy.parseChangelog('# Title\n\nintro\n\n## Unreleased\n\n- a\n\n## 1.0.0\n- b\n- c\n')).toEqual([
            {
                heading: 'Unreleased',
                lines: [
                    '- a',
                ],
            },
            {
                heading: '1.0.0',
                lines: [
                    '- b',
                    '- c',
                ],
            },
        ]);
    });
});

describe('readChange', () => {
    let repo: string;
    const git = (...args: string[]) => execFileSync('git', args, {
        cwd: repo,
        encoding: 'utf8',
    });
    const write = (name: string, content: string) => {
        fs.mkdirSync(path.dirname(path.join(repo, name)), {
            recursive: true,
        });
        fs.writeFileSync(path.join(repo, name), content);
    };

    beforeAll(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'release-policy-'));
        git('init', '-q', '-b', 'main');
        git('config', 'user.email', 'a@example.com');
        git('config', 'user.name', 'a');
        write(MANIFEST, JSON.stringify(manifest('0.22.1')));
        write('docs/table.ts', 'export const x = 1;\n'.repeat(20));
        git('add', '.');
        git('commit', '-q', '-m', 'base');
        fs.mkdirSync(path.dirname(path.join(repo, LIB_FILE)), {
            recursive: true,
        });
        git('mv', 'docs/table.ts', LIB_FILE);
        write('CHANGELOG.md', changelog([
            PATCH,
        ]));
        git('add', '.');
        git('commit', '-q', '-m', 'head');
    });

    afterAll(() => {
        fs.rmSync(repo, {
            recursive: true,
            force: true,
        });
    });

    test('reads the files with renames, and a changelog missing on the base as empty', () => {
        const result = policy.readChange('HEAD~1', 'HEAD', repo);
        expect(result.files).toEqual(expect.arrayContaining([
            {
                filename: LIB_FILE,
                previous_filename: 'docs/table.ts',
            },
            {
                filename: 'CHANGELOG.md',
            },
        ]));
        expect(result.base.changelog).toBe('');
        expect(result.head.changelog).toContain(PATCH);
        expect(result.head.manifest.version).toBe('0.22.1');
    });

    test('the pair passes the check', () => {
        expect(policy.check(policy.readChange('HEAD~1', 'HEAD', repo))).toEqual([]);
    });
});
