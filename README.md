# cdk-glue-iceberg-table

[![CI](https://img.shields.io/github/actions/workflow/status/ksco92/arceus/ci.yml?branch=main&label=CI)](https://github.com/ksco92/arceus/actions/workflows/ci.yml)
[![coverage](https://codecov.io/gh/ksco92/arceus/branch/main/graph/badge.svg)](https://codecov.io/gh/ksco92/arceus)
[![npm](https://img.shields.io/npm/v/cdk-glue-iceberg-table.svg)](https://www.npmjs.com/package/cdk-glue-iceberg-table)
[![PyPI](https://img.shields.io/pypi/v/cdk-glue-iceberg-table.svg)](https://pypi.org/project/cdk-glue-iceberg-table/)
[![license](https://img.shields.io/npm/l/cdk-glue-iceberg-table.svg)](https://github.com/ksco92/arceus/blob/main/LICENSE)

**AWS CDK L2 construct to create and evolve Apache Iceberg tables in the AWS Glue Data Catalog — schema and partition changes that survive CloudFormation updates, via cdk deploy.**

Declare columns, partition specs, sort orders, and table properties in TypeScript or Python. Adding, renaming, dropping, or widening columns and evolving partition specs land as pull requests and apply in place through `cdk deploy` as a plain `AWS::Glue::Table`.

- **Plain CloudFormation:** emits `AWS::Glue::Table` directly with no custom resource, Lambda, or out-of-band DDL.
- **Safe `OpenTableFormatInput` shape:** puts schema, partitions, sort order, and properties under `icebergTableInput`, avoiding the two broken raw `CfnTable` forms (placing columns under `storageDescriptor.columns`, which breaks Athena after an update, or setting `tableInput` beside `icebergTableInput`, which CloudFormation rejects at creation; see [Why a raw CfnTable goes wrong](#why-a-raw-cfntable-goes-wrong)).
- **Synth-time checks:** validates field ids, column types, and transform-to-column compatibility in TypeScript and Python ([jsii](https://aws.github.io/jsii/)) across Iceberg format versions 1, 2, and 3.

**Status (November 2026):** Pre-1.0 (`0.x`, with 1.0 planned; breaking changes bump the minor version and record upgrade notes in [UPGRADING.md](https://github.com/ksco92/arceus/blob/main/UPGRADING.md)). Published on [npm](https://www.npmjs.com/package/cdk-glue-iceberg-table), [PyPI](https://pypi.org/project/cdk-glue-iceberg-table/), and [Construct Hub](https://constructs.dev/packages/cdk-glue-iceberg-table) by one maintainer, with a zero-replacement [plain-`CfnTable` eject hatch](#referencing-an-existing-table-or-migrating-to-raw-cfntable). Athena queries v2 tables only, not v3. Originally proposed for `@aws-cdk/aws-glue-alpha` in [aws/aws-cdk#37988](https://github.com/aws/aws-cdk/pull/37988) (closed stale in September 2026), this package is maintained independently. GitHub `main` may be ahead of the latest registry release (see [CHANGELOG.md](https://github.com/ksco92/arceus/blob/main/CHANGELOG.md)).

## Contents

- [Install](#install)
- [Quick start](#quick-start)
  - [The field id rules](#the-field-id-rules)
- [Evolving a table](#evolving-a-table)
- [Is this the right tool](#is-this-the-right-tool)
  - [How it compares](#how-it-compares)
  - [Why a raw CfnTable goes wrong](#why-a-raw-cfntable-goes-wrong)
  - [What the construct rests on](#what-the-construct-rests-on)
- [Granting access](#granting-access)
  - [CloudFormation deploying-role permissions](#cloudformation-deploying-role-permissions)
- [Reference](#reference)
  - [IcebergTableProps](#icebergtableprops)
  - [Columns and field ids](#columns-and-field-ids)
  - [Partition fields](#partition-fields)
  - [Identifier fields](#identifier-fields)
  - [Table properties](#table-properties)
  - [Format version 3](#format-version-3)
  - [Referencing an existing table or migrating to raw CfnTable](#referencing-an-existing-table-or-migrating-to-raw-cfntable)
  - [Preventing field-id reuse in team CI](#preventing-field-id-reuse-in-team-ci)
  - [Catalog account, tokenized table names, and tokenized locations](#catalog-account-tokenized-table-names-and-tokenized-locations)
  - [Exported types](#exported-types)
- [Known limitations](#known-limitations)
- [Contributing](#contributing)
- [License](#license)

## Install

```bash
npm install cdk-glue-iceberg-table      # TypeScript / JavaScript
pip install cdk-glue-iceberg-table      # Python
```

Peer dependencies required in your CDK app (`aws-cdk-lib >= 2.273.0`, because `Database` is imported from stable `aws-cdk-lib/aws-glue`, and `constructs >= 10.8.1`):

```bash
npm install aws-cdk-lib@^2.273.0 constructs@^10.8.1        # TypeScript / JavaScript
pip install 'aws-cdk-lib>=2.273.0' 'constructs>=10.8.1'    # Python
```

Both languages require Node.js 22.14 or newer (the Python package runs under it through jsii); Python requires 3.10 or newer. Upgrading from an earlier version: see [UPGRADING.md](https://github.com/ksco92/arceus/blob/main/UPGRADING.md) (notes start at 0.12.0).

## Quick start

Both examples go inside a stack's constructor in an existing CDK app. Required vs defaulted properties:

- `database` accepts any `IDatabase`, including a new `Database` or an existing Glue database imported via `Database.fromDatabaseArn(...)`.
- `formatVersion` is required (`IcebergFormatVersion.V1`, `V2`, or `V3`).
- `dataFormat` defaults to `IcebergDataFormat.PARQUET`.
- `removalPolicy` defaults to `RemovalPolicy.RETAIN`.

Setting `identifierFieldNames` prepends `(PK) ` to each identifier column's Glue comment so Glue `UpdateTable` recognizes identifier changes as a distinct schema instead of reusing an earlier matching one ([Identifier fields](#identifier-fields)).

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

`cdk deploy` creates the Glue Data Catalog table and writes Iceberg `metadata.json` under the S3 prefix in `location`. For a full example exercising nested `list`, `struct`, and `map` columns, `decimal`, `sortOrder`, `tableProperties`, and the resulting `metadata.json`, see [docs/full-example.md](https://github.com/ksco92/arceus/blob/main/docs/full-example.md).

### Python

Props are `snake_case` and type names match TypeScript. Pass each column and partition field as `IcebergColumn` and `IcebergPartitionField` with `snake_case` arguments (a plain dict keeps TypeScript keys such as `sourceColumn` and `fieldId`):

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

`id` and `fieldId` are Iceberg field ids. Data files store values by field id rather than column name. `IcebergTable` validates ids within a single declaration ([Columns and field ids](#columns-and-field-ids), [Partition fields](#partition-fields)), keeps no state across deploys, and leaves cross-deploy id hygiene to you:

1. **Declare a new table's ids in creation order (columns 1, 2, 3 in order, then nested fields):** Glue numbers a new table this way regardless of declared ids; if the declared ids differ, the first update Glue accepts renumbers the fields to them, causing pre-update data files to read under the wrong field. Use `IcebergTable.creationOrderFieldIds(columns)` ([Creation order](#creation-order)).
2. **Keep each column's id for life and retire dropped column ids:** A rename keeps the `id` and changes `name`; a new column takes an id above `last-column-id` ([how to read it](https://github.com/ksco92/arceus/blob/main/docs/field-ids.md#which-ids-the-table-has-used)). Giving a dropped column's id to a new column of the same type is accepted by Glue, causing Spark and Athena to read the dropped column's pre-drop values under the new column.
3. **Use `fieldId >= 1000` and never reuse a changed or dropped partition field's id:** Changing a transform or `sourceColumn` creates a new partition field that needs a `fieldId` no partition spec of the table has used. Reassigning a prior id (such as giving `bucket(8)` the id `bucket(4)` held) is accepted by Glue and readable in Athena, while Spark `SELECT *` fails with `ValidationException: Conflicting partition fields`. At creation Glue numbers partition fields sequentially from 1000 ([Partition fields](#partition-fields)).

See [docs/field-ids.md](https://github.com/ksco92/arceus/blob/main/docs/field-ids.md) for worked examples and [Preventing field-id reuse in team CI](#preventing-field-id-reuse-in-team-ci) for an automated check.

## Evolving a table

Edit `columns` or `partitionSpec` and run `cdk deploy` again. To add a column to the quick-start table, give it an id the table has never used:

```ts
    columns: [
        { name: 'order_id',    type: IcebergType.LONG,        required: true, id: 1 },
        { name: 'customer_id', type: IcebergType.LONG,        required: true, id: 2 },
        { name: 'placed_at',   type: IcebergType.TIMESTAMPTZ, required: true, id: 3 },
        { name: 'currency',    type: IcebergType.STRING,                      id: 4 }, // new
    ],
```

The construct sends the updated schema through Glue `UpdateTable`, which writes a new `metadata.json` and `schema-id`. Adds, renames (same `id`, new `name`), and drops apply in place through `cdk deploy`.

On a v2 table, promoting `int` to `long`, `float` to `double`, `decimal(10, 2)` to `decimal(12, 2)`, and relaxing `required: true` to `required: false` in one update is accepted in place by Glue; field ids are preserved, and Athena reads pre-update rows and inserts widened and `NULL` rows. On a v3 table, Glue accepts `unknown` to `string` and `date` to `timestamp` in place. Narrowing or incompatible type changes have not been tested against Glue.

### Nested fields

Each struct field, list element, map key, and map value keeps its declared id across updates. Adding a nested field anywhere in the schema leaves existing ids unchanged; give each new nested field an unused id:

```typescript
type: IcebergType.struct([
    { id: 10, name: 'line1', type: IcebergType.STRING },
    { id: 16, name: 'line2', type: IcebergType.STRING }, // new field, unused id
    { id: 11, name: 'city',  type: IcebergType.STRING },
]),
```

### Change the partition spec

To change from `month(placed_at)` to `day(placed_at)`, replace the entry under a fresh `fieldId` ([rule 3](#the-field-id-rules)):

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

Old data files written under the month spec stay readable; new writes partition by day.

### Identifiers, sort order and table properties

`identifierFieldNames` updates flow through `cdk deploy` (for tables created with identifiers before 0.11.0, check [Known limitations](#known-limitations) before removing the last identifier). `sortOrder` updates append a new entry under the next `order-id` in `sort-orders` and point `default-sort-order-id` at it, keeping earlier orders in the list. Changing `tableProperties` alone writes new metadata while preserving `current-schema-id`, partition spec, and sort order.

### Changes that need care

- **Changing `location` on an existing table:** CloudFormation updates `AWS::Glue::Table` in place (`table-uuid` is preserved, and `metadata.json`'s `location` and Glue's `metadata_location` move to the new prefix while pre-move manifests and data files remain under the old prefix). Engines with direct S3 access to both prefixes (such as Spark over `S3FileIO`) read pre-move rows and write new rows under the new prefix. Athena querying through Lake Formation fails both `INSERT` (before a new manifest list exists under the new prefix) and `SELECT *` with `PERMISSION_DENIED` (S3 403), because Lake Formation vends temporary S3 credentials scoped to the table's current `location`, blocking access to pre-move manifests and data files under the old prefix.
- **Dropping a column that a partition field has sourced breaks Athena:** Glue accepts the update, and subsequent `SELECT *` and `SELECT count(*)` queries in Athena fail with `GENERIC_INTERNAL_ERROR: Type cannot be null` on pre-drop rows, whether the partition field was dropped in the same deploy or earlier. Keep source columns of historical partition fields in `columns`.
- **Glue ignores a V2 to V3 `formatVersion` change:** The table stays format 2 while `properties.format-version` becomes `3`. Keep `formatVersion` at the table's actual format version.
- **Engine-side `ALTER TABLE` drift:**
  - After Athena `ALTER TABLE ... ADD COLUMNS (w string)` adds `w` under id 3 and writes a row with `w`:
    - A deploy with the declaration unchanged leaves Glue `VersionId` and `metadata_location` unchanged.
    - A deploy that updates a table property without declaring `w` removes `w` from the current schema (`SELECT *` omits `w`).
    - A deploy declaring `w` under id 3 adds no schema and reads `w`.
    - A deploy declaring `w` under id 4 is accepted and reads `w` as `NULL` in that row.
  - After Spark upgrades a v2 table to v3 via `SET TBLPROPERTIES ('format-version' = '3')`, update `formatVersion` to `IcebergFormatVersion.V3` so `properties.format-version` matches the format 3 table. Outcomes after other engine-side `ALTER TABLE` statements have not been tested.
- **A rolled-back deploy leaves its schema in the table's history:** When a column addition succeeds on the table before another stack resource fails, `UPDATE_ROLLBACK_COMPLETE` restores `current-schema-id`, while the new schema stays in `schemas` and `last-column-id` stays bumped. Treat ids from a rolled-back deploy as used.

### Changes that replace or remove the table

Changing `tableName`, `database`, or `catalogId` replaces the table (`Name`, `DatabaseName`, and `CatalogId` require replacement in [`AWS::Glue::Table`](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-glue-table.html)). `removalPolicy` (default `RemovalPolicy.RETAIN`) sets both `DeletionPolicy` and `UpdateReplacePolicy`: under `RETAIN`, CloudFormation leaves the old catalog entry in Glue outside the stack; under `DESTROY`, CloudFormation deletes the old catalog entry. Glue creates the replacement as a new table carrying nothing over from the old one.

When a deploy under `RemovalPolicy.DESTROY` changes `tableName` while keeping the same `location`, Glue creates the replacement with a new `table-uuid` and a `00000-` metadata file at that `location`, Athena `SELECT *` returns no rows, and objects written by the old table stay under `location` beside that file. What a same-`location` replacement under `RemovalPolicy.RETAIN` leaves at the old `location` has not been tested.

Give a replacement table its own `location`: `IcebergTable` never deletes S3 objects, and whether Athena [`VACUUM`](https://docs.aws.amazon.com/athena/latest/ug/vacuum-statement.html) on a replacement sharing an old `location` treats the old table's files as orphans past `vacuum_max_snapshot_age_seconds` has not been tested.

## Is this the right tool

### How it compares

| Approach | Declarative IaC (in the PR) | In-place schema + partition evolution | Keeps out the two hand-written shapes that go wrong | Typed API + synth-time validation |
| --- | --- | --- | --- | --- |
| Raw `CfnTable` (L1) | Yes | Only if you hand-write the `OpenTableFormatInput` shape | Yours to avoid | No |
| CDK custom resource (Lambda + Glue SDK) | Custom resource to maintain | Diff logic is yours to write | Your code's responsibility | No |
| Spark SQL or Athena SQL DDL at job runtime | Imperative, outside CloudFormation | Outside CloudFormation | n/a | No |
| `cdk-glue-iceberg-table` | Yes | Via `cdk deploy` | Avoids [both](#why-a-raw-cfntable-goes-wrong) by construction; [field-id reuse](#the-field-id-rules) is not checked | Yes |

### Why a raw CfnTable goes wrong

AWS documents Iceberg tables on `AWS::Glue::Table` with `OpenTableFormatInput.IcebergInput` ([AWS Big Data blog](https://aws.amazon.com/blogs/big-data/create-and-update-apache-iceberg-tables-with-partitions-in-the-aws-glue-data-catalog-using-the-aws-sdk-and-aws-cloudformation), [aws/aws-cdk#29660](https://github.com/aws/aws-cdk/issues/29660#issuecomment-4411359248)). The two shapes below break or fail.

#### Schema under `storageDescriptor.columns`

Glue creates the table below with parameter `table_type` `ICEBERG`, and Athena `SELECT *` initially returns its header. After an update that adds a column, the table has no Glue parameters and Athena `SELECT *` and `SELECT count(*)` fail with `HIVE_UNSUPPORTED_FORMAT`.

```typescript
new CfnTable(this, 'OrdersBad', {
    catalogId: this.account,
    databaseName: 'analytics',
    tableInput: {
        name: 'orders',
        tableType: 'EXTERNAL_TABLE',
        storageDescriptor: {
            location: 's3://.../orders/',
            columns: [/* ... */],
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

`IcebergTable` always emits schema, partitions, sort order, and properties under `openTableFormatInput.icebergInput.icebergTableInput`.

#### `tableInput` beside `icebergTableInput`

Declaring `tableInput` (even holding only `name`) beside `openTableFormatInput.icebergInput.icebergTableInput` fails at creation with `Table metadata is expected only via TableInput or via IcebergTableInput inside OpenTableFormatInput`. `IcebergTable` omits `tableInput` and stores `comment` in `icebergTableInput.properties['comment']`.

### What the construct rests on

Every non-replacing deploy emits `metadataOperation: 'CREATE'` (the only value CloudFormation's `IcebergInput` accepts), which CloudFormation passes through Glue's `UpdateTable` to update the Iceberg table metadata in place. That update mechanism and its edge cases rest on undocumented AWS Glue behaviors verified on v2 and v3 tables against Spark and Athena; see [docs/glue-behaviours.md](https://github.com/ksco92/arceus/blob/main/docs/glue-behaviours.md) for the observed list.

## Granting access

```typescript
const table = new IcebergTable(this, 'Orders', {
    // ...
    encryptionKey: bucketKey,        // KMS key encrypting the table's S3 bucket
});
table.grantRead(role);
table.grantWrite(role);
table.grantReadWrite(role, {
    catalogEncryptionKey: catalogKey, // Glue Data Catalog SSE-KMS key
    lakeFormationDataAccess: true,    // Athena / Lake Formation registered locations
});
```

Each method emits these IAM statements and no others:

| Statement | `grantRead` | `grantWrite` | `grantReadWrite` | Resource |
| --- | --- | --- | --- | --- |
| Glue | `glue:BatchGetPartition`, `glue:GetDatabase`, `glue:GetPartition`, `glue:GetPartitions`, `glue:GetTable`, `glue:GetTables`, `glue:GetTableVersion`, `glue:GetTableVersions` | `glue:BatchCreatePartition`, `glue:BatchDeletePartition`, `glue:CreatePartition`, `glue:DeletePartition`, `glue:UpdatePartition`, `glue:UpdateTable` | both lists | catalog, database, and table ARNs in the stack account or [`catalogId`](#catalog-account-tokenized-table-names-and-tokenized-locations) |
| S3 list | `s3:ListBucket` | none | `s3:ListBucket` | bucket ARN with condition `StringLike` `s3:prefix` = `<prefix>*` or `<prefix>` |
| S3 bucket | `s3:GetBucketLocation` | `s3:ListBucketMultipartUploads` | both | bucket ARN |
| S3 objects | `s3:GetObject` | `s3:PutObject`, `s3:DeleteObject`, `s3:AbortMultipartUpload`, `s3:ListMultipartUploadParts` | both lists | `<bucket>/<prefix>*` |
| Table key (`encryptionKey`) | `kms:Decrypt` | `kms:Decrypt`, `kms:GenerateDataKey` | `kms:Decrypt`, `kms:GenerateDataKey` | the key |
| Catalog key (`catalogEncryptionKey`) | `kms:Decrypt` | `kms:Decrypt`, `kms:Encrypt`, `kms:GenerateDataKey` | `kms:Decrypt`, `kms:Encrypt`, `kms:GenerateDataKey` | the key |
| Lake Formation (`lakeFormationDataAccess: true`) | `lakeformation:GetDataAccess` | `lakeformation:GetDataAccess` | `lakeformation:GetDataAccess` | `*` |

KMS grants apply to the whole key (`IKey.grant` adds no encryption-context condition), so a shared bucket or catalog key grants access for everything it encrypts. `lakeformation:GetDataAccess` uses `*` because Lake Formation supports no resource ARN for that action; the construct issues it only when `lakeFormationDataAccess: true` is passed, allowing the principal to call `GetDataAccess` for tables authorized by Lake Formation.

Lake Formation permissions (`AWS::LakeFormation::Permissions`) are declared separately:

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
    permissions: ['SELECT', 'DESCRIBE'], // add INSERT, DELETE, ALTER for writers
});
```

In Python, use `encryption_key`, `lake_formation_data_access`, and `catalog_encryption_key`.

### CloudFormation deploying-role permissions

The IAM role deploying a stack with `IcebergTable` (in CDK, the CloudFormation execution role passed via `iam:PassRole` on bootstrap roles) needs Glue database and table permissions (`CreateTable`, `UpdateTable`, `DeleteTable`, `GetTable`, `GetDatabase`), S3 read/write on the table `location` prefix (Glue writes `metadata.json` there on create and update) plus KMS permissions on any bucket or catalog encryption keys, and Lake Formation admin or table/data-location permissions if Lake Formation governs the location. See [docs/integ-test-setup.md](https://github.com/ksco92/arceus/blob/main/docs/integ-test-setup.md) for the complete IAM and Lake Formation setup used by the repository's integration stacks.

## Reference

### IcebergTableProps

Constructor properties on `IcebergTable` (in Python, `snake_case` keyword arguments):

| Property | Type | Required | Default / notes |
| --- | --- | --- | --- |
| `database` | `IDatabase` | Yes | Any `IDatabase`, including a new `Database` or one imported via `Database.fromDatabaseArn(...)` |
| `tableName` | `string` | Yes | `[a-z0-9_]+` literal, or a CDK token |
| `columns` | `IcebergColumn[]` | Yes | Non-empty; `column.required` defaults to `false` |
| `location` | `string` | Yes | S3 URI starting with `s3://` (trailing `/` appended if omitted; [tokenized location rules](#catalog-account-tokenized-table-names-and-tokenized-locations)) |
| `formatVersion` | `IcebergFormatVersion` | Yes | `V1`, `V2`, or `V3` |
| `catalogId` | `string` | No | Stack's account; 12-digit literal or CDK token |
| `encryptionKey` | `IKey` | No | None; KMS key encrypting the table's bucket for grants |
| `partitionSpec` | `IcebergPartitionField[]` | No | None; `fieldId >= 1000`, `name` defaults to `<sourceColumn>` (`IDENTITY`) or `<sourceColumn>_<transform>` |
| `sortOrder` | `IcebergSortField[]` | No | None (non-empty if set); field defaults: `transform` `IDENTITY`, `direction` `ASC`, `nullOrder` `NULLS_LAST` |
| `identifierFieldNames` | `string[]` | No | None; each named column must have `required: true` (prepends `(PK) ` to `doc`) |
| `dataFormat` | `IcebergDataFormat` | No | `IcebergDataFormat.PARQUET` (`PARQUET`, `ORC`, `AVRO`) |
| `tableProperties` | `{ [key: string]: string }` | No | None; `format-version` and `write.format.default` are populated automatically |
| `comment` | `string` | No | None; published under `properties['comment']` (mutually exclusive with `tableProperties['comment']`) |
| `removalPolicy` | `RemovalPolicy` | No | `RemovalPolicy.RETAIN` (sets `DeletionPolicy` and `UpdateReplacePolicy`) |

### Columns and field ids

Every top-level column takes an `id`, every struct field takes an `id`, every list takes `elementId`, and every map takes `keyId` and `valueId`. All ids in a schema must be distinct integers from `1` to `2147483447` (`Integer.MAX_VALUE - 200`, the [Iceberg reserved field ids](https://iceberg.apache.org/spec/#reserved-field-ids) ceiling).

#### Creation order

Glue numbers a new table's top-level columns first in declaration order, then each column's nested fields in turn (list element; map key, map value, key's nested fields, value's nested fields; struct fields, then their nested fields). `IcebergTable.creationOrderFieldIds(columns)` returns this path-to-id map regardless of the ids in `columns`:

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

Each partition field declares a `fieldId` of `1000` or above (matching the [Iceberg spec](https://iceberg.apache.org/spec/#partition-evolution) reference numbering) and an `IcebergPartitionTransform`. `cdk synth` validates `fieldId >= 1000` and transform-to-column compatibility. Number a new table's partition fields `1000`, `1001`, and up in `partitionSpec` order: Glue assigns those ids at creation and ignores declared ones, whereas fields added in later updates keep their declared `fieldId`.

### Identifier fields

`identifierFieldNames` lists columns that together identify a row and renders as `schema.identifierFieldIds`. `cdk synth` enforces `required: true` on every identifier column and rejects types `float`, `double`, `list`, `map`, `struct`, `unknown`, `variant`, `geometry`, and `geography`.

The construct prepends `(PK) ` to each identifier column's `doc` (`(PK) ` alone when `doc` is omitted), so user-supplied `doc` strings cannot start with `(PK) `. Because Glue's `UpdateTable` reuses an earlier schema whose fields (including `doc`) match the request, the marker ensures every identifier change produces a distinct schema change.

### Table properties

`tableProperties` entries are passed to Glue as given, except `format-version` and `write.format.default`, which are populated from `formatVersion` and `dataFormat` and must agree if repeated in `tableProperties`. Set the table description via either `comment` or `tableProperties['comment']`, not both. For v2 or v3 merge-on-read DML, set `write.delete.mode`, `write.update.mode`, and `write.merge.mode` to `'merge-on-read'` in `tableProperties`.

### Format version 3

Set `formatVersion: IcebergFormatVersion.V3` to enable the six v3 column types at any nesting depth (`UNKNOWN`, `TIMESTAMP_NS`, `TIMESTAMPTZ_NS`, `VARIANT`, `geometry(crs?)`, and `geography(crs?, algorithm?)` with `IcebergEdgeAlgorithm`); `cdk synth` rejects them on `V1` and `V2` tables.

Spark supports deletion vectors, row lineage, `variant`, and `unknown`, while four v3 types are catalog-only ([Known limitations](#known-limitations)).

See [docs/format-version-3.md](https://github.com/ksco92/arceus/blob/main/docs/format-version-3.md) for TypeScript and Python examples, per-type partition and identifier rules, `crs` validation, and the engine compatibility table.

### Referencing an existing table or migrating to raw CfnTable

Use `IcebergTable.fromIcebergTableAttributes` for read-only IAM grant references (`grantRead`, `grantWrite`, `grantReadWrite`) to an existing table without managing or mutating its schema or properties in CloudFormation (`cdk import` of an existing Glue Iceberg table into `IcebergTable` management has not been tested):

```typescript
const existing = IcebergTable.fromIcebergTableAttributes(this, 'Orders', {
    database: db,
    tableName: 'orders',
    location: 's3://my-bucket/analytics/orders/',
    encryptionKey: bucketKey, // optional
    catalogId: '111122223333', // optional
});
existing.grantRead(role);
```

To migrate an existing `IcebergTable` off this construct onto a raw `CfnTable` without replacing the Glue table, use the `table.resource` escape hatch (the underlying `CfnTable` child with construct id `'Resource'`, also exposed as `table.node.defaultChild`). Because `IcebergTable` nests its `CfnTable` under child id `'Resource'`, capture its CloudFormation logical ID from the synthesized template (or `stack.getLogicalId(table.resource)`) before removing `IcebergTable`, declare a `CfnTable` with the matching `openTableFormatInput.icebergInput` properties and `applyRemovalPolicy(...)`, and pass that logical ID to `raw.overrideLogicalId(logicalId)`:

```typescript
import { RemovalPolicy } from 'aws-cdk-lib';
import { CfnTable } from 'aws-cdk-lib/aws-glue';

// Capture `logicalId` from the existing stack (`stack.getLogicalId(table.resource)`) before replacing:
const raw = new CfnTable(this, 'OrdersTable', {
    catalogId: this.account,
    databaseName: db.databaseName,
    name: 'orders',
    openTableFormatInput: { /* matching icebergInput shape */ },
});
raw.applyRemovalPolicy(RemovalPolicy.RETAIN);
raw.overrideLogicalId(logicalId);
```

With matching properties, removal policy, and logical ID, the synthesized `AWS::Glue::Table` resource is identical to what `IcebergTable` emits, so `cdk deploy` leaves the Glue table untouched.

### Preventing field-id reuse in team CI

Because `IcebergTable` checks ids within one declaration only, run [docs/check-field-ids.js](https://github.com/ksco92/arceus/blob/main/docs/check-field-ids.js) in CI against each PR's synthesized template and the live table's `metadata.json` to fail before deploy on reused historical column or nested field ids, ids `<= last-column-id`, conflicting partition `fieldId`s, or a stale `last-partition-id`:

```bash
aws s3 cp "$(aws glue get-table --database-name analytics --name orders \
    --query 'Table.Parameters.metadata_location' --output text)" metadata.json
node docs/check-field-ids.js cdk.out/MyStack.template.json metadata.json --table orders
```

See [docs/field-ids.md#check-in-ci](https://github.com/ksco92/arceus/blob/main/docs/field-ids.md#check-in-ci) for `--table` selection (including tokenized table names via logical resource id) and exit codes.

### Catalog account, tokenized table names, and tokenized locations

`catalogId` (`catalog_id` in Python) on `IcebergTable` and `IcebergTableAttributes` sets the target Glue Data Catalog account (12 digits if literal, or a CDK token). When omitted, the stack's account is used; when set, `CatalogId`, `tableArn`, and all grant database/table/catalog ARNs use that account (the database must already exist in that catalog, and cross-account catalog/Lake Formation/IAM policies remain yours to configure).

`tableName` accepts a lowercase `[a-z0-9_]+` literal or a CDK token (such as `CfnParameter` or cross-stack reference). Tokens are not validated at synth time; avoid resolving `tableName` to `*`, which would widen grants across every table in the database.

`location` (on both `IcebergTable` and `IcebergTableAttributes`) must start with a literal `s3://` prefix and separate the bucket from any key prefix with a literal `/` (for example `` `s3://${bucket.bucketName}/analytics/orders/` ``). A pure token without `s3://` is rejected at synth time, and a single token combining bucket and prefix without a literal `/` puts the whole token into the bucket ARN with an empty prefix for grants.

### Exported types

All symbols exported by `cdk-glue-iceberg-table` (in Python, `cdk_glue_iceberg_table`):

- **`IcebergTable`**: the L2 construct, exposing `tableArn`, `tableName`, `database`, `location`, `encryptionKey`, `dataFormat`, `formatVersion`, `resource` (the underlying `CfnTable` child `'Resource'`), `grantRead` / `grantWrite` / `grantReadWrite`, `fromIcebergTableAttributes(...)`, and `creationOrderFieldIds(columns)` (`creation_order_field_ids` in Python; names containing `.` or `` ` `` are backquoted).
- **`IIcebergTable`**: public interface implemented by `IcebergTable` and tables returned by `fromIcebergTableAttributes`.
- **`IcebergTableProps`**: constructor properties interface for `IcebergTable`.
- **`IcebergTableAttributes`**: attributes interface for `IcebergTable.fromIcebergTableAttributes`.
- **`IcebergTableGrantOptions`**: options interface for grant methods (`lakeFormationDataAccess`, `catalogEncryptionKey`).
- **`IcebergColumn`**: top-level column definition (`name`, `type`, `id`, optional `required`, `doc`).
- **`IcebergPartitionField`**: partition spec entry (`sourceColumn`, `transform`, `fieldId`, optional `name`).
- **`IcebergSortField`**: write-order entry (`sourceColumn`, optional `transform`, `direction`, `nullOrder`).
- **`IcebergType`**: type constants and factories (`BOOLEAN`, `INT`, `LONG`, `FLOAT`, `DOUBLE`, `DATE`, `TIME`, `TIMESTAMP`, `TIMESTAMPTZ`, `STRING`, `UUID`, `BINARY`, `UNKNOWN`, `TIMESTAMP_NS`, `TIMESTAMPTZ_NS`, `VARIANT`, `decimal`, `fixed`, `list`, `map`, `struct`, `geometry`, `geography`) with private constructor and `kind: IcebergTypeKind`.
- **`IcebergTypeKind`**: enum discriminator for `IcebergType` (for example, `type.kind === IcebergTypeKind.DECIMAL`).
- **`IcebergListDefinition`**, **`IcebergMapDefinition`**, **`IcebergStructFieldDefinition`**: nested-type definitions carrying element, key, value, and struct field ids.
- **`IcebergEdgeAlgorithm`**: geography edge-interpolation algorithm enum (`SPHERICAL`, `VINCENTY`, `THOMAS`, `ANDOYER`, `KARNEY`).
- **`IcebergPartitionTransform`**: transform constants and factories (`IDENTITY`, `YEAR`, `MONTH`, `DAY`, `HOUR`, `VOID`, `bucket(N)`, `truncate(W)`) with private constructor, `kind: IcebergPartitionTransformKind`, and `toTransformString()`.
- **`IcebergPartitionTransformKind`**: enum discriminator for `IcebergPartitionTransform` (for example, `transform.kind === IcebergPartitionTransformKind.BUCKET`).
- **`IcebergDataFormat`**: data-file format enum (`PARQUET`, `ORC`, `AVRO`; defaults to `PARQUET`).
- **`IcebergFormatVersion`**: Iceberg format version enum (`V1`, `V2`, `V3`; required on `IcebergTable`).
- **`IcebergSortDirection`**: sort direction enum (`ASC`, `DESC`).
- **`IcebergNullOrder`**: null-ordering enum (`NULLS_FIRST`, `NULLS_LAST`).

## Known limitations

- **Creation-time numbering:** Glue ignores declared column and partition ids on `CREATE` and numbers columns in creation order and partition fields from `1000` ([Creation order](#creation-order), [Partition fields](#partition-fields)).
- **Stateless field-id validation:** `IcebergTable` checks ids within one declaration only and cannot detect cross-deploy id reuse ([The field id rules](#the-field-id-rules)).
- **Merge-on-read on v1:** `write.{delete,update,merge}.mode = merge-on-read` is not rejected at synth on `IcebergFormatVersion.V1`; set it only on v2 or v3 tables.
- **Mixed CDK and engine partition evolution:** check `last-partition-id` in `metadata.json` before running engine-side `ALTER TABLE ... ADD PARTITION FIELD` after CDK partition updates; if `last-partition-id` is below the highest declared partition `fieldId`, an engine-side `ADD PARTITION FIELD` can collide with an existing partition spec entry.
- **Pre-0.11.0 identifier removal:** tables created with identifiers before 0.11.0 lack `(PK) ` markers in their earliest schema, so removing the last identifier without changing another column's `doc` restores the old schema with ids.
- **Column defaults and Athena DDL-only clauses:** Iceberg v3 `initial-default` / `write-default` and Hive/Athena-only clauses (`ALTER TABLE ... SET LOCATION`, `bucketed_by`) are not exposed by `AWS::Glue::Table` (use `IcebergPartitionTransform.bucket(N)`).
- **Spark v3 type support:** Spark and Iceberg at the versions listed in [Format version 3](https://github.com/ksco92/arceus/blob/main/docs/format-version-3.md) lack `TypeToSparkType` conversion for `timestamp_ns`, `timestamptz_ns`, `geometry`, and `geography` (`Cannot convert unsupported type to Spark`), so tables with those columns are catalog-only in those runtimes.

## Contributing

The package is developed in the [`ksco92/arceus`](https://github.com/ksco92/arceus) monorepo alongside a CDK demo and integration suite. Build/test instructions, CI and release gates, and the demo stacks live in [CONTRIBUTING.md](https://github.com/ksco92/arceus/blob/main/CONTRIBUTING.md).

## License

[MIT](https://github.com/ksco92/arceus/blob/main/LICENSE).
