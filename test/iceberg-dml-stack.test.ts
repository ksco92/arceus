import {
    App,
} from 'aws-cdk-lib';
import {
    Match,
    Template,
} from 'aws-cdk-lib/assertions';
import {
    IcebergDmlStack,
} from '../lib/iceberg-dml-stack';

function synth(): Template {
    const app = new App();
    const stack = new IcebergDmlStack(app, 'Dml', {
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

describe('IcebergDmlStack', () => {
    let template: Template;

    beforeAll(() => {
        template = synth();
    });

    it('creates exactly one Glue table named dml_test', () => {
        template.resourceCountIs('AWS::Glue::Table', 1);
        template.hasResourceProperties('AWS::Glue::Table', {
            Name: 'dml_test',
            DatabaseName: 'sample_database',
        });
    });

    it('emits the table under openTableFormatInput.icebergTableInput, never TableInput', () => {
        template.hasResourceProperties('AWS::Glue::Table', {
            OpenTableFormatInput: {
                IcebergInput: {
                    MetadataOperation: 'CREATE',
                    Version: '2',
                },
            },
            TableInput: Match.absent(),
        });
    });

    it('declares account_id, email, balance, last_updated_at with stable ids', () => {
        const tables = template.findResources('AWS::Glue::Table');
        const props = Object.values(tables)[0].Properties;
        const fields = props.OpenTableFormatInput.IcebergInput.IcebergTableInput.Schema.Fields;
        expect(fields.map((f: { Id: number; Name: string }) => ({
            Id: f.Id,
            Name: f.Name,
        }))).toEqual([
            {
                Id: 1,
                Name: 'account_id',
            },
            {
                Id: 2,
                Name: 'email',
            },
            {
                Id: 3,
                Name: 'balance',
            },
            {
                Id: 4,
                Name: 'last_updated_at',
            },
        ]);
    });

    it('exposes account_id as the identifier field id', () => {
        template.hasResourceProperties('AWS::Glue::Table', {
            OpenTableFormatInput: {
                IcebergInput: {
                    IcebergTableInput: Match.objectLike({
                        Schema: Match.objectLike({
                            IdentifierFieldIds: [
                                1,
                            ],
                        }),
                    }),
                },
            },
        });
    });

    it('partitions by bucket(4) on account_id', () => {
        template.hasResourceProperties('AWS::Glue::Table', {
            OpenTableFormatInput: {
                IcebergInput: {
                    IcebergTableInput: Match.objectLike({
                        PartitionSpec: Match.objectLike({
                            Fields: [
                                Match.objectLike({
                                    Name: 'account_id_bucket',
                                    Transform: 'bucket[4]',
                                }),
                            ],
                        }),
                    }),
                },
            },
        });
    });

    it('sets all three merge-on-read mode properties', () => {
        const tables = template.findResources('AWS::Glue::Table');
        const props = Object.values(tables)[0].Properties;
        const properties = props.OpenTableFormatInput.IcebergInput.IcebergTableInput.Properties;
        expect(properties['write.delete.mode']).toBe('merge-on-read');
        expect(properties['write.update.mode']).toBe('merge-on-read');
        expect(properties['write.merge.mode']).toBe('merge-on-read');
        expect(properties['format-version']).toBe('2');
    });

    it('configures aggressive snapshot expiration for VACUUM', () => {
        const tables = template.findResources('AWS::Glue::Table');
        const props = Object.values(tables)[0].Properties;
        const properties = props.OpenTableFormatInput.IcebergInput.IcebergTableInput.Properties;
        expect(properties['history.expire.min-snapshots-to-keep']).toBe('1');
        expect(properties['history.expire.max-snapshot-age-ms']).toBe('60000');
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
                    Name: 'dml_test',
                    DatabaseName: 'sample_database',
                }),
            }),
        });
    });

    it('outputs the table name', () => {
        template.hasOutput('DmlTableNameOutput', {
            Value: 'dml_test',
        });
    });
});
