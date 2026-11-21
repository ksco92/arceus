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
    ArnPrincipal,
    Policy,
    PolicyStatement,
    Role,
} from 'aws-cdk-lib/aws-iam';
import {
    Key,
} from 'aws-cdk-lib/aws-kms';
import {
    Database,
} from 'aws-cdk-lib/aws-glue';
import {
    Bucket,
} from 'aws-cdk-lib/aws-s3';
import {
    IcebergFormatVersion,
    IcebergNullOrder,
    IcebergPartitionTransform,
    IcebergSortDirection,
    IcebergTable,
    IcebergType,
} from '../packages/cdk-glue-iceberg-table/lib/iceberg';

/**
 * Props for `IcebergSurfaceStack`. Imports the lake bucket and Glue
 * database from `ArceusStack` by name.
 */
export interface IcebergSurfaceStackProps extends StackProps {
    /** Name of the data-lake bucket that owns each table's S3 prefix. */
    readonly importedDataLakeBucketName: string;

    /** Name of the existing Glue database to publish the tables to. */
    readonly importedDatabaseName: string;

    /**
     * ARN of the IAM principal granted SELECT/INSERT/DELETE/ALTER/
     * DESCRIBE on every test table. Also the trust principal for the
     * two grantee roles the stack creates: it's the only identity
     * allowed to `sts:AssumeRole` them, so the integ-test script can
     * exercise the construct's grants.
     */
    readonly principalArn: string;
}

/**
 * Stack that exercises Tier-2 construct surface the evolution and
 * DML stacks don't reach:
 *
 *   - `transforms_test` — every partition transform (identity, year,
 *     month, day, hour, bucket(N), truncate(W)) on one table.
 *   - `sorted_test` — multi-field write order with mixed directions
 *     and null orderings; its name comes from a `CfnParameter`.
 *   - `nested_test` — list, struct, and map columns inserted and
 *     queried via Spark SQL.
 *   - `creation_order_test` — nested columns declared with ids out of
 *     creation order, to read back the ids Glue assigns at CREATE.
 *   - `grants_test` — read by `ReaderRole` (`grantRead`) and written by
 *     `ReadWriterRole` (`grantReadWrite` on an imported handle).
 */
