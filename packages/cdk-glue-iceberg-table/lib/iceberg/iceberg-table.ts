import {
    Resource,
    Stack,
    RemovalPolicy,
} from 'aws-cdk-lib';
import {
    CfnTable,
    IDatabase,
} from 'aws-cdk-lib/aws-glue';
import {
    Grant,
    IGrantable,
} from 'aws-cdk-lib/aws-iam';
import {
    IKey,
} from 'aws-cdk-lib/aws-kms';
import {
    Construct,
} from 'constructs';
import {
    primitive,
} from './iceberg-type';
import {
    IcebergDataFormat,
    IcebergFormatVersion,
    validateIcebergProperties,
} from './iceberg-table-properties';
import {
    GrantContext,
    IcebergTableGrantOptions,
    READ_PROFILE,
    READ_WRITE_PROFILE,
    WRITE_PROFILE,
    grantContext,
    grantSplit,
} from './iceberg-table-grants';
import {
    creationOrderFieldIds,
    mergeProperties,
    normalizeLocation,
    parseS3Uri,
    renderPartitionSpec,
    renderSchema,
    renderSortOrder,
    resolveIdentifierFieldIds,
    snapshotProps,
    validatePartitionSpec,
    validateProps,
    validateLocation,
    validateSortOrder,
    validateCatalogId,
    validateTableName,
} from './iceberg-table-render';
import {
    checkSchemaHistory,
} from './iceberg-schema-history';
import {
    IcebergColumn,
} from './iceberg-column';
import {
    IcebergPartitionField,
} from './iceberg-partition-field';
import {
    IcebergSortField,
} from './iceberg-sort-field';

/// /////////////////////////////////////////////////
/// /////////////////////////////////////////////////
// Public construct types

/** Construction properties for an `IcebergTable`. */
export interface IcebergTableProps {
    /** Glue database that will hold the table. */
    readonly database: IDatabase;

    /**
     * Table name (lower-case, no spaces — Glue and Athena will fold it). A literal is
     * checked; a token (a `CfnParameter`, a cross-stack reference) is used as given.
     */
    readonly tableName: string;

    /**
     * Account id of the Glue Data Catalog that holds the table: 12 digits, or a token.
     * @default - the stack's account
     */
    readonly catalogId?: string;

    /** Top-level columns. Must contain at least one column. */
    readonly columns: IcebergColumn[];

    /** S3 URI where Iceberg metadata + data live. Must start with `s3://`. */
    readonly location: string;

    /**
     * KMS key the table's bucket encrypts objects with. When set, read grants
     * add `kms:Decrypt` and write grants add `kms:Decrypt` and
     * `kms:GenerateDataKey`, on the whole key. Defaults to no KMS permission.
     */
    readonly encryptionKey?: IKey;

    /** Optional partition spec. Order is preserved in the partition layout. */
    readonly partitionSpec?: IcebergPartitionField[];

    /** Optional default write order. Realized as `IcebergTableInput.writeOrder`. */
    readonly sortOrder?: IcebergSortField[];

    /**
     * Names of columns that together identify a row. Maps to
     * `IcebergSchema.identifierFieldIds`. Each must be a required
     * column; an optional column is rejected at synth, as is one of
     * type float, double, list, map, struct, unknown, variant,
     * geometry or geography. The construct prefixes each
     * identifier column's `doc` with `(PK) `, so no column's own `doc`
     * may start with that prefix.
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

    /**
     * Path of the committed schema history file of the table's database, relative to the
     * working directory; the README section "Checking changes against a schema history"
     * lists what synth checks against it.
     * @default - no history check
     */
    readonly schemaHistoryFile?: string;
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

    /** KMS key the table's objects are encrypted with, when known. */
    readonly encryptionKey?: IKey;

    /** Grant Glue + S3 read on this table. */
    grantRead(grantee: IGrantable, options?: IcebergTableGrantOptions): Grant;

    /** Grant Glue + S3 write on this table. */
    grantWrite(grantee: IGrantable, options?: IcebergTableGrantOptions): Grant;

    /** Grant Glue + S3 read + write on this table. */
    grantReadWrite(grantee: IGrantable, options?: IcebergTableGrantOptions): Grant;
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

    /** KMS key the table's objects are encrypted with, as given in the props. */
    public readonly encryptionKey?: IKey;

    /** Resolved data format (after defaulting). */
    public readonly dataFormat: IcebergDataFormat;

    /** Format version, as supplied by the caller. */
    public readonly formatVersion: IcebergFormatVersion;

    /** The underlying L1 — exposed for escape-hatch use. */
    public readonly resource: CfnTable;

    private readonly grantContext: GrantContext;

