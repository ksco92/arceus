import * as fs from 'fs';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const gate = require('../.github/scripts/integ-gate.js');

const patternsText = fs.readFileSync(
    path.join(__dirname, '..', '.github', 'integ-trigger-set.txt'),
    'utf8',
);

const PACKAGE_JSON = 'packages/cdk-glue-iceberg-table/package.json';

const touches = (...files: object[]): boolean => gate.touchesTriggerSet(patternsText, files);
const modified = (filename: string, patch?: string) => ({
    filename,
    status: 'modified',
    patch,
});

describe('trigger set patterns', () => {
    test.each([
        'packages/cdk-glue-iceberg-table/lib/iceberg/table.ts',
        'packages/cdk-glue-iceberg-table/lib/iceberg/nested/deep.ts',
        'lib/arceus-stack.ts',
        'lib/iceberg-v3-dml-stack.ts',
        'lib/a-new-demo-stack.ts',
        'bin/arceus.ts',
        'cdk.json',
        'scripts/integration-test-dml.sh',
        'scripts/integration-test-a-new-suite.sh',
        'scripts/field_ids.py',
        'scripts/spark/verify_dml.py',
        'scripts/spark/install-spark.sh',
        'scripts/spark/a-new-program.py',
    ])('%s is in the set', (filename) => {
        expect(touches(modified(filename))).toBe(true);
    });

    test.each([
        'README.md',
        'docs/integ-test-setup.md',
        'e2e-consumer/package.json',
        '.github/workflows/ci.yml',
        '.github/workflows/publish.yml',
        '.github/workflows/integ-test.yml',
        '.github/workflows/integ-gate.yml',
        '.github/integ-trigger-set.txt',
        '.github/scripts/integ-gate.js',
        'test/arceus-stack.test.ts',
        'packages/cdk-glue-iceberg-table/test/table.test.ts',
        'packages/cdk-glue-iceberg-table/lib/other.ts',
        'packages/cdk-glue-iceberg-table/README.md',
        'scripts/helper.sh',
        'scripts/integration-test.sh',
        'scripts/integration-test-dml.sh.bak/x',
        'library/x.ts',
        'nested/cdk.json',
        'e2e-consumer/lib/consumer-stack.ts',
        'scripts/integration-test-a/b.sh',
        'bin/other.ts',
        'cdk.json5',
        'package.json',
        'package-lock.json',
    ])('%s is outside the set', (filename) => {
        expect(touches(modified(filename))).toBe(false);
    });

    test('an empty file list is outside the set', () => {
        expect(touches()).toBe(false);
    });

    test('one in-set file among exempt ones puts the PR in the set', () => {
        expect(touches(modified('README.md'), modified('docs/a.md'), modified('lib/x.ts'))).toBe(true);
    });

    test('comments and blank lines are not patterns', () => {
        expect(gate.parsePatterns('# lib/\n\n  \ncdk.json\n')).toHaveLength(1);
    });

    test('regex metacharacters in a pattern match literally', () => {
        expect(gate.touchesTriggerSet('a.b+c', [
            modified('a.b+c'),
        ])).toBe(true);
        expect(gate.touchesTriggerSet('a.b+c', [
            modified('axb+c'),
        ])).toBe(false);
    });
});

describe('renames', () => {
    test('moving a file out of the set counts on the old path', () => {
        expect(touches({
            filename: 'docs/x.py',
            previous_filename: 'scripts/spark/x.py',
            status: 'renamed',
        })).toBe(true);
    });

    test('moving a file into the set counts on the new path', () => {
        expect(touches({
            filename: 'lib/x.ts',
            previous_filename: 'docs/x.ts',
            status: 'renamed',
        })).toBe(true);
    });

    test('a rename between exempt paths stays outside', () => {
        expect(touches({
            filename: 'docs/b.md',
            previous_filename: 'docs/a.md',
            status: 'renamed',
        })).toBe(false);
    });
});

