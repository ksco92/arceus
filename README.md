# cdk-glue-iceberg-table

[![CI](https://img.shields.io/github/actions/workflow/status/ksco92/arceus/ci.yml?branch=main&label=CI)](https://github.com/ksco92/arceus/actions/workflows/ci.yml)
[![coverage](https://codecov.io/gh/ksco92/arceus/branch/main/graph/badge.svg)](https://codecov.io/gh/ksco92/arceus)
[![npm](https://img.shields.io/npm/v/cdk-glue-iceberg-table.svg)](https://www.npmjs.com/package/cdk-glue-iceberg-table)
[![types](https://img.shields.io/npm/types/cdk-glue-iceberg-table.svg)](https://www.npmjs.com/package/cdk-glue-iceberg-table)
[![downloads](https://img.shields.io/npm/dw/cdk-glue-iceberg-table.svg)](https://www.npmjs.com/package/cdk-glue-iceberg-table)
[![last commit](https://img.shields.io/github/last-commit/ksco92/arceus.svg)](https://github.com/ksco92/arceus/commits/main)
[![license](https://img.shields.io/npm/l/cdk-glue-iceberg-table.svg)](LICENSE)

A CDK L2 construct for Apache Iceberg tables in the AWS Glue Data
Catalog. Emits the `AWS::Glue::Table` shape that survives
CloudFormation `Update`, so `cdk deploy` can create, evolve, and
destroy Iceberg tables the same way it handles any other resource.

The motivating issue is [aws/aws-cdk#29660](https://github.com/aws/aws-cdk/issues/29660);
[`manmartgarc`'s comment](https://github.com/aws/aws-cdk/issues/29660#issuecomment-4411359248)
documents the only working CFN shape and the silent-corruption traps
you can hit by getting it slightly wrong. This construct implements
that shape and refuses to emit the unsafe alternatives.

The upstream CDK PR landing this construct in
`@aws-cdk/aws-glue-alpha` is [aws/aws-cdk#37988](https://github.com/aws/aws-cdk/pull/37988).
Until that merges, this package is the most current reference
implementation. Once `@aws-cdk/aws-glue-alpha` ships its own
`IcebergTable`, prefer the official one and treat this package as a
stopgap.

## Install

```bash
npm install cdk-glue-iceberg-table
```

Peer dependencies (your CDK app must already have these):

```bash
npm install aws-cdk-lib constructs @aws-cdk/aws-glue-alpha
```

## Use

```ts
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Database } from '@aws-cdk/aws-glue-alpha';
import {
    IcebergTable,
    IcebergType,
    IcebergPartitionTransform,
} from 'cdk-glue-iceberg-table';

const bucket = new Bucket(this, 'Warehouse');
const db = new Database(this, 'Db', { databaseName: 'analytics' });

new IcebergTable(this, 'OrdersTable', {
    database: db,
    tableName: 'orders',
    location: `s3://${bucket.bucketName}/analytics/orders/`,
    columns: [
        { name: 'order_id',    type: IcebergType.LONG,        required: true, id: 1 },
        { name: 'customer_id', type: IcebergType.LONG,        required: true, id: 2 },
        { name: 'placed_at',   type: IcebergType.TIMESTAMPTZ, required: true, id: 3 },
    ],
    partitionSpec: [
        { sourceColumn: 'placed_at',   transform: IcebergPartitionTransform.DAY },
        { sourceColumn: 'customer_id', transform: IcebergPartitionTransform.bucket(16) },
    ],
    identifierFieldNames: ['order_id'],
});
```

Consumer-facing reference sections below:

- [Using `IcebergTable`](#using-icebergtable) — full API reference with examples.
- [Two footguns the construct prevents](#two-footguns-the-construct-prevents) — the silent-corruption traps that motivated this construct.
- [Known limitations](#known-limitations) — what the construct does and doesn't enforce.

## Repo layout

This repo is **both** the published package and a CDK demo app:

- `lib/iceberg/` — the published package (`cdk-glue-iceberg-table` on npm).
- `lib/arceus-stack.ts`, `lib/iceberg-evolution-stack.ts`, `lib/iceberg-dml-stack.ts`, `lib/iceberg-surface-stack.ts`, `bin/`, `scripts/` — a CDK app that dogfoods the construct against a real AWS account, plus three bash harnesses: one drives schema + partition evolution through real `cdk deploy`s, one exercises the v2 DML surface (UPDATE / DELETE / MERGE / time travel / OPTIMIZE / VACUUM), and one covers the remaining surface (every partition transform, multi-field sort order, list / struct / map columns, and `grantRead` at runtime by assuming the grantee role and calling Glue / S3 directly). **Repo-only, not published to npm.**
- `e2e-consumer/` — a standalone CDK app that depends on the **published** `cdk-glue-iceberg-table` from npm. Proves that a fresh install + import + `cdk synth` works for downstream consumers. Runs on every PR via the `e2e-consumer` job in `.github/workflows/ci.yml`. Its `lib/surface-reference.ts` touches every exported symbol so that a rename in the published surface breaks CI. The pin in `e2e-consumer/package-lock.json` tracks the version most recently published to npm; CLAUDE.md asks for it to be bumped after each release.

How the test gates fit together:

- **`ci.yml`** runs on every PR — lint, unit tests with the 95% coverage gate, `npm pack`, and the `e2e-consumer` synth against the pinned published npm version.
- **`integ-test.yml`** is the real-AWS gate. Runs three scripts back-to-back: `scripts/integration-test-evolution.sh` (four `cdk deploy`s exercising schema + partition evolution), `scripts/integration-test-dml.sh` (one deploy, then UPDATE / DELETE / MERGE / time travel / OPTIMIZE / VACUUM against a v2 merge-on-read table), and `scripts/integration-test-surface.sh` (one deploy, then every partition transform, multi-field sort order, nested-type roundtrip, and `grantRead` at runtime via assume-role + direct Glue/S3 calls). Gated by `run-integ-test` label or `/run-integ-test` collaborator comment. PRs that touch any file under `lib/`, `bin/arceus.ts`, `cdk.json`, or any of the scripts must show a green run before merging (see CLAUDE.md §"Integration test for construct-touching PRs"). Doc-only PRs are exempt.
- **`publish.yml`** runs on push to `main` — trusted-publish to npm when `package.json`'s `version` is newer than the registry.

The sections [Prerequisites](#prerequisites), [Quickstart](#quickstart),
[Demo tables](#demo-tables-deployed-by-arceusstack), and
[Schema + partition evolution](#schema--partition-evolution-via-cdk-only)
cover the demo app. Skip them if you only want to consume the construct.

## Prerequisites

Before running the quickstart you need:

1. AWS credentials in the default profile with permissions to manage
   CloudFormation, KMS, S3, Glue, Lake Formation, Athena, and IAM
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
   `cdk deploy` and any subsequent Athena queries. Local devs
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

## What's in the repo

Repo source paths (npm consumers import from the package root and get the same exports under `dist/lib/iceberg/`):

- **`lib/iceberg/iceberg-table.ts`**: the `IcebergTable` L2 construct.
- **`lib/iceberg/iceberg-type.ts`**: `IcebergType` with primitives + `list` / `map` / `struct` factories. Renders to the JSON shape Glue's `IcebergStructField.type` expects.
- **`lib/iceberg/iceberg-partition-transform.ts`**: `IcebergPartitionTransform` (identity / bucket(N) / truncate(W) / year / month / day / hour / void). Each transform validates against the source column type at synth time.
- **`lib/iceberg/iceberg-table-properties.ts`**: `IcebergDataFormat` (parquet/orc/avro, default parquet), `IcebergFormatVersion` (v1/v2, required — set explicitly per table), and a validator that catches misconfigured `tableProperties` before they leave your machine (wrong codec for the chosen format, `merge-on-read` on a v1 table, non-positive numeric values, …).
- **`lib/arceus-stack.ts`**: the demo stack: KMS-encrypted data lake bucket, Athena results bucket, Glue database, three demo Iceberg tables (`orders`, `events`, `customers`). Repo-only, not in the npm tarball.
- **`lib/iceberg-evolution-stack.ts`** + **`scripts/integration-test-evolution.sh`**: a parameterized stack and a bash harness that drives four real `cdk deploy`s to prove schema/partition evolution works end-to-end. Repo-only, not in the npm tarball.
- **`lib/iceberg-dml-stack.ts`** + **`scripts/integration-test-dml.sh`**: a v2 merge-on-read table and a bash harness that exercises UPDATE, DELETE, MERGE INTO (upsert), time-travel SELECT, OPTIMIZE compaction, and VACUUM snapshot expiration. Single deploy, ~3 minutes. Repo-only, not in the npm tarball.
- **`lib/iceberg-surface-stack.ts`** + **`scripts/integration-test-surface.sh`**: three tables (one per concern) and a harness that verifies every partition transform renders the right `metadata.json`, a three-field sort order with mixed direction + null ordering, list/struct/map columns roundtrip through Athena, and `grantRead`'s four-statement IAM split actually authorizes (and denies cross-prefix) at runtime under an assumed grantee role. The same checks run against `IcebergTable.fromIcebergTableAttributes(...)` to prove the import factory's grant path is symmetric with the native one. Single deploy, ~4 minutes. Repo-only, not in the npm tarball.

## Quickstart

```bash
# PRINCIPAL_ARN is the ARN of the IAM principal (user, role, or
# federated identity) that the stack should make a Lake Formation
# admin and per-table grantee. It must equal the identity running
# `cdk deploy` and any subsequent Athena queries — otherwise the
# integration script's INSERT/SELECT calls fail with `Principal does
# not have any privilege on specified resource`.
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
npx jest                         # runs the suite; coverage floor in jest.config.js
npx cdk deploy ArceusStack --require-approval=never
./scripts/integration-test-evolution.sh   # add + rename + drop, via cdk only
```

`cdk ls` will show four stacks: `ArceusStack` (the demo data lake +
three Iceberg tables), `IcebergEvolutionStack` (the evolution test
target), `IcebergDmlStack` (the DML test target), and
`IcebergSurfaceStack` (the transforms / sort / nested-types /
grants test target). Deploy only `ArceusStack` for the quickstart;
the three test stacks are created on demand by their respective
scripts under `scripts/`.

## Using `IcebergTable`

A minimal table:

```typescript
import {
    Database,
} from '@aws-cdk/aws-glue-alpha';
import {
    IcebergTable,
    IcebergType,
} from 'cdk-glue-iceberg-table';

const db = new Database(this, 'Db', {
    databaseName: 'analytics',
});

new IcebergTable(this, 'Users', {
    database: db,
    tableName: 'users',
    columns: [
        {
            name: 'user_id',
            type: IcebergType.LONG,
            required: true,
            id: 1,
        },
        {
            name: 'email',
            type: IcebergType.STRING,
            required: true,
            id: 2,
        },
        {
            name: 'signed_up_at',
            type: IcebergType.TIMESTAMPTZ,
            required: true,
            id: 3,
        },
    ],
    location: `s3://${bucket.bucketName}/analytics/users/`,
});
```

A table that exercises most of the surface (partitions, sort order,
nested types, identifier fields, table properties, removal policy).
This is the exact shape `ArceusStack` uses for the `orders` demo
table, so the column list / partition spec / properties round-trip
straight to the live metadata.json below.

```typescript
import {
    RemovalPolicy,
} from 'aws-cdk-lib';
import {
    Database,
} from '@aws-cdk/aws-glue-alpha';
import {
    IcebergDataFormat,
    IcebergFormatVersion,
    IcebergNullOrder,
    IcebergPartitionTransform,
    IcebergSortDirection,
    IcebergTable,
    IcebergType,
} from 'cdk-glue-iceberg-table';

new IcebergTable(this, 'OrdersTable', {
    database: db,
    tableName: 'orders',
    comment: 'Demo Iceberg orders table — exercises partitions, sort order, and merge-on-read.',
    columns: [
        {
            name: 'order_id',
            type: IcebergType.LONG,
            required: true,
            id: 1,
        },
        {
            name: 'customer_id',
            type: IcebergType.LONG,
            required: true,
            id: 2,
        },
        {
            name: 'order_amount',
            type: IcebergType.decimal(12, 2),
            required: true,
            id: 3,
        },
        {
            name: 'currency',
            type: IcebergType.STRING,
            required: true,
            id: 4,
        },
        {
            name: 'placed_at',
            type: IcebergType.TIMESTAMPTZ,
            required: true,
            id: 5,
        },
        {
            name: 'tags',
            type: IcebergType.list(IcebergType.STRING),
            id: 6,
        },
        {
            name: 'shipping_address',
            type: IcebergType.struct([
                {
                    name: 'line1',
                    type: IcebergType.STRING,
                    required: true,
                },
                {
                    name: 'city',
                    type: IcebergType.STRING,
                    required: true,
                },
                {
                    name: 'country',
                    type: IcebergType.STRING,
                    required: true,
                },
                {
                    name: 'postal_code',
                    type: IcebergType.STRING,
                },
            ]),
            id: 7,
        },
        {
            name: 'metadata',
            type: IcebergType.map(IcebergType.STRING, IcebergType.STRING, false),
            id: 8,
        },
    ],
    location: `s3://${bucket.bucketName}/analytics/orders/`,
    partitionSpec: [
        {
            sourceColumn: 'placed_at',
            transform: IcebergPartitionTransform.DAY,
        },
        {
            sourceColumn: 'customer_id',
            transform: IcebergPartitionTransform.bucket(16),
        },
    ],
    sortOrder: [
        {
            sourceColumn: 'placed_at',
            direction: IcebergSortDirection.ASC,
            nullOrder: IcebergNullOrder.NULLS_LAST,
        },
        {
            sourceColumn: 'order_id',
            direction: IcebergSortDirection.ASC,
        },
    ],
    identifierFieldNames: [
        'order_id',
    ],
    dataFormat: IcebergDataFormat.PARQUET,
    formatVersion: IcebergFormatVersion.V2,
    tableProperties: {
        'write.parquet.compression-codec': 'zstd',
        'write.delete.mode': 'merge-on-read',
        'write.update.mode': 'merge-on-read',
        'write.merge.mode': 'merge-on-read',
        'write.target-file-size-bytes': '134217728',
        'history.expire.min-snapshots-to-keep': '5',
        'gc.enabled': 'true',
    },
    removalPolicy: RemovalPolicy.DESTROY,
});
```

### Granting access

```typescript
table.grantRead(role);        // Glue read + S3 read on the table's prefix
table.grantWrite(role);       // Glue write + S3 write
table.grantReadWrite(role);
```

### Importing an existing table

```typescript
const existing = IcebergTable.fromIcebergTableAttributes(this, 'Orders', {
    database: db,
    tableName: 'orders',
    location: 's3://my-bucket/analytics/orders/',
});
existing.grantRead(role);
```

## Demo tables (deployed by `ArceusStack`)

| Table | Format | Columns | Partitions | Sort | Notable properties |
| --- | --- | --- | --- | --- | --- |
| `orders` | parquet, v2 | `order_id(1)`, `customer_id(2)`, `order_amount(3)`, `currency(4)`, `placed_at(5)`, `tags(6)` (list), `shipping_address(7)` (struct), `metadata(8)` (map) | `day(placed_at)`, `bucket(16)(customer_id)` | `placed_at ASC NULLS LAST`, `order_id ASC` | `write.{delete,update,merge}.mode = merge-on-read`, `zstd`, `history.expire.min-snapshots-to-keep = 5`, identifier-field-ids = `[order_id]`, nested `list`/`struct`/`map` columns |
| `events` | parquet, v2 | `event_id(1)`, `event_name(2)`, `session_id(3)`, `occurred_at(4)`, `attributes(5)` (map) | `hour(occurred_at)` | (none) | high-cardinality hourly partitioning |
| `customers` | parquet, v2 | `customer_id(1)`, `email(2)`, `signed_up_at(4)`, `loyalty_tier(5)` (id 3 retired) | (none) | (none) | identifier-field-ids = `[customer_id]` — the stack's `customers` block carries inline comments narrating the schema-evolution journey that landed here (drop `full_name`, add `loyalty_tier`); the live evolution loop runs against the separate `IcebergEvolutionStack` |

After `cdk deploy ArceusStack`, the three tables are queryable from Athena (workgroup `ReadOnly`).

### Validating the demo

`SHOW TBLPROPERTIES sample_database.orders` returns:

```
format                              parquet
write_compression                   zstd
write_target_data_file_size_bytes   134217728
vacuum_min_snapshots_to_keep        5
```

The Iceberg `metadata.json` for `orders` contains every feature you set:

```json
{
  "format-version": 2,
  "table-uuid": "39a948f9-...",
  "current-schema-id": 0,
  "schemas": [
    {
      "schema-id": 0,
      "identifier-field-ids": [1],
      "fields": [
        { "id": 1, "name": "order_id", "required": true, "type": "long" },
        { "id": 2, "name": "customer_id", "required": true, "type": "long" },
        { "id": 3, "name": "order_amount", "required": true, "type": "decimal(12, 2)" },
        { "id": 4, "name": "currency", "required": true, "type": "string" },
        { "id": 5, "name": "placed_at", "required": true, "type": "timestamptz" },
        { "id": 6, "name": "tags", "required": false,
          "type": { "type": "list", "element-id": 9, "element": "string", "element-required": true } },
        { "id": 7, "name": "shipping_address", "required": false,
          "type": { "type": "struct", "fields": [
            { "id": 10, "name": "line1", "required": true, "type": "string" },
            { "id": 11, "name": "city", "required": true, "type": "string" },
            { "id": 12, "name": "country", "required": true, "type": "string" },
            { "id": 13, "name": "postal_code", "required": false, "type": "string" }
          ] } },
        { "id": 8, "name": "metadata", "required": false,
          "type": { "type": "map", "key-id": 14, "key": "string", "value-id": 15,
                    "value-required": false, "value": "string" } }
      ]
    }
  ],
  "partition-specs": [
    { "spec-id": 0, "fields": [
      { "name": "placed_at_day",      "transform": "day",        "source-id": 5, "field-id": 1000 },
      { "name": "customer_id_bucket", "transform": "bucket[16]", "source-id": 2, "field-id": 1001 }
    ]}
  ],
  "sort-orders": [
    { "order-id": 1, "fields": [
      { "transform": "identity", "source-id": 5, "direction": "asc", "null-order": "nulls-last" },
      { "transform": "identity", "source-id": 1, "direction": "asc", "null-order": "nulls-last" }
    ]}
  ],
  "properties": {
    "format-version": "2",
    "write.format.default": "parquet",
    "write.parquet.compression-codec": "zstd",
    "write.merge.mode": "merge-on-read",
    "write.update.mode": "merge-on-read",
    "write.delete.mode": "merge-on-read",
    "write.target-file-size-bytes": "134217728",
    "history.expire.min-snapshots-to-keep": "5",
    "gc.enabled": "true",
    "comment": "Demo Iceberg orders table — exercises partitions, sort order, and merge-on-read."
  }
}
```

### Inserting and querying

```sql
-- INSERT into the orders table
INSERT INTO sample_database.orders VALUES
  (1001, 5001, DECIMAL '149.99', 'USD',
   TIMESTAMP '2026-05-20 09:15:00 UTC',
   ARRAY['holiday-promo','first-order'],
   CAST(ROW('1 Infinite Loop','Cupertino','US','95014')
        AS ROW(line1 VARCHAR,city VARCHAR,country VARCHAR,postal_code VARCHAR)),
   MAP(ARRAY['channel','utm'], ARRAY['web','google'])),
  -- ... more rows
;

-- merge-on-read DELETE (only legal because we chose v2 + merge-on-read mode)
DELETE FROM sample_database.orders WHERE order_id = 1003;

-- merge-on-read UPDATE
UPDATE sample_database.orders SET currency = 'GBP' WHERE customer_id = 5002;

-- SELECT
SELECT customer_id, SUM(order_amount) AS total
  FROM sample_database.orders
  GROUP BY 1
  ORDER BY 2 DESC;
```

## Schema + partition evolution via cdk-only

`scripts/integration-test-evolution.sh` drives the
`IcebergEvolutionStack` through four `cdk deploy`s and verifies the
underlying Iceberg `metadata.json` after each:

| Step | Change | Columns | Partitions |
| ---: | --- | --- | --- |
| 1 | Initial deploy | `customer_id(1)`, `email(2)`, `signed_up_at(3)` | `day(signed_up_at)` |
| 2 | **ADD** column `region(4)` | + `region(4)` | unchanged |
| 3 | **RENAME** `email` → `contact_email` (id 2 preserved), **ADD** partition `bucket(8)(customer_id)` | rename | + `bucket(8)(customer_id)` |
| 4 | **DROP** column `region` (id 4 stays retired), **DROP** partition `bucket(8)(customer_id)` | − `region` | − `customer_id_bucket` |

Last script run output (abridged: `cdk deploy` chatter and the
per-Athena-query state polling lines are omitted; the assertion
output is verbatim):

```
=== STEP 1 — cdk deploy ===
✨ Total time: 10.57s

=== VERIFY step 1 ===
  columns ✓ (1:customer_id,2:email,3:signed_up_at)
  partitions ✓ (signed_up_at_day)

=== INSERT seed rows ===
  3 rows inserted

=== STEP 2 — cdk deploy ===
=== VERIFY step 2 (ADD column) ===
  columns ✓ (1:customer_id,2:email,3:signed_up_at,4:region)
  partitions ✓ (signed_up_at_day)

=== VERIFY old rows are preserved with region=NULL ===
  pre-existing rows readable ✓
  inserted 1 row carrying region='us-east-1'

=== STEP 3 — cdk deploy ===
=== VERIFY step 3 (RENAME column + ADD partition) ===
  columns ✓ (1:customer_id,2:contact_email,3:signed_up_at,4:region)
  partitions ✓ (signed_up_at_day,customer_id_bucket)
  rename preserved data ✓

=== STEP 4 — cdk deploy ===
=== VERIFY step 4 (DROP column + DROP partition) ===
  columns ✓ (1:customer_id,2:contact_email,3:signed_up_at)
  partitions ✓ (signed_up_at_day)
  last-column-id stays at 4 — id reuse protection ✓
  all 4 pre-existing rows queryable after drop ✓

=== TEARDOWN ===
IcebergEvolutionStack |   4 | DELETE_COMPLETE      | AWS::CloudFormation::Stack
 ✅  IcebergEvolutionStack: destroyed

=== ALL EVOLUTION STEPS PASSED ===
```

The construct passes each new column list + partition spec to Glue
`UpdateTable` via `OpenTableFormatInput`. Glue computes the Iceberg
metadata delta (new `schema-id`, new `spec-id`) and writes a new
`metadata.json`. Old data files stay readable because the field IDs
the construct pins (`id: N` on each `IcebergColumn`) never change
across deploys.

## DML, time travel, OPTIMIZE, and VACUUM

`scripts/integration-test-dml.sh` covers the v2 surface that the
evolution test doesn't. The harness deploys `IcebergDmlStack` once,
then runs a sequence of Athena statements against a v2 merge-on-read
table with `identifierFieldNames: ['account_id']`:

| Step | Statement | Verify |
| ---: | --- | --- |
| 1 | `INSERT` 5 seed rows | row count == 5 |
| 2 | `UPDATE balance WHERE account_id = 2` | balance == 250, row count == 5 |
| 3 | `DELETE WHERE account_id = 4` | row count == 4, account_id=4 gone |
| 4 | capture pre-MERGE snapshot id from `dml_test$snapshots` | — |
| 5 | `MERGE INTO ... USING ... ON account_id` (update id=3, insert id=6 + id=7) | row count == 6, id=3 balance updated, ids 6 and 7 present |
| 6 | `SELECT ... FOR VERSION AS OF <pre-MERGE snapshot>` | time-travel still sees 4 rows, no id=6 |
| 7 | `OPTIMIZE ... REWRITE DATA USING BIN_PACK` | succeeds, row count unchanged |
| 8 | `VACUUM ...` (after a 65-s sleep to clear `max-snapshot-age-ms`) | succeeds, row count unchanged |
| 9 | final `SELECT` | 6 rows with the expected balances |

The DML table is configured with `history.expire.max-snapshot-age-ms`
of 60 seconds so VACUUM has snapshots to expire on a fresh table.
All three scripts run sequentially in the same `integ-test.yml`
job; evolution takes ~5 minutes, DML ~3, and surface ~4.

## Partition transforms, sort order, nested types, and grants

`scripts/integration-test-surface.sh` covers the slice of the
construct surface the evolution and DML stacks don't reach.
`IcebergSurfaceStack` defines three small tables that each isolate
one concern:

| Concern | Table | What the script checks |
| --- | --- | --- |
| **Every partition transform** | `transforms_test` (separate `year_source` / `month_source` / `day_source` / `hour_source` timestamps to avoid Iceberg's redundant-temporal-transform rejection, plus `user_id` / `email` / `value`) | `metadata.json` contains all seven transforms (`year`, `month`, `day`, `hour`, `bucket[8]`, `truncate[4]`, `identity`); INSERT one row and verify the resulting S3 prefix contains the expected multi-transform layout (`year_source_year=...`, `month_source_month=...`, etc.) |
| **Sort order** | `sorted_test` (`tenant`, `created_at`, `amount`) | `metadata.json`'s `sort-orders` block has three fields with the expected direction + null-order pairs: `asc/nulls-first`, `desc/nulls-last`, `desc/nulls-last` |
| **Nested types** | `nested_test` (`tags` list, `profile` struct, `attrs` map) | INSERT two rows using `ARRAY[...]`, `CAST(ROW(...) AS ROW(...))`, and `MAP(ARRAY[...], ARRAY[...])`. SELECT verifies `tags[1]`, `profile.first_name`, and `element_at(attrs, 'tier')` all roundtrip correctly |
| **`grantRead` S3 statements at runtime** | `transforms_test` + a `GranteeRole` trusted by the deployer | Assume the role and call S3 directly (Lake Formation doesn't gate S3 calls when the bucket is registered with `hybridAccessEnabled: true`, so the IAM grants the construct produces are what's being tested). `s3:ListBucket` on the table's own prefix succeeds. `s3:ListBucket` on a foreign table's prefix is denied — the `s3:prefix` condition kicks in. The Glue action grants are validated by the unit tests, not at runtime, because LF gates `glue:*` against tables in LF-registered locations regardless of the principal's IAM policy |
| **`fromIcebergTableAttributes(...)` + `grantRead`** | imported handle on `transforms_test` + a second `ImportedGranteeRole` | Same S3 checks under the import-factory grantee. Verifies the import path produces a symmetric IAM split |

The construct's `grantRead` / `grantWrite` / `grantReadWrite` issue
**IAM grants only**. In a Lake-Formation-managed deployment like
`ArceusStack`, Athena queries still need separate LF `SELECT` /
`INSERT` / `DELETE` grants on top of the construct's IAM grants. The
surface test deliberately bypasses Athena (assumes the role and
calls Glue + S3 directly) so the construct's grant logic is
verified in isolation — under LF, the IAM grants alone are
necessary but not sufficient for Athena queries.

## Two footguns the construct prevents

### Footgun #1 — schema under `storageDescriptor.columns`

The CREATE succeeds but the first UPDATE silently strips
`table_type=ICEBERG` from the table's Glue parameters, and Athena
queries after that fail with `HIVE_UNSUPPORTED_FORMAT`.

```typescript
// DON'T DO THIS — what most StackOverflow / re:Post examples show
new CfnTable(this, 'OrdersBad', {
    catalogId: this.account,
    databaseName: 'analytics',
    tableInput: {
        name: 'orders',
        tableType: 'EXTERNAL_TABLE',
        parameters: {
            table_type: 'ICEBERG',
        },
        storageDescriptor: {
            location: 's3://.../orders/',
            columns: [
                /* ... */
            ],
        },
    },
    openTableFormatInput: {
        icebergInput: {
            metadataOperation: 'CREATE',
            version: '2',
        },
    },
});
```

`IcebergTable` instead always emits schema/partitions/sort/properties
under `openTableFormatInput.icebergInput.icebergTableInput`, never
under `storageDescriptor`.

### Footgun #2 — `tableInput` co-present with `openTableFormatInput`

Even setting just `tableInput: { name: 'foo' }` next to
`openTableFormatInput` returns
`"Table metadata is expected only via TableInput or via IcebergTableInputProperties inside OpenTableFormatInput"`.
The construct never emits `tableInput`; the table-level comment goes
into `tableProperties['comment']`, which lives inside
`icebergTableInput.properties`.

(There is a third footgun, field-id reuse after a column drop, that
the construct does **not** prevent. See the next section.)

## Known limitations

- **Field-id reuse is not detected across deploys.** If you drop a column with `id = 5` and then add a different column with `id = 5` in a later deploy, Glue accepts the UPDATE and Iceberg's metadata silently violates the "never reuse a retired id" invariant. Readers projecting old snapshots will surface deleted data under the new field's name. The construct enforces uniqueness **within one deploy** (`duplicate column id N` validator), but it doesn't compare against the live table state. The safe workflow is to always pin `id` explicitly and treat dropped ids as retired forever; never let CDK reassign an id that has ever been used.
- **Partition field ids are positional and not pinnable.** The construct allocates partition `fieldId` densely from 1000 in the order partitions appear in `partitionSpec`. Reordering the array across deploys reassigns those ids for unchanged logical partitions, which is the partition-spec analog of the column-id-reuse footgun above. There is no `IcebergPartitionField.fieldId` pinning prop today. The safe workflow is append-only: add new partition fields at the end of `partitionSpec`, and only drop the trailing ones.
- **CREATE-only metadata operation.** The CFN `IcebergInput.metadataOperation` only accepts `CREATE`; the construct always emits that. Subsequent deploys use Glue's normal `UpdateTable` path, which writes new Iceberg metadata in-place.
- **Format version is immutable after CREATE.** The `formatVersion` prop is read once at table creation; changing it later requires a destroy + recreate.
- **`merge-on-read` requires v2.** The construct rejects `write.{delete,update,merge}.mode = merge-on-read` on a v1 table at synth time.
- **Athena DDL features that don't surface through CFN** (e.g. `ALTER TABLE WRITE ORDERED BY`, `ALTER TABLE … SET LOCATION`, `bucketed_by` / `bucket_count` Hive clauses) are not exposed. Use `IcebergPartitionTransform.bucket(N)` instead of Hive bucketing.
- **Dropping a partition column requires a `void` intermediate per the Iceberg spec**, and the CFN `OpenTableFormatInput` cannot express that. The construct accepts the change, but Athena queries against the result will fail with `Type cannot be null`. The integration-test script demonstrates the safe pattern: drop partitions that source from `customer_id` while keeping `customer_id` itself in the schema, and drop the `region` column while it is not partitioning anything.

## Tests

```
npx jest          # runs every suite under test/, prints coverage at the end
```

Coverage is gated at 95% statements / 95% branches / 95% lines / 95% functions
on `lib/**/*.ts` via the `coverageThreshold.global` block in `jest.config.js`.
A failing gate fails the suite, so the README does not paste a transcript that
would drift after the next refactor; run the command locally for the live
numbers.

## Project layout

```
arceus/
├── bin/arceus.ts                       # CDK app entry point
├── lib/
│   ├── arceus-stack.ts                 # Demo stack (buckets, DB, 3 demo tables)
│   ├── iceberg-evolution-stack.ts      # Parameterized stack for the evolution test
│   ├── iceberg-dml-stack.ts            # Stack for the DML / time-travel / OPTIMIZE / VACUUM test
│   ├── iceberg-surface-stack.ts        # Stack for transforms / sort / nested types / grants test
│   └── iceberg/
│       ├── iceberg-table.ts            # The L2 construct itself
│       ├── iceberg-type.ts             # IcebergType + struct/list/map/decimal/fixed
│       ├── iceberg-partition-transform.ts
│       ├── iceberg-table-properties.ts # Format/version enums + property validation
│       └── index.ts                    # Re-exports (the npm package's entry point)
├── test/
│   ├── arceus-stack.test.ts
│   ├── iceberg-evolution-stack.test.ts
│   ├── iceberg-dml-stack.test.ts
│   ├── iceberg-surface-stack.test.ts
│   └── iceberg/
│       ├── iceberg-partition-transform.test.ts
│       ├── iceberg-table-properties.test.ts
│       ├── iceberg-table.test.ts
│       └── iceberg-type.test.ts
├── e2e-consumer/                       # Standalone CDK app that consumes the
│   │                                   # published npm package — proves a fresh
│   │                                   # install + import + synth works. Runs
│   │                                   # on every PR via the `e2e-consumer` job
│   │                                   # in `.github/workflows/ci.yml`.
│   ├── bin/app.ts
│   ├── lib/consumer-stack.ts           # Realistic consumer (one IcebergTable)
│   └── lib/surface-reference.ts        # Anchors every exported symbol so a
│                                       # rename in the published surface breaks CI
├── scripts/
│   ├── integration-test-evolution.sh   # End-to-end evolution harness
│   ├── integration-test-dml.sh         # End-to-end DML harness
│   └── integration-test-surface.sh     # End-to-end surface harness
├── docs/
│   └── integ-test-setup.md             # AWS-side prerequisites for the integ-test
│                                       # workflow (OIDC provider, IAM role, repo var)
├── .github/workflows/
│   ├── ci.yml                          # Lint + test + build + pack + e2e-consumer
│   ├── publish.yml                     # Trusted-publish to npm on version bump
│   └── integ-test.yml                  # Real-AWS evolution test (gated by label /
│                                       # `/run-integ-test` comment)
├── cdk.json
├── package.json                        # The published package's manifest
├── tsconfig.json                       # Wide include (used by ESLint and dev)
├── tsconfig.build.json                 # Narrow include (used by `npm publish`)
├── jest.config.js
└── eslint.config.js
```
