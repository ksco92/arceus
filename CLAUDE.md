# Project policies

These rules apply to every contribution to this repo, including those
written with AI assistance.

## Version bumping

Every PR merged to `main` must include a bump to the `version` field
in `package.json`. Pick the level per semver:

- **patch** (`0.1.0` → `0.1.1`) — bug fixes, doc-only changes, internal
  refactors that don't change the public API.
- **minor** (`0.1.0` → `0.2.0`) — additive features that don't break
  existing API.
- **major** (`1.0.0` → `2.0.0`) — breaking changes after the package
  has reached `1.0.0`. While the package is still pre-1.0 (the
  current state), per semver it is acceptable to bump *minor* on
  breaking changes; reserve the `0.x` → `1.0.0` jump for the
  "graduate to stable" milestone.

`.github/workflows/publish.yml` only publishes when the version on
`main` is newer than the version on the npm registry. A PR that
forgets to bump won't error — it just becomes a no-op on merge — but
the policy is "always bump" so reviewers should reject PRs missing a
version change.

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
  the banned-vocabulary list in the project's `oss-reviewer` rules
  (§4.10): `delve`, `tapestry`, `landscape`, `testament`, `vibrant`,
  `pivotal`, `nuanced`, `seamless`, `comprehensive and`, `robust and`,
  `leverage` (unless followed by `the existing`).
- Long-running comments that narrate intent in the present tense
  ("Increment counter by 1", "Loop through items", "Check if X") are
  artifacts of a chat transcript — strip them before commit.

If a contribution was written with AI assistance, the human
contributor is the sole credited author.

## Integration test for construct-touching PRs

PRs that change any file under `lib/iceberg/`, `lib/arceus-stack.ts`,
`lib/iceberg-evolution-stack.ts`, or
`scripts/integration-test-evolution.sh` must have the **Integration
test** workflow (`.github/workflows/integ-test.yml`) run green on
the PR head before merging.

The workflow is gated — it does not fire on every PR because it runs
real `cdk deploy`s against a sandbox AWS account and takes ~5 min.
Trigger it on a same-repo PR by either:

- adding the label `run-integ-test` to the PR, or
- commenting `/run-integ-test` on the PR (collaborator-only).

It comments back on the PR with success / failure plus a link to the
run log. Reviewers should refuse to merge a construct-touching PR
without seeing that success comment, even if all unit tests are
green and pr-reviewer returns PASS.

PRs that touch only the README, the demo's `bin/`, the workflows
under `.github/workflows/`, or unrelated paths do not need the integ
test. The list above is the trigger set — when in doubt, run it.

See `docs/integ-test-setup.md` for the AWS-side prerequisites
(`ArceusStack` deployed, account `cdk bootstrap`ped, IAM role +
`AWS_INTEG_ROLE_ARN` repo variable set).
