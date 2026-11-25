import {
    CfnOutput,
    CfnParameter,
    RemovalPolicy,
    Stack,
    StackProps,
} from 'aws-cdk-lib';
import {
    Construct,
} from 'constructs';
import {
    CfnPermissions,
} from 'aws-cdk-lib/aws-lakeformation';
import {
    CfnTable,
    Database,
} from 'aws-cdk-lib/aws-glue';
import {
    Bucket,
} from 'aws-cdk-lib/aws-s3';
import {
    IcebergColumn,
    IcebergFormatVersion,
    IcebergNullOrder,
    IcebergPartitionField,
    IcebergPartitionTransform,
    IcebergSortDirection,
    IcebergSortField,
    IcebergTable,
    IcebergTableProps,
    IcebergType,
} from '../packages/cdk-glue-iceberg-table/lib/iceberg';

const LAST_COMMENT_CHANGE_STEP = 6;
const LAST_STEP = 12;
const ID_CAT_V_COLUMNS: IcebergColumn[] = [
    {
        name: 'id',
        type: IcebergType.LONG,
        id: 1,
    },
    {
        name: 'cat',
        type: IcebergType.STRING,
        id: 2,
    },
    {
        name: 'v',
        type: IcebergType.STRING,
        id: 3,
    },
];
const ID_V_IDENTIFIER_COLUMNS: IcebergColumn[] = [
    {
        name: 'id',
        type: IcebergType.LONG,
        required: true,
        id: 1,
    },
    {
        name: 'v',
        type: IcebergType.STRING,
        id: 2,
    },
];
const ID_V_COLUMNS: IcebergColumn[] = [
    {
        name: 'id',
        type: IcebergType.LONG,
        id: 1,
    },
    {
        name: 'v',
        type: IcebergType.STRING,
        id: 2,
    },
];
const COMMIT_RETRIES = {
    'commit.retry.num-retries': '5',
};

/**
 * Props for `IcebergEvolutionStack`. The stack itself is parameterized
 * on a single integer `step` so that integration tests can run
 * sequential `cdk deploy --context evolutionStep=N` invocations and
 * observe how the underlying Iceberg tables evolve.
 *
 * The bucket and database are imported by name rather than passed as
 * cross-stack references so that the test stack can be deployed and
 * destroyed independently of `ArceusStack`.
 */
export interface IcebergEvolutionStackProps extends StackProps {
    /** Name of the data-lake bucket that owns the table's S3 prefix. */
    readonly importedDataLakeBucketName: string;

    /** Name of the existing Glue database to publish the table to. */
    readonly importedDatabaseName: string;

    /**
     * ARN of the IAM principal (user, role, or federated identity)
     * that should be granted SELECT/INSERT/DELETE/ALTER/DESCRIBE on
     * every test table — typically the principal running `cdk deploy`.
     * For CI this is the OIDC role's ARN; for local dev pass your
     * IAM user or assumed-role ARN.
     */
    readonly principalArn: string;
}

/**
 * Stack whose Iceberg tables change with `--context evolutionStep=N`, the
 * target of `scripts/integration-test-evolution.sh`: `evolution_test` and
 * `nested_evolution_test` evolve across the steps, plus one small table per
 * Glue behaviour the script asserts (`CONTRIBUTING.md` describes each).
 * Step 11 adds a table that fails to create after the table update, so its
 * deploy rolls back.
 */
