import {
    App,
} from 'aws-cdk-lib';
import {
    Match,
    Template,
} from 'aws-cdk-lib/assertions';
import {
    IcebergSparkSmokeStack,
} from '../lib/iceberg-spark-smoke-stack';

function synth(): Template {
    const app = new App();
    const stack = new IcebergSparkSmokeStack(app, 'SparkSmoke', {
        env: {
            account: '123456789012',
            region: 'us-east-1',
        },
        importedDataLakeBucketName: 'data-lake-bucket-123456789012',
        importedDatabaseName: 'sample_database',
        principalArn: 'arn:aws:iam::123456789012:user/me',
    });
    return Template.fromStack(stack);
}

describe('IcebergSparkSmokeStack', () => {
    let template: Template;

    beforeAll(() => {
        template = synth();
    });

    it('creates exactly one Glue table named spark_smoke', () => {
        template.resourceCountIs('AWS::Glue::Table', 1);
        template.hasResourceProperties('AWS::Glue::Table', {
            Name: 'spark_smoke',
            DatabaseName: 'sample_database',
        });
    });

    it('keeps the table on destroy-with-stack, v2, at the lake bucket prefix', () => {
        template.hasResource('AWS::Glue::Table', {
            DeletionPolicy: 'Delete',
            Properties: {
                OpenTableFormatInput: {
                    IcebergInput: {
                        IcebergTableInput: Match.objectLike({
                            Location: 's3://data-lake-bucket-123456789012/sample_database/spark_smoke/',
                            Properties: Match.objectLike({
                                'format-version': '2',
                            }),
                        }),
                    },
                },
            },
        });
    });

    it('grants the test principal SELECT/INSERT/ALTER/DESCRIBE via Lake Formation', () => {
        template.hasResourceProperties('AWS::LakeFormation::Permissions', {
            Permissions: [
                'SELECT',
                'INSERT',
                'ALTER',
                'DESCRIBE',
            ],
            DataLakePrincipal: {
                DataLakePrincipalIdentifier: 'arn:aws:iam::123456789012:user/me',
            },
            Resource: Match.objectLike({
                TableResource: Match.objectLike({
                    Name: 'spark_smoke',
                    DatabaseName: 'sample_database',
                }),
            }),
        });
    });
});
