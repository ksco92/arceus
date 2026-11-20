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
        'scripts/athena.sh',
        'scripts/x.sh',
        'scripts/spark/verify_dml.py',
        'scripts/spark/install-spark.sh',
        'scripts/spark/a-new-program.py',
        '.github/workflows/integ-gate.yml',
        '.github/integ-trigger-set.txt',
        '.github/scripts/integ-gate.js',
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
        'test/arceus-stack.test.ts',
        'packages/cdk-glue-iceberg-table/test/table.test.ts',
        'packages/cdk-glue-iceberg-table/lib/other.ts',
        'packages/cdk-glue-iceberg-table/README.md',
        'library/x.ts',
        'docs/lib/x.ts',
        'xscripts/spark/y.py',
        'docs/scripts/x',
        'nested/cdk.json',
        'e2e-consumer/lib/consumer-stack.ts',
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

    test('a removed non-version line with an added version line is in the set', () => {
        expect(touches(modified(PACKAGE_JSON, '@@ -1 +1 @@\n-  "license": "MIT",\n+    "version": "0.15.0",'))).toBe(true);
    });

    test('two added version lines are in the set', () => {
        expect(touches(modified(PACKAGE_JSON, '@@ -1 +1,2 @@\n+    "version": "0.15.0",\n+    "version": "0.16.0",'))).toBe(true);
    });

    test('two removed version lines are in the set', () => {
        expect(touches(modified(PACKAGE_JSON, '@@ -1,2 +1 @@\n-    "version": "0.14.0",\n-    "version": "0.15.0",'))).toBe(true);
    });

    test('an addition before the removal is in the set', () => {
        expect(touches(modified(PACKAGE_JSON, '@@ -1 +1 @@\n+    "version": "0.15.0",\n-    "version": "0.14.0",'))).toBe(true);
    });

    test('a version line with trailing content is in the set', () => {
        expect(touches(modified(PACKAGE_JSON, '@@ -1 +1 @@\n-    "version": "0.14.0",\n+    "version": "1.0.0", "license": "MIT"'))).toBe(true);
    });

    test('a version line with leading content is in the set', () => {
        expect(touches(modified(PACKAGE_JSON, '@@ -1 +1 @@\n-    "version": "0.14.0",\n+ -  "version": "1.0.0",'))).toBe(true);
    });

    test.each([
        'lib/x.ts',
        'cdk.json',
    ])('a version-only patch on %s stays in the set', (filename) => {
        expect(touches(modified(filename, '@@ -1 +1 @@\n-    "version": "0.14.0",\n+    "version": "0.15.0",'))).toBe(true);
    });
});

describe('classify', () => {
    const HEAD = 'a'.repeat(40);

    const run = async (opts: {files?: object[]; changedFiles?: number; existing?: {context: string; description: string}[]; headRepo?: string; base?: string}) => {
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
                            statuses: opts.existing ?? [],
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
                    base: {
                        ref: opts.base ?? 'main',
                    },
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

    const own = {
        context: 'integ-gate',
        description: 'No trigger-set files changed',
    };
    const report = {
        context: 'integ-gate',
        description: 'Integration test run passed on this commit',
    };
    const inSet = [
        modified('lib/x.ts'),
    ];

    test('the integration workflow posts descriptions that start with the kept prefix', () => {
        const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'integ-test.yml'), 'utf8');
        expect(workflow).toContain('description="Integration test run passed');
        expect(workflow).toContain('description="Integration test run $DEPLOY_RESULT');
    });

    test('an earlier classify success is recomputed to pending when the PR now touches the set', async () => {
        const {
            createCommitStatus,
        } = await run({
            files: inSet,
            existing: [
                own,
            ],
        });
        expect(createCommitStatus).toHaveBeenCalledWith(expect.objectContaining({
            state: 'pending',
        }));
    });

    test('an earlier classify pending is recomputed to success when the PR no longer touches the set', async () => {
        const {
            createCommitStatus,
        } = await run({
            files: [
                modified('README.md'),
            ],
            existing: [
                {
                    context: 'integ-gate',
                    description: 'Trigger-set files changed: run the integration test (label run-integ-test)',
                },
            ],
        });
        expect(createCommitStatus).toHaveBeenCalledWith(expect.objectContaining({
            state: 'success',
        }));
    });

    test.each([
        report,
        {
            context: 'integ-gate',
            description: 'Integration test run failure on this commit',
        },
    ])('a result from the integration run is kept', async (existing) => {
        const {
            createCommitStatus, github,
        } = await run({
            files: inSet,
            existing: [
                existing,
            ],
        });
        expect(createCommitStatus).not.toHaveBeenCalled();
        expect(github.paginate).not.toHaveBeenCalled();
    });

    test.each([
        'x Integration test run passed',
        'Integration test queued',
    ])('an earlier status described "%s" is recomputed', async (description) => {
        const {
            createCommitStatus,
        } = await run({
            files: inSet,
            existing: [
                {
                    context: 'integ-gate',
                    description,
                },
            ],
        });
        expect(createCommitStatus).toHaveBeenCalledWith(expect.objectContaining({
            state: 'pending',
        }));
    });

    test('other contexts on the head do not suppress the status', async () => {
        const {
            createCommitStatus,
        } = await run({
            files: inSet,
            existing: [
                {
                    context: 'ci',
                    description: 'Integration test run passed',
                },
            ],
        });
        expect(createCommitStatus).toHaveBeenCalledTimes(1);
    });

    test('a PR against another base posts nothing', async () => {
        const {
            createCommitStatus, github,
        } = await run({
            files: inSet,
            base: 'feature/x',
        });
        expect(createCommitStatus).not.toHaveBeenCalled();
        expect(github.rest.repos.getCombinedStatusForRef).not.toHaveBeenCalled();
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
