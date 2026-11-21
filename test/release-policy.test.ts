import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    execFileSync, spawnSync,
} from 'child_process';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const policy = require('../.github/scripts/release-policy.js');

const SCRIPT = path.join(__dirname, '..', '.github', 'scripts', 'release-policy.js');
const PACKAGE = 'packages/cdk-glue-iceberg-table';
const MANIFEST = `${PACKAGE}/package.json`;
const LIB_FILE = `${PACKAGE}/lib/iceberg/iceberg-table.ts`;
const PACKAGE_README = `${PACKAGE}/README.md`;

const PATCH = '- (patch) Fix a thing';
const MINOR = '- (minor) Add a thing';
const BREAKING = '- (breaking) Remove a thing';

const md = (...blocks: string[]) => [
    '# Changelog',
    ...blocks,
    '',
].join('\n\n');

const changelog = (...lines: string[]) => md('## Unreleased', ...lines);

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

const lock = (version: string, extra: object = {}) => ({
    packages: {
        '': {
            name: 'arceus',
        },
        [PACKAGE]: {
            version,
        },
        ...extra,
    },
});

const DEV_EDIT = {
    devDependencies: {
        jest: '^31.0.0',
    },
};
const PEER_EDIT = {
    peerDependencies: {
        constructs: '^10.9.0',
    },
};
const DEPENDENCY_SWAP = {
    'node_modules/x': {
        version: '2.0.0',
    },
};

const files = (...names: string[]) => names.map((filename) => ({
    filename,
}));

const renamed = (filename: string, previous: string) => ({
    filename,
    previous_filename: previous,
});

const change = (opts: {
    files?: object[];
    baseLines?: string[];
    headLines?: string[];
    baseVersion?: string;
    headVersion?: string;
    headManifest?: object;
}) => ({
    files: opts.files ?? [],
    base: {
        changelog: changelog(...opts.baseLines ?? []),
        manifest: manifest(opts.baseVersion ?? '0.22.1'),
        lock: lock(opts.baseVersion ?? '0.22.1'),
    },
    head: {
        changelog: changelog(...opts.headLines ?? opts.baseLines ?? []),
        manifest: opts.headManifest ?? manifest(opts.headVersion ?? opts.baseVersion ?? '0.22.1'),
        lock: lock(opts.headVersion ?? opts.baseVersion ?? '0.22.1'),
    },
});

