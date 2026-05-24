import * as cdk from 'aws-cdk-lib';
import {
    DefaultStackSynthesizer,
    Fn,
    RemovalPolicy,
} from 'aws-cdk-lib';
import {
    Construct,
} from 'constructs';
import {
    ArnPrincipal,
} from 'aws-cdk-lib/aws-iam';
import {
    Key,
} from 'aws-cdk-lib/aws-kms';
import {
    BlockPublicAccess,
    Bucket,
    BucketEncryption,
    ObjectOwnership,
} from 'aws-cdk-lib/aws-s3';
import {
    CfnDataCatalogEncryptionSettings,
} from 'aws-cdk-lib/aws-glue';
import {
    CfnDataLakeSettings,
    CfnPermissions,
    CfnResource,
} from 'aws-cdk-lib/aws-lakeformation';
import {
    Database,
} from '@aws-cdk/aws-glue-alpha';
import {
    CfnWorkGroup,
} from 'aws-cdk-lib/aws-athena';
import {
    IcebergDataFormat,
    IcebergNullOrder,
    IcebergPartitionTransform,
    IcebergSortDirection,
    IcebergTable,
    IcebergType,
} from './iceberg';

export class ArceusStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        /// /////////////////////////////////////////////////
        /// /////////////////////////////////////////////////
        /// /////////////////////////////////////////////////
        /// /////////////////////////////////////////////////
        // Security

        const myUser = new ArnPrincipal(`arn:aws:iam::${this.account}:user/rodrigo`);

        const dataLakeBucketKmsKey = new Key(this, 'DataLakeBucketKmsKey', {
            enableKeyRotation: true,
            removalPolicy: RemovalPolicy.DESTROY,
        });

        const athenaResultsBucketKmsKey = new Key(this, 'AthenaResultsBucketKmsKey', {
            enableKeyRotation: true,
            removalPolicy: RemovalPolicy.DESTROY,
        });

        const catalogKmsKey = new Key(this, 'CatalogKmsKey', {
            enableKeyRotation: true,
            removalPolicy: RemovalPolicy.DESTROY,
        });

        const lfServiceRoleArn = `arn:${this.partition}:iam::${this.account}:role/aws-service-role/lakeformation.amazonaws.com/AWSServiceRoleForLakeFormationDataAccess`;

        const lfAdmins = [
            myUser,
            new ArnPrincipal(Fn.sub((this.synthesizer as DefaultStackSynthesizer).cloudFormationExecutionRoleArn)),
        ];

        /// /////////////////////////////////////////////////
        /// /////////////////////////////////////////////////
        /// /////////////////////////////////////////////////
        /// /////////////////////////////////////////////////
        // Buckets

        const loggingBucket = new Bucket(this, 'LoggingBucket', {
            bucketName: `logging-${this.account}`,
            encryption: BucketEncryption.S3_MANAGED,
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            objectOwnership: ObjectOwnership.OBJECT_WRITER,
        });

        const dataLakeBucket = new Bucket(this, 'DataLakeBucket', {
            bucketName: `data-lake-bucket-${this.account}`,
            encryptionKey: dataLakeBucketKmsKey,
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
            bucketKeyEnabled: true,
            serverAccessLogsBucket: loggingBucket,
            serverAccessLogsPrefix: `data-lake-bucket-${this.account}/`,
        });

        const athenaResultsBucket = new Bucket(this, 'AthenaResultsBucket', {
            bucketName: `athena-results-bucket-${this.account}`,
            encryptionKey: athenaResultsBucketKmsKey,
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
            bucketKeyEnabled: true,
            serverAccessLogsBucket: loggingBucket,
            serverAccessLogsPrefix: `athena-results-bucket-${this.account}/`,
        });

        /// /////////////////////////////////////////////////
        /// /////////////////////////////////////////////////
        // Bucket permissions

        const buckets = [
            athenaResultsBucket,
            dataLakeBucket,
        ];

        buckets.forEach((bucket) => {
            bucket.grantReadWrite(new ArnPrincipal(lfServiceRoleArn));
        });

        /// /////////////////////////////////////////////////
        /// /////////////////////////////////////////////////
        /// /////////////////////////////////////////////////
        /// /////////////////////////////////////////////////
        // Catalog settings

        /// /////////////////////////////////////////////////
        /// /////////////////////////////////////////////////
        // Catalog encryption

        new CfnDataCatalogEncryptionSettings(this, 'CatalogEncryptionSettings', {
            catalogId: this.account,
            dataCatalogEncryptionSettings: {
                encryptionAtRest: {
                    catalogEncryptionMode: 'SSE-KMS',
                    sseAwsKmsKeyId: catalogKmsKey.keyId,
                },
            },
        });

        lfAdmins.forEach((admin) => {
            catalogKmsKey.grantEncryptDecrypt(admin);
        });

        /// /////////////////////////////////////////////////
        /// /////////////////////////////////////////////////
        // Lake Formation settings

        new CfnDataLakeSettings(this, 'DataLakeSettings', {
            admins: lfAdmins.map((admin) => ({
                dataLakePrincipalIdentifier: admin.arn,
            })),
            parameters: {
                CROSS_ACCOUNT_VERSION: 4,
            },
            mutationType: 'REPLACE',
            createDatabaseDefaultPermissions: [

            ],
            createTableDefaultPermissions: [

            ],
        });

        new CfnResource(this, 'DataLakeRegisteredLocation', {
            resourceArn: `${dataLakeBucket.bucketArn}/`,
            useServiceLinkedRole: true,
            hybridAccessEnabled: true,
            roleArn: lfServiceRoleArn,
        });

        /// /////////////////////////////////////////////////
        /// /////////////////////////////////////////////////
        /// /////////////////////////////////////////////////
        /// /////////////////////////////////////////////////
        // Athena WG

        new CfnWorkGroup(this, 'ReadOnlyWorkGroup', {
            name: 'ReadOnly',
            workGroupConfiguration: {
                publishCloudWatchMetricsEnabled: true,
                resultConfiguration: {
                    outputLocation: `s3://${athenaResultsBucket.bucketName}/ReadOnlyWorkGroup`,
                },
            },
            recursiveDeleteOption: true,
        });

        /// /////////////////////////////////////////////////
        /// /////////////////////////////////////////////////
        /// /////////////////////////////////////////////////
        /// /////////////////////////////////////////////////
        // Database

        const databaseName = 'sample_database';

        const glueDatabase = new Database(this, 'SampleDatabase', {
            databaseName: databaseName,
            description: 'This is the description.',
            locationUri: `s3://${dataLakeBucket.bucketName}/${databaseName}/`,
        });

        /// /////////////////////////////////////////////////
        /// /////////////////////////////////////////////////
        /// /////////////////////////////////////////////////
        /// /////////////////////////////////////////////////
        // Permissions

        new CfnPermissions(this, 'DatabasePermission', {
            permissions: [
                'DESCRIBE',
            ],
            permissionsWithGrantOption: [

            ],
            resource: {
                databaseResource: {
                    catalogId: this.account,
                    name: glueDatabase.databaseName,
                },
            },
            dataLakePrincipal: {
                dataLakePrincipalIdentifier: myUser.arn,
            },
        });

        /// /////////////////////////////////////////////////
        /// /////////////////////////////////////////////////
        /// /////////////////////////////////////////////////
        /// /////////////////////////////////////////////////
        // Iceberg demo tables

        const ordersTable = new IcebergTable(this, 'OrdersTable', {
            database: glueDatabase,
            tableName: 'orders',
            comment: 'Demo Iceberg orders table — exercises partitions, sort order, and merge-on-read.',
            columns: [
                {
                    name: 'order_id',
                    type: IcebergType.LONG,
                    required: true,
                    doc: 'Monotonically increasing order id.',
                    id: 1,
                },
                {
                    name: 'customer_id',
                    type: IcebergType.LONG,
                    required: true,
                    doc: 'Foreign key to customers.customer_id.',
                    id: 2,
                },
                {
                    name: 'order_amount',
                    type: IcebergType.decimal(12, 2),
                    required: true,
                    doc: 'Total order amount in USD.',
                    id: 3,
                },
                {
                    name: 'currency',
                    type: IcebergType.STRING,
                    required: true,
                    doc: 'ISO-4217 currency code.',
                    id: 4,
                },
                {
                    name: 'placed_at',
                    type: IcebergType.TIMESTAMPTZ,
                    required: true,
                    doc: 'Order placement timestamp.',
                    id: 5,
                },
                {
                    name: 'tags',
                    type: IcebergType.list(IcebergType.STRING),
                    required: false,
                    doc: 'Free-form labels (loyalty-program, holiday-promo, ...).',
                    id: 6,
                },
                {
                    name: 'shipping_address',
                    type: IcebergType.struct([
                        {
                            name: 'line1',
                            type: IcebergType.STRING,
                            required: true,
                        },
                        {
                            name: 'city',
                            type: IcebergType.STRING,
                            required: true,
                        },
                        {
                            name: 'country',
                            type: IcebergType.STRING,
                            required: true,
                        },
                        {
                            name: 'postal_code',
                            type: IcebergType.STRING,
                            required: false,
                        },
                    ]),
                    required: false,
                    doc: 'Optional shipping address.',
                    id: 7,
                },
                {
                    name: 'metadata',
                    type: IcebergType.map(IcebergType.STRING, IcebergType.STRING, false),
                    required: false,
                    doc: 'Free-form string key/value metadata.',
                    id: 8,
                },
            ],
            location: `s3://${dataLakeBucket.bucketName}/${databaseName}/orders/`,
            partitionSpec: [
                {
                    sourceColumn: 'placed_at',
                    transform: IcebergPartitionTransform.DAY,
                },
                {
                    sourceColumn: 'customer_id',
                    transform: IcebergPartitionTransform.bucket(16),
                },
            ],
            sortOrder: [
                {
                    sourceColumn: 'placed_at',
                    direction: IcebergSortDirection.ASC,
                    nullOrder: IcebergNullOrder.NULLS_LAST,
                },
                {
                    sourceColumn: 'order_id',
                    direction: IcebergSortDirection.ASC,
                },
            ],
            identifierFieldNames: [
                'order_id',
            ],
            dataFormat: IcebergDataFormat.PARQUET,
            tableProperties: {
                'write.parquet.compression-codec': 'zstd',
                'write.delete.mode': 'merge-on-read',
                'write.update.mode': 'merge-on-read',
                'write.merge.mode': 'merge-on-read',
                'write.target-file-size-bytes': '134217728',
                'history.expire.min-snapshots-to-keep': '5',
                'gc.enabled': 'true',
            },
            removalPolicy: RemovalPolicy.DESTROY,
        });

        const eventsTable = new IcebergTable(this, 'EventsTable', {
            database: glueDatabase,
            tableName: 'events',
            comment: 'Demo Iceberg events table — high-cardinality hourly partitioning.',
            columns: [
                {
                    name: 'event_id',
                    type: IcebergType.STRING,
                    required: true,
                    id: 1,
                },
                {
                    name: 'event_name',
                    type: IcebergType.STRING,
                    required: true,
                    id: 2,
                },
                {
                    name: 'session_id',
                    type: IcebergType.STRING,
                    required: false,
                    id: 3,
                },
                {
                    name: 'occurred_at',
                    type: IcebergType.TIMESTAMPTZ,
                    required: true,
                    id: 4,
                },
                {
                    name: 'attributes',
                    type: IcebergType.map(IcebergType.STRING, IcebergType.STRING, false),
                    required: false,
                    id: 5,
                },
            ],
            location: `s3://${dataLakeBucket.bucketName}/${databaseName}/events/`,
            partitionSpec: [
                {
                    sourceColumn: 'occurred_at',
                    transform: IcebergPartitionTransform.HOUR,
                },
            ],
            removalPolicy: RemovalPolicy.DESTROY,
        });

        /// `customers` exists to demonstrate cdk-only schema evolution:
        /// add, rename, and drop columns happen by editing this block
        /// and running `cdk deploy` again. Every column has a pinned
        /// `id` so that adds/removes never reassign existing ids.
        const customersTable = new IcebergTable(this, 'CustomersTable', {
            database: glueDatabase,
            tableName: 'customers',
            comment: 'Demo Iceberg customers table — schema evolution playground.',
            columns: [
                {
                    name: 'customer_id',
                    type: IcebergType.LONG,
                    required: true,
                    id: 1,
                    doc: 'Customer primary key.',
                },
                {
                    name: 'email',
                    type: IcebergType.STRING,
                    required: true,
                    id: 2,
                },
                /// Schema evolution step 3: `display_name` (formerly
                /// `full_name`, id=3) is dropped here. The id stays
                /// retired in metadata — never reassign it to a new
                /// column or readers projecting old snapshots will
                /// surface the wrong data under the new name.
                {
                    name: 'signed_up_at',
                    type: IcebergType.TIMESTAMPTZ,
                    required: true,
                    id: 4,
                },
                /// Schema evolution step 1: added in deploy v2.
                /// New id (5) is above last-column-id; no reuse risk.
                {
                    name: 'loyalty_tier',
                    type: IcebergType.STRING,
                    required: false,
                    id: 5,
                    doc: 'Loyalty program tier — added in evolution step 1.',
                },
            ],
            location: `s3://${dataLakeBucket.bucketName}/${databaseName}/customers/`,
            identifierFieldNames: [
                'customer_id',
            ],
            removalPolicy: RemovalPolicy.DESTROY,
        });

        /// /////////////////////////////////////////////////
        /// /////////////////////////////////////////////////
        /// /////////////////////////////////////////////////
        /// /////////////////////////////////////////////////
        // Outputs

        new cdk.CfnOutput(this, 'DataLakeBucketNameOutput', {
            value: dataLakeBucket.bucketName,
            description: 'Data lake bucket where Iceberg tables will be stored.',
        });

        new cdk.CfnOutput(this, 'AthenaResultsBucketNameOutput', {
            value: athenaResultsBucket.bucketName,
            description: 'Athena query results bucket.',
        });

        new cdk.CfnOutput(this, 'DatabaseNameOutput', {
            value: glueDatabase.databaseName,
            description: 'Glue database for Iceberg tables.',
        });

        new cdk.CfnOutput(this, 'OrdersTableNameOutput', {
            value: ordersTable.tableName,
            description: 'Iceberg orders table name.',
        });

        new cdk.CfnOutput(this, 'EventsTableNameOutput', {
            value: eventsTable.tableName,
            description: 'Iceberg events table name.',
        });

        new cdk.CfnOutput(this, 'CustomersTableNameOutput', {
            value: customersTable.tableName,
            description: 'Iceberg customers table name (schema-evolution demo).',
        });

        /// /////////////////////////////////////////////////
        /// /////////////////////////////////////////////////
        // Lake Formation grants on the demo tables so the
        // developer principal can run INSERT/UPDATE/DELETE/SELECT.

        const tablePermissionGrants = [
            {
                id: 'OrdersTablePermission',
                table: ordersTable,
            },
            {
                id: 'EventsTablePermission',
                table: eventsTable,
            },
            {
                id: 'CustomersTablePermission',
                table: customersTable,
            },
        ];
        tablePermissionGrants.forEach((grant) => {
            const permission = new CfnPermissions(this, grant.id, {
                permissions: [
                    'SELECT',
                    'INSERT',
                    'DELETE',
                    'ALTER',
                    'DESCRIBE',
                ],
                permissionsWithGrantOption: [

                ],
                resource: {
                    tableResource: {
                        catalogId: this.account,
                        name: grant.table.tableName,
                        databaseName: glueDatabase.databaseName,
                    },
                },
                dataLakePrincipal: {
                    dataLakePrincipalIdentifier: myUser.arn,
                },
            });
            permission.addDependency(grant.table.resource);
        });
    }
}
