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
    }
}
