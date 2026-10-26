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
} from 'aws-cdk-lib/aws-glue';
import {
    Bucket,
} from 'aws-cdk-lib/aws-s3';
import {
    IcebergFormatVersion,
    IcebergTable,
    IcebergType,
} from '../packages/cdk-glue-iceberg-table/lib/iceberg';

/** Props for `IcebergSparkSmokeStack`; the bucket and database are owned by `ArceusStack`. */
export interface IcebergSparkSmokeStackProps extends StackProps {
    /** Name of the data-lake bucket that owns the table's S3 prefix. */
    readonly importedDataLakeBucketName: string;

    /** Name of the existing Glue database to publish the table to. */
    readonly importedDatabaseName: string;

    /** ARN of the IAM principal granted SELECT/INSERT/DELETE/ALTER/DESCRIBE on the table. */
    readonly principalArn: string;
}

/** One-column Iceberg v2 table that `scripts/spark/smoke.py` writes to. */
export class IcebergSparkSmokeStack extends Stack {
    constructor(scope: Construct, id: string, props: IcebergSparkSmokeStackProps) {
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

        const table = new IcebergTable(this, 'SparkSmokeTable', {
            database: importedDatabase,
            tableName: 'spark_smoke',
            columns: [
                {
                    name: 'id',
                    type: IcebergType.LONG,
                    required: true,
                    id: 1,
                },
            ],
            location: `s3://${importedBucket.bucketName}/${importedDatabase.databaseName}/spark_smoke/`,
            formatVersion: IcebergFormatVersion.V2,
            removalPolicy: RemovalPolicy.DESTROY,
        });

        const permission = new CfnPermissions(this, 'SparkSmokeTablePermission', {
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

        new CfnOutput(this, 'SparkSmokeTableNameOutput', {
            value: table.tableName,
        });
    }
}
