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
    Database,
} from '@aws-cdk/aws-glue-alpha';
import {
    Bucket,
} from 'aws-cdk-lib/aws-s3';
import {
    IcebergDataFormat,
    IcebergFormatVersion,
    IcebergPartitionTransform,
    IcebergSortDirection,
    IcebergTable,
    IcebergType,
} from '../packages/cdk-glue-iceberg-table/lib/iceberg';

/**
 * Props for `IcebergDmlStack`. Imports the lake bucket and Glue
 * database from `ArceusStack` by name so the stack can be deployed
 * and destroyed independently.
 */
export interface IcebergDmlStackProps extends StackProps {
    /** Name of the data-lake bucket that owns the table's S3 prefix. */
    readonly importedDataLakeBucketName: string;

    /** Name of the existing Glue database to publish the table to. */
    readonly importedDatabaseName: string;

    /**
     * ARN of the IAM principal that should be granted
     * SELECT/INSERT/DELETE/ALTER/DESCRIBE on the test table — typically
     * the principal running `cdk deploy`.
     */
    readonly principalArn: string;
}

/**
 * Stack that owns a single Iceberg v2 table sized for exercising the
 * full Iceberg-v2 DML surface: identifier fields, merge-on-read
 * delete / update / merge, time travel, OPTIMIZE compaction, and
 * VACUUM snapshot expiration. Used as the target of
 * `scripts/integration-test-dml.sh`.
 *
 * The schema is intentionally simple — the test is about the DML
 * commands, not about schema evolution (which is covered by
 * `IcebergEvolutionStack`).
 */
export class IcebergDmlStack extends Stack {
    constructor(scope: Construct, id: string, props: IcebergDmlStackProps) {
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

        const table = new IcebergTable(this, 'DmlTable', {
            database: importedDatabase,
            tableName: 'dml_test',
            comment: 'Integration-test target for DML (update / delete / merge / time-travel / optimize / vacuum).',
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
                    required: true,
                    id: 2,
                },
                {
                    name: 'balance',
                    type: IcebergType.decimal(12, 2),
                    required: true,
                    id: 3,
                },
                {
                    name: 'last_updated_at',
                    type: IcebergType.TIMESTAMPTZ,
                    required: true,
                    id: 4,
                },
            ],
            location: `s3://${importedBucket.bucketName}/${importedDatabase.databaseName}/dml_test/`,
            partitionSpec: [
                {
                    sourceColumn: 'account_id',
                    transform: IcebergPartitionTransform.bucket(4),
                },
            ],
            sortOrder: [
                {
                    sourceColumn: 'account_id',
                    direction: IcebergSortDirection.ASC,
                },
            ],
            identifierFieldNames: [
                'account_id',
            ],
            dataFormat: IcebergDataFormat.PARQUET,
            formatVersion: IcebergFormatVersion.V2,
            tableProperties: {
                'write.delete.mode': 'merge-on-read',
                'write.update.mode': 'merge-on-read',
                'write.merge.mode': 'merge-on-read',
                /// Aggressive snapshot expiration so VACUUM has something
                /// to do on a fresh table that's only existed for ~minutes.
                'history.expire.min-snapshots-to-keep': '1',
                'history.expire.max-snapshot-age-ms': '60000',
            },
            removalPolicy: RemovalPolicy.DESTROY,
        });

        const permission = new CfnPermissions(this, 'DmlTablePermission', {
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
        permission.addDependency(table.resource);

        new CfnOutput(this, 'DmlTableNameOutput', {
            value: table.tableName,
        });
    }
}
