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

const app = new App();
const env = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
};

new ArceusStack(app, 'ArceusStack', {
    env,
});

new IcebergEvolutionStack(app, 'IcebergEvolutionStack', {
    env,
    /// Imports the demo lake's bucket + database created by ArceusStack
    /// — see the stack itself for the construction. Splitting the
    /// imports across two files would just add a noise stack to
    /// `cdk ls` for zero CFN-side gain.
    importedDataLakeBucketName: `data-lake-bucket-${env.account ?? ''}`,
    importedDatabaseName: 'sample_database',
    developerIamUserName: 'rodrigo',
});