describe('a pull request that leaves the version alone', () => {
    const touching = (...names: string[]) => change({
        files: files(...names),
    });
    const renaming = (filename: string, previous: string) => change({
        files: [
            renamed(filename, previous),
        ],
    });
    const editingManifest = (extra: object) => change({
        files: files(MANIFEST),
        headManifest: manifest('0.22.1', extra),
    });
    const withLine = (line: string, ...names: string[]) => change({
        files: files(...names),
        headLines: [
            line,
        ],
    });
    const lineOnBase = change({
        files: files(LIB_FILE),
        baseLines: [
            PATCH,
        ],
    });

    test.each`
        name                                       | input                                                    | problems
        ${'no published file'}                     | ${touching('README.md', 'lib/arceus-stack.ts')}          | ${0}
        ${'a lib file'}                            | ${touching(LIB_FILE)}                                    | ${1}
        ${'the package README'}                    | ${touching(PACKAGE_README)}                              | ${1}
        ${'the package LICENSE'}                   | ${touching(`${PACKAGE}/LICENSE`)}                        | ${1}
        ${'only devDependencies in the manifest'}  | ${editingManifest(DEV_EDIT)}                             | ${0}
        ${'peerDependencies in the manifest'}      | ${editingManifest(PEER_EDIT)}                            | ${1}
        ${'a published file renamed out'}          | ${renaming('docs/table.ts', LIB_FILE)}                   | ${1}
        ${'a file renamed into the package'}       | ${renaming(LIB_FILE, 'docs/table.ts')}                   | ${1}
        ${'a rename between unpublished paths'}    | ${renaming('docs/b.md', 'docs/a.md')}                    | ${0}
        ${'a lib file and a line already on base'} | ${lineOnBase}                                            | ${1}
        ${'a lib file and a patch line'}           | ${withLine(PATCH, LIB_FILE)}                             | ${0}
        ${'a lib file and a minor line'}           | ${withLine(MINOR, LIB_FILE)}                             | ${0}
        ${'a lib file and a breaking line'}        | ${withLine(BREAKING, LIB_FILE)}                          | ${0}
        ${'an unknown tag'}                        | ${withLine('- (fix) Fix a thing')}                       | ${1}
        ${'a line with no text'}                   | ${withLine('- (patch)')}                                 | ${1}
        ${'a line with no dash'}                   | ${withLine('(patch) Fix a thing')}                       | ${1}
        ${'a line with no tag'}                    | ${withLine('- Fix a thing')}                             | ${1}
        ${'a line with text before the tag'}       | ${withLine('see - (patch) Fix a thing')}                 | ${1}
    `('$name gives $problems problem(s)', ({
        input, problems,
    }) => {
        expect(policy.check(input)).toHaveLength(problems);
    });

    test('a base with no changelog yet takes the first line', () => {
        const input = withLine(PATCH, LIB_FILE);
        input.base.changelog = '';
        expect(policy.check(input)).toEqual([]);
    });

    test('a changelog with version sections and no Unreleased heading fails', () => {
        const input = change({});
        input.head.changelog = md('## 0.22.1', PATCH);
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
        headLock?: ReturnType<typeof lock>;
    }) => {
        const pending = opts.pending ?? [
            PATCH,
        ];
        const version = opts.version ?? '0.22.2';
        const input = change({
            baseLines: pending,
            headVersion: version,
            files: opts.files ?? files(MANIFEST, 'CHANGELOG.md', ...pending.includes(BREAKING) ? [
                'UPGRADING.md',
            ] : []),
        });
        input.head.changelog = opts.headChangelog ?? md('## Unreleased', `## ${version}`, ...pending);
        input.head.manifest = opts.headManifest ?? manifest(version);
        input.head.lock = opts.headLock ?? lock(version);
        return input;
    };
    const bump = (version: string, ...pending: string[]) => release({
        pending,
        version,
    });
    const editing = (...names: string[]) => release({
        files: files(MANIFEST, 'CHANGELOG.md', ...names),
    });
    const renamingAway = release({
        files: [
            ...files(MANIFEST, 'CHANGELOG.md'),
            renamed('docs/x.md', 'package-lock.json'),
        ],
    });
    const breakingWithoutUpgrading = release({
        pending: [
            BREAKING,
        ],
        version: '0.23.0',
        files: files(MANIFEST, 'CHANGELOG.md'),
    });
    const withChangelog = (headChangelog: string) => release({
        headChangelog,
    });
    const withManifest = (extra: object) => release({
        headManifest: manifest('0.22.2', extra),
    });
    const withLock = (extra: object) => release({
        headLock: lock('0.22.2', extra),
    });

    test.each`
        name                                           | input                                                              | problems
        ${'a patch bump of a patch line'}              | ${release({})}                                                     | ${0}
        ${'a minor bump of a minor line'}              | ${bump('0.23.0', MINOR)}                                           | ${0}
        ${'a minor bump of a breaking line'}           | ${bump('0.23.0', BREAKING)}                                        | ${0}
        ${'a minor bump of patch and minor lines'}     | ${bump('0.23.0', PATCH, MINOR)}                                    | ${0}
        ${'the lockfile edited only in the version'}   | ${editing('package-lock.json')}                                    | ${0}
        ${'a patch bump of a minor line'}              | ${bump('0.22.2', MINOR)}                                           | ${1}
        ${'a minor bump of a patch line'}              | ${bump('0.23.0', PATCH)}                                           | ${1}
        ${'a major bump'}                              | ${bump('1.0.0', BREAKING)}                                         | ${1}
        ${'a version equal to the base as numbers'}    | ${bump('0.22.01', PATCH)}                                          | ${1}
        ${'a lower minor version'}                     | ${bump('0.21.9', PATCH)}                                           | ${1}
        ${'a lower patch version'}                     | ${bump('0.22.0', PATCH)}                                           | ${1}
        ${'a version with a prefix'}                   | ${bump('v0.22.2', PATCH)}                                          | ${1}
        ${'a version with a suffix'}                   | ${bump('0.22.2-rc.1', PATCH)}                                      | ${1}
        ${'no pending lines'}                          | ${bump('0.22.2')}                                                  | ${1}
        ${'a lib file edited too'}                     | ${editing(LIB_FILE)}                                               | ${1}
        ${'the root README edited too'}                | ${editing('README.md')}                                            | ${1}
        ${'the package README edited too'}             | ${editing(PACKAGE_README)}                                         | ${1}
        ${'a file renamed out of the release set'}     | ${renamingAway}                                                    | ${1}
        ${'peerDependencies edited'}                   | ${withManifest(PEER_EDIT)}                                         | ${1}
        ${'devDependencies edited'}                    | ${withManifest(DEV_EDIT)}                                          | ${1}
        ${'a dependency changed in the lockfile'}      | ${withLock(DEPENDENCY_SWAP)}                                       | ${1}
        ${'a breaking line and no UPGRADING.md edit'}  | ${breakingWithoutUpgrading}                                        | ${1}
        ${'UPGRADING.md edited with no breaking line'} | ${editing('UPGRADING.md')}                                         | ${1}
        ${'pending lines left under Unreleased'}       | ${withChangelog(md('## Unreleased', PATCH, '## 0.22.2', PATCH))}   | ${1}
        ${'no section for the new version'}            | ${withChangelog(md('## Unreleased'))}                              | ${1}
        ${'a section for another version'}             | ${withChangelog(md('## Unreleased', '## 0.22.3', PATCH))}          | ${1}
        ${'a section not directly under Unreleased'}   | ${withChangelog(md('## Unreleased', '## 0.22.1', PATCH, '## 0.22.2'))} | ${1}
        ${'a first section that is not Unreleased'}    | ${withChangelog(md('## Pending', '## 0.22.2', PATCH))}            | ${1}
        ${'changed lines under the new version'}       | ${withChangelog(md('## Unreleased', '## 0.22.2', MINOR))}          | ${1}
        ${'a dropped line under the new version'}      | ${withChangelog(md('## Unreleased', '## 0.22.2'))}                 | ${1}
        ${'an added line under the new version'}       | ${withChangelog(md('## Unreleased', '## 0.22.2', PATCH, MINOR))}   | ${1}
        ${'no Unreleased heading'}                     | ${withChangelog(md('## 0.22.2', PATCH))}                           | ${1}
    `('$name gives $problems problem(s)', ({
        input, problems,
    }) => {
        expect(policy.check(input)).toHaveLength(problems);
    });
});

