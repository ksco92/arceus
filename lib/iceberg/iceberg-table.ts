import {
    Resource,
    Stack,
    RemovalPolicy,
} from 'aws-cdk-lib';
import {
    CfnTable,
} from 'aws-cdk-lib/aws-glue';
import {
    Grant,
    IGrantable,
} from 'aws-cdk-lib/aws-iam';
import {
    Construct,
} from 'constructs';
import {
    IDatabase,
} from '@aws-cdk/aws-glue-alpha';
import {
    IcebergRenderContext,
    IcebergType,
} from './iceberg-type';
import {
    IcebergPartitionTransform,
} from './iceberg-partition-transform';
import {
    ICEBERG_PROPERTY_KEYS,
    IcebergDataFormat,
    IcebergFormatVersion,
    validateIcebergProperties,
} from './iceberg-table-properties';

/// /////////////////////////////////////////////////
/// /////////////////////////////////////////////////
// Sort order enums

/** Sort direction for an Iceberg sort field. */
export enum IcebergSortDirection {
    /** Ascending — smaller values first. */
    ASC = 'asc',

    /** Descending — larger values first. */
    DESC = 'desc',
}

/** Null ordering for an Iceberg sort field. */
export enum IcebergNullOrder {
    /** Nulls precede all non-null values. */
    NULLS_FIRST = 'nulls-first',

    /** Nulls follow all non-null values. */
    NULLS_LAST = 'nulls-last',
}

/// /////////////////////////////////////////////////
/// /////////////////////////////////////////////////
// Public construct types

/** One top-level column in an Iceberg table. */
export interface IcebergColumn {
    /** Column name (unique within the table). */
    readonly name: string;

    /** Column type. */
    readonly type: IcebergType;

    /**
     * Whether the column is non-nullable. Defaults to `false` to
     * match the Iceberg spec default of optional fields.
     */
    readonly required?: boolean;

    /** Optional documentation string. */
    readonly doc?: string;

    /**
     * Pin this column to a specific Iceberg field id. Highly
     * recommended for production tables: it lets you safely add,
     * remove, and reorder columns across `cdk deploy`s without
     * triggering Iceberg's silent-corruption-on-id-reuse trap. When
     * omitted the construct assigns ids by position (1..N for the
     * top-level columns), which is fine for fresh tables but unsafe
     * once the table has data and you start dropping columns.
     */
    readonly id?: number;
}

/** One partition spec field. */
export interface IcebergPartitionField {
    /** Name of the top-level table column this partition derives from. */
    readonly sourceColumn: string;

    /** Transform to apply to the source column. */
    readonly transform: IcebergPartitionTransform;

    /**
     * Display name for the partition field. Defaults to
     * `<sourceColumn>` for identity transforms and
     * `<sourceColumn>_<transform>` otherwise.
     */
    readonly name?: string;
}

/** One write-order (sort) field. */
export interface IcebergSortField {
    /** Name of the top-level table column to sort on. */
    readonly sourceColumn: string;

    /** Transform to apply to the source column. Defaults to `identity`. */
    readonly transform?: IcebergPartitionTransform;

    /** Sort direction. Defaults to `ASC`. */
    readonly direction?: IcebergSortDirection;

    /** Null ordering. Defaults to `NULLS_LAST`. */
    readonly nullOrder?: IcebergNullOrder;
}

/** Construction properties for an `IcebergTable`. */
export interface IcebergTableProps {
    /** Glue database that will hold the table. */
    readonly database: IDatabase;

    /** Table name (lower-case, no spaces — Glue and Athena will fold it). */
    readonly tableName: string;

    /** Top-level columns. Must contain at least one column. */
    readonly columns: IcebergColumn[];

    /** S3 URI where Iceberg metadata + data live. Must start with `s3://`. */
    readonly location: string;

    /** Optional partition spec. Order is preserved in the partition layout. */
    readonly partitionSpec?: IcebergPartitionField[];

    /** Optional default write order. Realized as `IcebergTableInput.writeOrder`. */
    readonly sortOrder?: IcebergSortField[];

    /**
     * Names of columns that together identify a row. Maps to
     * `IcebergSchema.identifierFieldIds`. Per the Iceberg spec these
     * must be primitive, non-nullable, non-floating-point fields.
     */
    readonly identifierFieldNames?: string[];

    /** Data-file storage format. Defaults to `PARQUET`. */
    readonly dataFormat?: IcebergDataFormat;

    /** Iceberg format version. Defaults to `V2`. */
    readonly formatVersion?: IcebergFormatVersion;

