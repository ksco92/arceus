# Project policies

These rules apply to every contribution to this repo, including those
written with AI assistance.

## Releases

A pull request records what it changes in `CHANGELOG.md`; a release is
a pull request of its own that sets the version. Only a release edits
`version` in `packages/cdk-glue-iceberg-table/package.json` (the
published manifest — the monorepo root `package.json` is private and
unpublished, so its version is not released).

### Changelog lines

A pull request that changes a published file adds one line under
`## Unreleased` in `CHANGELOG.md`. The published files are those the
manifest's `files` field ships (built from
`packages/cdk-glue-iceberg-table/lib/`), the package `README.md`, and
the manifest apart from its `devDependencies`. A line is
`- (patch) …`, `- (minor) …` or `- (breaking) …`, the level chosen per
semver:

- **patch** — bug fixes, doc-only changes, internal refactors that
  don't change the public API.
- **minor** — additive features that don't break existing API.
- **breaking** — changes that break existing API.

A `(breaking)` line also adds its upgrade note under `## Unreleased` in
`UPGRADING.md`.

### Release pull requests

A release pull request is opened when the owner asks, and at once for a
fix to a wrong-data read, a failing deploy or a security defect. It
edits only `version` in the package manifest, the files the previous
version bump touched for the version alone (`package-lock.json`), and
the `## Unreleased` heading of `CHANGELOG.md`, which becomes
`## <version>` with a new empty `## Unreleased` above it. The
`## Unreleased` heading of `UPGRADING.md` changes the same way only when
notes sit under it; a release with no breaking change leaves
`UPGRADING.md` untouched.

The version is a minor bump when any pending line is `(minor)` or
`(breaking)` and a patch bump otherwise. While the package is pre-1.0
(the current state), per semver it is acceptable for a breaking change
to bump *minor*; the `0.x` → `1.0.0` jump is the "graduate to stable"
milestone and never happens without the owner's say.

`.github/workflows/publish.yml` publishes to each of npm and PyPI when
the version on `main` differs from that registry's version. After it succeeds
on both registries, the release's merge commit is tagged `v<version>`
and a GitHub release is created from that changelog section. Then
`e2e-consumer/`, which consumes the **published** npm package, moves to
the new version: while the package is pre-1.0 a `^0.y.z` range does not
cross a minor, so bump both the range in `e2e-consumer/package.json`
and the lockfile (`npm install cdk-glue-iceberg-table@<version>
--package-lock-only` in `e2e-consumer/`), in a small follow-up PR. The
surface-anchor test only catches a rename when the lock pin matches the
version being reviewed, so a stale pin silently weakens the guarantee.

Only the latest release line is maintained. If an older version ever
needs a fix, it is made on a branch cut from that version's tag, and
`publish.yml` is never dispatched from that branch: it publishes
whatever version it is given as npm's `latest`.

## No AI authorship signals

This is a human-authored project. AI assistance is allowed; AI
attribution in artifacts that survive merge is not.

- Commit messages must NOT contain `Co-Authored-By: Claude` (or any
  other AI-attribution) trailers.
- Commit/PR bodies must NOT contain the `🤖 Generated with Claude
  Code` footer or equivalents.
- Branch names must NOT contain `claude`, `ai`, `bot`, `gpt`,
  `copilot`, or similar.
- Code, docs, and README prose must not read as AI-generated. Avoid
  this banned-vocabulary list: `delve`, `tapestry`, `landscape`,
  `testament`, `vibrant`, `pivotal`, `nuanced`, `seamless`,
  `comprehensive and`, `robust and`, `leverage` (unless followed by
  `the existing`).
- Long-running comments that narrate intent in the present tense
  ("Increment counter by 1", "Loop through items", "Check if X") are
  artifacts of a chat transcript — strip them before commit.

If a contribution was written with AI assistance, the human
contributor is the sole credited author.

## Integration test for construct-touching PRs

PRs that change any file consumed by the workflow's `cdk deploy` must
have the **Integration test** workflow
(`.github/workflows/integ-test.yml`) run green on the PR head before
merging. The trigger set is the path list in
`.github/integ-trigger-set.txt`, by directory and name prefix, so a new
file under a listed directory is covered without an edit; the gate's
own files are in it. A change to
`packages/cdk-glue-iceberg-table/package.json` is outside the set only when
its sole edited line is `"version"`; any other change to it is in the set.

The workflow caches only the sha512-verified downloads under `.spark/downloads`; an extracted Spark tree is never cached.

The workflow is gated — it does not fire on every PR because it runs
real `cdk deploy`s against a sandbox AWS account and takes about 20 min
with the Spark downloads cached and up to about 45 min without.
Trigger it on a same-repo PR by either:

- adding the label `run-integ-test` to the PR, or
- commenting `/run-integ-test` on the PR (collaborator-only).

It comments back on the PR with success / failure plus a link to the
run log. Reviewers **must** refuse to merge a trigger-set PR unless the
`integ-gate` status on its head is `success`, even if all unit tests are
green.

It also runs weekly on `main` and opens or comments on an issue titled
`Weekly integration run failed` when that run fails.

Exemption list (no integ-test required):

- `README.md` and any other top-level doc.
- `docs/`.
- `e2e-consumer/` (its own job in `ci.yml` covers it).
- `.github/workflows/ci.yml` and `.github/workflows/publish.yml`
  (integ-irrelevant by topic).
- `.github/workflows/integ-test.yml` itself — a broken `integ-test.yml`
  can't validate itself; review changes to this file knowing the
  next trigger-set PR is the first chance to confirm it still works.
- `test/` and `packages/cdk-glue-iceberg-table/test/` (unit tests,
  exercised by `npm test` in `ci.yml`).
- `packages/cdk-glue-iceberg-table/package.json` if the only change is
  the `version` bump of a release.

When in doubt, run it.

The `integ-gate` commit status reports the gate on every PR to
`main`. The **Integration gate** workflow
(`.github/workflows/integ-gate.yml`) matches the PR's changed files
against the trigger set and posts `success` when none is in it and
`pending` when one is. A green Integration test run posts `success` on
the commit it ran on; a failed or cancelled one posts `failure`. A new
commit has no status until the workflow posts one. The one manual step:
the owner marks the status check `integ-gate` as required in branch
protection for `main`.

See `docs/integ-test-setup.md` for the AWS-side prerequisites
(`ArceusStack` deployed, account `cdk bootstrap`ped, IAM role +
`AWS_INTEG_ROLE_ARN` repo variable set).

## Accepted install-time scripts

The root lockfile carries two packages that run a script at `npm ci`:
`unrs-resolver` (`postinstall`, through `napi-postinstall`, which
downloads the platform's native binding from the registry without an
integrity check when the pinned `@unrs/resolver-binding-*` optional
dependency is absent) and `@parcel/watcher` (`install`, a no-op unless
`npm_config_build_from_source=true`). Both arrive through Jest 30.
Accepted because CI and publish run on linux-x64-gnu, where the
lockfile pins both bindings with integrity hashes. Revisit if a
workflow runs on another platform or with `--omit=optional`. A new
entry in the list printed by

```
node -e 'const l=require("./package-lock.json");for(const [k,v] of Object.entries(l.packages)) if(v.hasInstallScript) console.log(k)'
```

blocks merge until it is recorded here.
