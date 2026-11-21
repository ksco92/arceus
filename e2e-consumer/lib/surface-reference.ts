/**
 * Public-surface anchor for `cdk-glue-iceberg-table`.
 *
 * The contract of `e2e-consumer/` is to break CI when the published
 * package's public exports change in a way that an external user
 * would notice — a renamed factory, a removed enum value, a re-typed
 * options interface, a missing re-export. The realistic consumer
 * stack at `./consumer-stack.ts` only touches a slice of the surface
 * (whatever a typical user would need). This file touches the rest.
 *
 * The rule for adding new exports to `cdk-glue-iceberg-table`: add a
 * reference here too, or the next release can rename it without CI
 * complaining. Every static factory, enum value, and re-exported
 * type lives below.
 */
import type {
    IcebergColumn,
    IcebergListDefinition,
    IcebergMapDefinition,
    IcebergPartitionField,
    IcebergPartitionTransformOptions,
    IcebergSortField,
    IcebergStructFieldDefinition,
    IcebergTableAttributes,
    IcebergTableGrantOptions,
    IcebergTableProps,
    IcebergTypeOptions,
    IIcebergTable,
} from 'cdk-glue-iceberg-table';
import {
    IcebergDataFormat,
    IcebergEdgeAlgorithm,
    IcebergFormatVersion,
    IcebergNullOrder,
    IcebergPartitionTransform,
    IcebergPartitionTransformKind,
    IcebergSortDirection,
    IcebergTable,
    IcebergType,
    IcebergTypeKind,
} from 'cdk-glue-iceberg-table';

const types = [
    IcebergType.BOOLEAN,
    IcebergType.INT,
    IcebergType.LONG,
    IcebergType.FLOAT,
    IcebergType.DOUBLE,
    IcebergType.DATE,
    IcebergType.TIME,
    IcebergType.TIMESTAMP,
    IcebergType.TIMESTAMPTZ,
    IcebergType.STRING,
    IcebergType.UUID,
    IcebergType.BINARY,
    IcebergType.UNKNOWN,
    IcebergType.TIMESTAMP_NS,
    IcebergType.TIMESTAMPTZ_NS,
    IcebergType.VARIANT,
];

const parameterized = [
    IcebergType.decimal(10, 2),
    IcebergType.fixed(16),
    IcebergType.list({
        element: IcebergType.STRING,
        elementId: 1,
    }),
    IcebergType.map({
        key: IcebergType.STRING,
        keyId: 1,
        value: IcebergType.INT,
        valueId: 2,
    }),
    IcebergType.geometry(),
    IcebergType.geography(),
    IcebergType.struct([
        {
            id: 1,
            name: 'k',
            type: IcebergType.STRING,
            required: true,
        },
    ]),
];

const transforms = [
    IcebergPartitionTransform.IDENTITY,
    IcebergPartitionTransform.YEAR,
    IcebergPartitionTransform.MONTH,
    IcebergPartitionTransform.DAY,
    IcebergPartitionTransform.HOUR,
    IcebergPartitionTransform.VOID,
    IcebergPartitionTransform.bucket(16),
    IcebergPartitionTransform.truncate(8),
];

const enums = [
    IcebergSortDirection.ASC,
    IcebergSortDirection.DESC,
    IcebergNullOrder.NULLS_FIRST,
    IcebergNullOrder.NULLS_LAST,
    IcebergDataFormat.PARQUET,
    IcebergDataFormat.ORC,
    IcebergDataFormat.AVRO,
    IcebergFormatVersion.V1,
    IcebergFormatVersion.V2,
    IcebergFormatVersion.V3,
    IcebergTypeKind.BOOLEAN,
    IcebergTypeKind.INT,
    IcebergTypeKind.LONG,
    IcebergTypeKind.FLOAT,
    IcebergTypeKind.DOUBLE,
    IcebergTypeKind.DATE,
    IcebergTypeKind.TIME,
    IcebergTypeKind.TIMESTAMP,
    IcebergTypeKind.TIMESTAMPTZ,
    IcebergTypeKind.STRING,
    IcebergTypeKind.UUID,
    IcebergTypeKind.BINARY,
    IcebergTypeKind.DECIMAL,
    IcebergTypeKind.FIXED,
    IcebergTypeKind.LIST,
    IcebergTypeKind.MAP,
    IcebergTypeKind.STRUCT,
    IcebergTypeKind.UNKNOWN,
    IcebergTypeKind.TIMESTAMP_NS,
    IcebergTypeKind.TIMESTAMPTZ_NS,
    IcebergTypeKind.VARIANT,
    IcebergTypeKind.GEOMETRY,
    IcebergTypeKind.GEOGRAPHY,
    IcebergEdgeAlgorithm.SPHERICAL,
    IcebergEdgeAlgorithm.VINCENTY,
    IcebergEdgeAlgorithm.THOMAS,
    IcebergEdgeAlgorithm.ANDOYER,
    IcebergEdgeAlgorithm.KARNEY,
    IcebergPartitionTransformKind.IDENTITY,
    IcebergPartitionTransformKind.YEAR,
    IcebergPartitionTransformKind.MONTH,
    IcebergPartitionTransformKind.DAY,
    IcebergPartitionTransformKind.HOUR,
    IcebergPartitionTransformKind.VOID,
    IcebergPartitionTransformKind.BUCKET,
    IcebergPartitionTransformKind.TRUNCATE,
];

const fromAttributes = IcebergTable.fromIcebergTableAttributes;

const creationOrderFieldIds = IcebergTable.creationOrderFieldIds;

// Type-only imports must be referenced via a value position to
// survive `tsc` tree-shaking. A throwaway `null as unknown as T`
// anchors each one.
const typeAnchors: Array<unknown> = [
    null as unknown as IcebergColumn,
    null as unknown as IcebergListDefinition,
    null as unknown as IcebergMapDefinition,
    null as unknown as IcebergPartitionField,
    null as unknown as IcebergPartitionTransformOptions,
    null as unknown as IcebergSortField,
    null as unknown as IcebergStructFieldDefinition,
    null as unknown as IcebergTableAttributes,
    null as unknown as IcebergTableGrantOptions,
    null as unknown as IcebergTableProps,
    null as unknown as IcebergTypeOptions,
    null as unknown as IIcebergTable,
];

export const SURFACE_ANCHORS = {
    types,
    parameterized,
    transforms,
    enums,
    fromAttributes,
    creationOrderFieldIds,
    typeAnchors,
};