    /**
     * Extra `properties` to publish on the table. Auto-added keys
     * (`format-version`, `write.format.default`) are merged in and
     * must agree with `formatVersion` / `dataFormat` if user-supplied.
     */
    readonly tableProperties?: { [key: string]: string };

    /**
     * Optional table comment. Glue's `OpenTableFormatInput` shape is
     * mutually exclusive with `TableInput.Description`, so the
     * construct cannot surface a description through the regular
     * Glue field. The comment is published in the Iceberg
     * `properties` map under the `comment` key, where Athena's
     * `SHOW TBLPROPERTIES` and Iceberg-aware readers can find it.
     */
    readonly comment?: string;

    /**
     * Removal policy for the underlying Glue table. Defaults to `RETAIN`
     * to match how CloudFormation treats Glue tables by default and to
     * avoid accidentally dropping production metadata.
     */
    readonly removalPolicy?: RemovalPolicy;
}

/** Public interface implemented by `IcebergTable` and by import shims. */
export interface IIcebergTable {
    /** Glue ARN of the table. */
    readonly tableArn: string;

    /** Table name. */
    readonly tableName: string;

    /** Glue database holding the table. */
    readonly database: IDatabase;

    /** S3 URI where the table is materialized. */
    readonly location: string;

    /** Grant Glue + S3 read on this table. */
    grantRead(grantee: IGrantable): Grant;

    /** Grant Glue + S3 write on this table. */
    grantWrite(grantee: IGrantable): Grant;

    /** Grant Glue + S3 read + write on this table. */
    grantReadWrite(grantee: IGrantable): Grant;
}

/// /////////////////////////////////////////////////
/// /////////////////////////////////////////////////
// Grant action sets

const READ_TABLE_ACTIONS = [
    'glue:BatchGetPartition',
    'glue:GetPartition',
    'glue:GetPartitions',
    'glue:GetTable',
    'glue:GetTables',
    'glue:GetTableVersion',
    'glue:GetTableVersions',
];

const WRITE_TABLE_ACTIONS = [
    'glue:BatchCreatePartition',
    'glue:BatchDeletePartition',
    'glue:CreatePartition',
    'glue:DeletePartition',
    'glue:UpdatePartition',
    'glue:UpdateTable',
];

/// S3 actions that operate at the bucket level AND support the
/// `s3:prefix` request condition key (per the S3 docs). Granted on
/// the bucket ARN with a `StringLike s3:prefix = [<prefix>*, <prefix>]`
/// condition so the grantee can only list the table's own prefix.
const READ_S3_LIST_ACTIONS = [
    's3:ListBucket',
];

/// S3 actions that operate at the bucket level but DO NOT support
/// `s3:prefix`. Granted on the bucket ARN with no condition — adding
/// one would silently deny these actions at runtime even though they
/// appear in the policy document.
const READ_S3_BUCKET_ACTIONS = [
    's3:GetBucketLocation',
];

const WRITE_S3_BUCKET_ACTIONS = [
    's3:ListBucketMultipartUploads',
];

/// S3 actions that operate at the object level. Must be granted on
/// the `bucket/prefix*` ARN.
const READ_S3_OBJECT_ACTIONS = [
    's3:GetObject',
];

const WRITE_S3_OBJECT_ACTIONS = [
    's3:PutObject',
    's3:DeleteObject',
    's3:AbortMultipartUpload',
    's3:ListMultipartUploadParts',
];

/// /////////////////////////////////////////////////
/// /////////////////////////////////////////////////
// IcebergTable

/**
 * A Glue table created in the Apache Iceberg open table format.
 *
 * The construct emits the
 * `OpenTableFormatInput.IcebergInput.IcebergTableInput` shape that
 * survives CloudFormation `Update` (the alternative — placing columns
 * under `tableInput.storageDescriptor.columns` — silently strips
 * `table_type=ICEBERG` from Glue parameters on the first update and
 * leaves the table un-queryable in Athena).
 */
export class IcebergTable extends Resource implements IIcebergTable {
    /** Glue ARN of the table. */
    public readonly tableArn: string;

    /** Table name as it appears in Glue / Athena. */
    public readonly tableName: string;

    /** Glue database holding the table. */
    public readonly database: IDatabase;

    /** S3 URI where the Iceberg metadata + data live. */
    public readonly location: string;

    /** Resolved data format (after defaulting). */
    public readonly dataFormat: IcebergDataFormat;