    constructor(scope: Construct, id: string, props: IcebergTableProps) {
        props = snapshotProps(props);
        super(scope, id, {
            physicalName: props.tableName,
        });

        validateProps(props);

        this.database = props.database;
        this.tableName = props.tableName;
        this.location = normalizeLocation(props.location);
        this.encryptionKey = props.encryptionKey;
        this.dataFormat = props.dataFormat ?? IcebergDataFormat.PARQUET;
        this.formatVersion = props.formatVersion;

        this.grantContext = grantContext(
            Stack.of(this),
            this.database,
            this.tableName,
            props.catalogId,
            parseS3Uri(this.location),
            this.encryptionKey,
        );
        this.tableArn = this.grantContext.tableArn;

        const mergedProperties = mergeProperties(
            this.dataFormat,
            this.formatVersion,
            props.tableProperties,
            props.comment,
        );
        validateIcebergProperties(this.dataFormat, this.formatVersion, mergedProperties);

        const rendered = renderSchema(props.columns, props.identifierFieldNames);
        validatePartitionSpec(props.partitionSpec, rendered.columnByName);
        validateSortOrder(props.sortOrder, rendered.columnByName);
        const identifierFieldIds = resolveIdentifierFieldIds(props.identifierFieldNames, rendered.columnByName);
        const partitionSpec = renderPartitionSpec(props.partitionSpec, rendered.columnByName);
        if (props.schemaHistoryFile !== undefined) {
            checkSchemaHistory(this, props.schemaHistoryFile, this.tableName, props.columns, partitionSpec);
        }

        this.resource = new CfnTable(this, 'Resource', {
            catalogId: props.catalogId ?? Stack.of(this).account,
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
                        partitionSpec,
                        writeOrder: renderSortOrder(props.sortOrder, rendered.columnByName),
                        properties: mergedProperties,
                    },
                },
            },
        });

        const removalPolicy = props.removalPolicy ?? RemovalPolicy.RETAIN;
        this.resource.applyRemovalPolicy(removalPolicy);

        this.node.defaultChild = this.resource;
    }

    /**
     * Field ids Glue assigns when it creates a table with these columns, keyed by
     * field path (`addr.city`, `tags.element`, `attrs.key`, `attrs.value`). Declare
     * a new table with these ids; the ids in `columns` are ignored. A name containing `.`
     * or a backquote appears in backquotes, inner backquotes doubled. From Python, a
     * top-level column named `__proto__` makes the call raise a jsii serialization error.
     * @param columns Columns of the table, in declaration order.
     */
    public static creationOrderFieldIds(columns: IcebergColumn[]): { [path: string]: number } {
        return creationOrderFieldIds(columns);
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
        const {
            database,
            encryptionKey,
            tableName: importedName,
            catalogId: importedCatalogId,
        } = attrs;
        const importedLocation = primitive('location', attrs.location, 'string', {
            tokens: true,
        });
        const tableName = primitive('tableName', importedName, 'string', {
            tokens: true,
        });
        const catalogId = primitive('catalogId', importedCatalogId, 'string', {
            optional: true,
            tokens: true,
        });
        validateTableName(tableName);
        validateCatalogId(catalogId);
        validateLocation(importedLocation);
        const location = normalizeLocation(importedLocation);
        const context = grantContext(Stack.of(scope), database, tableName, catalogId, parseS3Uri(location), encryptionKey);

        class Imported extends Resource implements IIcebergTable {
            public readonly tableArn = context.tableArn;
            public readonly tableName = tableName;
            public readonly database = database;
            public readonly location = location;
            public readonly encryptionKey = encryptionKey;

            public grantRead(grantee: IGrantable, options?: IcebergTableGrantOptions): Grant {
                return grantSplit(grantee, READ_PROFILE, context, options);
            }

            public grantWrite(grantee: IGrantable, options?: IcebergTableGrantOptions): Grant {
                return grantSplit(grantee, WRITE_PROFILE, context, options);
            }

            public grantReadWrite(grantee: IGrantable, options?: IcebergTableGrantOptions): Grant {
                return grantSplit(grantee, READ_WRITE_PROFILE, context, options);
            }
        }

        return new Imported(scope, id);
    }

    /** Grant Glue + S3 read on this table. */
    public grantRead(grantee: IGrantable, options?: IcebergTableGrantOptions): Grant {
        return grantSplit(grantee, READ_PROFILE, this.grantContext, options);
    }

    /** Grant Glue + S3 write on this table. */
    public grantWrite(grantee: IGrantable, options?: IcebergTableGrantOptions): Grant {
        return grantSplit(grantee, WRITE_PROFILE, this.grantContext, options);
    }

    /** Grant Glue + S3 read + write on this table. */
    public grantReadWrite(grantee: IGrantable, options?: IcebergTableGrantOptions): Grant {
        return grantSplit(grantee, READ_WRITE_PROFILE, this.grantContext, options);
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

    /**
     * Account id of the Glue Data Catalog that holds the table: 12 digits, or a token.
     * @default - the stack's account
     */
    readonly catalogId?: string;

    /** KMS key the table's objects are encrypted with; grants add the actions of `IcebergTableProps.encryptionKey` on the whole key. */
    readonly encryptionKey?: IKey;
}
