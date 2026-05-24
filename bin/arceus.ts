#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import {
    ArceusStack,
} from '../lib/arceus-stack';

const app = new cdk.App();
new ArceusStack(app, 'ArceusStack');