    /** Resolved format version (after defaulting). */
    public readonly formatVersion: IcebergFormatVersion;

    /** The underlying L1 — exposed for escape-hatch use. */
    public readonly resource: CfnTable;

    private readonly bucketArn: string;
    private readonly objectArn: string;
    private readonly s3PrefixGlob: string;

    constructor(scope: Construct, id: string, props: IcebergTableProps) {
        super(scope, id, {
            physicalName: props.tableName,
        });

        validateProps(props);

        this.database = props.database;
        this.tableName = props.tableName;
        this.location = normalizeLocation(props.location);
        this.dataFormat = props.dataFormat ?? IcebergDataFormat.PARQUET;
        this.formatVersion = props.formatVersion ?? IcebergFormatVersion.V2;

        const parsed = parseS3Uri(this.location);
        this.bucketArn = `arn:${Stack.of(this).partition}:s3:::${parsed.bucket}`;
        this.objectArn = `${this.bucketArn}/${parsed.key}*`;
        this.s3PrefixGlob = `${parsed.key}*`;

        const mergedProperties = mergeProperties(
            this.dataFormat,
            this.formatVersion,
            props.tableProperties,
            props.comment,
        );
        validateIcebergProperties(this.dataFormat, this.formatVersion, mergedProperties);

        const rendered = renderSchema(props.columns);
        validatePartitionSpec(props.partitionSpec, rendered.columnByName);
        validateSortOrder(props.sortOrder, rendered.columnByName);
        const identifierFieldIds = resolveIdentifierFieldIds(props.identifierFieldNames, rendered.columnByName);

        this.resource = new CfnTable(this, 'Resource', {
            catalogId: Stack.of(this).account,
            databaseName: props.database.databaseName,
            name: this.tableName,
            openTableFormatInput: {
                icebergInput: {
                    metadataOperation: 'CREATE',
                    version: this.formatVersion,
                    icebergTableInput: {
                        location: this.location,
                        schema: {
                            type: 'struct',
                            schemaId: 0,
                            fields: rendered.fields,
                            identifierFieldIds: identifierFieldIds,
                        },
                        partitionSpec: renderPartitionSpec(props.partitionSpec, rendered.columnByName),
                        writeOrder: renderSortOrder(props.sortOrder, rendered.columnByName),
                        properties: mergedProperties,
                    },
                },
            },
        });

        const removalPolicy = props.removalPolicy ?? RemovalPolicy.RETAIN;
        this.resource.applyRemovalPolicy(removalPolicy);

        this.tableArn = Stack.of(this).formatArn({
            service: 'glue',
            resource: 'table',
            resourceName: `${props.database.databaseName}/${this.tableName}`,
        });

        this.node.defaultChild = this.resource;
    }

    /**
     * Import an existing Iceberg table by its name + database.
     *
     * Imported tables can be referenced from grants but cannot be
     * mutated; their schema and properties are unknown to CDK.
     */
    public static fromIcebergTableAttributes(
        scope: Construct,
        id: string,
        attrs: IcebergTableAttributes,
    ): IIcebergTable {
        const stack = Stack.of(scope);
        const location = normalizeLocation(attrs.location);
        const parsed = parseS3Uri(location);
        const bucketArn = `arn:${stack.partition}:s3:::${parsed.bucket}`;
        const objectArn = `${bucketArn}/${parsed.key}*`;
        const prefixGlob = `${parsed.key}*`;
        const tableArn = stack.formatArn({
            service: 'glue',
            resource: 'table',
            resourceName: `${attrs.database.databaseName}/${attrs.tableName}`,
        });

        class Imported extends Resource implements IIcebergTable {
            public readonly tableArn = tableArn;
            public readonly tableName = attrs.tableName;
            public readonly database = attrs.database;
            public readonly location = location;

            public grantRead(grantee: IGrantable): Grant {
                return grantSplit(grantee, {
                    tableArn,
                    bucketArn,
                    objectArn,
                    prefixGlob,
                    tableActions: READ_TABLE_ACTIONS,
                    listActions: READ_S3_LIST_ACTIONS,
                    bucketActions: READ_S3_BUCKET_ACTIONS,
                    objectActions: READ_S3_OBJECT_ACTIONS,
                });
            }

            public grantWrite(grantee: IGrantable): Grant {
                return grantSplit(grantee, {
                    tableArn,
                    bucketArn,
                    objectArn,
                    prefixGlob,
                    tableActions: WRITE_TABLE_ACTIONS,
                    listActions: [],
                    bucketActions: WRITE_S3_BUCKET_ACTIONS,
                    objectActions: WRITE_S3_OBJECT_ACTIONS,
                });
            }

            public grantReadWrite(grantee: IGrantable): Grant {
                return grantSplit(grantee, {
                    tableArn,
                    bucketArn,
                    objectArn,
                    prefixGlob,
                    tableActions: [
                        ...READ_TABLE_ACTIONS,
                        ...WRITE_TABLE_ACTIONS,
                    ],
                    listActions: READ_S3_LIST_ACTIONS,
                    bucketActions: [
                        ...READ_S3_BUCKET_ACTIONS,
                        ...WRITE_S3_BUCKET_ACTIONS,
                    ],
                    objectActions: [
                        ...READ_S3_OBJECT_ACTIONS,
                        ...WRITE_S3_OBJECT_ACTIONS,
                    ],
                });
            }
        }

        return new Imported(scope, id);
    }

