import {
    App,
} from 'aws-cdk-lib';
import {
    Match,
    Template,
} from 'aws-cdk-lib/assertions';
import {
    IcebergV3DmlStack,
} from '../lib/iceberg-v3-dml-stack';

function synth(): Template {
    const app = new App();
    const stack = new IcebergV3DmlStack(app, 'V3Dml', {
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

describe('IcebergV3DmlStack', () => {
    let template: Template;

    beforeAll(() => {
        template = synth();
    });

    it('creates v3_dml_test at Version 3 and v3_upgrade_test at Version 2', () => {
        template.resourceCountIs('AWS::Glue::Table', 2);
        template.hasResourceProperties('AWS::Glue::Table', {
            Name: 'v3_dml_test',
            OpenTableFormatInput: {
                IcebergInput: Match.objectLike({
                    Version: '3',
                }),
            },
        });
        template.hasResourceProperties('AWS::Glue::Table', {
            Name: 'v3_upgrade_test',
            OpenTableFormatInput: {
                IcebergInput: Match.objectLike({
                    Version: '2',
                }),
            },
        });
    });

    it('renders the v3 column types of v3_dml_test with stable ids', () => {
        template.hasResourceProperties('AWS::Glue::Table', {
            Name: 'v3_dml_test',
            OpenTableFormatInput: {
                IcebergInput: {
                    MetadataOperation: 'CREATE',
                    Version: '3',
                    IcebergTableInput: Match.objectLike({
                        Location: 's3://data-lake-bucket-123456789012/sample_database/v3_dml_test/',
                        Schema: Match.objectLike({
                            Fields: [
                                {
                                    Id: 1,
                                    Name: 'account_id',
                                    Required: true,
                                    Type: 'long',
                                },
                                {
                                    Id: 2,
                                    Name: 'email',
                                    Required: false,
                                    Type: 'string',
                                },
                                {
                                    Id: 3,
                                    Name: 'payload',
                                    Required: false,
                                    Type: 'variant',
                                },
                                {
                                    Id: 4,
                                    Name: 'placeholder',
                                    Required: false,
                                    Type: 'unknown',
                                },
                                {
                                    Id: 5,
                                    Name: 'home',
                                    Required: false,
                                    Type: 'geography(OGC:CRS84, spherical)',
                                },
                                {
                                    Id: 6,
                                    Name: 'shape',
                                    Required: false,
                                    Type: 'geometry',
                                },
                                {
                                    Id: 7,
                                    Name: 'balance',
                                    Required: false,
                                    Type: 'decimal(12, 2)',
                                },
                                {
                                    Id: 8,
                                    Name: 'updated_at',
                                    Required: false,
                                    Type: 'timestamptz',
                                },
                            ],
                            IdentifierFieldIds: [
                                1,
                            ],
                        }),
                    }),
                },
            },
        });
    });

    it('partitions v3_dml_test by bucket[4] on account_id and writes merge-on-read', () => {
        template.hasResourceProperties('AWS::Glue::Table', {
            Name: 'v3_dml_test',
            OpenTableFormatInput: {
                IcebergInput: Match.objectLike({
                    IcebergTableInput: Match.objectLike({
                        PartitionSpec: Match.objectLike({
                            Fields: [
                                {
                                    FieldId: 1000,
                                    Name: 'account_id_bucket',
                                    SourceId: 1,
                                    Transform: 'bucket[4]',
                                },
                            ],
                        }),
                        Properties: Match.objectLike({
                            'format-version': '3',
                            'write.delete.mode': 'merge-on-read',
                            'write.update.mode': 'merge-on-read',
                            'write.merge.mode': 'merge-on-read',
                        }),
                    }),
                }),
            },
        });
    });

    it('declares v3_upgrade_test as unpartitioned v2 with id and name', () => {
        template.hasResourceProperties('AWS::Glue::Table', {
            Name: 'v3_upgrade_test',
            OpenTableFormatInput: {
                IcebergInput: Match.objectLike({
                    IcebergTableInput: Match.objectLike({
                        Location: 's3://data-lake-bucket-123456789012/sample_database/v3_upgrade_test/',
                        PartitionSpec: Match.absent(),
                        Properties: Match.objectLike({
                            'format-version': '2',
                        }),
                        Schema: Match.objectLike({
                            Fields: [
                                {
                                    Id: 1,
                                    Name: 'id',
                                    Required: false,
                                    Type: 'long',
                                },
                                {
                                    Id: 2,
                                    Name: 'name',
                                    Required: false,
                                    Type: 'string',
                                },
                            ],
                        }),
                    }),
                }),
            },
        });
    });

    it.each([
        'v3_dml_test',
        'v3_upgrade_test',
    ])('grants the test principal SELECT/INSERT/DELETE/ALTER/DESCRIBE on %s', (tableName) => {
        template.resourceCountIs('AWS::LakeFormation::Permissions', 2);
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
            Resource: {
                TableResource: {
                    CatalogId: '123456789012',
                    Name: tableName,
                    DatabaseName: 'sample_database',
                },
            },
        });
    });
});
