import {
    App,
} from 'aws-cdk-lib';
import {
    Template,
} from 'aws-cdk-lib/assertions';
import {
    ArceusStack,
} from '../lib/arceus-stack';

describe('ArceusStack', () => {
    let template: Template;

    beforeAll(() => {
        const app = new App();
        const stack = new ArceusStack(app, 'TestStack', {
            env: {
                account: '123456789012',
                region: 'us-east-1',
            },
        });
        template = Template.fromStack(stack);
    });

    it('creates the three KMS keys with rotation enabled', () => {
        template.resourceCountIs('AWS::KMS::Key', 3);
        template.allResourcesProperties('AWS::KMS::Key', {
            EnableKeyRotation: true,
        });
    });

    it('creates the data lake, athena results, and logging buckets', () => {
        template.resourceCountIs('AWS::S3::Bucket', 3);
    });

    it('creates the Glue database with the expected name', () => {
        template.hasResourceProperties('AWS::Glue::Database', {
            DatabaseInput: {
                Name: 'sample_database',
            },
        });
    });

    it('creates the Athena workgroup', () => {
        template.hasResourceProperties('AWS::Athena::WorkGroup', {
            Name: 'ReadOnly',
        });
    });

    it('creates Lake Formation settings and registered location', () => {
        template.resourceCountIs('AWS::LakeFormation::DataLakeSettings', 1);
        template.resourceCountIs('AWS::LakeFormation::Resource', 1);
    });

    it('does not create any CloudTrail resources', () => {
        template.resourceCountIs('AWS::CloudTrail::Trail', 0);
    });
});
