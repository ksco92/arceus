#!/usr/bin/env node
import {
    App,
} from 'aws-cdk-lib';
import {
    ArceusStack,
} from '../lib/arceus-stack';
import {
    IcebergEvolutionStack,
} from '../lib/iceberg-evolution-stack';

const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION;
if (!account || !region) {
    throw new Error(
        'CDK_DEFAULT_ACCOUNT and CDK_DEFAULT_REGION must both be set. '
        + 'Run `aws sts get-caller-identity` and `aws configure get region` to confirm; '
        + 'cdk normally populates these from the active AWS profile.',
    );
}
const env = {
    account,
    region,
};

const app = new App();

new ArceusStack(app, 'ArceusStack', {
    env,
});

new IcebergEvolutionStack(app, 'IcebergEvolutionStack', {
    env,
    /// Imports the demo lake's bucket + database created by ArceusStack
    /// — see the stack itself for the construction. Splitting the
    /// imports across two files would just add a noise stack to
    /// `cdk ls` for zero CFN-side gain.
    importedDataLakeBucketName: `data-lake-bucket-${account}`,
    importedDatabaseName: 'sample_database',
    developerIamUserName: 'rodrigo',
});
