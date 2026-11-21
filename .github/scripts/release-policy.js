const {execFileSync} = require('child_process');

const PACKAGE_DIR = 'packages/cdk-glue-iceberg-table/';
const MANIFEST = `${PACKAGE_DIR}package.json`;
const PUBLISHED_DIR = `${PACKAGE_DIR}lib/`;
const PUBLISHED_FILES = [MANIFEST, `${PACKAGE_DIR}README.md`, `${PACKAGE_DIR}LICENSE`];
const RELEASE_FILES = [MANIFEST, 'package-lock.json', 'CHANGELOG.md', 'UPGRADING.md'];
const CHANGELOG = 'CHANGELOG.md';
const UNRELEASED = 'Unreleased';
const LINE = /^- \((patch|minor|breaking)\) \S/;
const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
const LEVELS = ['major', 'minor', 'patch'];

/** Sections of a changelog in order: each `## ` heading with its non-blank lines. */
function parseChangelog(text) {
    const sections = [];
    for (const line of text.split('\n')) {
        if (line.startsWith('## ')) {
            sections.push({heading: line.slice(3).trim(), lines: []});
        } else if (sections.length > 0 && line.trim() !== '') {
            sections[sections.length - 1].lines.push(line.trim());
        }
    }
    return sections;
}

function unreleasedSection(text) {
    return parseChangelog(text).find((section) => section.heading === UNRELEASED);
}

function without(manifest, key) {
    const copy = {...manifest};
    delete copy[key];
    return JSON.stringify(copy);
}

function isPublishedPath(path) {
    return path.startsWith(PUBLISHED_DIR) || PUBLISHED_FILES.includes(path);
}

/** A rename counts on both its old and new path; a manifest edit counts unless it is confined to devDependencies. */
function changesPublishedFile(files, baseManifest, headManifest) {
    return files.some((file) => {
        if (file.filename === MANIFEST && !file.previous_filename) {
            return without(baseManifest, 'devDependencies') !== without(headManifest, 'devDependencies');
        }
        return [file.filename, file.previous_filename].some((path) => path && isPublishedPath(path));
    });
}

/** The semver level of the first component that differs, or null when `head` is not higher than `base`. */
function bumpLevel(base, head) {
    const [a, b] = [base, head].map((version) => version.match(VERSION).slice(1).map(Number));
    const i = [0, 1, 2].find((index) => a[index] !== b[index]);
    return i === undefined || b[i] < a[i] ? null : LEVELS[i];
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
    for (const file of files) {
        for (const path of [file.filename, file.previous_filename].filter(Boolean)) {
            if (!RELEASE_FILES.includes(path)) {
                problems.push(`A release pull request may not edit ${path}.`);
            }
        }
    }
    if (without(base.manifest, 'version') !== without(head.manifest, 'version')) {
        problems.push(`A release pull request may edit only "version" in ${MANIFEST}.`);
    }
    if (![base.manifest.version, version].every((v) => VERSION.test(v)) || !bumpLevel(base.manifest.version, version)) {
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
    return problems;
}

/**
 * The problems found in a pull request, given its changed files
 * ({filename, previous_filename}) and the base and head contents of
 * CHANGELOG.md and the package manifest. A changed `version` makes it a
 * release pull request.
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
    const files = git('diff', '--name-status', '-M', base, head)
        .split('\n')
        .filter(Boolean)
        .map((line) => {
            const [status, ...paths] = line.split('\t');
            return status.startsWith('R')
                ? {filename: paths[1], previous_filename: paths[0]}
                : {filename: paths[0]};
        });
    const side = (revision) => ({
        changelog: show(revision, CHANGELOG),
        manifest: JSON.parse(show(revision, MANIFEST)),
    });
    return {files, base: side(base), head: side(head)};
}

if (require.main === module) {
    const problems = check(readChange(process.argv[2], process.argv[3]));
    problems.forEach((problem) => console.error(problem));
    process.exitCode = problems.length > 0 ? 1 : 0;
}

module.exports = {parseChangelog, changesPublishedFile, check, readChange};