    /** Grant Glue read + S3 read on this table. */
    public grantRead(grantee: IGrantable): Grant {
        return grantSplit(grantee, {
            tableArn: this.tableArn,
            bucketArn: this.bucketArn,
            objectArn: this.objectArn,
            prefixGlob: this.s3PrefixGlob,
            tableActions: READ_TABLE_ACTIONS,
            listActions: READ_S3_LIST_ACTIONS,
            bucketActions: READ_S3_BUCKET_ACTIONS,
            objectActions: READ_S3_OBJECT_ACTIONS,
        });
    }

    /** Grant Glue write + S3 write on this table. */
    public grantWrite(grantee: IGrantable): Grant {
        return grantSplit(grantee, {
            tableArn: this.tableArn,
            bucketArn: this.bucketArn,
            objectArn: this.objectArn,
            prefixGlob: this.s3PrefixGlob,
            tableActions: WRITE_TABLE_ACTIONS,
            listActions: [],
            bucketActions: WRITE_S3_BUCKET_ACTIONS,
            objectActions: WRITE_S3_OBJECT_ACTIONS,
        });
    }

    /** Grant Glue + S3 read + write on this table. */
    public grantReadWrite(grantee: IGrantable): Grant {
        return grantSplit(grantee, {
            tableArn: this.tableArn,
            bucketArn: this.bucketArn,
            objectArn: this.objectArn,
            prefixGlob: this.s3PrefixGlob,
            tableActions: [
                ...READ_TABLE_ACTIONS,
                ...WRITE_TABLE_ACTIONS,
            ],
            listActions: READ_S3_LIST_ACTIONS,
            bucketActions: [
                ...READ_S3_BUCKET_ACTIONS,
                ...WRITE_S3_BUCKET_ACTIONS,
            ],
            objectActions: [
                ...READ_S3_OBJECT_ACTIONS,
                ...WRITE_S3_OBJECT_ACTIONS,
            ],
        });
    }
}

/** Attributes needed to import an existing Iceberg table. */
export interface IcebergTableAttributes {
    /** Glue database holding the table. */
    readonly database: IDatabase;

    /** Existing table's name. */
    readonly tableName: string;

    /** S3 URI where the table's data + metadata live. */
    readonly location: string;
}

/// /////////////////////////////////////////////////
/// /////////////////////////////////////////////////
// Validation

function validateProps(props: IcebergTableProps): void {
    if (!props.tableName.match(/^[a-z0-9_]+$/)) {
        throw new Error(
            `tableName '${props.tableName}' must contain only lowercase letters, digits, and underscores`,
        );
    }
    if (props.columns.length === 0) {
        throw new Error('IcebergTable requires at least one column');
    }
    const names = new Set<string>();
    for (const column of props.columns) {
        if (names.has(column.name)) {
            throw new Error(`duplicate column name: ${column.name}`);
        }
        names.add(column.name);
    }
    if (!props.location.startsWith('s3://')) {
        throw new Error(`location must start with 's3://', got '${props.location}'`);
    }
}

function normalizeLocation(location: string): string {
    return location.endsWith('/') ? location : `${location}/`;
}

function parseS3Uri(uri: string): { bucket: string; key: string } {
    /// `normalizeLocation` is always called first, so `uri` ends with `/`
    /// and therefore contains at least one `/` after the scheme.
    const rest = uri.substring('s3://'.length);
    const slash = rest.indexOf('/');
    return {
        bucket: rest.substring(0, slash),
        key: rest.substring(slash + 1),
    };
}

/// /////////////////////////////////////////////////
/// /////////////////////////////////////////////////
// Schema / partition / sort rendering

