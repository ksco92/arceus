import {
    App,
} from 'aws-cdk-lib';
import {
    Match,
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
            principalArn: 'arn:aws:iam::123456789012:user/tester',
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

    it('creates exactly three demo Iceberg tables', () => {
        template.resourceCountIs('AWS::Glue::Table', 3);
    });

    it('creates the orders table with partitions, sort order, identifier ids, and merge-on-read properties', () => {
        template.hasResourceProperties('AWS::Glue::Table', {
            Name: 'orders',
            OpenTableFormatInput: {
                IcebergInput: {
                    MetadataOperation: 'CREATE',
                    Version: '2',
                    IcebergTableInput: Match.objectLike({
                        Schema: Match.objectLike({
                            IdentifierFieldIds: [
                                1,
                            ],
                        }),
                        PartitionSpec: Match.objectLike({
                            Fields: Match.arrayWith([
                                Match.objectLike({
                                    Name: 'placed_at_day',
                                    Transform: 'day',
                                }),
                                Match.objectLike({
                                    Name: 'customer_id_bucket',
                                    Transform: 'bucket[16]',
                                }),
                            ]),
                        }),
                        WriteOrder: Match.objectLike({
                            Fields: Match.arrayWith([
                                Match.objectLike({
                                    Direction: 'asc',
                                    NullOrder: 'nulls-last',
                                }),
                            ]),
                        }),
                        Properties: Match.objectLike({
                            'write.merge.mode': 'merge-on-read',
                            'write.update.mode': 'merge-on-read',
                            'write.delete.mode': 'merge-on-read',
                            'write.parquet.compression-codec': 'zstd',
                            'format-version': '2',
                            'write.format.default': 'parquet',
                        }),
                    }),
                },
            },
            TableInput: Match.absent(),
        });
    });

    it('creates the events table with an hour(occurred_at) partition', () => {
        template.hasResourceProperties('AWS::Glue::Table', {
            Name: 'events',
            OpenTableFormatInput: {
                IcebergInput: Match.objectLike({
                    IcebergTableInput: Match.objectLike({
                        PartitionSpec: Match.objectLike({
                            Fields: [
                                Match.objectLike({
                                    Name: 'occurred_at_hour',
                                    Transform: 'hour',
                                }),
                            ],
                        }),
                    }),
                }),
            },
        });
    });

    it('creates the customers table with identifier ids and no partition spec', () => {
        template.hasResourceProperties('AWS::Glue::Table', {
            Name: 'customers',
            OpenTableFormatInput: {
                IcebergInput: Match.objectLike({
                    IcebergTableInput: Match.objectLike({
                        Schema: Match.objectLike({
                            IdentifierFieldIds: [
                                1,
                            ],
                        }),
                        PartitionSpec: Match.absent(),
                    }),
                }),
            },
        });
    });

    it('grants SELECT/INSERT/DELETE/ALTER/DESCRIBE on each demo table to the developer user', () => {
        template.resourceCountIs('AWS::LakeFormation::Permissions', 4);
        const permissions = template.findResources('AWS::LakeFormation::Permissions');
        const tablePermissions = Object.values(permissions).filter((resource) => {
            return resource.Properties.Resource?.TableResource !== undefined;
        });
        expect(tablePermissions).toHaveLength(3);
        for (const permission of tablePermissions) {
            expect(permission.Properties.Permissions).toEqual(
                expect.arrayContaining([
                    'SELECT',
                    'INSERT',
                    'DELETE',
                    'ALTER',
                    'DESCRIBE',
                ]),
            );
        }
    });
});