export class IcebergSurfaceStack extends Stack {
    constructor(scope: Construct, id: string, props: IcebergSurfaceStackProps) {
        super(scope, id, props);

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
        const dbName = importedDatabase.databaseName;
        const bucketName = importedBucket.bucketName;
        const dataLakeKey = Key.fromKeyArn(this, 'DataLakeKey', new CfnParameter(this, 'DataLakeKeyArn', {
            description: 'ARN of the KMS key the data-lake bucket encrypts objects with.',
        }).valueAsString);
        const catalogKey = Key.fromKeyArn(this, 'CatalogKey', new CfnParameter(this, 'CatalogKeyArn', {
            description: 'ARN of the KMS key the Data Catalog is encrypted with.',
        }).valueAsString);

        /// ////////////////////////////////////////////////////////
        // Table 1 — every partition transform.

        const transformsTable = new IcebergTable(this, 'TransformsTable', {
            database: importedDatabase,
            tableName: 'transforms_test',
            formatVersion: IcebergFormatVersion.V2,
            comment: 'Exercises every IcebergPartitionTransform on a single table.',
            columns: [
                /// One source column per temporal transform — Iceberg
                /// considers year(x) + month(x), month(x) + day(x), etc.
                /// on the same column redundant and refuses to write.
                {
                    name: 'year_source',
                    type: IcebergType.TIMESTAMPTZ,
                    required: true,
                    id: 1,
                },
                {
                    name: 'month_source',
                    type: IcebergType.TIMESTAMPTZ,
                    required: true,
                    id: 2,
                },
                {
                    name: 'day_source',
                    type: IcebergType.TIMESTAMPTZ,
                    required: true,
                    id: 3,
                },
                {
                    name: 'hour_source',
                    type: IcebergType.TIMESTAMPTZ,
                    required: true,
                    id: 4,
                },
                {
                    name: 'user_id',
                    type: IcebergType.LONG,
                    required: true,
                    id: 5,
                },
                {
                    name: 'email',
                    type: IcebergType.STRING,
                    required: true,
                    id: 6,
                },
                {
                    name: 'value',
                    type: IcebergType.LONG,
                    required: true,
                    id: 7,
                },
            ],
            location: `s3://${bucketName}/${dbName}/transforms_test/`,
            partitionSpec: [
                {
                    sourceColumn: 'year_source',
                    transform: IcebergPartitionTransform.YEAR,
                    fieldId: 1000,
                },
                {
                    sourceColumn: 'month_source',
                    transform: IcebergPartitionTransform.MONTH,
                    fieldId: 1001,
                },
                {
                    sourceColumn: 'day_source',
                    transform: IcebergPartitionTransform.DAY,
                    fieldId: 1002,
                },
                {
                    sourceColumn: 'hour_source',
                    transform: IcebergPartitionTransform.HOUR,
                    fieldId: 1003,
                },
                {
                    sourceColumn: 'user_id',
                    transform: IcebergPartitionTransform.bucket(8),
                    fieldId: 1004,
                },
                {
                    sourceColumn: 'email',
                    transform: IcebergPartitionTransform.truncate(4),
                    fieldId: 1005,
                },
                {
                    sourceColumn: 'value',
                    transform: IcebergPartitionTransform.IDENTITY,
                    fieldId: 1006,
                },
            ],
            removalPolicy: RemovalPolicy.DESTROY,
        });

        /// ////////////////////////////////////////////////////////
        // Table 2 — multi-field sort order with mixed directions.

        const sortedTable = new IcebergTable(this, 'SortedTable', {
            database: importedDatabase,
            tableName: new CfnParameter(this, 'SortedTableName', {
                default: 'sorted_test',
                description: 'Name of the sorted table.',
            }).valueAsString,
            formatVersion: IcebergFormatVersion.V2,
            comment: 'Exercises sortOrder with multiple fields, mixed direction + null ordering.',
            columns: [
                {
                    name: 'tenant',
                    type: IcebergType.STRING,
                    required: true,
                    id: 1,
                },
                {
                    name: 'created_at',
                    type: IcebergType.TIMESTAMPTZ,
                    required: true,
                    id: 2,
                },
                {
                    name: 'amount',
                    type: IcebergType.decimal(10, 2),
                    required: true,
                    id: 3,
                },
            ],
            location: `s3://${bucketName}/${dbName}/sorted_test/`,
            sortOrder: [
                {
                    sourceColumn: 'tenant',
                    direction: IcebergSortDirection.ASC,
                    nullOrder: IcebergNullOrder.NULLS_FIRST,
                },
                {
                    sourceColumn: 'created_at',
                    direction: IcebergSortDirection.DESC,
                    nullOrder: IcebergNullOrder.NULLS_LAST,
                },
                {
                    sourceColumn: 'amount',
                    direction: IcebergSortDirection.DESC,
                },
            ],
            removalPolicy: RemovalPolicy.DESTROY,
        });

        /// ////////////////////////////////////////////////////////
        // Table 3 — list, struct, map.

        const nestedTable = new IcebergTable(this, 'NestedTable', {
            database: importedDatabase,
            tableName: 'nested_test',
            formatVersion: IcebergFormatVersion.V2,
            comment: 'Exercises list, struct, and map column types end-to-end via Spark.',
            columns: [
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
                        elementRequired: true,
                    }),
                    id: 2,
                },
                {
                    name: 'profile',
                    type: IcebergType.struct([
                        {
                            id: 6,
                            name: 'first_name',
                            type: IcebergType.STRING,
                            required: true,
                        },
                        {
                            id: 7,
                            name: 'last_name',
                            type: IcebergType.STRING,
                            required: true,
                        },
                        {
                            id: 8,
                            name: 'age',
                            type: IcebergType.INT,
                        },
                    ]),
                    id: 3,
                },
                {
                    name: 'attrs',
                    type: IcebergType.map({
                        key: IcebergType.STRING,
                        keyId: 9,
                        value: IcebergType.STRING,
                        valueId: 10,
                    }),
                    id: 4,
                },
            ],
            location: `s3://${bucketName}/${dbName}/nested_test/`,
            removalPolicy: RemovalPolicy.DESTROY,
        });

        /// ////////////////////////////////////////////////////////
        // Table 4 — no partition, sort order or identifier, so the table stays updatable.

        const creationOrderTable = new IcebergTable(this, 'CreationOrderTable', {
            database: importedDatabase,
            tableName: 'creation_order_test',
            formatVersion: IcebergFormatVersion.V2,
            comment: 'Declared out of creation order; Glue stores the creation-order ids.',
            columns: [
                {
                    name: 'b',
                    type: IcebergType.LONG,
                    required: true,
                    id: 12,
                },
                {
                    name: 'a',
                    type: IcebergType.STRING,
                    id: 5,
                },
                {
                    name: 's',
                    type: IcebergType.struct([
                        {
                            id: 21,
                            name: 'lst',
                            type: IcebergType.list({
                                elementId: 22,
                                element: IcebergType.struct([
                                    {
                                        id: 23,
                                        name: 'p',
                                        type: IcebergType.INT,
                                    },
                                ]),
                            }),
                        },
                    ]),
                    id: 20,
                },
                {
                    name: 'm',
                    type: IcebergType.map({
                        keyId: 31,
                        key: IcebergType.struct([
                            {
                                id: 32,
                                name: 'k',
                                type: IcebergType.STRING,
                            },
                        ]),
                        valueId: 33,
                        value: IcebergType.struct([
                            {
                                id: 34,
                                name: 'v',
                                type: IcebergType.INT,
                            },
                        ]),
                    }),
                    id: 30,
                },
            ],
            location: `s3://${bucketName}/${dbName}/creation_order_test/`,
            removalPolicy: RemovalPolicy.DESTROY,
        });

        /// ////////////////////////////////////////////////////////
        // Table 5 — read and written only by the two grantee roles.

        const grantsTable = new IcebergTable(this, 'GrantsTable', {
            database: importedDatabase,
            tableName: 'grants_test',
            formatVersion: IcebergFormatVersion.V2,
            comment: 'Read and written by roles whose table permissions come from the construct grants.',
            columns: [
                {
                    name: 'id',
                    type: IcebergType.LONG,
                    required: true,
                    id: 1,
                },
                {
                    name: 'source',
                    type: IcebergType.STRING,
                    id: 2,
                },
            ],
            location: `s3://${bucketName}/${dbName}/grants_test/`,
            encryptionKey: dataLakeKey,
            removalPolicy: RemovalPolicy.DESTROY,
        });

        /// ////////////////////////////////////////////////////////
        // LF table grants for the deployer principal.

        const tablePermission = (id: string, table: IcebergTable, principalArn: string, permissions: string[]): void => {
            new CfnPermissions(this, id, {
                permissions,
                permissionsWithGrantOption: [],
                resource: {
                    tableResource: {
                        catalogId: this.account,
                        name: table.tableName,
                        databaseName: dbName,
                    },
                },
                dataLakePrincipal: {
                    dataLakePrincipalIdentifier: principalArn,
                },
            }).addResourceDependency(table.resource);
        };
        [
            transformsTable,
            sortedTable,
            nestedTable,
            creationOrderTable,
            grantsTable,
        ].forEach((table, index) => {
            tablePermission(`LfPermission${index}`, table, props.principalArn, [
                'SELECT',
                'INSERT',
                'DELETE',
                'ALTER',
                'DESCRIBE',
            ]);
        });

        /// ////////////////////////////////////////////////////////
        // Grantee roles, trusted by the deployer principal so the script
        // can assume them. Their table permissions come from the grants;
        // the Lake Formation permissions and the Athena policy below are
        // what a caller adds alongside them.

        const grantOptions = {
            catalogEncryptionKey: catalogKey,
            lakeFormationDataAccess: true,
        };
        const readerRole = new Role(this, 'ReaderRole', {
            assumedBy: new ArnPrincipal(props.principalArn),
            description: 'Holds grantRead on grants_test.',
        });
        grantsTable.grantRead(readerRole, grantOptions);

        const importedGrantsTable = IcebergTable.fromIcebergTableAttributes(this, 'ImportedGrantsTable', {
            database: importedDatabase,
            tableName: grantsTable.tableName,
            location: grantsTable.location,
            encryptionKey: dataLakeKey,
        });
        const readWriterRole = new Role(this, 'ReadWriterRole', {
            assumedBy: new ArnPrincipal(props.principalArn),
            description: 'Holds grantReadWrite on an imported handle of grants_test.',
        });
        importedGrantsTable.grantReadWrite(readWriterRole, grantOptions);

        tablePermission('ReaderLfPermission', grantsTable, readerRole.roleArn, [
            'SELECT',
            'DESCRIBE',
        ]);
        tablePermission('ReadWriterLfPermission', grantsTable, readWriterRole.roleArn, [
            'SELECT',
            'INSERT',
            'DELETE',
            'ALTER',
            'DESCRIBE',
        ]);

        /// Athena runs the queries in the `primary` workgroup and writes
        /// results under `athena-results/` (scripts/athena.sh).
        new Policy(this, 'AthenaQueryPolicy', {
            roles: [
                readerRole,
                readWriterRole,
            ],
            statements: [
                new PolicyStatement({
                    actions: [
                        'athena:StartQueryExecution',
                        'athena:GetQueryExecution',
                        'athena:GetQueryResults',
                        'athena:StopQueryExecution',
                    ],
                    resources: [
                        this.formatArn({
                            service: 'athena',
                            resource: 'workgroup',
                            resourceName: 'primary',
                        }),
                    ],
                }),
                new PolicyStatement({
                    actions: [
                        's3:GetObject',
                        's3:PutObject',
                    ],
                    resources: [
                        importedBucket.arnForObjects('athena-results/*'),
                    ],
                }),
                new PolicyStatement({
                    actions: [
                        'kms:GenerateDataKey',
                    ],
                    resources: [
                        dataLakeKey.keyArn,
                    ],
                }),
            ],
        });

        /// ////////////////////////////////////////////////////////
        // Outputs the script reads.

        new CfnOutput(this, 'ReaderRoleArnOutput', {
            value: readerRole.roleArn,
        });
        new CfnOutput(this, 'ReadWriterRoleArnOutput', {
            value: readWriterRole.roleArn,
        });
    }
}
