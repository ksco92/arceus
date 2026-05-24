# arceus

A CDK app + `IcebergTable` L2 construct for managing Apache Iceberg
tables in the AWS Glue Data Catalog. The construct emits the
`AWS::Glue::Table` shape that survives CloudFormation `Update` (so
`cdk deploy` can create, evolve, and destroy Iceberg tables the same
way it handles any other resource).

The motivating issue is [aws/aws-cdk#29660](https://github.com/aws/aws-cdk/issues/29660);
the last comment on that issue (May 2026) documents the only working
shape and the silent-corruption traps you can hit by getting it
slightly wrong. This construct implements that shape and refuses to
emit the unsafe alternatives.

> **Repo shape:** this is a self-contained CDK **app + demo**, not an
> npm-publishable library. The `IcebergTable` construct itself is
> reusable — copy the `lib/iceberg/` directory into your own CDK
> project. The `bin/` and stack files are demo scaffolding.

## Prerequisites

Before running the quickstart you need:

1. AWS credentials in the default profile with permissions to manage
   CloudFormation, KMS, S3, Glue, Lake Formation, Athena, and IAM
   policies. `aws sts get-caller-identity` must return successfully.
2. `CDK_DEFAULT_ACCOUNT` and `CDK_DEFAULT_REGION` set in the
   environment (the AWS CLI sets these automatically for most
   profile setups; `cdk` also populates them from the active profile).
3. `DEVELOPER_IAM_USER` set to the name of an **existing IAM user**
   in this account. The stack adds that user as a Lake Formation
   admin and grants it per-table `SELECT/INSERT/DELETE/ALTER/DESCRIBE`
   on the demo Iceberg tables — without it the deploy fails when LF
   can't resolve the principal.
4. The Lake Formation service-linked role
   `AWSServiceRoleForLakeFormationDataAccess` must exist in the
   account. Create it once with
   `aws iam create-service-linked-role --aws-service-name lakeformation.amazonaws.com`
   if you haven't already.
5. `cdk bootstrap aws://<account>/<region>` if the account hasn't
   been bootstrapped for CDK.

## What you get

- **`lib/iceberg/iceberg-table.ts`** — the `IcebergTable` L2 construct.
- **`lib/iceberg/iceberg-type.ts`** — `IcebergType` with primitives + `list` / `map` / `struct` factories. Renders to the JSON shape Glue's `IcebergStructField.type` expects.
- **`lib/iceberg/iceberg-partition-transform.ts`** — `IcebergPartitionTransform` (identity / bucket(N) / truncate(W) / year / month / day / hour / void). Each transform validates against the source column type at synth time.
- **`lib/iceberg/iceberg-table-properties.ts`** — `IcebergDataFormat` (parquet/orc/avro — default parquet), `IcebergFormatVersion` (v1/v2 — default v2), and a validator that catches misconfigured `tableProperties` before they leave your machine (wrong codec for the chosen format, `merge-on-read` on a v1 table, non-positive numeric values, …).
- **`lib/arceus-stack.ts`** — the demo stack: KMS-encrypted data lake bucket, Athena results bucket, Glue database, three demo Iceberg tables (`orders`, `events`, `customers`).
- **`lib/iceberg-evolution-stack.ts`** + **`scripts/integration-test-evolution.sh`** — a parameterized stack and a bash harness that drives four real `cdk deploy`s to prove schema/partition evolution works end-to-end.

## Quickstart

```bash
export DEVELOPER_IAM_USER="$(aws sts get-caller-identity --query Arn --output text | awk -F/ '{print $NF}')"

npm install
npx jest                         # 167 tests, 100% line coverage
npx cdk deploy ArceusStack --require-approval=never
./scripts/integration-test-evolution.sh   # add + rename + drop, via cdk only
```

`cdk ls` will show two stacks — `ArceusStack` (the demo data lake +
three Iceberg tables) and `IcebergEvolutionStack` (the evolution
test target driven by `scripts/integration-test-evolution.sh`).
Deploy only `ArceusStack` for the quickstart; the evolution stack
is created on demand by the script.

## Using `IcebergTable`

A minimal table:

```typescript
import {
    Database,
} from '@aws-cdk/aws-glue-alpha';
import {
    IcebergTable,
    IcebergType,
} from './iceberg';

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

A table that exercises most of the surface — partitions, sort order,
nested types, identifier fields, table properties, removal policy.
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
} from './iceberg';

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

Last script run output (abridged — `cdk deploy` chatter and the
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
The construct never emits `tableInput` — table-level comment goes
into `tableProperties['comment']`, which lives inside
`icebergTableInput.properties`.

(There is a third footgun — field-id reuse after a column drop — that
the construct does **not** prevent. See the next section.)

## Known limitations

- **Field-id reuse is not detected across deploys.** If you drop a column with `id = 5` and then add a different column with `id = 5` in a later deploy, Glue accepts the UPDATE and Iceberg's metadata silently violates the "never reuse a retired id" invariant. Readers projecting old snapshots will surface deleted data under the new field's name. The construct enforces uniqueness **within one deploy** (`duplicate column id N` validator), but it doesn't compare against the live table state. The safe workflow is to always pin `id` explicitly and treat dropped ids as retired forever; never let CDK reassign an id that has ever been used.
- **CREATE-only metadata operation.** The CFN `IcebergInput.metadataOperation` only accepts `CREATE`; the construct always emits that. Subsequent deploys use Glue's normal `UpdateTable` path, which writes new Iceberg metadata in-place.
- **Format version is immutable after CREATE.** The `formatVersion` prop is read once at table creation; changing it later requires a destroy + recreate.
- **`merge-on-read` requires v2.** The construct rejects `write.{delete,update,merge}.mode = merge-on-read` on a v1 table at synth time.
- **Athena DDL features that don't surface through CFN** (e.g. `ALTER TABLE WRITE ORDERED BY`, `ALTER TABLE … SET LOCATION`, `bucketed_by` / `bucket_count` Hive clauses) are not exposed. Use `IcebergPartitionTransform.bucket(N)` instead of Hive bucketing.
- **Dropping a partition column requires a `void` intermediate per the Iceberg spec**, and the CFN `OpenTableFormatInput` cannot express that. The construct accepts the change, but Athena queries against the result will fail with `Type cannot be null`. The integration-test script demonstrates the safe pattern: drop partitions that source from `customer_id` while keeping `customer_id` itself in the schema, and drop the `region` column while it is not partitioning anything.

## Tests

```
$ npx jest
Test Suites: 6 passed, 6 total
Tests:       167 passed, 167 total

Coverage summary
Statements   : 100% ( 411/411 )
Branches     : 100% ( 146/146 )
Functions    : 98.8% ( 83/84 )
Lines        : 100% ( 408/408 )
```

The 95% coverage floor is enforced in `jest.config.js`.

## Project layout

```
arceus/
├── bin/arceus.ts                       # CDK app entry point
├── lib/
│   ├── arceus-stack.ts                 # Demo stack (buckets, DB, 3 demo tables)
│   ├── iceberg-evolution-stack.ts      # Parameterized stack for the evolution test
│   └── iceberg/
│       ├── iceberg-table.ts            # The L2 construct itself
│       ├── iceberg-type.ts             # IcebergType + struct/list/map/decimal/fixed
│       ├── iceberg-partition-transform.ts
│       ├── iceberg-table-properties.ts # Format/version enums + property validation
│       └── index.ts                    # Re-exports
├── test/
│   ├── arceus-stack.test.ts
│   ├── iceberg-evolution-stack.test.ts
│   └── iceberg/
│       ├── iceberg-partition-transform.test.ts
│       ├── iceberg-table-properties.test.ts
│       ├── iceberg-table.test.ts
│       └── iceberg-type.test.ts
├── scripts/
│   └── integration-test-evolution.sh   # End-to-end evolution harness
├── cdk.json
├── package.json
├── jest.config.js
├── eslint.config.js
└── tsconfig.json
```
