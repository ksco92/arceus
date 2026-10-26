import {
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
    Database,
} from 'aws-cdk-lib/aws-glue';
import {
    Bucket,
} from 'aws-cdk-lib/aws-s3';
import {
    IcebergEdgeAlgorithm,
    IcebergFormatVersion,
    IcebergPartitionTransform,
    IcebergTable,
    IcebergType,
} from '../packages/cdk-glue-iceberg-table/lib/iceberg';

/** Props for `IcebergV3DmlStack`; the bucket and database are owned by `ArceusStack`. */
export interface IcebergV3DmlStackProps extends StackProps {
    /** Name of the data-lake bucket that owns the tables' S3 prefixes. */
    readonly importedDataLakeBucketName: string;

    /** Name of the existing Glue database to publish the tables to. */
    readonly importedDatabaseName: string;

    /** ARN of the IAM principal granted SELECT/INSERT/DELETE/ALTER/DESCRIBE on both tables. */
    readonly principalArn: string;
}

/**
 * A v3 merge-on-read table (`v3_dml_test`) and a v2 table that Spark upgrades
 * in place (`v3_upgrade_test`), driven by `scripts/spark/verify_v3_dml.py`.
 */
export class IcebergV3DmlStack extends Stack {
    constructor(scope: Construct, id: string, props: IcebergV3DmlStackProps) {
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
        const location = (tableName: string) => `s3://${importedBucket.bucketName}/${importedDatabase.databaseName}/${tableName}/`;

        const dmlTable = new IcebergTable(this, 'V3DmlTable', {
            database: importedDatabase,
            tableName: 'v3_dml_test',
            columns: [
                {
                    name: 'account_id',
                    type: IcebergType.LONG,
                    required: true,
                    id: 1,
                },
                {
                    name: 'email',
                    type: IcebergType.STRING,
                    id: 2,
                },
                {
                    name: 'payload',
                    type: IcebergType.VARIANT,
                    id: 3,
                },
                {
                    name: 'placeholder',
                    type: IcebergType.UNKNOWN,
                    id: 4,
                },
                {
                    name: 'home',
                    type: IcebergType.geography('OGC:CRS84', IcebergEdgeAlgorithm.SPHERICAL),
                    id: 5,
                },
                {
                    name: 'shape',
                    type: IcebergType.geometry(),
                    id: 6,
                },
                {
                    name: 'balance',
                    type: IcebergType.decimal(12, 2),
                    id: 7,
                },
                {
                    name: 'updated_at',
                    type: IcebergType.TIMESTAMPTZ,
                    id: 8,
                },
            ],
            location: location('v3_dml_test'),
            partitionSpec: [
                {
                    sourceColumn: 'account_id',
                    transform: IcebergPartitionTransform.bucket(4),
                    fieldId: 1000,
                },
            ],
            identifierFieldNames: [
                'account_id',
            ],
            formatVersion: IcebergFormatVersion.V3,
            tableProperties: {
                'write.delete.mode': 'merge-on-read',
                'write.update.mode': 'merge-on-read',
                'write.merge.mode': 'merge-on-read',
            },
            removalPolicy: RemovalPolicy.DESTROY,
        });

        const upgradeTable = new IcebergTable(this, 'V3UpgradeTable', {
            database: importedDatabase,
            tableName: 'v3_upgrade_test',
            columns: [
                {
                    name: 'id',
                    type: IcebergType.LONG,
                    id: 1,
                },
                {
                    name: 'name',
                    type: IcebergType.STRING,
                    id: 2,
                },
            ],
            location: location('v3_upgrade_test'),
            formatVersion: IcebergFormatVersion.V2,
            removalPolicy: RemovalPolicy.DESTROY,
        });

        for (const [
            permissionId,
            table,
        ] of [
            [
                'V3DmlTablePermission',
                dmlTable,
            ],
            [
                'V3UpgradeTablePermission',
                upgradeTable,
            ],
        ] as const) {
            const permission = new CfnPermissions(this, permissionId, {
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
                        databaseName: importedDatabase.databaseName,
                    },
                },
                dataLakePrincipal: {
                    dataLakePrincipalIdentifier: props.principalArn,
                },
            });
            permission.addResourceDependency(table.resource);
        }
    }
}
