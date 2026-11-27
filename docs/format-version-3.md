# Format version 3

Set `formatVersion: IcebergFormatVersion.V3` to create a v3 table. The six v3 types below are accepted only on `IcebergFormatVersion.V3` tables at any nesting depth; `cdk synth` rejects them on `V1` or `V2` tables.

The examples below assume the `bucket` and `db` constructs from [Quick start](https://github.com/ksco92/arceus/blob/main/README.md#quick-start).

## TypeScript

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

## Python

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

## V3 column types

| Type | Factory | Rendered string | Partition and identifier rules |
| --- | --- | --- | --- |
| `unknown` | `IcebergType.UNKNOWN` | `unknown` | Optional only (column, list element, or map value; never a map key). Partition or sort source only with `void`. Not an identifier field. |
| `timestamp_ns` | `IcebergType.TIMESTAMP_NS` | `timestamp_ns` | `identity`, `year`, `month`, `day`, `hour`, `bucket(N)`, `void`; not `truncate(W)`. Allowed as an identifier field. |
| `timestamptz_ns` | `IcebergType.TIMESTAMPTZ_NS` | `timestamptz_ns` | Same as `timestamp_ns`. |
| `variant` | `IcebergType.VARIANT` | `variant` | Never a partition or sort source, `void` included. Not an identifier field. |
| `geometry` | `IcebergType.geometry(crs?)` | `geometry`, or `geometry(<crs>)` | Partition or sort source only with `void`. Not an identifier field. |
| `geography` | `IcebergType.geography(crs?, algorithm?)` | `geography`, `geography(<crs>)`, or `geography(<crs>, <algorithm>)` | Same as `geometry`. Setting `algorithm` without `crs` spells out `OGC:CRS84`. |

Geometry and geography `crs` values must be non-empty identifiers (such as `OGC:CRS84` or `EPSG:3857`) with no whitespace, parentheses, braces, or commas (inline PROJJSON is not allowed).

## Engine compatibility

| Engine | v3 tables | Notes |
| --- | --- | --- |
| Spark 4.1.1 + Iceberg 1.11.0 | Yes | Supports deletion vectors, row lineage, `variant`, and `unknown`; cannot open `timestamp_ns`, `timestamptz_ns`, `geometry`, or `geography` ([Known limitations](https://github.com/ksco92/arceus/blob/main/README.md#known-limitations)). |
| AWS Glue 6.0 | Documented | [AWS Glue release notes](https://docs.aws.amazon.com/glue/latest/dg/release-notes.html) list Iceberg v3 (`VARIANT`, deletion vectors, row lineage, nanosecond timestamps, geo types); shares the Spark 4.1.1 and Iceberg 1.11.0 versions above, while the managed Glue job runtime itself is not exercised here. |
| Amazon EMR Spark 8.1.0 | Documented | [EMR Spark 8.1.0 release notes](https://docs.aws.amazon.com/emr/latest/ReleaseGuide/emr-spark810-release.html) list Iceberg v3 support; not exercised here. |
| Athena SQL | No | [Athena Iceberg documentation](https://docs.aws.amazon.com/athena/latest/ug/querying-iceberg.html) states Athena operates only on Iceberg v2 tables. |

Glue ignores a `V2` to `V3` `formatVersion` change on an existing table ([Changes that need care](https://github.com/ksco92/arceus/blob/main/README.md#changes-that-need-care)). To upgrade an existing v2 table to v3, run Spark `SET TBLPROPERTIES ('format-version' = '3')` and update `formatVersion` to `IcebergFormatVersion.V3` so `properties.format-version` stays aligned.
