# Full surface example

This example declares an `IcebergTable` using nested `list`, `struct`, and `map` columns, `decimal`, a multi-field `partitionSpec`, a multi-field `sortOrder`, `identifierFieldNames`, `dataFormat`, `formatVersion`, `tableProperties`, a table `comment`, and `removalPolicy`.

```typescript
import {
    RemovalPolicy,
} from 'aws-cdk-lib';
import {
    Database,
} from 'aws-cdk-lib/aws-glue';
import {
    Bucket,
} from 'aws-cdk-lib/aws-s3';
import {
    IcebergDataFormat,
    IcebergFormatVersion,
    IcebergNullOrder,
    IcebergPartitionTransform,
    IcebergSortDirection,
    IcebergTable,
    IcebergType,
} from 'cdk-glue-iceberg-table';

const bucket = new Bucket(this, 'Warehouse');
const db = new Database(this, 'Db', {
    databaseName: 'analytics',
});

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

`removalPolicy` defaults to `RemovalPolicy.RETAIN`; the example sets `RemovalPolicy.DESTROY` for teardown. See [Changes that replace or remove the table](https://github.com/ksco92/arceus/blob/main/README.md#changes-that-replace-or-remove-the-table).

## Resulting `metadata.json`

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
