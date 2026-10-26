# Project policies

These rules apply to every contribution to this repo, including those
written with AI assistance.

## Version bumping

Every PR merged to `main` that changes the published package must
include a bump to the `version` field in
`packages/cdk-glue-iceberg-table/package.json` (the published
manifest — the monorepo root `package.json` is private and
unpublished, so its version is not released). Pick the level per
semver:

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
the policy is "always bump".

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
merging. The trigger set is:

- any construct source under
  `packages/cdk-glue-iceberg-table/lib/iceberg/` (the published
  construct the demo stacks deploy),
- any demo stack under `lib/` (`lib/arceus-stack.ts`,
  `lib/iceberg-evolution-stack.ts`, `lib/iceberg-dml-stack.ts`,
  `lib/iceberg-surface-stack.ts`, `lib/iceberg-spark-smoke-stack.ts`,
  `lib/iceberg-v3-evolution-stack.ts`, `lib/iceberg-v3-dml-stack.ts`),
- `bin/arceus.ts` (`cdk.json`'s `app:` entry — every `cdk` invocation
  parses it),
- `cdk.json` (feature flags + the `app:` declaration),
- the integration scripts under `scripts/`
  (`integration-test-evolution.sh`, `integration-test-dml.sh`,
  `integration-test-surface.sh`, `integration-test-spark-smoke.sh`,
  `integration-test-v3-evolution.sh`, `integration-test-v3-dml.sh`),
- the Spark toolchain under `scripts/spark/` (`install-spark.sh`,
  `spark-env.sh`, `smoke.py`, `verify_v3_dml.py`).

The workflow caches only the sha512-verified downloads under `.spark/downloads`; an extracted Spark tree is never cached.

The workflow is gated — it does not fire on every PR because it runs
real `cdk deploy`s against a sandbox AWS account and takes about 15 min.
Trigger it on a same-repo PR by either:

- adding the label `run-integ-test` to the PR, or
- commenting `/run-integ-test` on the PR (collaborator-only).

It comments back on the PR with success / failure plus a link to the
run log. Reviewers **must** refuse to merge a trigger-set PR without
seeing that success comment, even if all unit tests are green.

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
  the `version` bump.

When in doubt, run it.

This gate is **human-enforced**: GitHub does not require it as a
status check for the protected branch, so a trigger-set PR can be
merged with no integ-test ever fired. Reviewers must hold the line.
Until / unless the gate is wired into `Settings → Branches →
required status checks`, the written policy is the only thing
stopping a slip.

`e2e-consumer/` consumes the **published** npm package, so every
version bump in `packages/cdk-glue-iceberg-table/package.json` should
be followed by bumping `e2e-consumer/package-lock.json` to the same
version once the publish workflow completes. While the package is
pre-1.0 a `^0.y.z` range does not cross a minor, so bump both the range
in `e2e-consumer/package.json` and the lockfile (`npm install
cdk-glue-iceberg-table@<version> --package-lock-only` in
`e2e-consumer/`), in a small follow-up PR. The surface-anchor
test only catches a rename when the lock pin matches the version
being reviewed, so a stale pin silently weakens the guarantee.

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
