# Contributing to arceus

This repo develops [`cdk-glue-iceberg-table`](https://www.npmjs.com/package/cdk-glue-iceberg-table)
in an npm-workspace monorepo. Consumer documentation lives in the
[README](README.md), with breaking changes by version in
[UPGRADING.md](UPGRADING.md) and unreleased changes in
[CHANGELOG.md](CHANGELOG.md). This file covers the monorepo layout, how to
work in it, the CI / publish / integ-test gates, and the CDK demo app.

The repo has two parts:

- **[`packages/cdk-glue-iceberg-table/`](packages/cdk-glue-iceberg-table)** —
  the published package
  [`cdk-glue-iceberg-table`](https://www.npmjs.com/package/cdk-glue-iceberg-table):
  an AWS CDK L2 construct for creating and evolving Apache Iceberg
  tables in the AWS Glue Data Catalog.
- **The CDK demo app at the repo root** (`bin/`, `lib/arceus-stack.ts`,
  the evolution / DML / surface / Spark-smoke / v3-evolution stacks, `scripts/`) — dogfoods the
  construct against a real AWS account. Repo-only, not published.

The package builds with [jsii](https://aws.github.io/jsii/) and ships
as a multi-language artifact: npm for TypeScript / JavaScript and PyPI
for Python, both generated from one TypeScript source and indexed on
[Construct Hub](https://constructs.dev/packages/cdk-glue-iceberg-table).

## Repo layout

```
arceus/
├── package.json                        # Monorepo root + demo-app manifest (npm workspaces)
├── packages/
│   └── cdk-glue-iceberg-table/         # The PUBLISHED package (npm + PyPI, built with jsii)
│       ├── lib/iceberg/
│       │   ├── iceberg-table.ts        # The L2 construct itself
│       │   ├── iceberg-type.ts         # IcebergType + struct/list/map/decimal/fixed
│       │   ├── iceberg-partition-transform.ts
│       │   ├── iceberg-table-properties.ts
│       │   ├── iceberg-column.ts
│       │   ├── iceberg-partition-field.ts
│       │   ├── iceberg-sort-order.ts
│       │   ├── iceberg-sort-field.ts
│       │   ├── iceberg-table-grants.ts
│       │   ├── iceberg-table-render.ts
│       │   └── index.ts                # Re-exports (the package's entry point)
│       ├── test/iceberg/               # Unit tests for the construct
│       ├── test/packed-consumer/       # Fixture installed from the PR's npm pack tarball (not shipped)
│       ├── test/python-smoke/          # Runs the README's Python examples against the built wheel (not shipped)
│       ├── package.json                # The published manifest (jsii config + version)
│       ├── tsconfig.dev.json           # tsconfig for ESLint + ts-jest (jsii owns tsconfig.json)
│       ├── jest.config.js
│       ├── eslint.config.js
│       ├── README.md                   # Consumer-facing docs (the npm page)
│       └── LICENSE
├── bin/arceus.ts                       # CDK app entry point (the demo app)
├── lib/                                # Demo stacks (import the construct from packages/)
│   ├── arceus-stack.ts                 # Demo stack (buckets, DB, 3 demo tables)
│   ├── iceberg-evolution-stack.ts      # Parameterized stack for the evolution test
│   ├── iceberg-dml-stack.ts            # Stack for the DML / time-travel / compaction / snapshot-expiry test
│   ├── iceberg-surface-stack.ts        # Stack for transforms / sort / nested types / grants test
│   ├── iceberg-spark-smoke-stack.ts    # Stack for the Spark toolchain smoke check
│   ├── iceberg-v3-evolution-stack.ts   # Parameterized stack for the v3 evolution test
│   └── iceberg-v3-dml-stack.ts         # Stack for the v3 DML / row lineage / upgrade test
├── test/                               # Demo stack tests
│   ├── arceus-stack.test.ts
│   ├── iceberg-evolution-stack.test.ts
│   ├── iceberg-dml-stack.test.ts
│   ├── iceberg-surface-stack.test.ts
│   ├── iceberg-spark-smoke-stack.test.ts
│   ├── iceberg-v3-evolution-stack.test.ts
│   └── iceberg-v3-dml-stack.test.ts
├── scripts/
│   ├── integration-test-evolution.sh   # End-to-end evolution harness
│   ├── integration-test-dml.sh         # End-to-end DML harness
│   ├── integration-test-surface.sh     # End-to-end surface harness
│   ├── integration-test-spark-smoke.sh # Spark toolchain smoke check (1 deploy + INSERT/SELECT)
│   ├── integration-test-v3-evolution.sh # v3 catalog-level evolution harness
│   ├── integration-test-v3-dml.sh      # End-to-end v3 DML harness
│   ├── field_ids.py                    # Prints a metadata.json schema's field ids as path:id
│   ├── athena.sh                       # Sourced Athena helpers (run_athena, athena_expect)
│   ├── metadata.sh                     # Sourced metadata.json helpers (fetch_metadata, assert_partition_history, field_ids)
│   └── spark/
│       ├── install-spark.sh            # Downloads and sha512-verifies Spark + Iceberg jars
│       ├── spark-env.sh                # Pins, paths, and the spark_submit helper
│       ├── smoke.py                    # PySpark INSERT + count against the Glue catalog
│       ├── verify_dml.py               # PySpark engine steps for the DML harness, and the read of its Athena rows
│       ├── verify_evolution.py         # PySpark engine steps for the evolution harness
│       ├── verify_grants.py            # PySpark reads and writes under the surface harness's grantee roles
│       ├── verify_surface.py           # PySpark engine steps for the surface harness
│       └── verify_v3_dml.py            # PySpark engine steps for the v3 DML harness
├── e2e-consumer/                       # Standalone CDK app consuming the PUBLISHED package
│   ├── bin/app.ts
│   ├── lib/consumer-stack.ts           # Realistic consumer (one IcebergTable)
│   └── lib/surface-reference.ts        # Anchors every exported symbol so a rename breaks CI
├── docs/
│   ├── field-ids.md                    # What field ids are and the rule for not reusing them
│   ├── full-example.md                 # Full-surface TypeScript IcebergTable example and resulting metadata.json
│   ├── glue-behaviours.md              # Glue behaviours the integration suites assert, with the assertion for each
│   └── integ-test-setup.md             # AWS-side prerequisites for the integ-test workflow
├── cdk.json                            # CDK app config (app: bin/arceus.ts)
├── tsconfig.json                       # Demo-app tsconfig (used by ESLint and ts-node)
├── jest.config.js                      # Demo stack tests
├── eslint.config.js
└── .github/workflows/
    ├── ci.yml                          # Lint + test + jsii build + Python package + wheel smoke + pack + e2e-consumer + packed-consumer + peer-floor + release-policy
    ├── publish.yml                     # Trusted-publish the package to npm + PyPI on version bump, then tag and create the GitHub release
    ├── integ-gate.yml                  # Posts the integ-gate commit status on each PR to main
    └── integ-test.yml                  # Real-AWS Spark smoke + evolution/DML/surface tests (gated)
```

The demo stacks import the construct via a relative path into the
package source (`../packages/cdk-glue-iceberg-table/lib/iceberg`), so
`npm test` and `cdk synth` work without a prior package build. The
`e2e-consumer` app is not an npm workspace: it
installs `cdk-glue-iceberg-table` from npm (pinned in its own
`package-lock.json`) to prove the published artifact works for a
downstream consumer.

## Working in the monorepo

From the repo root:

```bash
npm install                 # installs the workspace (root + packages/*)
npm run build               # builds the published package (jsii)
npm run lint                # lints the package + the demo app
npm test                    # package unit tests + demo stack tests
npm run test:package        # package unit tests only
npm run test:demo           # demo stack tests only
```

Per-package commands also work directly:

```bash
npm run test --workspace cdk-glue-iceberg-table
cd packages/cdk-glue-iceberg-table && npm run build
```

Coverage is gated at 95% statements / branches / lines / functions on
the package's `lib/**/*.ts` (via `coverageThreshold.global` in
`packages/cdk-glue-iceberg-table/jest.config.js`) and on the demo
app's `lib/**/*.ts` (via the root `jest.config.js`).

## How the CI / publish / integ-test gates fit together

- **`ci.yml`** runs on every PR — lints, runs the package unit tests with the 95% coverage gate, builds with `jsii`, builds the Python distribution with `jsii-pacmak`, installs the wheel into a virtual environment and runs the README's Python examples against it with `test/python-smoke/smoke.py`, runs `npm pack` on the package, runs the `release-policy` check described under "Changelog lines and releases", synths the `e2e-consumer` app against the pinned published npm version, installs the PR's own `npm pack` tarball into the `packed-consumer` fixture and synthesizes it, and reruns the package unit tests with `aws-cdk-lib` and `constructs` installed at the package's declared peer floors.
- **`publish.yml`** runs on push to `main` and on manual dispatch. A `check` job compares the package version with npm and PyPI; when either differs, a `build` job with read-only permissions lints, tests, builds the npm tarball and the Python distribution, and uploads both as artifacts. `publish-npm` (npm OIDC trusted publishing, `--provenance`) and `publish-pypi` (PyPI OIDC trusted publishing) each run only when their own registry's version differs; only these two jobs hold `id-token: write`. Both declare the `release` environment. Publishing is limited to `main` only while that environment's deployment branches are limited to `main` (a repository setting) and the trusted publishers on npmjs.com and pypi.org name environment `release` (registry settings); neither registry binds a branch. A `github-release` job, the only one with `contents: write`, then creates a GitHub release whose notes are that version's section of `CHANGELOG.md`, with the tag `v<version>` on the commit the run built unless the tag exists; it runs only when the run published to at least one registry and every publish job that ran succeeded, and does nothing when the release already exists. A merge that leaves `version` alone runs `check` alone and publishes nothing, and a not-yet-configured PyPI trusted publisher never blocks the npm publish.
- **`integ-test.yml`** is the real-AWS gate. It installs the pinned Spark toolchain, runs `scripts/integration-test-spark-smoke.sh` (one deploy, then an INSERT and a count through Spark), and then runs five scripts back-to-back: `scripts/integration-test-evolution.sh` (twelve `cdk deploy`s exercising schema, partition, identifier and nested-field evolution, a property-only update, a sort order change, a rolled-back deploy, deploys after an engine `ALTER TABLE`, and a rename that replaces a table at its `location`, read through Spark and Athena after each), `scripts/integration-test-dml.sh` (one deploy, then UPDATE / DELETE / MERGE / time travel / compaction / snapshot expiry through Spark and then through Athena against a v2 merge-on-read table, with each engine reading the other's rows), `scripts/integration-test-surface.sh` (one deploy, then every partition transform, multi-field sort order, nested-type roundtrip through Spark and Athena, the field ids Glue stores at creation, and reads and writes through Spark and Athena as roles holding `grantRead` and `grantReadWrite`), `scripts/integration-test-v3-evolution.sh` (four `cdk deploy`s of a v3 table, asserted from `metadata.json`), and `scripts/integration-test-v3-dml.sh` (one deploy, then Spark DML, row lineage, and a v2→v3 upgrade against v3 tables). Gated by the `run-integ-test` label or a `/run-integ-test` collaborator comment. The paths that require a green run before merging are listed in `.github/integ-trigger-set.txt` (see [CLAUDE.md](CLAUDE.md) §"Integration test for construct-touching PRs").
- **`integ-gate.yml`** posts the `integ-gate` commit status on each PR to `main`; see [docs/integ-test-setup.md](docs/integ-test-setup.md).

## Changelog lines and releases

Leave `version` alone: a release pull request sets it. A file counts as
published when it is under `packages/cdk-glue-iceberg-table/lib/`, or is
the package's `README.md`, `LICENSE` or `package.json` (an edit confined
to `devDependencies` does not count). If your change touches one, add
one line under `## Unreleased` in [CHANGELOG.md](CHANGELOG.md), tagged
with the level of the change:

```
- (patch) Describe the change in a sentence a user of the package can act on
```

- `(patch)`: a bug fix, a doc-only change to a published file, or a refactor that leaves the public API alone.
- `(minor)`: an additive feature that does not break existing API.
- `(breaking)`: a change that breaks existing API. It also needs its upgrade note under `## Unreleased` in [UPGRADING.md](UPGRADING.md).

The `release-policy` job in `ci.yml` fails a pull request that changes a
published file with no line, or whose lines are not of that form. Run it
locally against the point your branch left `main`:

```bash
node .github/scripts/release-policy.js "$(git merge-base origin/main HEAD)" HEAD
```

The maintainer opens release pull requests, and merging one is what
publishes to npm and PyPI; [CLAUDE.md](CLAUDE.md) says what a release
edits and what follows it.

## Conditions for merging a pull request

A change goes to `main` through a pull request. The active `Protect main` repository ruleset enforces pull requests, blocks branch deletion and force-pushes, and requires the six status checks (`release-policy`, `build-test`, `e2e-consumer`, `packed-consumer`, `peer-floor`, and `integ-gate`) on `main`.

- The `ci.yml` jobs pass: `release-policy`, `build-test`, `e2e-consumer`, `packed-consumer` and `peer-floor`.
- A PR other than a release that changes the published package adds a changelog line under `## Unreleased` and leaves `version` alone.
- A breaking change in such a PR also adds a note to `UPGRADING.md` under `## Unreleased`.
- The `integ-gate` commit status on the PR head is `success`; [CLAUDE.md](CLAUDE.md) says when that needs an Integration test run.
- `README.md` and `packages/cdk-glue-iceberg-table/README.md` stay byte-identical.

After a release publishes, a follow-up PR moves `e2e-consumer` to the new version; [CLAUDE.md](CLAUDE.md) gives the steps.

## Demo app: prerequisites

Before running the quickstart you need:

1. AWS credentials in the default profile with permissions to manage
   CloudFormation, KMS, S3, Glue, Lake Formation, and IAM
   policies. `aws sts get-caller-identity` must return successfully.
2. `CDK_DEFAULT_ACCOUNT` and `CDK_DEFAULT_REGION` set in the
   environment (the AWS CLI sets these automatically for most
   profile setups; `cdk` also populates them from the active profile).
3. `PRINCIPAL_ARN` set to the **ARN of an existing IAM principal**
   in this account (IAM user, role, or federated identity). The
   stack adds that principal as a Lake Formation admin and grants
   it per-table `SELECT/INSERT/DELETE/ALTER/DESCRIBE` on the demo
   Iceberg tables. Without it the deploy fails when LF can't resolve
   the principal. The same ARN must also be the identity running
   `cdk deploy` and the Spark and Athena queries the integration scripts run. Local devs
   typically set this to their IAM user ARN; CI (`integ-test.yml`)
   sets it to the OIDC role ARN.
   - **Only one principal is privileged at a time.** `ArceusStack`
     writes the Lake Formation admin list with REPLACE semantics,
     so the most recent `cdk deploy` wins. A local `cdk deploy` with
     your user ARN revokes the OIDC role's LF grants (and breaks the
     next integ-test run until CI redeploys), and vice versa.
     Coordinate accordingly.
   - **SSO / `aws-vault` users:** set `PRINCIPAL_ARN` to the
     canonical role ARN (`arn:aws:iam::<acct>:role/<RoleName>`), not
     the per-session `arn:aws:sts::<acct>:assumed-role/...` you'd
     get from `aws sts get-caller-identity`. LF grants on the
     session-suffixed ARN go stale at the next SSO refresh.
4. The Lake Formation service-linked role
   `AWSServiceRoleForLakeFormationDataAccess` must exist in the
   account. Create it once with
   `aws iam create-service-linked-role --aws-service-name lakeformation.amazonaws.com`
   if you haven't already.
5. `cdk bootstrap aws://<account>/<region>` if the account hasn't
   been bootstrapped for CDK.
6. For the evolution, DML and surface scripts, the Athena prerequisites in
   [docs/integ-test-setup.md](docs/integ-test-setup.md).

## Demo app: quickstart

```bash
# PRINCIPAL_ARN is the ARN of the IAM principal (user, role, or
# federated identity) that the stack should make a Lake Formation
# admin and per-table grantee. It must equal the identity running
# `cdk deploy` and the Spark and Athena queries the integration scripts run —
# otherwise the integration script's INSERT/SELECT calls fail with
# `Principal does not have any privilege on specified resource`.
#
# For a direct IAM-user session, the line below returns the right ARN
# (`arn:aws:iam::<acct>:user/<name>`).
#
# For SSO / aws-vault / any assumed-role session this returns
# `arn:aws:sts::<acct>:assumed-role/<RoleName>/<SessionName>`, which
# Lake Formation accepts but stales on the next session refresh
# because the SessionName changes. Set PRINCIPAL_ARN to the canonical
# `arn:aws:iam::<acct>:role/<RoleName>` instead — for example:
#   export PRINCIPAL_ARN="arn:aws:iam::123456789012:role/MyDevRole"
export PRINCIPAL_ARN="$(aws sts get-caller-identity --query Arn --output text)"

npm install
npm test                                  # package + demo stack tests
npx cdk deploy ArceusStack --require-approval=never
scripts/spark/install-spark.sh               # Spark toolchain for the Spark checks between deploys
./scripts/integration-test-evolution.sh   # add + rename + drop + partition, identifier and nested-field change via cdk, deploys after an engine ALTER TABLE, a rename that replaces a table at its location, Spark checks between deploys
```

`cdk ls` will show seven stacks: `ArceusStack` (the demo data lake +
three Iceberg tables) and six test targets (`IcebergEvolutionStack`,
`IcebergDmlStack`, `IcebergSurfaceStack`, `IcebergSparkSmokeStack`,
`IcebergV3EvolutionStack`, `IcebergV3DmlStack`). Deploy only `ArceusStack` for the quickstart;
the test stacks are created on demand by their respective scripts under
`scripts/`.

## Demo tables (deployed by `ArceusStack`)

| Table | Format | Columns | Partitions | Sort | Notable properties |
| --- | --- | --- | --- | --- | --- |
| `orders` | parquet, v2 | `order_id(1)`, `customer_id(2)`, `order_amount(3)`, `currency(4)`, `placed_at(5)`, `tags(6)` (list), `shipping_address(7)` (struct), `metadata(8)` (map) | `day(placed_at)`, `bucket(16)(customer_id)` | `placed_at ASC NULLS LAST`, `order_id ASC` | `write.{delete,update,merge}.mode = merge-on-read`, `zstd`, `history.expire.min-snapshots-to-keep = 5`, identifier-field-ids = `[order_id]`, nested `list`/`struct`/`map` columns |
| `events` | parquet, v2 | `event_id(1)`, `event_name(2)`, `session_id(3)`, `occurred_at(4)`, `attributes(5)` (map) | `hour(occurred_at)` | (none) | high-cardinality hourly partitioning |
| `customers` | parquet, v2 | `customer_id(1)`, `email(2)`, `signed_up_at(4)`, `loyalty_tier(5)` (id 3 retired) | (none) | (none) | identifier-field-ids = `[customer_id]` — the stack's `customers` block carries inline comments narrating the schema-evolution journey that landed here (drop `full_name`, add `loyalty_tier`); the live evolution loop runs against the separate `IcebergEvolutionStack` |

After `cdk deploy ArceusStack`, the three tables are queryable from Spark or Athena.

## Spark toolchain

The Spark smoke check (`scripts/integration-test-spark-smoke.sh`) reads
and writes an Iceberg table with Apache Spark running on the CI runner.
Versions are pinned in
`scripts/spark/spark-env.sh` and checksums in
`scripts/spark/install-spark.sh`. To use it locally you need a JDK 17,
`python3`, `curl`, `tar`, `shasum`, the AWS CLI with credentials, and
about 700 MB of disk for the first download:

```bash
scripts/spark/install-spark.sh               # downloads into .spark/ (SPARK_INSTALL_DIR overrides), verifies sha512
DESTROY=1 scripts/integration-test-spark-smoke.sh   # destroys any leftover IcebergSparkSmokeStack, deploys it, runs smoke.py, tears down
```

The smoke script needs `PRINCIPAL_ARN` and a deployed `ArceusStack`;
without `DESTROY=1` it leaves the stack deployed.

## Demo: schema + partition evolution

`scripts/integration-test-evolution.sh` drives the
`IcebergEvolutionStack` through twelve `cdk deploy`s and verifies the
underlying Iceberg `metadata.json` after each, with Spark INSERT /
SELECT checks (`scripts/spark/verify_evolution.py`) between deploys.
After each step (and its Spark phase, where there is one), Athena reads
`evolution_test` or `nested_evolution_test`, whichever the step changed:
every row loaded so far, under the step's column names, with the values
Spark inserted, and after steps 1 and 6 the `(PK) ` column comments from
`information_schema.columns`; the paragraphs below describe the other
tables.

The stack owns twenty-two tables, and step 11 declares a twenty-third,
`table_input_test`, that fails to create. `evolution_test` changes in
steps 1 to 6 and 9 to 12. `nested_evolution_test` is created in step 1
and loaded with one row; steps 7 and 8 evolve it. Its baseline columns
are `id(1)`, `tags(2)` (list, element id 5), `attrs(3)` (map, key id 6,
value id 7) and `addr(4)` (struct: `line1(8)`, `city(9)`). The table
below describes `evolution_test` except where a row names the nested
table.

`reused_id_test` drops a column in step 2 and gives its id to a new
column in step 3; Spark and Athena read it after step 3.
`partition_id_test` adds a partition field in step 2 and another in
step 3; the script reads its `metadata.json` after each.
`parameter_name_test` takes its name from a parameter from step 9;
Athena reads it after step 9. Step 10 passes that parameter the value
`parameter_name_replaced_test`, which replaces the table at the same
`location`, and later steps keep the value; the script reads the
replacement's `metadata.json`, the stack's events and the objects under
the old table's `location`, and Athena reads the replacement after
step 10.
In step 2, `renumber_test` (declared out of creation order) and
`decimal_test` get a table property and `format_version_test` goes
from V2 to V3; the script reads their `metadata.json` after it;
Athena writes a row to `renumber_test` after step 1 and reads it after
step 2.
`create_partition_id_test` declares partition field id 1005 on its
first field and 1000 on its second and never changes; the script reads its `metadata.json` after step 1.
`drop_source_test` drops a column together with the partition field it
sources in step 2; `drop_source_later_test` removes that partition field
in step 2 and drops the column in step 3. `reused_partition_id_test`
gives partition field id 1000 to `bucket[8]` in step 2, after
`bucket[4]` held it. Athena writes a row to each of the three after step
1 and queries them after step 2, and `drop_source_later_test` again
after step 3; the queries of a drop table whose column is gone must
fail, and so must the Spark phase's read of `reused_partition_id_test`
in step 2.
`storage_columns_test` is a raw `CfnTable` with its columns under
`storageDescriptor.columns`; it gains a column in step 2, and the
Athena queries after that must fail.
`unmarked_identifier_test` and `unmarked_identifier_doc_test` are
created with an identifier and an override that removes the `(PK) `
marker, get the marker in step 2 and lose the identifier in step 3, the
second with a `doc` added to its other column; the script reads their
`metadata.json` after step 3.
After step 1, Athena writes a row to `engine_column_test`,
`engine_column_declared_test` and `engine_column_other_id_test`, adds a
column `w` with `ALTER TABLE ... ADD COLUMNS`, and writes a row with a
value in `w`; the script then reads the first's `metadata.json`. Step 2
declares `w` on the second under the id Athena gave it and on the third
under another id, and leaves the first unchanged; step 3 changes a
table property of the first without declaring `w`. After step 2 the
script reads the first's Glue version and the other two's
`metadata.json`, and Athena reads the other two; after step 3 the
script and Athena read the first.
The Spark phase after step 1 writes a row to `engine_upgrade_test` and
`engine_upgrade_v2_test` and upgrades both to v3. Step 2 sets the
first's `formatVersion` to `V3` and changes a table property of the
second; the script reads their `metadata.json` after it, and the Spark
phase writes a row to each and reads both rows back.
`v2_promotion_test` is created in step 1 with `int`, `float`, `decimal(10, 2)` and a `required: true` string column; Athena writes a row after step 1, step 2 widens the three numeric types (`long`, `double`, `decimal(12, 2)`) and relaxes the string column to `required: false`, the script checks `metadata.json`, and Athena inserts a widened row with `NULL` and reads both rows back.
`location_change_test` is created at `.../location_change_test/v1/` in step 1 and moves to `.../location_change_test/v2/` in step 2; Athena writes a row after step 1, the script checks `table-uuid`, `location`, and `metadata_location`, and that an Athena `INSERT` fails with `PERMISSION_DENIED` after step 2, the Spark phase inserts a second row under `v2` and reads both rows back, Athena `SELECT *` fails with `PERMISSION_DENIED` ([Glue behaviours](docs/glue-behaviours.md)), and the script checks that data files exist under both prefixes.

Install the Spark toolchain first (see "Spark toolchain" above); the script needs `PRINCIPAL_ARN`, a deployed `ArceusStack` and the Athena prerequisites, and leaves `IcebergEvolutionStack` deployed at the end unless `DESTROY=1` is set.

| Step | Change | Columns | Partitions | Spark phase after the deploy |
| ---: | --- | --- | --- | --- |
| 1 | Initial deploy | `customer_id(1)`, `email(2)`, `signed_up_at(3)` | `day(signed_up_at)` | seed INSERT of ids 10-12; `nested_evolution_test` created and loaded with id 100 (`tags` = `t1`, `t2`; `attrs` = `k1`→`v1`, `k2`→`v2`; `addr` = `L1`, `C1`) |
| 2 | **ADD** column `region(4)`; `spec-count` asserted | + `region(4)` | unchanged | old rows read with `region` NULL, then INSERT of id 13 with `region` |
| 3 | **RENAME** `email` → `contact_email` (id 2 preserved), **ADD** partition `bucket(8)(customer_id)` | rename | + `bucket(8)(customer_id)` | `contact_email` for id 10 is `a@example.com` |
| 4 | **DROP** column `region` (id 4 stays retired), **DROP** partition `bucket(8)(customer_id)`; `spec-count` and `default-spec-id` asserted | − `region` | − `customer_id_bucket` | at least 4 rows read |
| 5 | **CHANGE** the `signed_up_at` transform from day to month under fresh field id 1002; partition-history invariants asserted | unchanged | `month(signed_up_at)` | INSERT of id 14 under the month spec, at least 5 rows read |
| 6 | **CHANGE** `identifierFieldNames` from `customer_id` to `contact_email`; the current schema's `identifier-field-ids` and the `(PK) ` doc markers asserted | unchanged | unchanged | none |
| 7 | `nested_evolution_test`: **ADD** top-level column `note(10)` | + `note(10)` | none | id 100 read by name (struct fields, list elements, map entries) with `note` NULL, then INSERT of id 101 with `note`, both rows read |
| 8 | `nested_evolution_test`: **ADD** struct field `addr.zip(11)` between `line1` and `city` | `addr` = `line1(8)`, `zip(11)`, `city(9)` | none | ids 100 and 101 read by name with `addr.zip` NULL, then INSERT of id 102 with a zip, all three rows read |
| 9 | **CHANGE** table property `commit.retry.num-retries` to `5`; every other field the script reads from `metadata.json` asserted unchanged | unchanged | unchanged | none |
| 10 | **CHANGE** `sortOrder` from `customer_id` to `signed_up_at` descending, nulls first; `default-sort-order-id` 2 and order 1 still in `sort-orders` asserted | unchanged | unchanged | none |
| 11 | **ADD** column `country(5)` plus `table_input_test`, a raw `CfnTable` with `tableInput` beside `icebergTableInput` that fails to create after the table update, its failure reason asserted; `cdk deploy` must exit non-zero with the stack in `UPDATE_ROLLBACK_COMPLETE`, then the earlier `current-schema-id`, `last-column-id` 5 and one more entry in `schemas` asserted | unchanged after the rollback | unchanged | none |
| 12 | The step 11 change again, without the failing resource; the schema step 11 added becomes current | + `country(5)` | unchanged | none |

The construct passes each new column list + partition spec to Glue
`UpdateTable` via `OpenTableFormatInput`. Glue computes the Iceberg
metadata delta (new `schema-id`, new `spec-id`) and writes a new
`metadata.json`. Old data files stay readable because the field IDs
the construct pins (`id: N` on each `IcebergColumn`, and the nested
ids on struct fields, list elements, and map keys and values) never
change across deploys.

## Demo: DML, time travel, compaction, and snapshot expiry

`scripts/integration-test-dml.sh` covers the v2 surface that the
evolution test doesn't. The harness deploys `IcebergDmlStack` once,
then runs a sequence of Spark SQL statements (one PySpark program,
`scripts/spark/verify_dml.py`) against a v2 merge-on-read
table with `identifierFieldNames: ['account_id']`, then the Athena
sequence below on account ids above 10, and finally a second
`verify_dml.py` phase that reads the Athena rows through Spark.

Install the Spark toolchain first (see "Spark toolchain" above); the script needs `PRINCIPAL_ARN`, a deployed `ArceusStack` and the Athena prerequisites, and leaves `IcebergDmlStack` deployed unless `DESTROY=1` is set.

| Step | Statement | Verify |
| ---: | --- | --- |
| 1 | `INSERT` 5 seed rows | row count == 5 |
| 2 | `UPDATE balance WHERE account_id = 2` | balance == 250, row count == 5 |
| 3 | `DELETE WHERE account_id = 4` | row count == 4, account_id=4 gone |
| 4 | capture pre-MERGE snapshot id from `glue.sample_database.dml_test.snapshots` | — |
| 5 | `MERGE INTO ... USING ... ON account_id` (update id=3, insert id=6 + id=7) | row count == 6, id=3 balance updated, ids 6 and 7 present |
| 6 | `SELECT ... VERSION AS OF <pre-MERGE snapshot>` | time-travel still sees 4 rows, no id=6 |
| 7 | `CALL glue.system.rewrite_data_files(...)` | succeeds, row count unchanged |
| 8 | `CALL glue.system.expire_snapshots(...)` with a future `older_than` | snapshots reduced to the current one; 6 rows unchanged |
| 9 | final `SELECT` | 6 rows with the expected balances |

| Athena step | Statement | Verify |
| ---: | --- | --- |
| 1 | `SELECT` the rows Spark wrote, and `information_schema.columns` | the rows with emails, balances and timestamps; the `account_id` comment carries `(PK) ` |
| 2 | `INSERT`, `UPDATE`, then `DELETE` on ids above 10 | the ids above 10 after each statement |
| 3 | capture the latest snapshot id and commit time from `"dml_test$snapshots"` | — |
| 4 | `MERGE INTO` updating and inserting ids above 10 | the ids above 10 |
| 5 | `FOR VERSION AS OF` and `FOR TIMESTAMP AS OF` the pre-MERGE snapshot | the pre-MERGE rows |
| 6 | `OPTIMIZE ... REWRITE DATA USING BIN_PACK` | latest snapshot operation is `replace`; rows unchanged |
| 7 | `VACUUM` (the table sets a short `history.expire.max-snapshot-age-ms`) | older snapshots expired; rows unchanged |
| 8 | Spark reads ids above 10 | the rows Athena wrote, and the table's row count |

The smoke check and the five scripts run sequentially in the same `integ-test.yml` job.

## Demo: partition transforms, sort order, nested types, and grants

`scripts/integration-test-surface.sh` covers the slice of the
construct surface the evolution and DML stacks don't reach.
`IcebergSurfaceStack` defines five small tables that each isolate
one concern:

The script runs its engine steps through the Spark toolchain, so install it first with `scripts/spark/install-spark.sh` (see "Spark toolchain" above), and reads `transforms_test` and `nested_test` back through Athena (see the Athena prerequisites above).

| Concern | Table | What the script checks |
| --- | --- | --- |
| **Every partition transform** | `transforms_test` (separate `year_source` / `month_source` / `day_source` / `hour_source` timestamps to avoid Iceberg's redundant-temporal-transform rejection, plus `user_id` / `email` / `value`) | `metadata.json` contains all seven transforms (`year`, `month`, `day`, `hour`, `bucket[8]`, `truncate[4]`, `identity`); INSERT one row, verify the resulting S3 prefix contains the expected multi-transform layout (`year_source_year=...`, `month_source_month=...`, etc.), and read the row back through Athena |
| **Sort order** | `sorted_test` (`tenant`, `created_at`, `amount`; its name is the `SortedTableName` parameter, default `sorted_test`) | `metadata.json`'s `sort-orders` block has three fields with the expected direction + null-order pairs: `asc/nulls-first`, `desc/nulls-last`, `desc/nulls-last` |
| **Nested types** | `nested_test` (`tags` list, `profile` struct, `attrs` map) | Spark INSERTs two rows using `array(...)`, `named_struct(...)`, and `map(...)`. SELECT verifies `tags[0]`, `profile.first_name`, and `attrs['tier']` all roundtrip correctly; Athena reads both rows' list lengths and first elements, struct fields, and map values |
| **Field ids at creation** | `transforms_test`, `sorted_test`, `nested_test`, and `creation_order_test` (nested columns declared with ids out of creation order) | The first three store the ids their template declares; `creation_order_test` stores the creation-order ids instead |
| **Grants at runtime** | `grants_test`, with `encryptionKey` set to the data-lake bucket's key; `ReaderRole` holds `grantRead` on it and `ReadWriterRole` holds `grantReadWrite` on an imported handle of it, both with the catalog key and Lake Formation data access | The script reads the two key ARNs from the account and passes them as the `DataLakeKeyArn` and `CatalogKeyArn` stack parameters. Besides its grant, each role holds Lake Formation permissions on the table and an Athena query policy. As `ReadWriterRole`: INSERT one row through Spark and one through Athena. As `ReaderRole`: read both rows through Spark and Athena, and be denied `glue:UpdateTable` and an S3 write under the table's prefix. Under each role, `s3:ListBucket` on the table's prefix succeeds and on a foreign prefix is denied |

## Demo: v3 evolution

`scripts/integration-test-v3-evolution.sh` drives `IcebergV3EvolutionStack`
(`--context v3EvolutionStep=N`) through four `cdk deploy`s and asserts
`metadata.json` after each, with no engine step, because upstream Spark cannot open a table that has
nanosecond timestamp columns. Step 1 creates `timestamp_ns`, `timestamptz_ns`,
`unknown`, and `date` columns with `day(occurred_at)`; step 2 adds
`source` and `hour(received_at)`; step 3 promotes `raw` to `string` and
`event_date` to `timestamp` (original ids, new schema id); step 4
replaces the day partition with `month(occurred_at)` under a fresh field
id. Each step checks `format-version`, `next-row-id`, the exact
`(id, name, type)` columns, the exact `(field-id, transform)`
partitions, and the partition-spec history invariants. Run it like the other suites:
`PRINCIPAL_ARN` set, `ArceusStack` deployed with the same principal, then
`DESTROY=1 scripts/integration-test-v3-evolution.sh`.

## Demo: v3 DML (deletion vectors, row lineage, variant, v2 to v3 upgrade, geo columns)

`IcebergV3DmlStack` deploys `v3_dml_test` (v3, merge-on-read), `v3_upgrade_test` (v2) and `v3_geo_test` (v3, geometry and geography columns).
`scripts/integration-test-v3-dml.sh` checks deletion vectors, row lineage, variant, MERGE, time travel, compaction, snapshot expiry and the v2→v3 upgrade through Spark, and the format versions and `next-row-id` on `v3_dml_test`, plus the columns of `v3_geo_test` that no Spark job opens, from `metadata.json`.
Install the Spark toolchain first (see "Spark toolchain" above); with `PRINCIPAL_ARN` set and `ArceusStack` deployed with the same principal, run `DESTROY=1 scripts/integration-test-v3-dml.sh` (without `DESTROY=1` it leaves `IcebergV3DmlStack` deployed).

## The e2e-consumer app

`e2e-consumer/` is a standalone CDK app that depends on the
**published** `cdk-glue-iceberg-table` from npm (not the workspace
copy). It proves that a fresh install + import + `cdk synth` works for
downstream consumers. It runs on every PR via the `e2e-consumer` job
in `.github/workflows/ci.yml`. Its `lib/surface-reference.ts` touches
every exported symbol so that a rename in the published surface breaks
CI. The pin in `e2e-consumer/package-lock.json` tracks the version
most recently published to npm; [CLAUDE.md](CLAUDE.md) asks for it to
be bumped after each release.

## The packed-consumer fixture

`packages/cdk-glue-iceberg-table/test/packed-consumer/` is a small CDK
app that imports the package through its public entry point; the
`packed-consumer` job in `.github/workflows/ci.yml` installs the PR's
`npm pack` tarball into a copy of it. The fixture changes with the API
in the same PR, so it always compiles against the PR; `e2e-consumer/`
stays the check against the published version.
