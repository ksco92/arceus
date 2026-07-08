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
    IcebergType,
} from './iceberg-type';
import {
    IcebergPartitionTransform,
} from './iceberg-partition-transform';
import {
    IcebergDataFormat,
    IcebergFormatVersion,
    validateIcebergProperties,
} from './iceberg-table-properties';
import {
    READ_S3_BUCKET_ACTIONS,
    READ_S3_LIST_ACTIONS,
    READ_S3_OBJECT_ACTIONS,
    READ_TABLE_ACTIONS,
    WRITE_S3_BUCKET_ACTIONS,
    WRITE_S3_OBJECT_ACTIONS,
    WRITE_TABLE_ACTIONS,
    grantSplit,
} from './iceberg-table-grants';
import {
    mergeProperties,
    normalizeLocation,
    parseS3Uri,
    renderPartitionSpec,
    renderSchema,
    renderSortOrder,
    resolveIdentifierFieldIds,
    validatePartitionSpec,
    validateProps,
    validateSortOrder,
} from './iceberg-table-render';

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
     * Iceberg field id for this column. Required: every top-level
     * column must be pinned to a stable, unique positive integer that
     * you never reuse or reassign across deploys. That stability is the
     * whole point — because data files reference fields by id, a fixed
     * id lets you add, remove, and reorder columns safely without
     * triggering Iceberg's silent-corruption-on-id-reuse trap. Pick the
     * id once when you add the column and never change it; once a column
     * is dropped, leave its id retired rather than giving it to a new
     * column.
     */
    readonly id: number;
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

    /**
     * Iceberg partition field id. Required: every partition field must
     * be pinned to a stable integer >= 1000 (the Iceberg spec reserves
     * ids below 1000 for schema columns) that is unique across the
     * table's entire partition-spec history — not just the current
     * spec. Iceberg's strict engines (Spark, Trino) reject a table
     * whose spec history carries two different partition fields with
     * the same id.
     *
     * The rule is the inverse of the column-id rule: a column keeps
     * its id forever, but any change to a partition field — a
     * different transform, a different source column — makes it a NEW
     * field that needs a fresh, never-before-used id. Only an
     * untouched field keeps its id across deploys. Once a field is
     * changed or dropped, its id is retired for good; the construct
     * cannot see prior deploys, so honoring retirement is on you.
     */
    readonly fieldId: number;
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

    /** Iceberg format version. Required — set explicitly per table. */
    readonly formatVersion: IcebergFormatVersion;

    /**
     * Extra `properties` to publish on the table. Auto-added keys
     * (`format-version`, `write.format.default`) are merged in and
     * must agree with `formatVersion` / `dataFormat` if user-supplied.
     * Setting `comment` here AND in the top-level `comment` prop
     * throws at synth time — pick one.
     */
    readonly tableProperties?: { [key: string]: string };

    /**
     * Optional table comment. Glue's `OpenTableFormatInput` shape is
     * mutually exclusive with `TableInput.Description`, so the
     * construct cannot surface a description through the regular
     * Glue field. The comment is published in the Iceberg
     * `properties` map under the `comment` key, where Athena's
     * `SHOW TBLPROPERTIES` and Iceberg-aware readers can find it.
     * Mutually exclusive with `tableProperties['comment']`.
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

    /** Format version, as supplied by the caller. */
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
        this.formatVersion = props.formatVersion;

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
        if (!attrs.location.startsWith('s3://')) {
            throw new Error(`location must start with 's3://', got '${attrs.location}'`);
        }
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
