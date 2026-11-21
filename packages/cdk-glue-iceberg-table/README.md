# cdk-glue-iceberg-table

[![CI](https://img.shields.io/github/actions/workflow/status/ksco92/arceus/ci.yml?branch=main&label=CI)](https://github.com/ksco92/arceus/actions/workflows/ci.yml)
[![coverage](https://codecov.io/gh/ksco92/arceus/branch/main/graph/badge.svg)](https://codecov.io/gh/ksco92/arceus)
[![npm](https://img.shields.io/npm/v/cdk-glue-iceberg-table.svg)](https://www.npmjs.com/package/cdk-glue-iceberg-table)
[![PyPI](https://img.shields.io/pypi/v/cdk-glue-iceberg-table.svg)](https://pypi.org/project/cdk-glue-iceberg-table/)
[![Construct Hub](https://img.shields.io/badge/Construct%20Hub-available-blueviolet)](https://constructs.dev/packages/cdk-glue-iceberg-table)
[![downloads](https://img.shields.io/npm/dw/cdk-glue-iceberg-table.svg)](https://www.npmjs.com/package/cdk-glue-iceberg-table)
[![license](https://img.shields.io/npm/l/cdk-glue-iceberg-table.svg)](https://github.com/ksco92/arceus/blob/main/LICENSE)

**`cdk-glue-iceberg-table` is an AWS CDK L2 construct to create and
evolve Apache Iceberg tables in the AWS Glue Data Catalog — schema and
partition changes that survive CloudFormation updates, via cdk
deploy.** It supports Iceberg format version 3 (`variant`, nanosecond
timestamps, `geometry` / `geography`, `unknown`). It emits the exact
`AWS::Glue::Table` / `OpenTableFormatInput` shape, so a single `cdk
deploy` creates, evolves, and destroys a table like any other CDK
resource. No custom resource, no Lambda, no "`cdk deploy` and then run
this SQL by hand" two-step. Table changes (new columns, renames, drops,
new partition fields) land as a reviewed diff in a pull request and
apply through `cdk deploy`.

Status (October 2026): published on npm (TypeScript/JavaScript) and
PyPI (Python), pre-1.0, with a public surface guarded on every PR by two
consumer jobs (`e2e-consumer` compiles and synthesizes an app against a
pinned published version, `packed-consumer` does the same against the PR's
own `npm pack` tarball) plus real-AWS integration suites, including ones
for format version 3. The multi-language packages are generated
from one TypeScript source with [jsii](https://aws.github.io/jsii/)
and indexed on [Construct
Hub](https://constructs.dev/packages/cdk-glue-iceberg-table).
Developed in the [`ksco92/arceus`](https://github.com/ksco92/arceus)
monorepo, which also holds a CDK demo app that dogfoods the construct
against a real AWS account.

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
shape, refuses to emit the unsafe alternatives, and sends Iceberg field
IDs you declare (in [creation order](#using-icebergtable) for a new
table); a schema history file catches reuse of a retired id. It was the
basis of an upstream proposal to land an `IcebergTable` in
`@aws-cdk/aws-glue-alpha` ([aws/aws-cdk#37988](https://github.com/aws/aws-cdk/pull/37988)),
closed unmerged in September 2026.

### How it compares

| Approach | Declarative IaC (in the PR) | In-place schema + partition evolution | Prevents the silent-corruption footguns | Typed API + synth-time validation |
| --- | --- | --- | --- | --- |
| Raw `CfnTable` (L1) | ✅ | ⚠️ only if you hand-write the exact `OpenTableFormatInput` shape | ❌ you own both footguns | ❌ |
| CDK custom resource (Lambda + Glue SDK) | ⚠️ via a custom resource you maintain | ⚠️ you write the diff logic | ⚠️ your code's responsibility | ❌ |
| Spark SQL DDL, or Athena SQL DDL, at job runtime | ❌ imperative, outside the PR | ✅ but outside CloudFormation | n/a | ❌ |
| **`cdk-glue-iceberg-table`** | ✅ | ✅ via `cdk deploy` | ✅ the two [footguns](#two-footguns-the-construct-prevents) by construction; ⚠️ field-id reuse only with a [schema history file](#checking-changes-against-a-schema-history) | ✅ |

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
`snake_case` props and `PascalCase` types; nested values are passed as the
typed classes with `snake_case` arguments, and a plain dict keeps the
TypeScript key spelling:

```python
from aws_cdk.aws_s3 import Bucket
from aws_cdk.aws_glue import Database
from cdk_glue_iceberg_table import (
    IcebergColumn,
    IcebergFormatVersion,
    IcebergPartitionField,
    IcebergPartitionTransform,
    IcebergTable,
    IcebergType,
)

bucket = Bucket(self, "Warehouse")
db = Database(self, "Db", database_name="analytics")

IcebergTable(self, "OrdersTable",
    database=db,
    table_name="orders",
    location=f"s3://{bucket.bucket_name}/analytics/orders/",
    columns=[
        IcebergColumn(name="order_id", type=IcebergType.LONG, required=True, id=1),
        IcebergColumn(name="customer_id", type=IcebergType.LONG, required=True, id=2),
        IcebergColumn(name="placed_at", type=IcebergType.TIMESTAMPTZ, required=True, id=3),
    ],
    partition_spec=[
        IcebergPartitionField(source_column="placed_at", transform=IcebergPartitionTransform.DAY, field_id=1000),
        IcebergPartitionField(source_column="customer_id", transform=IcebergPartitionTransform.bucket(16), field_id=1001),
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
- [Glue behaviours the construct relies on](#glue-behaviours-the-construct-relies-on) — what each integration suite asserts about Glue.
- [FAQ](#faq) — common "how do I … in CDK / CloudFormation" questions.

## Exported surface

The package entry point re-exports the main types you import from
`cdk-glue-iceberg-table`. In TypeScript / JavaScript the compiled
surface lives under `dist/lib/iceberg/` after `npm install`; in Python
the same surface is imported from the `cdk_glue_iceberg_table` module
after `pip install`:

- **`IcebergTable`** — the L2 construct itself, with `grantRead` / `grantWrite` / `grantReadWrite` (each taking an optional `IcebergTableGrantOptions`), the `fromIcebergTableAttributes(...)` import factory, and `creationOrderFieldIds(columns)` (Python: `creation_order_field_ids`), which returns a map from field path to the id Glue gives that field in a new table; a name containing `.` or a backquote appears in backquotes.
- **`IcebergSchemaHistory`** — `validateSchemaEvolution(previous, next)` (Python: `validate_schema_evolution`), which returns the unsafe changes from a table's history record to a definition (`IcebergTableSchema`) as `IcebergSchemaViolation`s, each carrying an `IcebergSchemaViolationKind` that names the class of unsafe change; `append`, `toJson` and `fromJson`, which record a definition in, write and read the history file (`IcebergSchemaHistoryFile`, `IcebergTableHistory`, `IcebergFieldHistory`, `IcebergPartitionFieldHistory`); and `updateFromCloudAssembly(directory)`, which records every table of a synthesized app. See [Checking changes against a schema history](#checking-changes-against-a-schema-history).
- **`IcebergType`** — primitive types, the v3 constants `UNKNOWN`, `TIMESTAMP_NS`, `TIMESTAMPTZ_NS`, and `VARIANT`, and the `list` / `map` / `struct` / `decimal` / `fixed` / `geometry(crs?)` / `geography(crs?, algorithm?)` factories. `list` takes an `IcebergListDefinition`, `map` an `IcebergMapDefinition`, and `struct` a list of `IcebergStructFieldDefinition`, each carrying the nested field ids. Renders to the string Glue's `IcebergStructField.type` expects.
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
id, declared in creation order when the table is created (below), is
what lets you add, rename, and drop columns across deploys without
corrupting old data — see
[How do I evolve an Iceberg table schema](#how-do-i-evolve-an-iceberg-table-schema-add-rename-or-drop-a-column-in-cloudformation).
Once a column is dropped, leave its id retired; never hand it to a new
column. Nested fields follow the same rule: every struct field takes
an `id`, every list an `elementId`, and every map a `keyId` and a
`valueId`. All ids in a schema, top-level and nested, must be distinct
integers from 1 to 2147483447.

A new table must declare its ids in creation order. When Glue creates
a table it does not keep the declared ids: it numbers the fields from
1 in creation order and points the partition spec, sort order and
identifier fields at the new ids. An update Glue accepts stores the
declared ids as given, so the first such update of a table created
with other ids renumbers its fields; for the update Glue rejects, see
[Known limitations](#known-limitations). To number a new table, number
the top-level columns first, in order, then the nested fields of each
column in turn (a list's element; a map's key, then its value, then
the key's nested fields, then the value's; a struct's fields, then
their nested fields). `IcebergTable.creationOrderFieldIds` returns
these ids by field path and ignores the ids in its input:

```typescript
const columns = [
    { name: 'id', type: IcebergType.LONG, required: true, id: 1 },
    { name: 'tags', type: IcebergType.list({ element: IcebergType.STRING, elementId: 4 }), id: 2 },
    {
        name: 'attrs',
        type: IcebergType.map({ key: IcebergType.STRING, keyId: 5, value: IcebergType.STRING, valueId: 6 }),
        id: 3,
    },
];
IcebergTable.creationOrderFieldIds(columns);
// { id: 1, tags: 2, attrs: 3, 'tags.element': 4, 'attrs.key': 5, 'attrs.value': 6 }
```

Ids out of creation order are for fields a later deploy adds; see
[Evolving schema and partitions](#evolving-schema-and-partitions).

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
            type: IcebergType.list({
                element: IcebergType.STRING,
                elementId: 9,
            }),
            id: 6,
        },
        {
            name: 'shipping_address',
            type: IcebergType.struct([
                {
                    id: 10,
                    name: 'line1',
                    type: IcebergType.STRING,
                    required: true,
                },
                {
                    id: 11,
                    name: 'city',
                    type: IcebergType.STRING,
                    required: true,
                },
                {
                    id: 12,
                    name: 'country',
                    type: IcebergType.STRING,
                    required: true,
                },
                {
                    id: 13,
                    name: 'postal_code',
                    type: IcebergType.STRING,
                },
            ]),
            id: 7,
        },
        {
            name: 'metadata',
            type: IcebergType.map({
                key: IcebergType.STRING,
                keyId: 14,
                value: IcebergType.STRING,
                valueId: 15,
            }),
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

`identifierFieldNames` lists the columns that together identify a row
and renders as the schema's `identifier-field-ids`. Each one must be a
`required: true` column (Glue rejects an optional one), and `cdk synth`
rejects an identifier column of type float, double, list, map, struct,
unknown, variant, geometry or geography. The construct prefixes each
identifier column's `doc` with `(PK) `, so a `doc` you write must not
start with `(PK) `; see [Evolving schema and
partitions](#evolving-schema-and-partitions).

Every string you pass is a literal string, not a token, and an
enum-typed one must be a member of its enum; the exceptions are
`location`, `comment`, table property values, `tableName` and
`catalogId`.

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
        { "id": 1, "name": "order_id", "required": true, "type": "long", "doc": "(PK) " },
        { "id": 2, "name": "customer_id", "required": true, "type": "long" },
        { "id": 3, "name": "order_amount", "required": true, "type": "decimal(12, 2)" },
        { "id": 4, "name": "currency", "required": true, "type": "string" },
        { "id": 5, "name": "placed_at", "required": true, "type": "timestamptz" },
        { "id": 6, "name": "tags", "required": false,
          "type": { "type": "list", "element-id": 9, "element": "string", "element-required": false } },
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
    IcebergTable,
    IcebergType,
} from 'cdk-glue-iceberg-table';

new IcebergTable(this, 'Events', {
    database: db,
    tableName: 'events',
    location: `s3://${bucket.bucketName}/analytics/events/`,
    columns: [
        { name: 'occurred_at', type: IcebergType.TIMESTAMP_NS, id: 1 },
        { name: 'payload',     type: IcebergType.VARIANT,      id: 2 },
        {
            name: 'origin',
            type: IcebergType.geography('OGC:CRS84', IcebergEdgeAlgorithm.SPHERICAL),
            id: 3,
        },
    ],
    formatVersion: IcebergFormatVersion.V3,
});
```

The same table in Python:

```python
from cdk_glue_iceberg_table import (
    IcebergColumn,
    IcebergEdgeAlgorithm,
    IcebergFormatVersion,
    IcebergTable,
    IcebergType,
)

IcebergTable(self, "Events",
    database=db,
    table_name="events",
    location=f"s3://{bucket.bucket_name}/analytics/events/",
    columns=[
        IcebergColumn(name="occurred_at", type=IcebergType.TIMESTAMP_NS, id=1),
        IcebergColumn(name="payload", type=IcebergType.VARIANT, id=2),
        IcebergColumn(
            name="origin",
            type=IcebergType.geography("OGC:CRS84", IcebergEdgeAlgorithm.SPHERICAL),
            id=3,
        ),
    ],
    format_version=IcebergFormatVersion.V3,
)
```

This table has a `timestamp_ns` column; see [Known limitations](#known-limitations)
before reading it from upstream Spark.

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
| Spark 4.1.1 + Iceberg 1.11.0 (the integration-test runner) | Yes | Reads and writes tables the construct creates, including deletion vectors, row lineage, `variant` and `unknown`, except tables with a `geometry`, `geography` or nanosecond-timestamp column ([Known limitations](#known-limitations)). |
| AWS Glue 6.0 | Documented | The [AWS Glue versions](https://docs.aws.amazon.com/glue/latest/dg/release-notes.html) page lists "Iceberg format version 3 with VARIANT data type, deletion vectors, row lineage tracking, nanosecond timestamps, and geo types". The integration suites run on Glue 6.0's Spark 4.1.1 and Iceberg 1.11.0 (`scripts/spark/spark-env.sh`); the Glue job runtime itself is not exercised. |
| Amazon EMR Spark 8.1.0 (Spark 4.1.1, Iceberg 1.11.0-amzn-0) | Documented | The [emr-spark-8.1.0 release notes](https://docs.aws.amazon.com/emr/latest/ReleaseGuide/emr-spark810-release.html) state "Amazon EMR Spark 8.1.0 extends Iceberg v3 spec support for Spark workloads". The integration suites do not run on EMR 8.1. |
| Athena SQL | No | The [Athena Iceberg page](https://docs.aws.amazon.com/athena/latest/ug/querying-iceberg.html) states "Athena only creates and operates on Iceberg v2 tables." The v2 integration suites also run through Athena (see [Does it work with Athena and Lake Formation?](#does-it-work-with-athena-and-lake-formation)); no v3 table is queried through Athena. |

### Granting access

```typescript
const table = new IcebergTable(this, 'Orders', {
    // ...
    encryptionKey: bucketKey,        // the key the table's bucket encrypts objects with
});
table.grantRead(role);
table.grantWrite(role);
table.grantReadWrite(role, {
    catalogEncryptionKey: catalogKey, // the Data Catalog's SSE-KMS key
    lakeFormationDataAccess: true,    // Athena on a location registered with Lake Formation
});
```

Each method issues these statements and no others:

| Statement | `grantRead` | `grantWrite` | `grantReadWrite` | Resource |
| --- | --- | --- | --- | --- |
| Glue | `glue:BatchGetPartition`, `glue:GetDatabase`, `glue:GetPartition`, `glue:GetPartitions`, `glue:GetTable`, `glue:GetTables`, `glue:GetTableVersion`, `glue:GetTableVersions` | `glue:BatchCreatePartition`, `glue:BatchDeletePartition`, `glue:CreatePartition`, `glue:DeletePartition`, `glue:UpdatePartition`, `glue:UpdateTable` | both lists | the catalog, database and table ARNs, in the stack account or the [`catalogId`](#catalog-account-and-tokenized-table-names) |
| S3 list | `s3:ListBucket` | none | `s3:ListBucket` | the bucket, with condition `StringLike` `s3:prefix` = `<prefix>*` or `<prefix>` |
| S3 bucket | `s3:GetBucketLocation` | `s3:ListBucketMultipartUploads` | both | the bucket |
| S3 objects | `s3:GetObject` | `s3:PutObject`, `s3:DeleteObject`, `s3:AbortMultipartUpload`, `s3:ListMultipartUploadParts` | both lists | `<bucket>/<prefix>*` |
| Table key, when `encryptionKey` is set | `kms:Decrypt` | `kms:Decrypt`, `kms:GenerateDataKey` | `kms:Decrypt`, `kms:GenerateDataKey` | the key |
| Catalog key, when `catalogEncryptionKey` is passed | `kms:Decrypt` | `kms:Decrypt`, `kms:Encrypt`, `kms:GenerateDataKey` | `kms:Decrypt`, `kms:Encrypt`, `kms:GenerateDataKey` | the key |
| Lake Formation, when `lakeFormationDataAccess` is `true` | `lakeformation:GetDataAccess` | `lakeformation:GetDataAccess` | `lakeformation:GetDataAccess` | `*` |

The KMS statements are on the whole key: `IKey.grant` adds no
encryption-context condition, so a key shared with other data (a bucket
or lake key, the catalog key) is covered for everything it encrypts,
not only this table.

`lakeformation:GetDataAccess` is the one statement on `*`, because Lake
Formation supports no resource for it. It is issued only with
`lakeFormationDataAccess: true`; with it, Lake Formation vends
credentials for every table the principal holds Lake Formation
permissions on, which includes tables open to `IAM_ALLOWED_PRINCIPALS`.

Pass `catalogEncryptionKey` when the Data Catalog is encrypted with a
customer managed key.

Lake Formation permissions themselves (`AWS::LakeFormation::Permissions`)
are yours to create:

```typescript
import { CfnPermissions } from 'aws-cdk-lib/aws-lakeformation';

new CfnPermissions(this, 'OrdersReader', {
    dataLakePrincipal: { dataLakePrincipalIdentifier: role.roleArn },
    resource: {
        tableResource: {
            catalogId: this.account,
            databaseName: table.database.databaseName,
            name: table.tableName,
        },
    },
    permissions: ['SELECT', 'DESCRIBE'],
});
```

Add `INSERT`, `DELETE` and `ALTER` for a principal that writes.

In Python the new names are `encryption_key`, and the grant options are
the keyword arguments `lake_formation_data_access` and
`catalog_encryption_key`.

Upgrading from a version before 0.17.0: existing `grantRead`,
`grantWrite` and `grantReadWrite` policies change with no code edit.
The Glue statement names the catalog and database ARNs as well as the
table, and read grants add `glue:GetDatabase`. Nothing for KMS or Lake
Formation is issued unless the new prop or options are passed.

### Importing an existing table

```typescript
const existing = IcebergTable.fromIcebergTableAttributes(this, 'Orders', {
    database: db,
    tableName: 'orders',
    location: 's3://my-bucket/analytics/orders/',
    encryptionKey: bucketKey, // optional; grants then cover the key
    catalogId: '111122223333', // optional; see below
});
existing.grantRead(role);
```

### Catalog account and tokenized table names

`catalogId` (Python `catalog_id`) on `IcebergTable` and on the import
attributes is the account id of the Glue Data Catalog that holds the
table. It is 12 digits or a single token (`Stack.of(this).account`,
`Aws.ACCOUNT_ID`, a `CfnParameter`); a string that mixes literal text
with a token is rejected. Omitting it changes nothing: the table is
created in the stack's account and `tableArn` and every grant keep
their policies. When set, it is the table's `CatalogId` and the account
in the catalog, database and table ARNs of `tableArn` and of every
grant; the database ARN is then built from `database.databaseName` and
that account, whatever account the `IDatabase` names. The database must
already exist in that catalog: a `Database` construct in the stack
creates one in the stack's account. The construct does not set up
cross-account access: the resource policy of the catalog, the Lake
Formation permissions and the IAM permissions of the deploying role in
that account are yours.

`tableName` may be a token, such as a `CfnParameter` or a cross-stack
reference. A literal is checked against `^[a-z0-9_]+$`; in a string that
mixes literal text with a token, the literal text is checked against
`^[a-z0-9_]*$`. A token is rendered as given in the template and in the
table ARN, for `tableName` and `catalogId` alike, so its deploy-time
value is the deployer's responsibility. A `tableName` of `*` would make
every grant on the table cover every table in the database. A table
with a token `tableName` cannot set `schemaHistoryFile`, because a
record is looked up by name at synth.

### Evolving schema and partitions

Change the `columns` array (or `partitionSpec`) and run `cdk deploy`
again. The construct passes the new schema to Glue's `UpdateTable`,
which writes a new `metadata.json` with a new `schema-id`; existing
data files stay readable while each column keeps its id and no
column takes the id of a dropped one: declare the ids the table holds,
and a [schema history file](#checking-changes-against-a-schema-history) rejects reuse. Adds, renames (same `id`, new
`name`), and drops all flow through `cdk deploy` alone — no
out-of-band SQL DDL.

Nested fields evolve the same way. Each struct field, list element,
map key, and map value keeps the id you gave it (the rule is under
[Using `IcebergTable`](#using-icebergtable)), so adding a column or a
struct field anywhere in the schema leaves every other id unchanged. A
new nested field takes an id no field of the table has ever used:

```typescript
type: IcebergType.struct([
    { id: 10, name: 'line1', type: IcebergType.STRING },
    { id: 16, name: 'line2', type: IcebergType.STRING }, // new field, never-used id
    { id: 11, name: 'city', type: IcebergType.STRING },
]),
```

Such an id is out of creation order, which is expected once a table
has evolved: creation order applies only to the ids a table is created
with (see [Using `IcebergTable`](#using-icebergtable)).

Upgrading from a version before 0.12.0, which numbered nested fields
itself: declare the ids the table's current `metadata.json` holds,
top-level and nested (each field `id`, `element-id`, `key-id` and
`value-id`), or the next deploy renumbers the fields that differ and
existing data files read under the wrong field. A nested type object
shared by two columns now fails synth with a duplicate id; give each
column its own nested type with its own ids. The list element and map
value nullability default also changed: `elementRequired` and
`valueRequired` now default to `false`. Earlier versions made list
elements required by default and map values required unless the third
argument of `map` was `false`; set `elementRequired: true` or
`valueRequired: true` wherever the deployed schema has
`"element-required": true` or `"value-required": true`.

Glue's `UpdateTable` reuses an earlier schema whose fields (name,
type, `required`, `doc`) match the request, together with that
schema's `identifier-field-ids`. The construct therefore prefixes the
`doc` of every identifier column with `(PK) ` (just `(PK) ` when the
column has no `doc`), shown as the column comment, so every
identifier change is a field change. On a table whose schema history
was written with the marker, identifier changes flow through `cdk
deploy` like column changes.

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

A changed `sortOrder` also flows through `cdk deploy`. Glue adds it to
`sort-orders` under the next `order-id` and points
`default-sort-order-id` at it; the earlier orders stay in the list.
A change to `tableProperties` alone writes new metadata that keeps the
same `current-schema-id`, partition spec and sort order.

### Checking changes against a schema history

The construct never reads the deployed table, so on its own it cannot
tell that an id belonged to a field dropped two deploys ago. A schema
history file committed beside the app gives synth that record without
an AWS call. Point `schemaHistoryFile` at the history file of the
table's database:

```typescript
new IcebergTable(this, 'Orders', {
    // ...
    schemaHistoryFile: path.join(__dirname, 'analytics.schema-history.json'),
});
```

A relative path resolves against the working directory, which is the
directory holding `cdk.json` when the `cdk` CLI runs the app. Create
the file once with the content `{"tables": []}`; if a table already
exists in Glue, read
[Adopting a table that exists in Glue](#adopting-a-table-that-exists-in-glue)
first. Records are keyed by table name, so give each Glue database its
own file.

Every synth (`cdk synth`, `cdk diff`, `cdk deploy`, and the CI job
that runs one) then compares each table with its record and fails,
listing every problem, when the definition:

- gives a column or nested field id in the record to a different
  field: a dropped field's id, or the id of a field whose
  path is still in the definition under another id;
- keeps a field's path but changes its id, as in the nested ids
  `4, 5, 6` becoming `5, 6, 7` after a column is added;
- changes a field's type, except `int` to `long`, `float` to `double`,
  and a wider decimal precision at the same scale;
- makes an optional field required;
- drops a column that any recorded partition spec was sourced from;
- keeps a partition `fieldId` with a different source column or
  transform.

Fields are identified by id, so a rename passes. A table with no
record is a new table: synth fails unless its ids are the ones Glue
assigns at creation (the rule is under
[Using `IcebergTable`](#using-icebergtable)), listing each field with
its declared id and the id Glue assigns, so the first record of a table
is written from a creation-order schema. A table with a record is not
held to creation order. Synth never writes the file; record a change
once it passes synth, and commit the file with the change:

```bash
cdk synth --quiet
node -e "console.log(require('cdk-glue-iceberg-table').IcebergSchemaHistory.updateFromCloudAssembly('cdk.out'))"
```

From a Python app, the second command is:

```bash
python -c "from cdk_glue_iceberg_table import IcebergSchemaHistory; print(IcebergSchemaHistory.update_from_cloud_assembly('cdk.out'))"
```

`updateFromCloudAssembly` records every table of the assembly that
sets `schemaHistoryFile` in that file and returns the files it wrote.
The record keeps every id the table has used: a dropped field stays
with `"dropped": true`, and a partition field stays after it leaves
the spec. The file must already exist, and nothing is written when any
table is an unsafe change. A column replaced under the same name needs
two recorded changes: drop it, then add it with a new id.

`IcebergSchemaHistory.validateSchemaEvolution(previous, next)` runs
the same checks on one table record without the prop, and
`IcebergSchemaHistory.append`, `toJson` and `fromJson` record a
definition in, write and read the file format.

#### Adopting a table that exists in Glue

Glue ignores the ids a table declares when it creates the table and
stores them as given from the first update of any kind. Before
recording anything, make the declared ids, top-level and nested, equal
the ids in the table's current `metadata.json`, whose location is the
table's `metadata_location` parameter (`aws glue get-table`). If those
ids are in creation order, declare them and write no record by hand:
that covers a table created in creation order and a table created out
of order and never updated, which holds creation-order ids whatever it
declared. Otherwise write the record from the definition that now
declares the table's ids; `IcebergSchemaHistory.append` and `toJson`
do not run the creation-order check:

```typescript
const history = IcebergSchemaHistory.append({ tables: [] }, 'orders', { columns, partitionSpec });
fs.writeFileSync('analytics.schema-history.json', IcebergSchemaHistory.toJson(history));
```

From a Python app (`partition_spec` is optional, and the history is
passed on to the next `append` for another table):

```python
history = IcebergSchemaHistory.append({"tables": []}, "orders", columns=columns, partition_spec=partition_spec)
with open("analytics.schema-history.json", "w") as f:
    f.write(IcebergSchemaHistory.to_json(tables=history.tables))
```

Remove a table's record from the file before the table is dropped and
recreated: Glue assigns fresh ids at the new CREATE, so the new table
declares creation-order ids.

Upgrading from a version before 0.18.0: an app that sets
`schemaHistoryFile` and has a table with no record whose ids are not in
creation order now fails synth; follow the steps above.

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
the construct prevents only with a [schema history
file](#checking-changes-against-a-schema-history). See the next
section.)

## Known limitations

- **Creation order is checked only with a schema history file.** Without the file the construct does not detect ids that Glue will reassign at creation; with it, a table with no record is checked ([rule](#checking-changes-against-a-schema-history)). When the first update of such a table changes the id of a column an identity partition is sourced from, Glue rejects the update with `Cannot create identity partition sourced from different field in schema` and the CloudFormation rollback fails the same way, leaving the stack in `UPDATE_ROLLBACK_FAILED`.
- **Field-id reuse across deploys is detected only with a schema history file.** This applies to nested ids (struct field, list element, map key and value) as well as column ids. If you drop a column with `id = 5` and then add a different column with `id = 5` in a later deploy, Glue accepts the UPDATE and Iceberg's metadata silently violates the "never reuse a retired id" invariant. Readers projecting old snapshots will surface deleted data under the new field's name. The construct enforces uniqueness **within one deploy** (`duplicate field id N` validator) and never reads the live table state; across deploys, only a [schema history file](#checking-changes-against-a-schema-history) catches reuse. Without it, treat dropped ids as retired forever.
- **Partition field-id reuse across deploys is detected only with a schema history file.** The same live-state blindness applies to partition `fieldId`s: the construct validates them within one deploy (integer >= 1000, unique in the spec), and only a [schema history file](#checking-changes-against-a-schema-history) tells it that the id you pinned already appeared in an earlier spec of the deployed table. The invariant partition ids must uphold is stricter than the column one — unique across the table's **entire spec history**, so a changed field (different transform or source column) must take a fresh id rather than keep its old one. Violate it and strict engines (Spark, Trino) reject the table with `Conflicting partition fields` while Athena keeps answering, masking the break until Spark runtime. Without the history file, treat every id that has ever appeared in any spec as retired, and allocate new fields the next never-used id. A partition change needs a new source column or transform; Glue ignores a `fieldId`-only change.
- **`last-partition-id` is written by Glue, not by the construct.** The construct supplies the spec's field ids; Glue's `UpdateTable` computes the table's `last-partition-id` counter when it writes the new metadata. The integration suites assert the counter is at least the highest supplied field id after a partition evolution ([pinned](#glue-behaviours-the-construct-relies-on)), but engines that later evolve the spec themselves (e.g. Spark `ALTER TABLE … ADD PARTITION FIELD`) allocate from that counter — if you mix CDK-managed and engine-managed partition evolution, verify the counter in `metadata.json` before trusting engine-side changes.
- **A rolled-back deploy leaves its schema in the table's history.** When a deploy that adds a column updates the table and then fails on another resource, the stack ends in `UPDATE_ROLLBACK_COMPLETE` and `current-schema-id` is back to its earlier value, so the column is gone and the rows read as before. The schema that held the column stays in `schemas`, and `last-column-id` stays at the column's id. A clean redeploy of the same change makes that schema current again without adding a schema. Treat an id from a rolled-back deploy as used: give it only to the column that deploy added.
- **Removing the last identifier from a table created with identifiers before 0.11.0 can bring the old ids back.** That table's history holds an unmarked schema with ids, and Glue reuses it when the rendered fields match it again. Change a column `doc` in the same deploy that removes the last identifier.
- **The schema history check covers only the changes it lists.** It does not see a change an engine makes with `ALTER TABLE` (Spark, Athena), whose ids the file never records, or a deploy whose definition was not recorded in the file. No integration suite deploys a table after an engine-side `ALTER TABLE`, so what a deploy does to such a table is not observed. It does not check sort order or identifier field changes or report an added required field, top level or nested, and it treats a field moved into another struct under its id as a rename. It reports the format v3 promotions `unknown` to any type and `date` to `timestamp` or `timestamp_ns` as type changes.
- **CREATE-only metadata operation.** The CFN `IcebergInput.metadataOperation` only accepts `CREATE`; the construct always emits that. Subsequent deploys use Glue's normal `UpdateTable` path, which writes new Iceberg metadata in-place.
- **Format version is immutable after CREATE.** Glue ignores a V2 to V3 `formatVersion` change, though `properties.format-version` then reads `3`. Keep `formatVersion` at the table's real version, or destroy + recreate the table to change it (remove its [schema history record](#adopting-a-table-that-exists-in-glue) first). An engine can upgrade a v2 table to v3 in place with `ALTER TABLE ... SET TBLPROPERTIES ('format-version' = '3')`; after that, set `formatVersion` to `V3` so the next deploy declares the version the table already has.
- **`merge-on-read` requires v2 or later.** The construct rejects `write.{delete,update,merge}.mode = merge-on-read` on a v1 table at synth time.
- **Column defaults are not available.** Iceberg v3 `initial-default` and `write-default` cannot be declared through CloudFormation: the `AWS::Glue::Table` resource schema has no `InitialDefault` or `WriteDefault` property. Revisit when that schema gains the two properties.
- **Nanosecond timestamps are catalog-only for Spark 4.1.1 with Iceberg 1.11.0.** In [`TypeToSparkType`](https://github.com/apache/iceberg/blob/apache-iceberg-1.11.0/spark/v4.1/spark/src/main/java/org/apache/iceberg/spark/TypeToSparkType.java) at the `apache-iceberg-1.11.0` tag, `primitive()` has no case for the `TIMESTAMP_NANO` type id, so a table with a `timestamp_ns` or `timestamptz_ns` column reaches the `Cannot convert unsupported type to Spark` error. The integration suite asserts these columns from `metadata.json` only.
- **Geometry and geography columns are catalog-only for Spark 4.1.1 with Iceberg 1.11.0, the versions AWS Glue 6.0 ships.** The first Spark read of a table holding a `geography` and a `geometry` column failed with `UnsupportedOperationException: Cannot convert unsupported type to Spark: geography(OGC:CRS84, spherical)` on those versions. [`TypeToSparkType`](https://github.com/apache/iceberg/blob/apache-iceberg-1.11.0/spark/v4.1/spark/src/main/java/org/apache/iceberg/spark/TypeToSparkType.java) at the `apache-iceberg-1.11.0` tag has no conversion for `geometry` either. The integration suite deploys these columns on a table no Spark job opens and asserts them from `metadata.json` only.
- **Athena DDL features that don't surface through CFN** (e.g. `ALTER TABLE … SET LOCATION`, `bucketed_by` / `bucket_count` Hive clauses) are not exposed. Use `IcebergPartitionTransform.bucket(N)` instead of Hive bucketing.
- **Dropping a partition column requires a `void` intermediate per the Iceberg spec**, and the CFN `OpenTableFormatInput` cannot express that. The construct accepts the change unless a [schema history file](#checking-changes-against-a-schema-history) records the column as a partition source, and Athena queries against the result will fail with `Type cannot be null`. The safe pattern is to drop partitions that source from a column while keeping that column in the schema, and only drop a column once it is no longer partitioning anything.

## Glue behaviours the construct relies on

AWS does not document these behaviours of Glue as contracts; each row
holds as of the last green Integration test run and is asserted by the
script and assertion named, which `grep` finds. Two more are relied on
and asserted by no suite: the canonical `decimal(P, S)` spacing, and
Glue deduping identical partition specs. For engine-side `ALTER TABLE`,
see [Known limitations](#known-limitations).

| Observed | Script and assertion |
| --- | --- |
| CREATE renumbers fields in creation order ([rule](#using-icebergtable)). | `scripts/integration-test-surface.sh`: `assert_stored_ids creation_order_test` under `VERIFY 2b`; `VERIFY 2a` for tables declared in creation order. |
| UpdateTable stores declared column and nested ids as given, including an id out of creation order and the gap a dropped column leaves. | `scripts/integration-test-evolution.sh`: `assert_nested_ids` under `VERIFY step 8`, `assert_columns` under `VERIFY step 12`, `last-column-id stays at 4 — id reuse protection` under `VERIFY step 4`. |
| On a v3 table the partition field ids and `last-partition-id` after a partition evolution are `1002:month,1001:hour` and 1002; in both evolution scripts `last-partition-id` is at least the highest declared id. | `scripts/integration-test-v3-evolution.sh`: `verify_step` and `assert_equals "last-partition-id" "1002"` at step 4. `assert_partition_history`, called from both evolution scripts, fails on `STALE COUNTER` and on `CONFLICT`. |
| An update whose fields match an earlier schema makes that schema current again and adds none, though the construct sends `schemaId: 0`. | `scripts/integration-test-evolution.sh`: `assert_meta schema-id "$ROLLED_BACK_SCHEMA_ID"` and `assert_meta schemas-count $((SCHEMAS_BEFORE + 1))` under `VERIFY step 12`. |
| Property-only update ([paragraph](#evolving-schema-and-partitions)). | `scripts/integration-test-evolution.sh`: `assert_meta commit-retries 5`, `assert_same "rest of metadata.json unchanged"` under `VERIFY step 9`. |
| Changed sort order ([paragraph](#evolving-schema-and-partitions)). | `scripts/integration-test-evolution.sh`: `assert_meta sort-orders`, `assert_meta default-sort-order-id 2` under `VERIFY step 10`. |
| A changed `identifierFieldNames` on a `(PK) `-marked table changes `identifier-field-ids`. | `scripts/integration-test-evolution.sh`: `assert_identifiers "2" "contact_email"` under `VERIFY step 6`. |
| Rolled-back deploy ([limitation](#known-limitations)). | `scripts/integration-test-evolution.sh`: `stack status`, `current schema, columns and orders as before step 11`, `assert_meta last-column-id 5`, `assert_meta schemas-count` under `VERIFY step 11`. |

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
readable while each column keeps its id and no column takes the id of
a dropped one; a [schema history file](#checking-changes-against-a-schema-history) rejects reuse.
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
types, format/version mismatches caught before deploy), field IDs
you declare (in creation order for a new table, with a [schema history file](#checking-changes-against-a-schema-history) checking reuse),
and `grantRead` / `grantWrite` helpers. See
[How it compares](#how-it-compares).

### How do I create a partitioned Iceberg table in CDK?

Pass a `partitionSpec` of `IcebergPartitionTransform` entries —
`identity`, `bucket(N)`, `truncate(W)`, `year`, `month`, `day`, `hour`,
or `void` — each pinned to a `fieldId` of 1000 or above. Transforms are
validated against their source column's type at synth time. See
[Using `IcebergTable`](#using-icebergtable).

### Does it work with Athena and Lake Formation?

Yes for v2 tables, no for v3 (see the engine matrix in [Format
version 3](#format-version-3)). The demo app in the
[`arceus`](https://github.com/ksco92/arceus) repo registers its tables
with Lake Formation, and its v2 integration suites query them through
Athena as well as Spark, on the same tables:

- merge-on-read `INSERT`, `UPDATE`, `DELETE` and `MERGE INTO`, time
  travel (`FOR VERSION AS OF` / `FOR TIMESTAMP AS OF`), `OPTIMIZE ...
  REWRITE DATA USING BIN_PACK`, and `VACUUM`;
- a read after every schema, partition, identifier and nested-field
  evolution step;
- the `(PK) ` comment on identifier columns, read from
  `information_schema.columns`;
- rows written by Spark read through Athena, and rows written by Athena
  read through Spark;
- reads and writes through Spark and Athena as roles whose table
  permissions come from `grantRead` and `grantReadWrite`, and a denied
  write as the `grantRead` role.

The suites grant the querying principal `SELECT`, `INSERT`, `DELETE`,
`ALTER` and `DESCRIBE` through Lake Formation. See [Granting access](#granting-access).

### Can I use Iceberg v2 merge-on-read (row-level UPDATE and DELETE)?

Yes — set `formatVersion: IcebergFormatVersion.V2` and the
`write.{delete,update,merge}.mode = merge-on-read` table properties.
The construct rejects merge-on-read on a v1 table at synth time.

### Can I create an Iceberg v3 table?

Yes. Set `formatVersion: IcebergFormatVersion.V3`; see [Format
version 3](#format-version-3) for the types, the engine matrix and the
limits.

## Contributing

Development, the monorepo layout, and the demo app live in [CONTRIBUTING.md](https://github.com/ksco92/arceus/blob/main/CONTRIBUTING.md).

## License

[MIT](https://github.com/ksco92/arceus/blob/main/LICENSE).
