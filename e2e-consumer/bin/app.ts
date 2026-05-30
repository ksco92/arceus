#!/usr/bin/env node
import {
    App,
} from 'aws-cdk-lib';
import {
    ConsumerStack,
} from '../lib/consumer-stack';
import {
    SURFACE_ANCHORS,
} from '../lib/surface-reference';

const app = new App();
new ConsumerStack(app, 'CdkGlueIcebergTableE2EConsumer', {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT ?? '123456789012',
        region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
    },
});

// Force-import the surface-anchor file so its imports are checked at
// synth time, not tree-shaken.
void SURFACE_ANCHORS;
