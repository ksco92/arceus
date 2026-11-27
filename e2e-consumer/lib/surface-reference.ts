/**
 * Public-surface anchor for `cdk-glue-iceberg-table`.
 *
 * The contract of `e2e-consumer/` is to break CI when the published
 * package's public exports change in a way that an external user
 * would notice — a renamed factory, a removed enum value, a re-typed
 * options interface, a missing re-export. The realistic consumer
 * stack at `./consumer-stack.ts` only touches a slice of the surface
 * (whatever a typical user would need). This file touches the rest.
 * It also names every instance member and interface field, so a
 * renamed, removed or added key fails the type check.
 *
 * The rule for adding new exports to `cdk-glue-iceberg-table`: add a
 * reference here too, or the next release can rename it without CI
 * complaining. Every static factory, enum value, and re-exported
 * type lives below.
 */
import type {
    Resource,
} from 'aws-cdk-lib';
import type {
    IcebergColumn,
    IcebergListDefinition,
    IcebergMapDefinition,
    IcebergPartitionField,
    IcebergSortField,
    IcebergStructFieldDefinition,
    IcebergTableAttributes,
    IcebergTableGrantOptions,
    IcebergTableProps,
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

const iIcebergTableKeys: Record<keyof IIcebergTable, true> = {
    tableArn: true,
    tableName: true,
    database: true,
    location: true,
    encryptionKey: true,
    grantRead: true,
    grantWrite: true,
    grantReadWrite: true,
};

const icebergTableKeys: Record<Exclude<keyof IcebergTable, keyof Resource>, true> = {
    ...iIcebergTableKeys,
    dataFormat: true,
    formatVersion: true,
    resource: true,
};

const icebergTablePropsKeys: Record<keyof IcebergTableProps, true> = {
    database: true,
    tableName: true,
    catalogId: true,
    columns: true,
    location: true,
    encryptionKey: true,
    partitionSpec: true,
    sortOrder: true,
    identifierFieldNames: true,
    dataFormat: true,
    formatVersion: true,
    tableProperties: true,
    comment: true,
    removalPolicy: true,
};

const icebergTableAttributesKeys: Record<keyof IcebergTableAttributes, true> = {
    database: true,
    tableName: true,
    location: true,
    catalogId: true,
    encryptionKey: true,
};

const icebergTableGrantOptionsKeys: Record<keyof IcebergTableGrantOptions, true> = {
    lakeFormationDataAccess: true,
    catalogEncryptionKey: true,
};

const icebergColumnKeys: Record<keyof IcebergColumn, true> = {
    name: true,
    type: true,
    required: true,
    doc: true,
    id: true,
};

const icebergPartitionFieldKeys: Record<keyof IcebergPartitionField, true> = {
    sourceColumn: true,
    transform: true,
    name: true,
    fieldId: true,
};

const icebergSortFieldKeys: Record<keyof IcebergSortField, true> = {
    sourceColumn: true,
    transform: true,
    direction: true,
    nullOrder: true,
};

const icebergStructFieldDefinitionKeys: Record<keyof IcebergStructFieldDefinition, true> = {
    id: true,
    name: true,
    type: true,
    required: true,
    doc: true,
};

const icebergListDefinitionKeys: Record<keyof IcebergListDefinition, true> = {
    element: true,
    elementId: true,
    elementRequired: true,
};

const icebergMapDefinitionKeys: Record<keyof IcebergMapDefinition, true> = {
    key: true,
    keyId: true,
    value: true,
    valueId: true,
    valueRequired: true,
};

const icebergTypeInstanceKeys: Record<Exclude<keyof IcebergType, `_${string}`>, true> = {
    kind: true,
    decimalPrecision: true,
    decimalScale: true,
    fixedLength: true,
    listElement: true,
    listElementId: true,
    listElementRequired: true,
    mapKey: true,
    mapKeyId: true,
    mapValue: true,
    mapValueId: true,
    mapValueRequired: true,
    structFields: true,
    geoCrs: true,
    geographyAlgorithm: true,
};

const icebergPartitionTransformInstanceKeys: Record<Exclude<keyof IcebergPartitionTransform, `_${string}`>, true> = {
    kind: true,
    bucketCount: true,
    truncateWidth: true,
    toTransformString: true,
};

export const SURFACE_ANCHORS = {
    types,
    parameterized,
    transforms,
    enums,
    fromAttributes,
    creationOrderFieldIds,
    iIcebergTableKeys,
    icebergTableKeys,
    icebergTablePropsKeys,
    icebergTableAttributesKeys,
    icebergTableGrantOptionsKeys,
    icebergColumnKeys,
    icebergPartitionFieldKeys,
    icebergSortFieldKeys,
    icebergStructFieldDefinitionKeys,
    icebergListDefinitionKeys,
    icebergMapDefinitionKeys,
    icebergTypeInstanceKeys,
    icebergPartitionTransformInstanceKeys,
};