interface RenderedColumn {
    readonly id: number;
    readonly type: IcebergType;
}

interface RenderedSchema {
    readonly fields: CfnTable.IcebergStructFieldProperty[];
    readonly columnByName: Map<string, RenderedColumn>;
}

function renderSchema(columns: IcebergColumn[]): RenderedSchema {
    /// First pass: assign top-level ids. Pinned ids win; the rest are
    /// filled with the smallest unused positive integers. Nested-type
    /// ids continue above the highest top-level id so they never
    /// collide with column ids.
    const topLevelIds = assignTopLevelIds(columns);
    let nextId = Math.max(...topLevelIds, columns.length) + 1;
    const ctx: IcebergRenderContext = {
        nextId: () => {
            const id = nextId;
            nextId += 1;
            return id;
        },
    };
    const columnByName = new Map<string, RenderedColumn>();
    const fields: CfnTable.IcebergStructFieldProperty[] = columns.map((column, index) => {
        const id = topLevelIds[index];
        const typeString = column.type._render(ctx);
        columnByName.set(column.name, {
            id,
            type: column.type,
        });
        return {
            id,
            name: column.name,
            type: typeString,
            required: column.required ?? false,
            doc: column.doc,
        };
    });
    return {
        fields,
        columnByName,
    };
}

/**
 * Assign top-level field ids honoring user-pinned ids and filling
 * unspecified ones with the smallest unused positive integer.
 * Throws on duplicate or non-positive ids.
 *
 * @internal
 */
function assignTopLevelIds(columns: IcebergColumn[]): number[] {
    const taken = new Set<number>();
    for (const column of columns) {
        if (column.id === undefined) {
            continue;
        }
        if (!Number.isInteger(column.id) || column.id < 1) {
            throw new Error(
                `column '${column.name}' has invalid id ${column.id}; ids must be positive integers`,
            );
        }
        if (taken.has(column.id)) {
            throw new Error(`duplicate column id ${column.id} on column '${column.name}'`);
        }
        taken.add(column.id);
    }
    let cursor = 1;
    return columns.map((column) => {
        if (column.id !== undefined) {
            return column.id;
        }
        while (taken.has(cursor)) {
            cursor += 1;
        }
        taken.add(cursor);
        const assigned = cursor;
        cursor += 1;
        return assigned;
    });
}

function validatePartitionSpec(
    partitionSpec: IcebergPartitionField[] | undefined,
    columnByName: Map<string, RenderedColumn>,
): void {
    if (partitionSpec === undefined) {
        return;
    }
    const partitionNames = new Set<string>();
    for (const field of partitionSpec) {
        const source = columnByName.get(field.sourceColumn);
        if (source === undefined) {
            throw new Error(
                `partitionSpec references unknown column '${field.sourceColumn}'`,
            );
        }
        field.transform.validateSourceType(field.sourceColumn, source.type);
        const partitionName = field.name ?? defaultPartitionName(field);
        if (partitionNames.has(partitionName)) {
            throw new Error(`duplicate partition field name: ${partitionName}`);
        }
        partitionNames.add(partitionName);
    }
}

function validateSortOrder(
    sortOrder: IcebergSortField[] | undefined,
    columnByName: Map<string, RenderedColumn>,
): void {
    if (sortOrder === undefined) {
        return;
    }
    if (sortOrder.length === 0) {
        throw new Error('sortOrder must contain at least one field when provided');
    }
    for (const field of sortOrder) {
        const source = columnByName.get(field.sourceColumn);
        if (source === undefined) {
            throw new Error(`sortOrder references unknown column '${field.sourceColumn}'`);
        }
        const transform = field.transform ?? IcebergPartitionTransform.IDENTITY;
        transform.validateSourceType(field.sourceColumn, source.type);
    }
}

function renderPartitionSpec(
    partitionSpec: IcebergPartitionField[] | undefined,
    columnByName: Map<string, RenderedColumn>,
): CfnTable.IcebergPartitionSpecProperty | undefined {
    if (partitionSpec === undefined || partitionSpec.length === 0) {
        return undefined;
    }
    const fields: CfnTable.IcebergPartitionFieldProperty[] = partitionSpec.map((field, index) => ({
        name: field.name ?? defaultPartitionName(field),
        sourceId: columnByName.get(field.sourceColumn)!.id,
        transform: field.transform.toTransformString(),
        /// Per the Iceberg spec, partition field ids must be in the
        /// range [1000, 9999]; the construct allocates them densely
        /// from 1000 in declaration order.
        fieldId: 1000 + index,
    }));
    return {
        specId: 0,
        fields,
    };
}

