# Field ids

Every column of an Iceberg table has a field id, and so does each struct field, list
element, map key and map value. Data files store values under those ids, not names ([column
projection](https://iceberg.apache.org/spec/#column-projection)). A rename needs no rewrite,
and a column added later cannot pick up old values because it gets an id no column had
before ([evolution guide](https://iceberg.apache.org/docs/latest/evolution/#correctness)).

`IcebergTable` is stateless about ids. It renders the ids you declare in `columns` and
`partitionSpec` and checks those of one definition (valid and unique). It keeps no record of
the ids earlier deploys used, so nothing is checked across deploys. Not reusing an id is up
to whoever edits the definition; this page is the rule.

The examples below continue from this table, except the new table, which stands alone:

```typescript
columns: [
    { name: 'order_id', type: IcebergType.LONG, required: true, id: 1 },
    { name: 'amount', type: IcebergType.DOUBLE, id: 2 },
    { name: 'note', type: IcebergType.STRING, id: 3 },
    { name: 'placed_at', type: IcebergType.TIMESTAMPTZ, id: 4 },
],
partitionSpec: [
    { sourceColumn: 'placed_at', transform: IcebergPartitionTransform.MONTH, fieldId: 1000 },
],
```

## Drop a column, then add one

We remove `note` and deploy. A later deploy adds `currency`:

```typescript
    { name: 'currency', type: IcebergType.STRING, id: 5 },
```

It takes 5, never 3: files written before the drop hold the `note` values under id 3, and a
reader selects a column from a file by id, so a new column declared with 3 would be read
from those values. (4 is `placed_at`'s.) In the integration suite's own table, Glue stored
the columns as `1,2,3,5` after the column with id 4 was dropped and a new one declared with
5 (`scripts/integration-test-evolution.sh`: `assert_columns` under `VERIFY step 12`). In
the suite's `reused_id_test` table, where a new string column took a dropped string column's
id, Glue accepted the update and Spark and Athena read the dropped column's value, in the
row written before the drop, as the new column's value
(`scripts/integration-test-evolution.sh`:
`athena_expect "d of the row written before the drop reads c's value"` under
`ATHENA step 3`; `scripts/spark/verify_evolution.py`: `row written before c was dropped`
in `phase_3`).

## Which ids the table has used

A dropped column is gone from `columns`, and its id with it. The table keeps the number:
`last-column-id` in its `metadata.json` is "the highest assigned column ID for the table"
([table metadata fields](https://iceberg.apache.org/spec/#table-metadata-fields)), and a
drop does not lower it (`scripts/integration-test-evolution.sh`: `last-column-id stays at 4`
under `VERIFY step 4`). Give a new column or nested field an id above it. The Glue table's
`metadata_location` parameter is the file's S3 path:

```bash
aws s3 cp "$(aws glue get-table --database-name analytics --name orders \
    --query 'Table.Parameters.metadata_location' --output text)" - \
    | python3 -c "import json, sys; print(json.load(sys.stdin)['last-column-id'])"
```

## Rename a column

We rename `amount` to `total` and keep its id:

```typescript
    { name: 'total', type: IcebergType.DOUBLE, id: 2 },
```

The id is the column's identity, so the files still hold its values. In the suite's table,
Glue stored a renamed column under its old id (`scripts/integration-test-evolution.sh`:
`assert_columns` under `VERIFY step 3`).

## A new table

Say a new table declares these columns, with ids out of creation order:

```typescript
const columns = [
    { name: 'order_id', type: IcebergType.LONG, required: true, id: 1 },
    { name: 'tags', type: IcebergType.list({ element: IcebergType.STRING, elementId: 2 }), id: 3 },
    { name: 'placed_at', type: IcebergType.TIMESTAMPTZ, id: 4 },
];
console.log(IcebergTable.creationOrderFieldIds(columns));
// { order_id: 1, tags: 2, placed_at: 3, 'tags.element': 4 }
```

For a table the integration suite declared out of creation order, Glue stored ids in creation order
(`scripts/integration-test-surface.sh`: `assert_stored_ids creation_order_test` under
`VERIFY 2b`), so declare the returned ids from the start. A column added later takes the
next unused id, even though that is out of creation order.

## Change a partition field

We want `day(placed_at)` instead of the month field, a new partition field:

```typescript
partitionSpec: [
    { sourceColumn: 'placed_at', transform: IcebergPartitionTransform.DAY, fieldId: 1001 },
],
```

It takes 1001, not 1000: in Iceberg, new partition field ids are assigned based on the last
assigned partition id in the table's metadata ([partition
evolution](https://iceberg.apache.org/spec/#partition-evolution)), and the construct sends
the `fieldId` you declare. In the suite's table, after a day to month change declared under
`fieldId: 1002`, Glue reported `last-partition-id` 1002 (`scripts/integration-test-v3-evolution.sh`:
`assert_equals "last-partition-id" "1002"` under `VERIFY step 4`).
