# Contributing to arceus

This repo develops [`cdk-glue-iceberg-table`](https://www.npmjs.com/package/cdk-glue-iceberg-table)
in an npm-workspace monorepo. Consumer documentation — install, API
reference, the two footguns, known limitations, and the FAQ — lives in
the [README](README.md). This file covers the monorepo layout, how to
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
│       │   ├── iceberg-table-grants.ts
│       │   ├── iceberg-table-render.ts
│       │   └── index.ts                # Re-exports (the package's entry point)
│       ├── test/iceberg/               # Unit tests for the construct
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
│   └── spark/
│       ├── install-spark.sh            # Downloads and sha512-verifies Spark + Iceberg jars
│       ├── spark-env.sh                # Pins, paths, and the spark_submit helper
│       ├── smoke.py                    # PySpark INSERT + count against the Glue catalog
│       ├── verify_dml.py               # PySpark engine steps for the DML harness
│       ├── verify_evolution.py         # PySpark engine steps for the evolution harness
│       ├── verify_surface.py           # PySpark engine steps for the surface harness
│       └── verify_v3_dml.py            # PySpark engine steps for the v3 DML harness
├── e2e-consumer/                       # Standalone CDK app consuming the PUBLISHED package
│   ├── bin/app.ts
│   ├── lib/consumer-stack.ts           # Realistic consumer (one IcebergTable)
│   └── lib/surface-reference.ts        # Anchors every exported symbol so a rename breaks CI
├── docs/
│   └── integ-test-setup.md             # AWS-side prerequisites for the integ-test workflow
├── cdk.json                            # CDK app config (app: bin/arceus.ts)
├── tsconfig.json                       # Demo-app tsconfig (used by ESLint and ts-node)
├── jest.config.js                      # Demo stack tests
├── eslint.config.js
└── .github/workflows/
    ├── ci.yml                          # Lint + test + jsii build + Python package + pack + e2e-consumer
    ├── publish.yml                     # Trusted-publish the package to npm + PyPI on version bump
    └── integ-test.yml                  # Real-AWS Spark smoke + evolution/DML/surface tests (gated)
```

The demo stacks import the construct via a relative path into the
package source (`../packages/cdk-glue-iceberg-table/lib/iceberg`), so
`npm test` and `cdk synth` work without a prior package build. The
`e2e-consumer` app is intentionally **not** an npm workspace: it
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

- **`ci.yml`** runs on every PR — lints, runs the package unit tests with the 95% coverage gate, builds with `jsii`, builds the Python distribution with `jsii-pacmak`, runs `npm pack` on the package, and synths the `e2e-consumer` app against the pinned published npm version.
- **`publish.yml`** runs on push to `main` — trusted-publishes the `packages/cdk-glue-iceberg-table` package to **npm** (via npm OIDC trusted publishing, `--provenance`) and to **PyPI** (via PyPI OIDC trusted publishing, the wheel built with `jsii-pacmak -t python`). Each publish is gated independently on its own version-vs-registry check, so a PR that forgets to bump becomes a no-op and a not-yet-configured PyPI trusted publisher never blocks the npm publish.
- **`integ-test.yml`** is the real-AWS gate. It installs the pinned Spark toolchain, runs `scripts/integration-test-spark-smoke.sh` (one deploy, then an INSERT and a count through Spark), and then runs five scripts back-to-back: `scripts/integration-test-evolution.sh` (five `cdk deploy`s exercising schema + partition evolution), `scripts/integration-test-dml.sh` (one deploy, then UPDATE / DELETE / MERGE / time travel / compaction / snapshot expiry through Spark against a v2 merge-on-read table), `scripts/integration-test-surface.sh` (one deploy, then every partition transform, multi-field sort order, nested-type roundtrip, and `grantRead` at runtime via assume-role + direct Glue/S3 calls), `scripts/integration-test-v3-evolution.sh` (four `cdk deploy`s of a v3 table, asserted from `metadata.json`), and `scripts/integration-test-v3-dml.sh` (one deploy, then Spark DML, row lineage, and a v2→v3 upgrade against v3 tables). Gated by the `run-integ-test` label or a `/run-integ-test` collaborator comment. PRs that touch the construct, `bin/arceus.ts`, `cdk.json`, or any of the scripts must show a green run before merging (see [CLAUDE.md](CLAUDE.md) §"Integration test for construct-touching PRs"). Doc-only PRs are exempt.

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
   `cdk deploy` and the Spark queries the integration scripts run. Local devs
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

## Demo app: quickstart

```bash
# PRINCIPAL_ARN is the ARN of the IAM principal (user, role, or
# federated identity) that the stack should make a Lake Formation
# admin and per-table grantee. It must equal the identity running
# `cdk deploy` and the Spark queries the integration scripts run —
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
./scripts/integration-test-evolution.sh   # add + rename + drop + partition change via cdk, Spark checks between deploys
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
`IcebergEvolutionStack` through five `cdk deploy`s and verifies the
underlying Iceberg `metadata.json` after each, with Spark INSERT / SELECT
checks (`scripts/spark/verify_evolution.py`) between deploys.

Install the Spark toolchain first (see "Spark toolchain" above); the script needs `PRINCIPAL_ARN` and a deployed `ArceusStack`, and leaves `IcebergEvolutionStack` deployed at the end unless `DESTROY=1` is set.

| Step | Change | Columns | Partitions | Spark phase after the deploy |
| ---: | --- | --- | --- | --- |
| 1 | Initial deploy | `customer_id(1)`, `email(2)`, `signed_up_at(3)` | `day(signed_up_at)` | seed INSERT of ids 10-12 |
| 2 | **ADD** column `region(4)` | + `region(4)` | unchanged | old rows read with `region` NULL, then INSERT of id 13 with `region` |
| 3 | **RENAME** `email` → `contact_email` (id 2 preserved), **ADD** partition `bucket(8)(customer_id)` | rename | + `bucket(8)(customer_id)` | `contact_email` for id 10 is `a@example.com` |
| 4 | **DROP** column `region` (id 4 stays retired), **DROP** partition `bucket(8)(customer_id)` | − `region` | − `customer_id_bucket` | at least 4 rows read |
| 5 | **CHANGE** the `signed_up_at` transform from day to month under fresh field id 1002; partition-history invariants asserted | unchanged | `month(signed_up_at)` | INSERT of id 14 under the month spec, at least 5 rows read |

The construct passes each new column list + partition spec to Glue
`UpdateTable` via `OpenTableFormatInput`. Glue computes the Iceberg
metadata delta (new `schema-id`, new `spec-id`) and writes a new
`metadata.json`. Old data files stay readable because the field IDs
the construct pins (`id: N` on each `IcebergColumn`) never change
across deploys.

## Demo: DML, time travel, compaction, and snapshot expiry

`scripts/integration-test-dml.sh` covers the v2 surface that the
evolution test doesn't. The harness deploys `IcebergDmlStack` once,
then runs a sequence of Spark SQL statements (one PySpark program,
`scripts/spark/verify_dml.py`) against a v2 merge-on-read
table with `identifierFieldNames: ['account_id']`.

Install the Spark toolchain first (see "Spark toolchain" above); the script needs `PRINCIPAL_ARN` and a deployed `ArceusStack`, and leaves `IcebergDmlStack` deployed unless `DESTROY=1` is set.

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

The smoke check and the five scripts run sequentially in the same `integ-test.yml`
job; evolution takes ~4 minutes, DML ~3, surface ~4, v3 evolution ~3, and v3 DML ~2.

## Demo: partition transforms, sort order, nested types, and grants

`scripts/integration-test-surface.sh` covers the slice of the
construct surface the evolution and DML stacks don't reach.
`IcebergSurfaceStack` defines three small tables that each isolate
one concern:

The script runs its engine steps through the Spark toolchain, so install it first with `scripts/spark/install-spark.sh` (see "Spark toolchain" above).

| Concern | Table | What the script checks |
| --- | --- | --- |
| **Every partition transform** | `transforms_test` (separate `year_source` / `month_source` / `day_source` / `hour_source` timestamps to avoid Iceberg's redundant-temporal-transform rejection, plus `user_id` / `email` / `value`) | `metadata.json` contains all seven transforms (`year`, `month`, `day`, `hour`, `bucket[8]`, `truncate[4]`, `identity`); INSERT one row and verify the resulting S3 prefix contains the expected multi-transform layout (`year_source_year=...`, `month_source_month=...`, etc.) |
| **Sort order** | `sorted_test` (`tenant`, `created_at`, `amount`) | `metadata.json`'s `sort-orders` block has three fields with the expected direction + null-order pairs: `asc/nulls-first`, `desc/nulls-last`, `desc/nulls-last` |
| **Nested types** | `nested_test` (`tags` list, `profile` struct, `attrs` map) | Spark INSERTs two rows using `array(...)`, `named_struct(...)`, and `map(...)`. SELECT verifies `tags[0]`, `profile.first_name`, and `attrs['tier']` all roundtrip correctly |
| **`grantRead` S3 statements at runtime** | `transforms_test` + a `GranteeRole` trusted by the deployer | Assume the role and call S3 directly (Lake Formation doesn't gate S3 calls when the bucket is registered with `hybridAccessEnabled: true`, so the IAM grants the construct produces are what's being tested). `s3:ListBucket` on the table's own prefix succeeds. `s3:ListBucket` on a foreign table's prefix is denied — the `s3:prefix` condition kicks in. The Glue action grants are validated by the unit tests, not at runtime, because LF gates `glue:*` against tables in LF-registered locations regardless of the principal's IAM policy |
| **`fromIcebergTableAttributes(...)` + `grantRead`** | imported handle on `transforms_test` + a second `ImportedGranteeRole` | Same S3 checks under the import-factory grantee. Verifies the import path produces a symmetric IAM split |

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

## Demo: v3 DML (deletion vectors, row lineage, variant, geo, v2 to v3 upgrade)

`IcebergV3DmlStack` deploys `v3_dml_test` (v3, merge-on-read) and `v3_upgrade_test` (v2).
`scripts/integration-test-v3-dml.sh` checks deletion vectors, row lineage, variant, geo, MERGE, time travel, compaction, snapshot expiry and the v2→v3 upgrade through Spark, and the format versions and `next-row-id` on `v3_dml_test` from `metadata.json`.
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