function renderSortOrder(
    sortOrder: IcebergSortField[] | undefined,
    columnByName: Map<string, RenderedColumn>,
): CfnTable.IcebergSortOrderProperty | undefined {
    if (sortOrder === undefined || sortOrder.length === 0) {
        return undefined;
    }
    const fields: CfnTable.IcebergSortFieldProperty[] = sortOrder.map((field) => {
        const transform = field.transform ?? IcebergPartitionTransform.IDENTITY;
        return {
            sourceId: columnByName.get(field.sourceColumn)!.id,
            transform: transform.toTransformString(),
            direction: field.direction ?? IcebergSortDirection.ASC,
            nullOrder: field.nullOrder ?? IcebergNullOrder.NULLS_LAST,
        };
    });
    return {
        orderId: 1,
        fields,
    };
}

function defaultPartitionName(field: IcebergPartitionField): string {
    const transformString = field.transform.toTransformString();
    if (transformString === 'identity') {
        return field.sourceColumn;
    }
    /// `bucket[16]` -> `sourceColumn_bucket`
    const baseTransform = transformString.replace(/\[.*\]$/, '');
    return `${field.sourceColumn}_${baseTransform}`;
}

function resolveIdentifierFieldIds(
    identifierFieldNames: string[] | undefined,
    columnByName: Map<string, RenderedColumn>,
): number[] | undefined {
    if (identifierFieldNames === undefined || identifierFieldNames.length === 0) {
        return undefined;
    }
    const seen = new Set<string>();
    return identifierFieldNames.map((name) => {
        if (seen.has(name)) {
            throw new Error(`duplicate identifier field: ${name}`);
        }
        seen.add(name);
        const column = columnByName.get(name);
        if (column === undefined) {
            throw new Error(`identifierFieldNames references unknown column '${name}'`);
        }
        return column.id;
    });
}

function mergeProperties(
    dataFormat: IcebergDataFormat,
    formatVersion: IcebergFormatVersion,
    user: { [key: string]: string } | undefined,
    comment: string | undefined,
): { [key: string]: string } {
    const merged: { [key: string]: string } = {
        [ICEBERG_PROPERTY_KEYS.FORMAT_VERSION]: formatVersion,
        [ICEBERG_PROPERTY_KEYS.WRITE_FORMAT_DEFAULT]: dataFormat,
        ...(user ?? {}),
    };
    if (comment !== undefined) {
        merged.comment = comment;
    }
    return merged;
}

/**
 * Issue the four policy statements that scope an Iceberg-table grant
 * correctly: Glue actions on the table ARN, S3 list-bucket actions
 * on the bucket ARN with an `s3:prefix` condition so only the
 * table's own prefix can be listed, S3 bucket-level actions that DO
 * NOT support the `s3:prefix` condition (e.g. `GetBucketLocation`,
 * `ListBucketMultipartUploads`) on the bucket ARN with no condition
 * — including them in the conditioned statement would silently deny
 * them at runtime — and S3 object-level actions on the
 * `bucket/prefix*` ARN. Returns the table-actions grant (any of the
 * four is sufficient for the `Grant` API contract; the rest attach
 * as side effects).
 *
 * @internal
 */
function grantSplit(
    grantee: IGrantable,
    args: {
        tableArn: string;
        bucketArn: string;
        objectArn: string;
        prefixGlob: string;
        tableActions: string[];
        listActions: string[];
        bucketActions: string[];
        objectActions: string[];
    },
): Grant {
    const tableGrant = Grant.addToPrincipal({
        grantee,
        actions: args.tableActions,
        resourceArns: [
            args.tableArn,
        ],
    });
    if (args.listActions.length > 0) {
        Grant.addToPrincipal({
            grantee,
            actions: args.listActions,
            resourceArns: [
                args.bucketArn,
            ],
            conditions: {
                StringLike: {
                    's3:prefix': [
                        args.prefixGlob,
                        args.prefixGlob.replace(/\*$/, ''),
                    ],
                },
            },
        });
    }
    if (args.bucketActions.length > 0) {
        Grant.addToPrincipal({
            grantee,
            actions: args.bucketActions,
            resourceArns: [
                args.bucketArn,
            ],
        });
    }
    Grant.addToPrincipal({
        grantee,
        actions: args.objectActions,
        resourceArns: [
            args.objectArn,
        ],
    });
    return tableGrant;
}
