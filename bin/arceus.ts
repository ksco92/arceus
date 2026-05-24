#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import {
    Database,
} from '@aws-cdk/aws-glue-alpha';
import {
    Bucket,
} from 'aws-cdk-lib/aws-s3';
import {
    ArnPrincipal,
} from 'aws-cdk-lib/aws-iam';
import {
    ArceusStack,
} from '../lib/arceus-stack';
import {
    IcebergEvolutionStack,
} from '../lib/iceberg-evolution-stack';

const app = new cdk.App();
const env = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
};

new ArceusStack(app, 'ArceusStack', {
    env,
});

/// Separate stack used by the integration-test evolution script.
/// It imports the demo lake's bucket + database by name so the test
/// doesn't have to re-create or share the demo's Lake Formation
/// settings.
const evolutionStack = new cdk.Stack(app, 'IcebergEvolutionImports', {
    env,
});
const importedBucket = Bucket.fromBucketName(
    evolutionStack,
    'ImportedDataLakeBucket',
    `data-lake-bucket-${cdk.Stack.of(evolutionStack).account}`,
);
const importedDatabase = Database.fromDatabaseArn(
    evolutionStack,
    'ImportedDatabase',
    `arn:aws:glue:${cdk.Stack.of(evolutionStack).region}:${cdk.Stack.of(evolutionStack).account}:database/sample_database`,
);
new IcebergEvolutionStack(app, 'IcebergEvolutionStack', {
    env,
    database: importedDatabase,
    dataLakeBucket: importedBucket,
    developerPrincipal: new ArnPrincipal(
        `arn:aws:iam::${cdk.Stack.of(evolutionStack).account}:user/rodrigo`,
    ),
});
