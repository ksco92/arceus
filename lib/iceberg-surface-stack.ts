import {
    CfnOutput,
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
    Role,
} from 'aws-cdk-lib/aws-iam';
import {
    Database,
} from '@aws-cdk/aws-glue-alpha';
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
     * exercise the construct's `grantRead` machinery.
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
 *     and null orderings.
 *   - `nested_test` — list, struct, and map columns inserted and
 *     queried via Athena's nested-type SQL.
 *   - `transforms_test.grantRead(granteeRole)` — the four-statement
 *     IAM split exercised at runtime by assuming the role from the
 *     integ script and calling Glue / S3 directly.
 *   - `IcebergTable.fromIcebergTableAttributes(...)` on the same
 *     table, then `grantRead(grantee2Role)` — proves the import
 *     factory's grant path is symmetric with the native one.
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
            tableName: 'sorted_test',
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
            comment: 'Exercises list, struct, and map column types end-to-end via Athena.',
            columns: [
                {
                    name: 'id',
                    type: IcebergType.LONG,
                    required: true,
                    id: 1,
                },
                {
                    name: 'tags',
                    type: IcebergType.list(IcebergType.STRING),
                    id: 2,
                },
                {
                    name: 'profile',
                    type: IcebergType.struct([
                        {
                            name: 'first_name',
                            type: IcebergType.STRING,
                            required: true,
                        },
                        {
                            name: 'last_name',
                            type: IcebergType.STRING,
                            required: true,
                        },
                        {
                            name: 'age',
                            type: IcebergType.INT,
                        },
                    ]),
                    id: 3,
                },
                {
                    name: 'attrs',
                    type: IcebergType.map(IcebergType.STRING, IcebergType.STRING, false),
                    id: 4,
                },
            ],
            location: `s3://${bucketName}/${dbName}/nested_test/`,
            removalPolicy: RemovalPolicy.DESTROY,
        });

        /// ////////////////////////////////////////////////////////
        // LF table grants for the deployer principal.

        const tablesForLfGrant = [
            transformsTable,
            sortedTable,
            nestedTable,
        ];
        tablesForLfGrant.forEach((table, index) => {
            const permission = new CfnPermissions(this, `LfPermission${index}`, {
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
                        name: table.tableName,
                        databaseName: dbName,
                    },
                },
                dataLakePrincipal: {
                    dataLakePrincipalIdentifier: props.principalArn,
                },
            });
            permission.addDependency(table.resource);
        });

        /// ////////////////////////////////////////////////////////
        // GranteeRole — trusts the deployer principal so the integ
        // script can assume it. `grantRead` is then exercised on the
        // role to verify the IAM-grant machinery at runtime (Glue
        // perms + S3 list-with-prefix-condition + S3 object reads).

        const granteeRole = new Role(this, 'GranteeRole', {
            assumedBy: new ArnPrincipal(props.principalArn),
            description: 'Trust-by-deployer role used by the surface integ-test script to exercise grantRead at runtime.',
        });
        transformsTable.grantRead(granteeRole);

        /// ////////////////////////////////////////////////////////
        // Imported handle on the same table + a second grantee role
        // it gets granted to. Validates that the import-by-attributes
        // path produces the same four IAM statements as the native
        // path.

        const importedTransforms = IcebergTable.fromIcebergTableAttributes(this, 'ImportedTransformsTable', {
            database: importedDatabase,
            tableName: transformsTable.tableName,
            location: transformsTable.location,
        });
        const importedGranteeRole = new Role(this, 'ImportedGranteeRole', {
            assumedBy: new ArnPrincipal(props.principalArn),
            description: 'Trust-by-deployer role granted via the imported-table factory; symmetry check against GranteeRole.',
        });
        importedTransforms.grantRead(importedGranteeRole);

        /// ////////////////////////////////////////////////////////
        // Outputs the script reads.

        new CfnOutput(this, 'GranteeRoleArnOutput', {
            value: granteeRole.roleArn,
        });
        new CfnOutput(this, 'ImportedGranteeRoleArnOutput', {
            value: importedGranteeRole.roleArn,
        });
    }
}
