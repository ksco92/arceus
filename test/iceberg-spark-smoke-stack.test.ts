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

    it('declares a single required bigint column id with field id 1', () => {
        const tables = template.findResources('AWS::Glue::Table');
        const props = Object.values(tables)[0].Properties;
        const fields = props.OpenTableFormatInput.IcebergInput.IcebergTableInput.Schema.Fields;
        expect(fields).toEqual([
            {
                Id: 1,
                Name: 'id',
                Required: true,
                Type: 'long',
            },
        ]);
    });

    it('grants the test principal SELECT/INSERT/DELETE/ALTER/DESCRIBE via Lake Formation', () => {
        template.hasResourceProperties('AWS::LakeFormation::Permissions', {
            Permissions: [
                'SELECT',
                'INSERT',
                'DELETE',
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

    it('outputs the table name', () => {
        template.hasOutput('SparkSmokeTableNameOutput', {
            Value: 'spark_smoke',
        });
    });
});