describe('against a git repository', () => {
    const LIB_DIR = `${PACKAGE}/lib/iceberg`;
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
    const commit = (message: string) => {
        git('add', '.');
        git('commit', '-q', '-m', message);
    };
    const run = (...args: string[]) => spawnSync('node', [
        SCRIPT,
        ...args,
    ], {
        cwd: repo,
        encoding: 'utf8',
    });

    beforeAll(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'release-policy-'));
        git('init', '-q', '-b', 'main');
        git('config', 'user.email', 'a@example.com');
        git('config', 'user.name', 'a');
        write(MANIFEST, JSON.stringify(manifest('0.22.1')));
        write('package-lock.json', JSON.stringify(lock('0.22.1')));
        write('docs/table.ts', 'export const x = 1;\n'.repeat(20));
        commit('base');
        fs.mkdirSync(path.join(repo, LIB_DIR), {
            recursive: true,
        });
        git('mv', 'docs/table.ts', LIB_FILE);
        write('CHANGELOG.md', changelog(PATCH));
        commit('rename with a changelog line');
        write(`${LIB_DIR}/é.ts`, 'export const y = 2;\n');
        commit('a lib file with no changelog line');
    });

    afterAll(() => {
        fs.rmSync(repo, {
            recursive: true,
            force: true,
        });
    });

    test('readChange reports renames and reads a changelog missing on the base as empty', () => {
        const result = policy.readChange('HEAD~2', 'HEAD~1', repo);
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
    });

    test('readChange reports a non-ASCII path as it is', () => {
        expect(policy.readChange('HEAD~1', 'HEAD', repo).files).toEqual([
            {
                filename: `${LIB_DIR}/é.ts`,
            },
        ]);
    });

    test('the script exits 0 on a clean pair', () => {
        expect(run('HEAD~2', 'HEAD~1')).toMatchObject({
            status: 0,
            stderr: '',
        });
    });

    test('the script exits 1 with the problem on stderr for a failing pair', () => {
        const result = run('HEAD~1', 'HEAD');
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('A published file changed');
    });

    test('the script exits 2 with a usage line when given no revisions', () => {
        const result = run();
        expect(result.status).toBe(2);
        expect(result.stderr).toContain('usage:');
    });
});
