const {execFileSync} = require('child_process');

const PACKAGE_PATH = 'packages/cdk-glue-iceberg-table';
const PACKAGE_DIR = `${PACKAGE_PATH}/`;
const MANIFEST = `${PACKAGE_DIR}package.json`;
const PUBLISHED_DIR = `${PACKAGE_DIR}lib/`;
const PUBLISHED_FILES = [MANIFEST, `${PACKAGE_DIR}README.md`, `${PACKAGE_DIR}LICENSE`];
const CHANGELOG = 'CHANGELOG.md';
const UPGRADING = 'UPGRADING.md';
const LOCKFILE = 'package-lock.json';
const RELEASE_FILES = [MANIFEST, LOCKFILE, CHANGELOG, UPGRADING];
const UNRELEASED = 'Unreleased';
const LINE = /^- \((patch|minor|breaking)\) \S/;
const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
const LEVELS = ['major', 'minor', 'patch'];

/** Sections of a changelog in order: each `## ` heading with its non-blank lines. */
function parseChangelog(text) {
    const sections = [];
    for (const line of text.split('\n')) {
        if (line.startsWith('## ')) {
            sections.push({heading: line.slice(3), lines: []});
        } else if (sections.length > 0 && line !== '') {
            sections[sections.length - 1].lines.push(line);
        }
    }
    return sections;
}

function unreleasedSection(text) {
    return parseChangelog(text).find((section) => section.heading === UNRELEASED);
}

function without(object, key) {
    const copy = {...object};
    delete copy[key];
    return copy;
}

function same(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

function lockWithoutPackageVersion(lock) {
    return {...lock, packages: {...lock.packages, [PACKAGE_PATH]: without(lock.packages[PACKAGE_PATH], 'version')}};
}

function isPublishedPath(path) {
    return path.startsWith(PUBLISHED_DIR) || PUBLISHED_FILES.includes(path);
}

/** A manifest edit counts unless it is confined to devDependencies. */
function changesPublishedFile(files, baseManifest, headManifest) {
    return files.some((file) => (file === MANIFEST
        ? !same(without(baseManifest, 'devDependencies'), without(headManifest, 'devDependencies'))
        : isPublishedPath(file)));
}

/** The semver level of the first component that differs, or a falsy value when `head` is not higher than `base`. */
function bumpLevel(base, head) {
    const [a, b] = [base, head].map((version) => version.match(VERSION).slice(1).map(Number));
    const i = [0, 1, 2].find((index) => a[index] !== b[index]);
    return b[i] < a[i] ? null : LEVELS[i];
}

function checkPullRequest({files, base, head}) {
    const problems = [];
    const unreleased = unreleasedSection(head.changelog);
    if (!unreleased) {
        return [`${CHANGELOG} has no "## ${UNRELEASED}" heading.`];
    }
    for (const line of unreleased.lines.filter((l) => !LINE.test(l))) {
        problems.push(`Not a changelog line of the form "- (patch|minor|breaking) text": ${line}`);
    }
    const pending = unreleasedSection(base.changelog)?.lines ?? [];
    const added = unreleased.lines.filter((line) => LINE.test(line) && !pending.includes(line));
    if (added.length === 0 && changesPublishedFile(files, base.manifest, head.manifest)) {
        problems.push(`A published file changed: add a line under "## ${UNRELEASED}" in ${CHANGELOG}.`);
    }
    return problems;
}

function checkRelease({files, base, head}) {
    const problems = [];
    const version = head.manifest.version;
    for (const file of files.filter((f) => !RELEASE_FILES.includes(f))) {
        problems.push(`A release pull request may not edit ${file}.`);
    }
    if (!same(without(base.manifest, 'version'), without(head.manifest, 'version'))) {
        problems.push(`A release pull request may edit only "version" in ${MANIFEST}.`);
    }
    if (!same(lockWithoutPackageVersion(base.lock), lockWithoutPackageVersion(head.lock))) {
        problems.push(`A release pull request may change only the package's own version entry in ${LOCKFILE}.`);
    }
    if (!VERSION.test(version) || !bumpLevel(base.manifest.version, version)) {
        return [...problems, `Version ${version} is not a higher x.y.z than ${base.manifest.version}.`];
    }
    const pending = unreleasedSection(base.changelog)?.lines ?? [];
    if (pending.length === 0) {
        problems.push(`A release needs at least one line under "## ${UNRELEASED}" on the base.`);
    }
    const [first, second] = parseChangelog(head.changelog);
    if (first?.heading !== UNRELEASED || first.lines.length > 0 || second?.heading !== version) {
        problems.push(`${CHANGELOG} must start with an empty "## ${UNRELEASED}" followed by "## ${version}".`);
    } else if (second.lines.join('\n') !== pending.join('\n')) {
        problems.push(`The lines under "## ${version}" must be the lines that were under "## ${UNRELEASED}" on the base.`);
    }
    const expected = pending.some((line) => /^- \((minor|breaking)\)/.test(line)) ? 'minor' : 'patch';
    const actual = bumpLevel(base.manifest.version, version);
    if (actual !== expected) {
        problems.push(`The pending lines call for a ${expected} bump, not ${actual}.`);
    }
    const hasBreaking = pending.some((line) => line.startsWith('- (breaking)'));
    const editsUpgrading = files.includes(UPGRADING);
    if (hasBreaking !== editsUpgrading) {
        problems.push(`${UPGRADING} must change in a release with a (breaking) line, and only then.`);
    }
    return problems;
}

/**
 * The problems found in a pull request, given its changed file paths (a
 * rename lists both) and the base and head contents of
 * CHANGELOG.md, the package manifest and the lockfile. A changed `version`
 * makes it a release pull request.
 */
function check(change) {
    return change.base.manifest.version === change.head.manifest.version
        ? checkPullRequest(change)
        : checkRelease(change);
}

/** The change between two git revisions of the repository in `cwd`; a missing changelog reads as empty. */
function readChange(base, head, cwd) {
    const git = (...args) => execFileSync('git', args, {cwd, encoding: 'utf8', stdio: 'pipe'});
    const show = (revision, path) => {
        try {
            return git('show', `${revision}:${path}`);
        } catch {
            return '';
        }
    };
    const files = git('diff', '--name-only', '--no-renames', '-z', base, head).split('\0').filter(Boolean);
    const side = (revision) => ({
        changelog: show(revision, CHANGELOG),
        manifest: JSON.parse(show(revision, MANIFEST)),
        lock: JSON.parse(show(revision, LOCKFILE)),
    });
    return {files, base: side(base), head: side(head)};
}

if (require.main === module) {
    const [base, head] = process.argv.slice(2);
    if (!base || !head) {
        console.error('usage: release-policy.js <base> <head>');
        process.exitCode = 2;
    } else {
        const problems = check(readChange(base, head));
        problems.forEach((problem) => console.error(problem));
        process.exitCode = problems.length > 0 ? 1 : 0;
    }
}

module.exports = {check, readChange};