describe('package.json version-only exemption', () => {
    const bump = '@@ -1,5 +1,5 @@\n {\n     "name": "cdk-glue-iceberg-table",\n-    "version": "0.14.0",\n+    "version": "0.15.0",\n     "stability": "experimental"\n }';

    test('a version-only edit is exempt', () => {
        expect(touches(modified(PACKAGE_JSON, bump))).toBe(false);
    });

    test('a version edit plus another field is in the set', () => {
        const patch = `${bump}\n-    "license": "Apache-2.0",\n+    "license": "MIT",`;
        expect(touches(modified(PACKAGE_JSON, patch))).toBe(true);
    });

    test('a dependency edit is in the set', () => {
        expect(touches(modified(PACKAGE_JSON, '@@ -9,3 +9,3 @@\n-    "constructs": "^10.0.0",\n+    "constructs": "^10.1.0",'))).toBe(true);
    });

    test('an added version line with no removal is in the set', () => {
        expect(touches(modified(PACKAGE_JSON, '@@ -4,2 +4,3 @@\n   "scripts": {\n+    "version": "node x.js",'))).toBe(true);
    });

    test('a removal followed by an unrelated addition is in the set', () => {
        expect(touches(modified(PACKAGE_JSON, '@@ -4,2 +4,3 @@\n-    "version": "0.14.0",\n+    "version": "0.15.0",\n+    "version": "0.16.0",'))).toBe(true);
    });

    test('a missing patch is in the set', () => {
        expect(touches(modified(PACKAGE_JSON))).toBe(true);
    });

    test('a patch with no changed lines is in the set', () => {
        expect(touches(modified(PACKAGE_JSON, '@@ -1 +1 @@'))).toBe(true);
    });

    test('a renamed package.json with a version-only patch is in the set', () => {
        expect(touches({
            filename: PACKAGE_JSON,
            previous_filename: 'old/package.json',
            status: 'renamed',
            patch: bump,
        })).toBe(true);
    });
});

describe('classify', () => {
    const HEAD = 'a'.repeat(40);

    const run = async (opts: {files?: object[]; changedFiles?: number; existing?: string[]; headRepo?: string}) => {
        const files = opts.files ?? [];
        const createCommitStatus = jest.fn();
        const github = {
            paginate: jest.fn().mockResolvedValue(files),
            rest: {
                pulls: {
                    listFiles: jest.fn(),
                },
                repos: {
                    getCombinedStatusForRef: jest.fn().mockResolvedValue({
                        data: {
                            statuses: (opts.existing ?? []).map((context) => ({
                                context,
                            })),
                        },
                    }),
                    createCommitStatus,
                },
            },
        };
        const core = {
            warning: jest.fn(),
            notice: jest.fn(),
        };
        const context = {
            repo: {
                owner: 'o',
                repo: 'r',
            },
            serverUrl: 'https://github.com',
            runId: 7,
            payload: {
                pull_request: {
                    number: 5,
                    changed_files: opts.changedFiles ?? files.length,
                    head: {
                        sha: HEAD,
                        repo: {
                            full_name: opts.headRepo ?? 'o/r',
                        },
                    },
                },
            },
        };
        await gate.classify({
            github,
            context,
            core,
            patternsText,
        });
        return {
            github,
            core,
            createCommitStatus,
        };
    };

    test('a README-only PR gets success', async () => {
        const {
            createCommitStatus,
        } = await run({
            files: [
                modified('README.md'),
            ],
        });
        expect(createCommitStatus).toHaveBeenCalledWith(expect.objectContaining({
            sha: HEAD,
            context: 'integ-gate',
            state: 'success',
            target_url: 'https://github.com/o/r/actions/runs/7',
        }));
    });

    test('a lib change gets pending', async () => {
        const {
            createCommitStatus,
        } = await run({
            files: [
                modified('lib/arceus-stack.ts'),
            ],
        });
        expect(createCommitStatus).toHaveBeenCalledWith(expect.objectContaining({
            sha: HEAD,
            state: 'pending',
        }));
    });

    test('files are listed through the paginated API', async () => {
        const {
            github,
        } = await run({
            files: [
                modified('README.md'),
            ],
        });
        expect(github.paginate).toHaveBeenCalledWith(github.rest.pulls.listFiles, {
            owner: 'o',
            repo: 'r',
            pull_number: 5,
            per_page: 100,
        });
    });

    test('a truncated file list is treated as in the set', async () => {
        const {
            createCommitStatus,
        } = await run({
            files: [
                modified('README.md'),
            ],
            changedFiles: 3000,
        });
        expect(createCommitStatus).toHaveBeenCalledWith(expect.objectContaining({
            state: 'pending',
        }));
    });

    test('a head that already has the status is left alone', async () => {
        const {
            createCommitStatus, github,
        } = await run({
            files: [
                modified('lib/x.ts'),
            ],
            existing: [
                'ci',
                'integ-gate',
            ],
        });
        expect(createCommitStatus).not.toHaveBeenCalled();
        expect(github.paginate).not.toHaveBeenCalled();
    });

    test('other contexts on the head do not suppress the status', async () => {
        const {
            createCommitStatus,
        } = await run({
            files: [
                modified('lib/x.ts'),
            ],
            existing: [
                'ci',
            ],
        });
        expect(createCommitStatus).toHaveBeenCalledTimes(1);
    });

    test('a fork PR posts nothing and warns', async () => {
        const {
            createCommitStatus, core, github,
        } = await run({
            files: [
                modified('README.md'),
            ],
            headRepo: 'fork/r',
        });
        expect(createCommitStatus).not.toHaveBeenCalled();
        expect(github.rest.repos.getCombinedStatusForRef).not.toHaveBeenCalled();
        expect(core.warning).toHaveBeenCalledTimes(1);
    });
});
