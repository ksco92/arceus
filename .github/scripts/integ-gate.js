const CONTEXT = 'integ-gate';
const VERSION_LINE = /^[+-]\s*"version":\s*"[^"]*",?\s*$/;
const UNLESS_VERSION_ONLY = ' unless-version-only';

function parsePatterns(text) {
    return text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#'))
        .map((line) => {
            const versionOnlyExempt = line.endsWith(UNLESS_VERSION_ONLY);
            const path = versionOnlyExempt ? line.slice(0, -UNLESS_VERSION_ONLY.length).trim() : line;
            const source = path
                .split('*')
                .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
                .join('[^/]*');
            return {
                regex: new RegExp(path.endsWith('/') ? `^${source}` : `^${source}$`),
                versionOnlyExempt,
            };
        });
}

function isVersionOnlyChange(file) {
    if (file.status !== 'modified' || typeof file.patch !== 'string') {
        return false;
    }
    const changed = file.patch.split('\n').filter((line) => /^[+-]/.test(line));
    return changed.length === 2
        && changed[0].startsWith('-')
        && changed[1].startsWith('+')
        && changed.every((line) => VERSION_LINE.test(line));
}

/**
 * True when any changed file falls in the trigger set. A rename counts on
 * both its old and new path.
 */
function touchesTriggerSet(patternsText, files) {
    const patterns = parsePatterns(patternsText);
    return files.some((file) => {
        const paths = [file.filename, file.previous_filename].filter(Boolean);
        return patterns.some((p) => paths.some((path) => p.regex.test(path))
            && !(p.versionOnlyExempt && isVersionOnlyChange(file)));
    });
}

/**
 * Posts the `integ-gate` commit status for a pull_request event: success
 * outside the trigger set, pending inside it. A head that already has the
 * status is left alone, so a re-run cannot undo a result.
 */
async function classify({github, context, core, patternsText}) {
    const pr = context.payload.pull_request;
    const {owner, repo} = context.repo;
    if (pr.head.repo.full_name !== `${owner}/${repo}`) {
        core.warning(`Fork PR from ${pr.head.repo.full_name}: the read-only token cannot post ${CONTEXT}.`);
        return;
    }
    const {data} = await github.rest.repos.getCombinedStatusForRef({
        owner, repo, ref: pr.head.sha, per_page: 100,
    });
    if (data.statuses.some((s) => s.context === CONTEXT)) {
        core.notice(`${CONTEXT} is already set on ${pr.head.sha}.`);
        return;
    }
    const files = await github.paginate(github.rest.pulls.listFiles, {
        owner, repo, pull_number: pr.number, per_page: 100,
    });
    const inSet = files.length < pr.changed_files || touchesTriggerSet(patternsText, files);
    await github.rest.repos.createCommitStatus({
        owner,
        repo,
        sha: pr.head.sha,
        context: CONTEXT,
        state: inSet ? 'pending' : 'success',
        description: inSet
            ? 'Trigger-set files changed: run the integration test (label run-integ-test)'
            : 'No trigger-set files changed',
        target_url: `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`,
    });
}

module.exports = {CONTEXT, parsePatterns, touchesTriggerSet, classify};