export class IcebergEvolutionStack extends Stack {
    constructor(scope: Construct, id: string, props: IcebergEvolutionStackProps) {
        super(scope, id, props);

        const stepRaw = this.node.tryGetContext('evolutionStep') ?? '1';
        const step = Number(stepRaw);
        if (!Number.isInteger(step) || step < 1 || step > LAST_STEP) {
            throw new Error(`evolutionStep must be an integer from 1 to ${LAST_STEP}, got '${stepRaw}'`);
        }

        const importedBucket = Bucket.fromBucketName(
            this,
            'ImportedDataLakeBucket',
            props.importedDataLakeBucketName,
        );
        const importedDatabase = Database.fromDatabaseArn(
            this,
            'ImportedDatabase',
            `arn:${this.partition}:glue:${this.region}:${this.account}:database/${props.importedDatabaseName}`,
        );

        const icebergTable = (
            tableId: string,
            name: string,
            tableProps: Omit<IcebergTableProps, 'database' | 'tableName' | 'formatVersion' | 'location'>
                & Partial<Pick<IcebergTableProps, 'tableName' | 'formatVersion'>>,
        ) => new IcebergTable(this, tableId, {
            database: importedDatabase,
            tableName: name,
            formatVersion: IcebergFormatVersion.V2,
            location: `s3://${importedBucket.bucketName}/${importedDatabase.databaseName}/${name}/`,
            removalPolicy: RemovalPolicy.DESTROY,
            ...tableProps,
        });

        const columns: IcebergColumn[] = buildColumns(step);
        const partitionSpec: IcebergPartitionField[] = buildPartitionSpec(step);

        const table = icebergTable('EvolutionTable', 'evolution_test', {
            comment: `Integration-test target — evolution step ${Math.min(step, LAST_COMMENT_CHANGE_STEP)}.`,
            columns,
            partitionSpec,
            identifierFieldNames: buildIdentifierFieldNames(step),
            sortOrder: buildSortOrder(step),
            tableProperties: step >= 9 ? COMMIT_RETRIES : undefined,
        });

        const nestedTable = icebergTable('NestedEvolutionTable', 'nested_evolution_test', {
            comment: 'Integration-test target — nested column evolution.',
            columns: buildNestedColumns(step),
        });

        const reusedIdTable = icebergTable('ReusedIdTable', 'reused_id_test', {
            columns: buildReusedIdColumns(step),
        });

        const partitionIdTable = icebergTable('PartitionIdTable', 'partition_id_test', {
            columns: [
                {
                    name: 'id',
                    type: IcebergType.LONG,
                    id: 1,
                },
                {
                    name: 'ts',
                    type: IcebergType.TIMESTAMPTZ,
                    id: 2,
                },
                {
                    name: 'cat',
                    type: IcebergType.STRING,
                    id: 3,
                },
                {
                    name: 'region',
                    type: IcebergType.STRING,
                    id: 4,
                },
            ],
            partitionSpec: buildPartitionIdSpec(step),
        });

        const parameterNameTable = icebergTable('ParameterNameTable', 'parameter_name_test', {
            tableName: step >= 9 ? new CfnParameter(this, 'ParameterNameTableName', {
                default: 'parameter_name_test',
            }).valueAsString : 'parameter_name_test',
            columns: ID_V_COLUMNS,
        });

        const renumberTable = icebergTable('RenumberTable', 'renumber_test', {
            columns: [
                {
                    name: 'a',
                    type: IcebergType.STRING,
                    id: 2,
                },
                {
                    name: 'b',
                    type: IcebergType.STRING,
                    id: 1,
                },
            ],
            tableProperties: step >= 2 ? COMMIT_RETRIES : undefined,
        });

        const formatVersionTable = icebergTable('FormatVersionTable', 'format_version_test', {
            formatVersion: step >= 2 ? IcebergFormatVersion.V3 : IcebergFormatVersion.V2,
            columns: ID_V_COLUMNS,
        });

        const decimalTable = icebergTable('DecimalTable', 'decimal_test', {
            columns: [
                {
                    name: 'amount',
                    type: IcebergType.decimal(10, 2),
                    id: 1,
                },
            ],
            tableProperties: step >= 2 ? COMMIT_RETRIES : undefined,
        });

        const createPartitionIdTable = icebergTable('CreatePartitionIdTable', 'create_partition_id_test', {
            columns: [
                {
                    name: 'id',
                    type: IcebergType.LONG,
                    id: 1,
                },
                {
                    name: 'ts',
                    type: IcebergType.TIMESTAMPTZ,
                    id: 2,
                },
            ],
            partitionSpec: [
                {
                    sourceColumn: 'ts',
                    transform: IcebergPartitionTransform.DAY,
                    fieldId: 1005,
                },
                {
                    sourceColumn: 'id',
                    transform: IcebergPartitionTransform.bucket(4),
                    fieldId: 1000,
                },
            ],
        });

        const dropSourceTable = icebergTable('DropSourceTable', 'drop_source_test', buildDropSourceTable(step, 2));
        const dropSourceLaterTable = icebergTable('DropSourceLaterTable', 'drop_source_later_test', buildDropSourceTable(step, 3));

        const reusedPartitionIdTable = icebergTable('ReusedPartitionIdTable', 'reused_partition_id_test', {
            columns: ID_CAT_V_COLUMNS,
            partitionSpec: [
                {
                    sourceColumn: 'id',
                    transform: IcebergPartitionTransform.bucket(step >= 2 ? 8 : 4),
                    fieldId: 1000,
                },
            ],
        });

        const unmarkedIdentifiers = step >= 3 ? [] : [
            'id',
        ];
        const unmarkedIdentifierTable = icebergTable('UnmarkedIdentifierTable', 'unmarked_identifier_test', {
            columns: ID_V_IDENTIFIER_COLUMNS,
            identifierFieldNames: unmarkedIdentifiers,
        });
        const unmarkedIdentifierDocTable = icebergTable('UnmarkedIdentifierDocTable', 'unmarked_identifier_doc_test', {
            columns: step >= 3 ? [
                ID_V_IDENTIFIER_COLUMNS[0],
                {
                    ...ID_V_IDENTIFIER_COLUMNS[1],
                    doc: 'Value.',
                },
            ] : ID_V_IDENTIFIER_COLUMNS,
            identifierFieldNames: unmarkedIdentifiers,
        });
        if (step === 1) {
            [
                unmarkedIdentifierTable,
                unmarkedIdentifierDocTable,
            ].forEach((unmarked) => unmarked.resource.addPropertyDeletionOverride(
                'OpenTableFormatInput.IcebergInput.IcebergTableInput.Schema.Fields.0.Doc',
            ));
        }

        const engineColumnTable = icebergTable('EngineColumnTable', 'engine_column_test', {
            columns: ID_V_COLUMNS,
            tableProperties: step >= 3 ? COMMIT_RETRIES : undefined,
        });
        const engineColumnDeclaredTable = icebergTable('EngineColumnDeclaredTable', 'engine_column_declared_test', {
            columns: buildEngineColumns(step, 3),
        });
        const engineColumnOtherIdTable = icebergTable('EngineColumnOtherIdTable', 'engine_column_other_id_test', {
            columns: buildEngineColumns(step, 4),
        });
        const engineUpgradeTable = icebergTable('EngineUpgradeTable', 'engine_upgrade_test', {
            formatVersion: step >= 2 ? IcebergFormatVersion.V3 : IcebergFormatVersion.V2,
            columns: ID_V_COLUMNS,
        });
        const engineUpgradeV2Table = icebergTable('EngineUpgradeV2Table', 'engine_upgrade_v2_test', {
            columns: ID_V_COLUMNS,
            tableProperties: step >= 2 ? COMMIT_RETRIES : undefined,
        });

        const grants: IcebergTable[] = [
            table,
            nestedTable,
            reusedIdTable,
            partitionIdTable,
            parameterNameTable,
            renumberTable,
            formatVersionTable,
            decimalTable,
            createPartitionIdTable,
            dropSourceTable,
            dropSourceLaterTable,
            reusedPartitionIdTable,
            unmarkedIdentifierTable,
            unmarkedIdentifierDocTable,
            engineColumnTable,
            engineColumnDeclaredTable,
            engineColumnOtherIdTable,
            engineUpgradeTable,
            engineUpgradeV2Table,
        ];
        const grant = (id: string, tableName: string, target: CfnTable) => {
            const permission = new CfnPermissions(this, `${id}Permission`, {
                permissions: [
                    'SELECT',
                    'INSERT',
                    'DELETE',
                    'ALTER',
                    'DESCRIBE',
                ],
                permissionsWithGrantOption: [],
                resource: {
                    tableResource: {
                        catalogId: this.account,
                        name: tableName,
                        databaseName: importedDatabase.databaseName,
                    },
                },
                dataLakePrincipal: {
                    dataLakePrincipalIdentifier: props.principalArn,
                },
            });
            permission.addResourceDependency(target);
        };
        grants.forEach((target) => grant(target.node.id, target.tableName, target.resource));

        const storageColumnsTable = new CfnTable(this, 'StorageColumnsTable', {
            catalogId: this.account,
            databaseName: importedDatabase.databaseName,
            tableInput: {
                name: 'storage_columns_test',
                tableType: 'EXTERNAL_TABLE',
                storageDescriptor: {
                    location: `s3://${importedBucket.bucketName}/${importedDatabase.databaseName}/storage_columns_test/`,
                    columns: [
                        {
                            name: 'id',
                            type: 'bigint',
                        },
                        ...(step >= 2 ? [
                            {
                                name: 'v',
                                type: 'string',
                            },
                        ] : []),
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
        grant('StorageColumnsTable', 'storage_columns_test', storageColumnsTable);

        if (step === 11) {
            /// `tableInput` beside `icebergTableInput`: the create fails after the table update.
            const tableInputTable = new CfnTable(this, 'TableInputTable', {
                catalogId: this.account,
                databaseName: importedDatabase.databaseName,
                tableInput: {
                    name: 'table_input_test',
                },
                openTableFormatInput: {
                    icebergInput: {
                        metadataOperation: 'CREATE',
                        version: '2',
                        icebergTableInput: {
                            location: `s3://${importedBucket.bucketName}/${importedDatabase.databaseName}/table_input_test/`,
                            schema: {
                                type: 'struct',
                                schemaId: 0,
                                fields: [
                                    {
                                        id: 1,
                                        name: 'id',
                                        type: 'long',
                                        required: false,
                                    },
                                ],
                            },
                        },
                    },
                },
            });
            tableInputTable.addResourceDependency(table.resource);
        }

        new CfnOutput(this, 'EvolutionStepOutput', {
            value: String(step),
            description: 'Evolution step this stack was last deployed with.',
        });

        new CfnOutput(this, 'EvolutionTableNameOutput', {
            value: table.tableName,
        });
    }
}

/// /////////////////////////////////////////////////
/// /////////////////////////////////////////////////
// Evolution definitions
//
// Each step is a snapshot of what the table looks like after a
// particular `cdk deploy`. The id pinning is the load-bearing piece —
// every column keeps the same id across the lifetime of the table so
// that data files (which reference fields by id) stay queryable.

function buildColumns(step: number): IcebergColumn[] {
    /// `region`, dropped in step 4, is never a partition source;
    /// `drop_source_test` is the table that drops one.
    const baseline: IcebergColumn[] = [
        {
            name: 'customer_id',
            type: IcebergType.LONG,
            required: true,
            id: 1,
            doc: 'Primary key.',
        },
        {
            name: 'email',
            type: IcebergType.STRING,
            required: true,
            id: 2,
        },
        {
            name: 'signed_up_at',
            type: IcebergType.TIMESTAMPTZ,
            required: true,
            id: 3,
        },
    ];
    if (step === 1) {
        return baseline;
    }
    /// Step 2: ADD `region` (new id 4).
    const withRegion: IcebergColumn[] = [
        ...baseline,
        {
            name: 'region',
            type: IcebergType.STRING,
            required: false,
            id: 4,
        },
    ];
    if (step === 2) {
        return withRegion;
    }
    /// Step 3: RENAME `email` -> `contact_email` (id 2 preserved).
    const renamed: IcebergColumn[] = [
        withRegion[0],
        {
            name: 'contact_email',
            type: IcebergType.STRING,
            required: true,
            id: 2,
        },
        withRegion[2],
        withRegion[3],
    ];
    if (step === 3) {
        return renamed;
    }
    /// Steps 4 to 10: DROP `region`. Id 4 stays retired — filter it out
    /// rather than index-slicing so the intent is explicit.
    const dropped = renamed.filter((column) => column.name !== 'region');
    if (step < 11) {
        return dropped;
    }
    /// Steps 11 and 12: ADD `country` (id 5); step 11's deploy rolls back.
    return [
        ...dropped,
        {
            name: 'country',
            type: IcebergType.STRING,
            required: false,
            id: 5,
        },
    ];
}

/// Step 10 replaces the creation-time order on `customer_id`.
function buildSortOrder(step: number): IcebergSortField[] {
    if (step >= 10) {
        return [
            {
                sourceColumn: 'signed_up_at',
                direction: IcebergSortDirection.DESC,
                nullOrder: IcebergNullOrder.NULLS_FIRST,
            },
        ];
    }
    return [
        {
            sourceColumn: 'customer_id',
        },
    ];
}

function buildPartitionSpec(step: number): IcebergPartitionField[] {
    const dayPartition: IcebergPartitionField = {
        sourceColumn: 'signed_up_at',
        transform: IcebergPartitionTransform.DAY,
        fieldId: 1000,
    };
    /// `customer_id` is partitioned via `bucket(8)` from step 3 onward,
    /// and removed in step 4. The transform deliberately targets a
    /// column that is NEVER dropped, so partition evolution proves out
    /// independently of column-drop semantics.
    const customerBucketPartition: IcebergPartitionField = {
        sourceColumn: 'customer_id',
        transform: IcebergPartitionTransform.bucket(8),
        fieldId: 1001,
    };
    /// Step 5 changes the transform on `signed_up_at` from `day` to
    /// `month`. A changed transform is a NEW partition field, so it
    /// takes the next never-used id (1002); 1000 and 1001 stay retired.
    const monthPartition: IcebergPartitionField = {
        sourceColumn: 'signed_up_at',
        transform: IcebergPartitionTransform.MONTH,
        fieldId: 1002,
    };
    if (step === 1 || step === 2) {
        return [
            dayPartition,
        ];
    }
    if (step === 3) {
        return [
            dayPartition,
            customerBucketPartition,
        ];
    }
    /// Step 4: DROP the bucket partition on customer_id while keeping
    /// the column itself in the schema.
    if (step === 4) {
        return [
            dayPartition,
        ];
    }
    /// Steps 5 onward: CHANGE the transform on signed_up_at (day -> month).
    return [
        monthPartition,
    ];
}

/// `reused_id_test` drops `c` (id 2) at step 2 and gives id 2 to the new
/// column `d` from step 3.
function buildReusedIdColumns(step: number): IcebergColumn[] {
    const kept: IcebergColumn[] = [
        {
            name: 'a',
            type: IcebergType.LONG,
            id: 1,
        },
    ];
    if (step === 2) {
        return kept;
    }
    return [
        ...kept,
        {
            name: step === 1 ? 'c' : 'd',
            type: IcebergType.STRING,
            id: 2,
        },
    ];
}

/// `cat` loses its partition field at step 2 and the column at `columnDropStep`.
function buildDropSourceTable(step: number, columnDropStep: number): Pick<IcebergTableProps, 'columns' | 'partitionSpec'> {
    const catPartition: IcebergPartitionField[] = step >= 2 ? [] : [
        {
            sourceColumn: 'cat',
            transform: IcebergPartitionTransform.IDENTITY,
            fieldId: 1001,
        },
    ];
    return {
        columns: ID_CAT_V_COLUMNS.filter((column) => step < columnDropStep || column.name !== 'cat'),
        partitionSpec: [
            {
                sourceColumn: 'id',
                transform: IcebergPartitionTransform.bucket(4),
                fieldId: 1000,
            },
            ...catPartition,
        ],
    };
}

/// Athena adds `w` to the engine column tables after step 1; step 2 declares it under `wId`.
function buildEngineColumns(step: number, wId: number): IcebergColumn[] {
    if (step < 2) {
        return ID_V_COLUMNS;
    }
    return [
        ...ID_V_COLUMNS,
        {
            name: 'w',
            type: IcebergType.STRING,
            id: wId,
        },
    ];
}

/// `partition_id_test` adds a field under 1005 at step 2, above the next
/// free id 1002, and one under 1003 at step 3, below `last-partition-id`.
function buildPartitionIdSpec(step: number): IcebergPartitionField[] {
    const spec: IcebergPartitionField[] = [
        {
            sourceColumn: 'ts',
            transform: IcebergPartitionTransform.DAY,
            fieldId: 1000,
        },
        {
            sourceColumn: 'id',
            transform: IcebergPartitionTransform.bucket(4),
            fieldId: 1001,
        },
    ];
    if (step >= 2) {
        spec.push({
            sourceColumn: 'cat',
            transform: IcebergPartitionTransform.IDENTITY,
            fieldId: 1005,
        });
    }
    if (step >= 3) {
        spec.push({
            sourceColumn: 'region',
            transform: IcebergPartitionTransform.IDENTITY,
            fieldId: 1003,
        });
    }
    return spec;
}

/// Step 6 changes only the identifier set; columns and partitions match
/// step 5, and later steps keep the step 6 identifiers.
function buildIdentifierFieldNames(step: number): string[] {
    if (step >= 6) {
        return [
            'contact_email',
        ];
    }
    return [
        'customer_id',
    ];
}

/// `nested_evolution_test` carries the baseline shape through step 6.
/// Step 7 adds the top-level `note` (id 10) and step 8 adds
/// `addr.zip` (id 11) between `line1` and `city`.
/// The baseline ids are the ones Glue assigns when it creates the table:
/// each level's fields in order, then each nested type's ids.
function buildNestedColumns(step: number): IcebergColumn[] {
    const columns: IcebergColumn[] = [
        {
            name: 'id',
            type: IcebergType.LONG,
            required: true,
            id: 1,
        },
        {
            name: 'tags',
            type: IcebergType.list({
                element: IcebergType.STRING,
                elementId: 5,
            }),
            id: 2,
        },
        {
            name: 'attrs',
            type: IcebergType.map({
                key: IcebergType.STRING,
                keyId: 6,
                value: IcebergType.STRING,
                valueId: 7,
            }),
            id: 3,
        },
        {
            name: 'addr',
            type: IcebergType.struct([
                {
                    id: 8,
                    name: 'line1',
                    type: IcebergType.STRING,
                },
                ...(step >= 8 ? [
                    {
                        id: 11,
                        name: 'zip',
                        type: IcebergType.STRING,
                    },
                ] : []),
                {
                    id: 9,
                    name: 'city',
                    type: IcebergType.STRING,
                },
            ]),
            id: 4,
        },
    ];
    if (step >= 7) {
        columns.push({
            name: 'note',
            type: IcebergType.STRING,
            id: 10,
        });
    }
    return columns;
}
