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
- **major** (`0.1.0` → `1.0.0`) — breaking changes. (Per semver, while
  the version is below 1.0 it's also acceptable to bump minor on
  breaks; once `1.0.0` ships, true breaks must bump major.)

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
