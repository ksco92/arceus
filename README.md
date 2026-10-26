# cdk-glue-iceberg-table

[![CI](https://img.shields.io/github/actions/workflow/status/ksco92/arceus/ci.yml?branch=main&label=CI)](https://github.com/ksco92/arceus/actions/workflows/ci.yml)
[![coverage](https://codecov.io/gh/ksco92/arceus/branch/main/graph/badge.svg)](https://codecov.io/gh/ksco92/arceus)
[![npm](https://img.shields.io/npm/v/cdk-glue-iceberg-table.svg)](https://www.npmjs.com/package/cdk-glue-iceberg-table)
[![PyPI](https://img.shields.io/pypi/v/cdk-glue-iceberg-table.svg)](https://pypi.org/project/cdk-glue-iceberg-table/)
[![Construct Hub](https://img.shields.io/badge/Construct%20Hub-available-blueviolet)](https://constructs.dev/packages/cdk-glue-iceberg-table)
[![types](https://img.shields.io/npm/types/cdk-glue-iceberg-table.svg)](https://www.npmjs.com/package/cdk-glue-iceberg-table)
[![downloads](https://img.shields.io/npm/dw/cdk-glue-iceberg-table.svg)](https://www.npmjs.com/package/cdk-glue-iceberg-table)
[![last commit](https://img.shields.io/github/last-commit/ksco92/arceus.svg)](https://github.com/ksco92/arceus/commits/main)
[![license](https://img.shields.io/npm/l/cdk-glue-iceberg-table.svg)](https://github.com/ksco92/arceus/blob/main/LICENSE)

**`cdk-glue-iceberg-table` is the AWS CDK L2 construct for creating
and evolving Apache Iceberg tables in the AWS Glue Data Catalog.** It
emits the exact `AWS::Glue::Table` / `OpenTableFormatInput` shape that
survives a CloudFormation `Update`, so a single `cdk deploy` creates a
table, evolves its schema and partitions, and destroys it, the same
lifecycle CDK gives any other resource. No custom resource, no Lambda,
no "`cdk deploy` and then run this SQL by hand" two-step. Table
changes (new columns, renames, drops, new partition fields) land as
a reviewed diff in a pull request and apply through `cdk deploy`.

Status (October 2026): published on npm (TypeScript/JavaScript) and PyPI
(Python), pre-1.0, with a public surface guarded by an end-to-end
consumer test on every PR plus real-AWS integration suites, including
ones for format version 3. The
multi-language packages are generated from one TypeScript source with
[jsii](https://aws.github.io/jsii/) and indexed on
[Construct Hub](https://constructs.dev/packages/cdk-glue-iceberg-table).
Developed in the
[`ksco92/arceus`](https://github.com/ksco92/arceus) monorepo, which
also holds a CDK demo app that dogfoods the construct against a real
AWS account.

### Why this exists

AWS documents the CloudFormation shape for Iceberg tables ([AWS Big
Data blog, December 2025](https://aws.amazon.com/blogs/big-data/create-and-update-apache-iceberg-tables-with-partitions-in-the-aws-glue-data-catalog-using-the-aws-sdk-and-aws-cloudformation)),
but raw `AWS::Glue::Table` is a minefield: the CREATE succeeds and the
*first* `Update` silently strips `table_type=ICEBERG`, after which
every Athena query fails with `HIVE_UNSUPPORTED_FORMAT`. The
motivating CDK issue is [aws/aws-cdk#29660](https://github.com/aws/aws-cdk/issues/29660);
[`manmartgarc`'s comment](https://github.com/aws/aws-cdk/issues/29660#issuecomment-4411359248)
documents the only working shape and the silent-corruption traps you
hit by getting it slightly wrong. This construct implements that
shape, refuses to emit the unsafe alternatives, and pins Iceberg field
IDs so schema evolution never orphans existing data. It was the basis
of an upstream proposal to land an `IcebergTable` in
`@aws-cdk/aws-glue-alpha` ([aws/aws-cdk#37988](https://github.com/aws/aws-cdk/pull/37988)),
closed unmerged in September 2026.

### How it compares

| Approach | Declarative IaC (in the PR) | In-place schema + partition evolution | Prevents the silent-corruption footguns | Typed API + synth-time validation |
| --- | --- | --- | --- | --- |
| Raw `CfnTable` (L1) | ✅ | ⚠️ only if you hand-write the exact `OpenTableFormatInput` shape | ❌ you own both footguns | ❌ |
| CDK custom resource (Lambda + Glue SDK) | ⚠️ via a custom resource you maintain | ⚠️ you write the diff logic | ⚠️ your code's responsibility | ❌ |
| Spark SQL DDL, or Athena SQL DDL (v1/v2 only), at job runtime | ❌ imperative, outside the PR | ✅ but outside CloudFormation | n/a | ❌ |
| **`cdk-glue-iceberg-table`** | ✅ | ✅ via `cdk deploy` | ✅ both prevented by construction | ✅ |

## Install

TypeScript / JavaScript (npm):

```bash
npm install cdk-glue-iceberg-table
```

Python (PyPI):

```bash
pip install cdk-glue-iceberg-table
```

Peer dependencies (your CDK app must already have these). This
release requires `aws-cdk-lib` 2.273.0 or newer and `constructs`
10.8.1 or newer, plus Node.js 22.14 or newer for both languages (the
Python package runs under Node.js through jsii).

For TypeScript / JavaScript:

```bash
npm install aws-cdk-lib@^2.273.0 constructs@^10.8.1
```

For Python:

```bash
pip install 'aws-cdk-lib>=2.273.0' 'constructs>=10.8.1'
```

## Use

### TypeScript

```ts
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Database } from 'aws-cdk-lib/aws-glue';
import {
    IcebergFormatVersion,
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
        { sourceColumn: 'placed_at',   transform: IcebergPartitionTransform.DAY,        fieldId: 1000 },
        { sourceColumn: 'customer_id', transform: IcebergPartitionTransform.bucket(16), fieldId: 1001 },
    ],
    identifierFieldNames: ['order_id'],
    formatVersion: IcebergFormatVersion.V2,
});
```

### Python

The same table in Python — the API mirrors TypeScript with
`snake_case` props and `PascalCase` types:

```python
from aws_cdk.aws_s3 import Bucket
from aws_cdk.aws_glue import Database
from cdk_glue_iceberg_table import (
    IcebergFormatVersion,
    IcebergTable,
    IcebergType,
    IcebergPartitionTransform,
)

bucket = Bucket(self, "Warehouse")
db = Database(self, "Db", database_name="analytics")

IcebergTable(self, "OrdersTable",
    database=db,
    table_name="orders",
    location=f"s3://{bucket.bucket_name}/analytics/orders/",
    columns=[
        {"name": "order_id", "type": IcebergType.LONG, "required": True, "id": 1},
        {"name": "customer_id", "type": IcebergType.LONG, "required": True, "id": 2},
        {"name": "placed_at", "type": IcebergType.TIMESTAMPTZ, "required": True, "id": 3},
    ],
    partition_spec=[
        {"source_column": "placed_at", "transform": IcebergPartitionTransform.DAY, "field_id": 1000},
        {"source_column": "customer_id", "transform": IcebergPartitionTransform.bucket(16), "field_id": 1001},
    ],
    identifier_field_names=["order_id"],
    format_version=IcebergFormatVersion.V2,
)
```

Consumer-facing reference sections:

- [How it compares](#how-it-compares) — `cdk-glue-iceberg-table` vs raw `CfnTable`, custom resources, and runtime SQL DDL.
- [Using `IcebergTable`](#using-icebergtable) — full API reference with examples.
- [Format version 3](#format-version-3) — the six v3 types, which engines read them, and the accepted limits.
- [Two footguns the construct prevents](#two-footguns-the-construct-prevents) — the silent-corruption traps that motivated this construct.
- [Known limitations](#known-limitations) — what the construct does and doesn't enforce.
- [FAQ](#faq) — common "how do I … in CDK / CloudFormation" questions.

## Exported surface

The package entry point re-exports everything you import from
`cdk-glue-iceberg-table`. In TypeScript / JavaScript the compiled
surface lives under `dist/lib/iceberg/` after `npm install`; in Python
the same surface is imported from the `cdk_glue_iceberg_table` module
after `pip install`:

- **`IcebergTable`** — the L2 construct itself, with `grantRead` / `grantWrite` / `grantReadWrite` and the `fromIcebergTableAttributes(...)` import factory.
- **`IcebergType`** — primitive types, the v3 constants `UNKNOWN`, `TIMESTAMP_NS`, `TIMESTAMPTZ_NS`, and `VARIANT`, and the `list` / `map` / `struct` / `decimal` / `fixed` / `geometry(crs?)` / `geography(crs?, algorithm?)` factories. Renders to the string Glue's `IcebergStructField.type` expects.
- **`IcebergPartitionTransform`** — identity / `bucket(N)` / `truncate(W)` / year / month / day / hour / void. Each transform validates against the source column type at synth time.
- **`IcebergDataFormat`** (parquet/orc/avro, default parquet), **`IcebergFormatVersion`** (v1/v2/v3, required — set explicitly per table; Athena cannot query v3 tables), **`IcebergSortDirection`**, **`IcebergNullOrder`**, **`IcebergEdgeAlgorithm`** (`SPHERICAL`, `VINCENTY`, `THOMAS`, `ANDOYER`, `KARNEY`; the second argument of `IcebergType.geography`), plus a `tableProperties` validator that catches misconfigured properties before they leave your machine (wrong codec for the chosen format, `merge-on-read` on a v1 table, non-positive numeric values, …).

## Using `IcebergTable`

A minimal table:

```typescript
import {
    Bucket,
} from 'aws-cdk-lib/aws-s3';
import {
    Database,
} from 'aws-cdk-lib/aws-glue';
import {
    IcebergFormatVersion,
    IcebergTable,
    IcebergType,
} from 'cdk-glue-iceberg-table';

const bucket = new Bucket(this, 'Warehouse');

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
    formatVersion: IcebergFormatVersion.V2,
});
```

Every top-level column must declare an `id`: a stable, unique,
positive integer you pick once and never reuse or reassign. Because
Iceberg data files reference fields by id rather than by name, a fixed
id is what lets you add, rename, and drop columns across deploys
without corrupting old data — see
[How do I evolve an Iceberg table schema](#how-do-i-evolve-an-iceberg-table-schema-add-rename-or-drop-a-column-in-cloudformation).
Once a column is dropped, leave its id retired; never hand it to a new
column. (Nested struct/list/map field ids are assigned automatically
above the highest top-level id — only top-level column ids are
caller-provided.)

A table that exercises most of the surface (partitions, sort order,
nested types, identifier fields, table properties, removal policy):

```typescript
import {
    RemovalPolicy,
} from 'aws-cdk-lib';
import {
    Database,
} from 'aws-cdk-lib/aws-glue';
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
            fieldId: 1000,
        },
        {
            sourceColumn: 'customer_id',
            transform: IcebergPartitionTransform.bucket(16),
            fieldId: 1001,
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

Each partition field also pins a `fieldId`: an integer of 1000 or
above (the Iceberg spec reserves lower ids for schema columns), unique
across the table's entire partition-spec history. The discipline is
the inverse of the column-id rule. A column keeps its id forever; a
partition field keeps its id only while it stays untouched. Change
anything about a field — swap `month` for `day`, point it at a
different source column — and it becomes a *new* field that needs a
fresh, never-before-used id, while the old id retires with the old
spec. Reusing a retired id (or reassigning an id to a different field)
produces a table that Athena still reads but Spark and Trino reject
with `ValidationException: Conflicting partition fields`.

The resulting Iceberg `metadata.json` for this table contains every
feature you set:

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

### Format version 3

Set `formatVersion: IcebergFormatVersion.V3` to create a v3 table. The
six v3 types (below) are only accepted on a V3 table, at any nesting
depth: inside a struct, as a list element, or as a map key or value.
Synth fails on a V1 or V2 table that uses one.

```typescript
import {
    IcebergEdgeAlgorithm,
    IcebergFormatVersion,
    IcebergPartitionTransform,
    IcebergTable,
    IcebergType,
} from 'cdk-glue-iceberg-table';

new IcebergTable(this, 'Events', {
    database: db,
    tableName: 'events',
    location: `s3://${bucket.bucketName}/analytics/events/`,
    columns: [
        { name: 'event_id',    type: IcebergType.LONG,         required: true, id: 1 },
        { name: 'occurred_at', type: IcebergType.TIMESTAMP_NS, id: 2 },
        { name: 'payload',     type: IcebergType.VARIANT,      id: 3 },
        {
            name: 'origin',
            type: IcebergType.geography('OGC:CRS84', IcebergEdgeAlgorithm.SPHERICAL),
            id: 4,
        },
    ],
    partitionSpec: [
        { sourceColumn: 'occurred_at', transform: IcebergPartitionTransform.DAY, fieldId: 1000 },
    ],
    formatVersion: IcebergFormatVersion.V3,
});
```

The same table in Python:

```python
from cdk_glue_iceberg_table import (
    IcebergEdgeAlgorithm,
    IcebergFormatVersion,
    IcebergPartitionTransform,
    IcebergTable,
    IcebergType,
)

IcebergTable(self, "Events",
    database=db,
    table_name="events",
    location=f"s3://{bucket.bucket_name}/analytics/events/",
    columns=[
        {"name": "event_id", "type": IcebergType.LONG, "required": True, "id": 1},
        {"name": "occurred_at", "type": IcebergType.TIMESTAMP_NS, "id": 2},
        {"name": "payload", "type": IcebergType.VARIANT, "id": 3},
        {
            "name": "origin",
            "type": IcebergType.geography("OGC:CRS84", IcebergEdgeAlgorithm.SPHERICAL),
            "id": 4,
        },
    ],
    partition_spec=[
        {"source_column": "occurred_at", "transform": IcebergPartitionTransform.DAY, "field_id": 1000},
    ],
    format_version=IcebergFormatVersion.V3,
)
```

The v3 types, with the rules `cdk synth` enforces:

| Type | Factory | Rendered string | Partition and identifier rules |
| --- | --- | --- | --- |
| unknown | `IcebergType.UNKNOWN` | `unknown` | Must be optional, as a column, list element, or map value; never a map key. Partition source only with `void`. Not an identifier field. |
| timestamp with nanoseconds | `IcebergType.TIMESTAMP_NS` | `timestamp_ns` | `identity`, `year`, `month`, `day`, `hour`, `bucket(N)`, `void`; not `truncate(W)`. Allowed as an identifier field. |
| timestamptz with nanoseconds | `IcebergType.TIMESTAMPTZ_NS` | `timestamptz_ns` | Same as `timestamp_ns`. |
| variant | `IcebergType.VARIANT` | `variant` | Never a partition or sort source, `void` included. Not an identifier field. |
| geometry | `IcebergType.geometry(crs?)` | `geometry`, or `geometry(<crs>)` when a CRS is given | Partition source only with `void`. Not an identifier field. |
| geography | `IcebergType.geography(crs?, algorithm?)` | `geography`, `geography(<crs>)`, or `geography(<crs>, <algorithm>)` when an algorithm is given, such as `geography(OGC:CRS84, spherical)` | Same as `geometry`. |

A geometry or geography `crs` is an identifier such as `OGC:CRS84` or
`EPSG:3857`; whitespace, parentheses, braces, and commas are rejected.
When `algorithm` is set without a `crs`, the rendered string spells out
`OGC:CRS84`.

Which engines read a v3 table created by the construct:

| Engine | v3 tables | Notes |
| --- | --- | --- |
| Spark 4.1 + Iceberg 1.12 (the integration-test runner) | Yes | Reads and writes tables the construct creates, including deletion vectors, row lineage, `variant`, `unknown`, and `geometry` / `geography`. Upstream Spark 4.1 fails to open a table with any `timestamp_ns` or `timestamptz_ns` column, and accepts only `OGC:CRS84` (or bare `geometry`) as a geometry CRS; see [Known limitations](#known-limitations). |
| AWS Glue 6.0 | Documented | The [AWS Glue versions](https://docs.aws.amazon.com/glue/latest/dg/release-notes.html) page lists "Iceberg format version 3 with VARIANT data type, deletion vectors, row lineage tracking, nanosecond timestamps, and geo types". The integration suites do not run on Glue 6.0. |
| Athena SQL | No | The [Athena Iceberg page](https://docs.aws.amazon.com/athena/latest/ug/querying-iceberg.html) states "Athena only creates and operates on Iceberg v2 tables." |

The `arceus` repo's v3 integration suites deploy v3 tables with the construct and check
them from `metadata.json` and, in the DML suite, through Spark; see
[CONTRIBUTING.md](https://github.com/ksco92/arceus/blob/main/CONTRIBUTING.md).

### Granting access

```typescript
table.grantRead(role);        // Glue read + S3 read on the table's prefix
table.grantWrite(role);       // Glue write + S3 write
table.grantReadWrite(role);
```

The `grant*` helpers issue **IAM grants only**. Under Lake Formation
you still add the matching `SELECT` / `INSERT` / `DELETE` LF grants on
top of the construct's IAM grants for Athena queries to succeed.

### Importing an existing table

```typescript
const existing = IcebergTable.fromIcebergTableAttributes(this, 'Orders', {
    database: db,
    tableName: 'orders',
    location: 's3://my-bucket/analytics/orders/',
});
existing.grantRead(role);
```

### Evolving schema and partitions

Change the `columns` array (or `partitionSpec`) and run `cdk deploy`
again. The construct passes the new schema to Glue's `UpdateTable`,
which writes a new `metadata.json` with a new `schema-id`; existing
data files stay readable because each column's `id` is pinned and
never reused. Adds, renames (same `id`, new `name`), and drops all
flow through `cdk deploy` alone — no out-of-band SQL DDL.

Partition evolution flows the same way, with one extra rule on
`fieldId`: a changed partition field is a new partition field. To move
a table from `month(placed_at)` to `day(placed_at)`, drop the month
entry and add a day entry under a fresh `fieldId` — never recycle the
month field's id:

```typescript
partitionSpec: [
    // was: { sourceColumn: 'placed_at', transform: IcebergPartitionTransform.MONTH, fieldId: 1000 },
    {
        sourceColumn: 'placed_at',
        transform: IcebergPartitionTransform.DAY,
        fieldId: 1001,
    },
],
```

Old data files written under the month spec stay readable; new writes
partition by day. Reusing `1000` for the day field instead corrupts
the spec history for strict engines (Spark, Trino) while Athena keeps
working — the failure only surfaces at Spark runtime.

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
- **Partition field-id reuse is not detected across deploys either.** The same live-state blindness applies to partition `fieldId`s: the construct validates them within one deploy (integer >= 1000, unique in the spec), but it cannot tell that the id you pinned already appeared in an earlier spec of the deployed table. The invariant partition ids must uphold is stricter than the column one — unique across the table's **entire spec history**, so a changed field (different transform or source column) must take a fresh id rather than keep its old one. Violate it and strict engines (Spark, Trino) reject the table with `Conflicting partition fields` while Athena keeps answering, masking the break until Spark runtime. The safe workflow: treat every id that has ever appeared in any spec as retired, and allocate new fields the next never-used id.
- **`last-partition-id` is written by Glue, not by the construct.** The construct supplies the spec's field ids; Glue's `UpdateTable` computes the table's `last-partition-id` counter when it writes the new metadata. The repo's integration test asserts the counter keeps up with the highest supplied field id after a partition evolution, but engines that later evolve the spec themselves (e.g. Spark `ALTER TABLE … ADD PARTITION FIELD`) allocate from that counter — if you mix CDK-managed and engine-managed partition evolution, verify the counter in `metadata.json` before trusting engine-side changes.
- **CREATE-only metadata operation.** The CFN `IcebergInput.metadataOperation` only accepts `CREATE`; the construct always emits that. Subsequent deploys use Glue's normal `UpdateTable` path, which writes new Iceberg metadata in-place.
- **Format version is immutable after CREATE.** The `formatVersion` prop is read once at table creation; changing it later requires a destroy + recreate. An engine can upgrade a v2 table in place with `ALTER TABLE … SET TBLPROPERTIES ('format-version' = '3')`. Every deploy submits `formatVersion` as the template's `version` and as the `format-version` table property, so set `formatVersion` to `V3` before the next deploy.
- **`merge-on-read` requires v2 or later.** The construct rejects `write.{delete,update,merge}.mode = merge-on-read` on a v1 table at synth time.
- **Column defaults are not available.** Iceberg v3 `initial-default` and `write-default` cannot be declared through CloudFormation: the `AWS::Glue::Table` resource schema has no `InitialDefault` or `WriteDefault` property (an `AWS::EarlyValidation::PropertyValidation` failure, checked 2026-10-25). Revisit when that schema gains the two properties.
- **Nanosecond timestamps are catalog-only for upstream Spark 4.1.** A table with any `timestamp_ns` or `timestamptz_ns` column fails to open in upstream Spark 4.1 with Iceberg 1.12. The integration suite for these columns asserts from `metadata.json` only.
- **Geometry CRS other than `OGC:CRS84` is catalog-only for upstream Spark 4.1.** Spark 4.1 accepts `OGC:CRS84`, or bare `geometry`, as the geometry CRS; a table declaring another CRS, such as `EPSG:3857`, cannot be read there.
- **Athena DDL features that don't surface through CFN** (e.g. `ALTER TABLE WRITE ORDERED BY`, `ALTER TABLE … SET LOCATION`, `bucketed_by` / `bucket_count` Hive clauses) are not exposed. Use `IcebergPartitionTransform.bucket(N)` instead of Hive bucketing.
- **Dropping a partition column requires a `void` intermediate per the Iceberg spec**, and the CFN `OpenTableFormatInput` cannot express that. The construct accepts the change, but Athena queries against the result will fail with `Type cannot be null`. The safe pattern is to drop partitions that source from a column while keeping that column in the schema, and only drop a column once it is no longer partitioning anything.

## FAQ

### How do I create an Apache Iceberg table in AWS CDK?

Install `cdk-glue-iceberg-table`, then declare an `IcebergTable` with a
database, a column list, and an S3 `location` — see [Use](#use).
`cdk deploy` creates the Glue Data Catalog table and writes the
Iceberg `metadata.json` under your S3 prefix. No custom resource or
Lambda is involved; it is a plain `AWS::Glue::Table` in your
CloudFormation template.

### How do I evolve an Iceberg table schema (add, rename, or drop a column) in CloudFormation?

Change the `columns` array and run `cdk deploy` again. The construct
passes the new schema to Glue's `UpdateTable`, which writes a new
`metadata.json` with a new `schema-id`; existing data files stay
readable because each column's `id` is pinned and never reused.
Partition changes work the same way, except a changed partition field
takes a fresh `fieldId` instead of keeping its old one. See [Evolving
schema and partitions](#evolving-schema-and-partitions).

### Does CloudFormation support Iceberg tables natively?

Yes, through `AWS::Glue::Table` with `OpenTableFormatInput.IcebergInput`,
documented by AWS in [December 2025](https://aws.amazon.com/blogs/big-data/create-and-update-apache-iceberg-tables-with-partitions-in-the-aws-glue-data-catalog-using-the-aws-sdk-and-aws-cloudformation).
The catch is that the raw shape corrupts the table on the first
`Update` if you place schema under `storageDescriptor.columns` or set
`tableInput` alongside `openTableFormatInput`. This construct only ever
emits the safe shape and gives you no way to express the unsafe ones.
See [Two footguns the construct prevents](#two-footguns-the-construct-prevents).

### What is the difference between cdk-glue-iceberg-table and a raw CfnTable?

A raw `CfnTable` makes you hand-write the `OpenTableFormatInput` JSON
and own both silent-corruption footguns. `cdk-glue-iceberg-table` gives
you a typed `IcebergType` / `IcebergPartitionTransform` API,
synth-time validation (partition transforms checked against column
types, format/version mismatches caught before deploy), pinned field
IDs for safe evolution, and `grantRead` / `grantWrite` helpers. See
[How it compares](#how-it-compares).

### How do I create a partitioned Iceberg table in CDK?

Pass a `partitionSpec` of `IcebergPartitionTransform` entries —
`identity`, `bucket(N)`, `truncate(W)`, `year`, `month`, `day`, `hour`,
or `void` — each pinned to a `fieldId` of 1000 or above. Transforms are
validated against their source column's type at synth time. See
[Using `IcebergTable`](#using-icebergtable).

### Does it work with Athena and Lake Formation?

Yes for v1 and v2 tables, no for v3: Athena reads and writes v1 and v2, including v2
merge-on-read `INSERT` / `UPDATE` / `DELETE` / `MERGE`, time travel,
`OPTIMIZE`, and `VACUUM`. The demo app in the
[`arceus`](https://github.com/ksco92/arceus) repo registers its tables
with Lake Formation and exercises the same operations through Spark in
its integration suite. The construct's `grant*` helpers issue IAM
grants; under Lake Formation you still add the matching `SELECT` /
`INSERT` LF grants. See [Granting access](#granting-access) and, for
v3, [Format version 3](#format-version-3).

### Can I use Iceberg v2 merge-on-read (row-level UPDATE and DELETE)?

Yes — set `formatVersion: IcebergFormatVersion.V2` and the
`write.{delete,update,merge}.mode = merge-on-read` table properties.
The construct rejects merge-on-read on a v1 table at synth time.

### Can I create an Iceberg v3 table?

Yes. Set `formatVersion: IcebergFormatVersion.V3`; the construct then
accepts `variant`, `unknown`, nanosecond timestamps, `geometry`, and
`geography` columns. Spark 4.1 with Iceberg 1.12 reads and writes the
result; Athena SQL does not read v3. See [Format version
3](#format-version-3) and [Known limitations](#known-limitations).

## Contributing

Development, the monorepo layout, and the demo app live in [CONTRIBUTING.md](https://github.com/ksco92/arceus/blob/main/CONTRIBUTING.md).

## License

[MIT](https://github.com/ksco92/arceus/blob/main/LICENSE).
