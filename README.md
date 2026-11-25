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
deploy.** You declare a table's columns and partition fields in your
CDK app. Adding, renaming or dropping a column, or changing the
partition spec, is an edit to that declaration: it lands as a reviewed
diff in a pull request and applies through `cdk deploy`.

- **Plain CloudFormation.** The template holds a plain
  `AWS::Glue::Table`: no custom resource, no Lambda, no SQL to run by
  hand.
- **The safe shape only.** The construct cannot emit the two
  hand-written `AWS::Glue::Table` shapes that [go
  wrong](#why-a-raw-cfntable-goes-wrong).
- **Checked at synth.** Column types and partition transforms are
  typed, and `cdk synth` rejects a transform that does not fit its
  source column's type.
- **TypeScript and Python**, generated from one TypeScript source with
  [jsii](https://aws.github.io/jsii/). Iceberg format versions 1, 2
  and 3; Athena cannot query v3 tables.

**What it leaves to you.** You choose every Iceberg field id, and the
construct keeps no record of earlier deploys, so it cannot check the
ids you declare against the ids the table has used. Glue accepts two
mistakes without an error. Give a dropped column's id to a new column
of the same type, and Spark and Athena read the dropped column's
values, in rows written before the drop, as the new column's. Number a
new table out of creation order, and Glue ignores the declared ids at
creation and renumbers the fields to them on the first update it
accepts. Three [field id rules](#the-field-id-rules) prevent both. The
rest is under [Known limitations](#known-limitations).

**Status:** pre-1.0, with a 1.0 release planned. A breaking change
bumps the minor version and gets a note in
[UPGRADING.md](https://github.com/ksco92/arceus/blob/main/UPGRADING.md).
The package has one maintainer. Its source is public, and the template
it emits is a plain `AWS::Glue::Table` in the shape described under [Why a
raw CfnTable goes wrong](#why-a-raw-cfntable-goes-wrong). It was
proposed upstream as an `IcebergTable` for `@aws-cdk/aws-glue-alpha`
([aws/aws-cdk#37988](https://github.com/aws/aws-cdk/pull/37988)); the
aws-cdk repository's stale-PR automation closed that pull request in
September 2026 after three weeks in merge conflicts, and this package
does not depend on it.

**How it is tested.**

- Integration suites deploy v2 and v3 tables to a real AWS account and
  read them back through Spark, and the v2 tables through Athena. They
  run weekly against `main` and, before merge, on every pull request
  that changes the construct, the demo stacks or the suites.
- Every pull request compiles and synthesizes a consumer app against a
  published version and against the pull request's own `npm pack`
  tarball.

**Versions.** The README on GitHub describes `main`, which can be
ahead of the latest release; [CHANGELOG.md](https://github.com/ksco92/arceus/blob/main/CHANGELOG.md)
lists what is unreleased, and the npm page shows the README of the
released version. API reference: [Construct
Hub](https://constructs.dev/packages/cdk-glue-iceberg-table).

## Install

```bash
npm install cdk-glue-iceberg-table      # TypeScript / JavaScript
pip install cdk-glue-iceberg-table      # Python
```

Your CDK app must already have the peer dependencies `aws-cdk-lib`
2.273.0 or newer and `constructs` 10.8.1 or newer:

```bash
npm install aws-cdk-lib@^2.273.0 constructs@^10.8.1        # TypeScript / JavaScript
pip install 'aws-cdk-lib>=2.273.0' 'constructs>=10.8.1'    # Python
```

Both languages need Node.js 22.14 or newer (the Python package runs
under it through jsii); Python needs 3.10 or newer.

Upgrading from an earlier version: see
[UPGRADING.md](https://github.com/ksco92/arceus/blob/main/UPGRADING.md),
whose notes start at 0.12.0.

## Quick start

Both examples go inside a stack's constructor in an existing CDK app.

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

`cdk deploy` creates the Glue Data Catalog table and writes the
Iceberg `metadata.json` under the S3 prefix in `location`.

### Python

The same table in Python. Props are `snake_case` and type names are
the same as in TypeScript. Pass each column and partition field as its
class (`IcebergColumn`, `IcebergPartitionField`) with `snake_case`
arguments; a plain dict instead keeps the TypeScript key spelling
(`sourceColumn`, `fieldId`):

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

### The field id rules

The `id` and `fieldId` numbers in the examples are Iceberg field ids.
Data files store values under these ids, not under column names, and
you choose them:

1. **Declare a new table's ids in creation order: columns 1, 2, 3 and
   so on in the order declared, then their nested fields.** Glue
   numbers a new table this way whatever ids it declares; if the
   declared ids differ, the first update Glue accepts renumbers the
   fields to them, and data files written before it read under the
   wrong field. The construct cannot tell a first deploy from a later
   one, so it does not check creation order;
   `IcebergTable.creationOrderFieldIds(columns)` returns the ids to
   declare ([creation order](#creation-order)).
2. **A column keeps its id for life, and a dropped column's id is
   retired.** A rename keeps the `id` and changes the `name`; a new
   column takes an id above the table's `last-column-id`, the highest
   id it has assigned ([how to read it](https://github.com/ksco92/arceus/blob/main/docs/field-ids.md#which-ids-the-table-has-used)). Give a dropped
   column's id to a new column of the same type and Glue accepts the
   deploy; Spark and Athena then read the dropped column's value, in a
   row written before the drop, as the new column's value.
3. **A partition field takes a `fieldId` of 1000 or above and keeps it
   only while it stays untouched.** Swap `month` for `day` or point
   the field at another source column, and it becomes a new field that
   needs a `fieldId` no partition spec of the table has used. Give
   `bucket(8)` of a column the id that `bucket(4)` of that column
   held, and Athena still reads the table while a Spark `SELECT *`
   from it fails with `ValidationException: Conflicting partition
   fields`. At creation Glue numbers the fields itself: see [Partition
   fields](#partition-fields).

The construct checks the ids of one definition (valid and unique) and
nothing across deploys. Each rule has a worked example on the [field
ids](https://github.com/ksco92/arceus/blob/main/docs/field-ids.md)
page.

## Evolving a table

Change the `columns` array or the `partitionSpec` and run `cdk deploy`
again. To add a column to the quick-start table, give it an id the
table has never used:

```ts
    columns: [
        { name: 'order_id',    type: IcebergType.LONG,        required: true, id: 1 },
        { name: 'customer_id', type: IcebergType.LONG,        required: true, id: 2 },
        { name: 'placed_at',   type: IcebergType.TIMESTAMPTZ, required: true, id: 3 },
        { name: 'currency',    type: IcebergType.STRING,                      id: 4 }, // new
    ],
```

The construct passes the new schema to Glue's `UpdateTable`, which
writes a new `metadata.json` with a new `schema-id`. Existing data
files stay readable while the ids follow [rule 2](#the-field-id-rules).
Adds, renames (same `id`, new `name`) and drops all go through `cdk
deploy` alone. On a v3 table the suites also deploy two type
promotions, `unknown` to `string` and `date` to `timestamp`; no suite
deploys any other type change.

### Nested fields

Nested fields evolve the same way. Each struct field, list element,
map key, and map value keeps the id you gave it, so adding a column or
a struct field anywhere in the schema leaves every other id unchanged.
A new nested field takes an id no field of the table has ever used:

```typescript
type: IcebergType.struct([
    { id: 10, name: 'line1', type: IcebergType.STRING },
    { id: 16, name: 'line2', type: IcebergType.STRING }, // new field, never-used id
    { id: 11, name: 'city', type: IcebergType.STRING },
]),
```

Such an id is out of creation order, which is expected once a table
has evolved: creation order applies only to the ids a table is created
with (see [Creation order](#creation-order)).

### Change the partition spec

Partition evolution flows the same way, with one extra rule on
`fieldId`: a changed partition field is a new partition field. To move
a table from `month(placed_at)` to `day(placed_at)`, drop the month
entry and add a day entry under a fresh `fieldId`; never recycle the
month field's id ([rule 3](#the-field-id-rules)):

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
partition by day.

### Identifiers, sort order and table properties

A changed `identifierFieldNames` flows through `cdk deploy` like a
column change. The exception is a table created with identifiers
before 0.11.0; read [Known limitations](#known-limitations) before
removing its last identifier. The construct marks each identifier
column by writing `(PK) ` at the start of its comment ([Identifier
fields](#identifier-fields)).

A changed `sortOrder` also flows through `cdk deploy`. Glue adds it to
`sort-orders` under the next `order-id` and points
`default-sort-order-id` at it; the earlier orders stay in the list.
A change to `tableProperties` alone writes new metadata that keeps the
same `current-schema-id`, partition spec and sort order.

### Changes that need care

- **Dropping a column that a partition field has sourced breaks Athena.** The construct accepts the change. Once the column is gone, `SELECT *` and `SELECT count(*)` from a table holding rows written before the drop fail in Athena with `GENERIC_INTERNAL_ERROR: Type cannot be null`, whether the partition field was removed in the same deploy or in an earlier one. Keep such a column in the schema.
- **Glue ignores a V2 to V3 `formatVersion` change.** The table stays format 2, and `properties.format-version` reads `3` all the same. Keep `formatVersion` at the table's real version.
- **What a deploy does after an engine-side `ALTER TABLE` is not observed.** The construct does not see a change an engine makes with `ALTER TABLE` (Spark, Athena), and no integration suite deploys a table after one. That includes the in-place upgrade of a v2 table with `ALTER TABLE ... SET TBLPROPERTIES ('format-version' = '3')`, which the v3 suite runs through Spark: setting `formatVersion` to `V3` afterwards makes the declaration match the table.
- **A rolled-back deploy leaves its schema in the table's history.** When a deploy that adds a column updates the table and then fails on another resource, the stack ends in `UPDATE_ROLLBACK_COMPLETE` and `current-schema-id` is back to its earlier value, so the column is gone and the rows read as before. The schema that held the column stays in `schemas`, and `last-column-id` stays at the column's id. A clean redeploy of the same change makes that schema current again without adding a schema. Treat an id from a rolled-back deploy as used: give it only to the column that deploy added.

### Changes that replace or remove the table

Changing `tableName`, `database` or `catalogId` to a different value
replaces the table: the [`AWS::Glue::Table`
reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-glue-table.html)
lists `Name`, `DatabaseName` and `CatalogId` as "Update requires:
Replacement". `removalPolicy` sets the table's
[`UpdateReplacePolicy`](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-attribute-updatereplacepolicy.html)
as well as its `DeletionPolicy`, so it applies to a replaced table as
it does to a removed one: with the default `RETAIN` CloudFormation
leaves the old table in the catalog, outside the stack; with `DESTROY`
it deletes the old table's catalog entry. The construct asks Glue to
create the replacement as a new table and carries nothing over from
the old one. No suite in this repository renames a table, so what Glue
does with a replacement at the old `location` is not observed.

The construct never deletes objects under `location`, but that does
not make them safe: give a replacement table its own `location`.
Athena documents that
[`VACUUM`](https://docs.aws.amazon.com/athena/latest/ug/vacuum-statement.html)
"Removes orphan files that are older than the time specified in the
vacuum_max_snapshot_age_seconds table property" and that orphan files
"are files in the table's data directory that are not part of the
table state"; a table that shares the old `location` may treat the old
table's files as orphans once they pass that age (inferred from those
two sentences, not observed).

## Is this the right tool

### How it compares

| Approach | Declarative IaC (in the PR) | In-place schema + partition evolution | Keeps out the two hand-written shapes that go wrong | Typed API + synth-time validation |
| --- | --- | --- | --- | --- |
| Raw `CfnTable` (L1) | ✅ | ⚠️ only if you hand-write the exact `OpenTableFormatInput` shape | ❌ both are yours to avoid | ❌ |
| CDK custom resource (Lambda + Glue SDK) | ⚠️ via a custom resource you maintain | ⚠️ you write the diff logic | ⚠️ your code's responsibility | ❌ |
| Spark SQL DDL, or Athena SQL DDL, at job runtime | ❌ imperative, outside the PR | ✅ but outside CloudFormation | n/a | ❌ |
| **`cdk-glue-iceberg-table`** | ✅ | ✅ via `cdk deploy` | ✅ [both](#why-a-raw-cfntable-goes-wrong) by construction; ⚠️ [field-id reuse](#the-field-id-rules) is not checked | ✅ |

### Why a raw CfnTable goes wrong

AWS documents the CloudFormation shape for Iceberg tables ([AWS Big
Data blog, December 2025](https://aws.amazon.com/blogs/big-data/create-and-update-apache-iceberg-tables-with-partitions-in-the-aws-glue-data-catalog-using-the-aws-sdk-and-aws-cloudformation)):
`AWS::Glue::Table` with `OpenTableFormatInput.IcebergInput`. The
motivating CDK issue is [aws/aws-cdk#29660](https://github.com/aws/aws-cdk/issues/29660);
[`manmartgarc`'s comment](https://github.com/aws/aws-cdk/issues/29660#issuecomment-4411359248)
documents the shape this construct implements. The two shapes below go
wrong.

#### Schema under `storageDescriptor.columns`

Glue creates the table the example below declares and gives it the
parameter `table_type` `ICEBERG`. After an update that adds a column,
the table holds no Glue parameters, and Athena `SELECT *` and
`SELECT count(*)` fail with `HIVE_UNSUPPORTED_FORMAT`.

```typescript
new CfnTable(this, 'OrdersBad', {
    catalogId: this.account,
    databaseName: 'analytics',
    tableInput: {
        name: 'orders',
        tableType: 'EXTERNAL_TABLE',
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

#### `tableInput` beside `icebergTableInput`

A table with a `tableInput` that holds only a `name`, beside an
`openTableFormatInput` that carries `icebergTableInput`, fails to
create. The CloudFormation event's reason contains `Table metadata is
expected only via TableInput or via IcebergTableInput inside
OpenTableFormatInput`. The construct never emits `tableInput`; the
table-level comment goes into `tableProperties['comment']`, which
lives inside `icebergTableInput.properties`.

### What the construct rests on

The construct depends on these behaviours of Glue, which AWS does not
document as contracts: that CREATE renumbers fields in creation order
and partition fields from 1000; that `UpdateTable` stores the column
and nested ids it is given and the `fieldId` of a partition field it
adds, and how it moves `last-partition-id`; what Spark and
Athena read after a dropped column's id is reused; that a `Name`
changed to a parameter with the same value leaves the table as it was;
that an update matching an earlier schema makes that schema current
again, and one matching a partition spec the table holds adds no spec;
that an update leaving the schema of a table with a `decimal(P, S)`
column alone adds no schema; and how property-only, sort order,
identifier and rolled-back updates land. [Glue
behaviours](https://github.com/ksco92/arceus/blob/main/docs/glue-behaviours.md)
lists each one with the integration-suite assertion that checks it,
along with other behaviours the suites assert.

### What the integration suites run

The demo app in the [`arceus`](https://github.com/ksco92/arceus) repo
registers its tables with Lake Formation, and its v2 integration suites
query them through Athena as well as Spark, on the same tables:

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

## Reference

### Columns and field ids

Every top-level column must declare an `id`: a stable, unique,
positive integer ([The field id rules](#the-field-id-rules)). Nested
fields follow the same rule: every struct field takes an `id`, every
list an `elementId`, and every map a `keyId` and a `valueId`. All ids
in a schema, top-level and nested, must be distinct integers from 1 to
2147483447. That ceiling is `Integer.MAX_VALUE - 200`, the largest
field id the Iceberg spec allows ([reserved field
ids](https://iceberg.apache.org/spec/#reserved-field-ids)).

#### Creation order

Glue renumbers the fields on CREATE and points the partition spec,
sort order and identifier fields at the new ids. To number a new
table, number the top-level columns first, in order, then the nested
fields of each column in turn (a list's element; a map's key, then its
value, then the key's nested fields, then the value's; a struct's
fields, then their nested fields).
`IcebergTable.creationOrderFieldIds` returns these ids by field path
and ignores the ids in its input:

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

### Partition fields

Each partition field declares a `fieldId` and an
`IcebergPartitionTransform`. The construct requires a `fieldId` of
1000 or above; the [Iceberg
spec](https://iceberg.apache.org/spec/#partition-evolution) says of
that number: "In v1, partition field IDs were not tracked, but were
assigned sequentially starting at 1000 in the reference
implementation." `cdk synth` rejects a lower `fieldId` and validates
the transform against the source column's type; [Exported
types](#exported-types) lists the transforms. Number a new table's
partition fields 1000, 1001 and up in `partitionSpec` order: at
creation Glue assigns those ids and ignores the declared ones. A field
added by a later deploy is stored under the `fieldId` it declares.

### Identifier fields

`identifierFieldNames` lists the columns that together identify a row
and renders as the schema's `identifier-field-ids`. Each one must be a
`required: true` column (Glue rejects an optional one), and `cdk synth`
rejects an identifier column of type float, double, list, map, struct,
unknown, variant, geometry or geography.

The construct writes `(PK) ` at the start of each identifier column's
`doc`, which is shown as the column comment (`(PK) ` alone when the
column has no `doc`). Glue's `UpdateTable` reuses an earlier schema
whose fields, `doc` included, match the request, together with that
schema's `identifier-field-ids`; the marker makes every identifier
change a field change. A `doc` you write must not start with `(PK) `.

### Table properties

`tableProperties` entries are passed to Glue as given, with two
exceptions. The construct sets `format-version` and
`write.format.default` itself, and a value you supply for either must
agree with `formatVersion` or `dataFormat`. `comment` is set in one
place only. `formatVersion` and `dataFormat` must be members of their
enums.

### A table using most of the surface

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

For the default `removalPolicy`, see [Changes that replace or remove
the table](#changes-that-replace-or-remove-the-table).

The resulting `metadata.json`:

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

| Engine | v3 tables | Notes |
| --- | --- | --- |
| Spark 4.1.1 + Iceberg 1.11.0 (the integration-test runner) | Yes | Reads and writes tables the construct creates, including deletion vectors, row lineage, `variant` and `unknown`, except tables with a `geometry`, `geography` or nanosecond-timestamp column ([Known limitations](#known-limitations)). |
| AWS Glue 6.0 | Documented | The [AWS Glue versions](https://docs.aws.amazon.com/glue/latest/dg/release-notes.html) page lists "Iceberg format version 3 with VARIANT data type, deletion vectors, row lineage tracking, nanosecond timestamps, and geo types". The integration suites run on Glue 6.0's Spark 4.1.1 and Iceberg 1.11.0 (`scripts/spark/spark-env.sh`); the Glue job runtime itself is not exercised. |
| Amazon EMR Spark 8.1.0 (Spark 4.1.1, Iceberg 1.11.0-amzn-0) | Documented | The [emr-spark-8.1.0 release notes](https://docs.aws.amazon.com/emr/latest/ReleaseGuide/emr-spark810-release.html) state "Amazon EMR Spark 8.1.0 extends Iceberg v3 spec support for Spark workloads". The integration suites do not run on EMR 8.1. |
| Athena SQL | No | The [Athena Iceberg page](https://docs.aws.amazon.com/athena/latest/ug/querying-iceberg.html) states "Athena only creates and operates on Iceberg v2 tables." No v3 table is queried through Athena. |

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

In Python the prop is `encryption_key`, and the grant options are
the keyword arguments `lake_formation_data_access` and
`catalog_encryption_key`.

### Importing an existing table

`IcebergTable.fromIcebergTableAttributes` references an existing table
so you can grant on it. It does not manage the table: CDK knows
nothing of its schema or properties and changes neither.

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
table. A literal is 12 digits; a string that contains a token
(`Stack.of(this).account`, `Aws.ACCOUNT_ID`, a `CfnParameter`) is used
as given. Omitting it changes nothing: the table is
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
reference. A literal is checked against `^[a-z0-9_]+$`. A string that
contains a token, with or without literal text around it, is not
checked and is rendered as given in the template and in the table ARN,
for `tableName` and `catalogId` alike, so its deploy-time value is the
deployer's responsibility. A `tableName` of `*` would make
every grant on the table cover every table in the database.

### Exported types

The types you import from `cdk-glue-iceberg-table` (in Python, from
the `cdk_glue_iceberg_table` module):

- **`IcebergTable`** — the L2 construct itself, with `grantRead` / `grantWrite` / `grantReadWrite` (each taking an optional `IcebergTableGrantOptions`), the `fromIcebergTableAttributes(...)` import factory, and `creationOrderFieldIds(columns)` (Python: `creation_order_field_ids`), which returns a map from field path to the id Glue gives that field in a new table; a name containing `.` or a backquote appears in backquotes.
- **`IcebergType`** — primitive types, the v3 constants `UNKNOWN`, `TIMESTAMP_NS`, `TIMESTAMPTZ_NS`, and `VARIANT`, and the `list` / `map` / `struct` / `decimal` / `fixed` / `geometry(crs?)` / `geography(crs?, algorithm?)` factories. `list` takes an `IcebergListDefinition`, `map` an `IcebergMapDefinition`, and `struct` a list of `IcebergStructFieldDefinition`, each carrying the nested field ids. Renders to the string Glue's `IcebergStructField.type` expects.
- **`IcebergPartitionTransform`** — identity / `bucket(N)` / `truncate(W)` / year / month / day / hour / void. Each transform validates against the source column type at synth time.
- **`IcebergDataFormat`** (parquet/orc/avro, default parquet), **`IcebergFormatVersion`** (v1/v2/v3, required — set explicitly per table), **`IcebergSortDirection`**, **`IcebergNullOrder`**, **`IcebergEdgeAlgorithm`** (`SPHERICAL`, `VINCENTY`, `THOMAS`, `ANDOYER`, `KARNEY`; the second argument of `IcebergType.geography`).

## Known limitations

**Rules the construct does not check.**

- **At creation Glue numbers a new table's columns and partition fields itself, whatever ids are declared** ([creation order](#creation-order), [partition fields](#partition-fields)).
- **A reused field id is not detected.** The construct is stateless about field ids; see [The field id rules](#the-field-id-rules).
- **`merge-on-read` on a v1 table is not caught.** The construct does not check `write.{delete,update,merge}.mode`; set `merge-on-read` only on a v2 or later table.

**What Glue and CloudFormation do.**

- **Mixing CDK-managed and engine-managed partition evolution needs a check of `last-partition-id`.** The construct supplies the spec's field ids; Glue's `UpdateTable` computes the table's `last-partition-id` counter when it writes the new metadata. The integration suites assert the counter is at least the highest supplied field id after a partition evolution ([pinned](https://github.com/ksco92/arceus/blob/main/docs/glue-behaviours.md)), but engines that later evolve the spec themselves (e.g. Spark `ALTER TABLE … ADD PARTITION FIELD`) allocate from that counter. If you mix the two, verify the counter in `metadata.json` before trusting engine-side changes.
- **Removing the last identifier from a table created with identifiers before 0.11.0 can bring the old ids back.** That table's history holds an unmarked schema with ids, and Glue reuses it when the rendered fields match it again. Change a column `doc` in the same deploy that removes the last identifier.
- **Every deploy after the first goes through Glue's `UpdateTable`.** The CFN `IcebergInput.metadataOperation` only accepts `CREATE`; the construct always emits that.
- **Column defaults are not available.** Iceberg v3 `initial-default` and `write-default` cannot be declared through CloudFormation: the `AWS::Glue::Table` resource schema has no `InitialDefault` or `WriteDefault` property. Revisit when that schema gains the two properties.
- **Athena DDL features that don't surface through CFN are not exposed** (e.g. `ALTER TABLE … SET LOCATION`, `bucketed_by` / `bucket_count` Hive clauses). Use `IcebergPartitionTransform.bucket(N)` instead of Hive bucketing.

**Engines and v3 types.**

- **Spark 4.1.1 with Iceberg 1.11.0 cannot convert a nanosecond timestamp column, so such a table is catalog-only there.** In [`TypeToSparkType`](https://github.com/apache/iceberg/blob/apache-iceberg-1.11.0/spark/v4.1/spark/src/main/java/org/apache/iceberg/spark/TypeToSparkType.java) at the `apache-iceberg-1.11.0` tag, `primitive()` has no case for the `TIMESTAMP_NANO` type id, so a table with a `timestamp_ns` or `timestamptz_ns` column reaches the `Cannot convert unsupported type to Spark` error. The integration suite asserts these columns from `metadata.json` only.
- **Spark 4.1.1 with Iceberg 1.11.0, the versions AWS Glue 6.0 ships, cannot read geometry and geography columns, so such a table is catalog-only there.** The first Spark read of a table holding a `geography` and a `geometry` column failed with `UnsupportedOperationException: Cannot convert unsupported type to Spark: geography(OGC:CRS84, spherical)` on those versions. [`TypeToSparkType`](https://github.com/apache/iceberg/blob/apache-iceberg-1.11.0/spark/v4.1/spark/src/main/java/org/apache/iceberg/spark/TypeToSparkType.java) at the `apache-iceberg-1.11.0` tag has no conversion for `geometry` either. The integration suite deploys these columns on a table no Spark job opens and asserts them from `metadata.json` only.

## FAQ

### How do I create an Apache Iceberg table in AWS CDK?

Install `cdk-glue-iceberg-table`, then declare an `IcebergTable` with
a database, a column list, and an S3 `location`; `cdk deploy` creates
it as a plain `AWS::Glue::Table`. See [Quick start](#quick-start).

### How do I evolve an Iceberg table schema (add, rename, or drop a column) in CloudFormation?

Change the `columns` array and run `cdk deploy` again. The ids you
declare must follow [The field id rules](#the-field-id-rules). See
[Evolving a table](#evolving-a-table).

### Does CloudFormation support Iceberg tables natively?

Yes, through `AWS::Glue::Table` with `OpenTableFormatInput.IcebergInput`.
Two hand-written variants of it go wrong, and the construct emits
neither; see [Why a raw CfnTable goes
wrong](#why-a-raw-cfntable-goes-wrong).

### What is the difference between cdk-glue-iceberg-table and a raw CfnTable?

A raw `CfnTable` makes you hand-write the `OpenTableFormatInput` JSON
and avoid the two shapes under [Why a raw CfnTable goes
wrong](#why-a-raw-cfntable-goes-wrong) yourself; this construct gives
a typed API with synth-time validation, field ids you declare, and
`grantRead` / `grantWrite`. See [How it compares](#how-it-compares).

### How do I create a partitioned Iceberg table in CDK?

Pass a `partitionSpec` of `IcebergPartitionTransform` entries. See
[Partition fields](#partition-fields).

### Does it work with Athena and Lake Formation?

Yes for v2 tables: the integration suites query tables registered with
Lake Formation through Athena and Spark ([what the suites
run](#what-the-integration-suites-run)). Athena cannot query v3 tables
([engine matrix](#format-version-3)).

### Can I use Iceberg v2 merge-on-read (row-level UPDATE and DELETE)?

Yes. Set `formatVersion: IcebergFormatVersion.V2` and the
`write.{delete,update,merge}.mode = merge-on-read` table properties;
the construct does not check them ([Known
limitations](#known-limitations)).

### Can I create an Iceberg v3 table?

Yes. Set `formatVersion: IcebergFormatVersion.V3`; see [Format
version 3](#format-version-3) for the types, the engine matrix and the
limits.

## Contributing

The package is developed in the [`ksco92/arceus`](https://github.com/ksco92/arceus)
monorepo, which also holds a CDK demo app that deploys the construct to
a real AWS account. Development, the monorepo layout, and the demo app
live in [CONTRIBUTING.md](https://github.com/ksco92/arceus/blob/main/CONTRIBUTING.md).

## License

[MIT](https://github.com/ksco92/arceus/blob/main/LICENSE).
