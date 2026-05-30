#!/usr/bin/env node
import {
    App,
} from 'aws-cdk-lib';
import {
    ConsumerStack,
} from '../lib/consumer-stack';

const app = new App();
new ConsumerStack(app, 'CdkGlueIcebergTableE2EConsumer', {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT ?? '123456789012',
        region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
    },
});
