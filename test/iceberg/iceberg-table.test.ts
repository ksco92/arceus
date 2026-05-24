import {
    App,
    RemovalPolicy,
    Stack,
} from 'aws-cdk-lib';
import {
    Match,
    Template,
} from 'aws-cdk-lib/assertions';
import {
    Database,
} from '@aws-cdk/aws-glue-alpha';
import {
    Role,
    ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import {
    IcebergDataFormat,
    IcebergFormatVersion,
    IcebergNullOrder,
    IcebergPartitionTransform,
    IcebergSortDirection,
    IcebergTable,
    IcebergType,
} from '../../lib/iceberg';

function makeStack(): { stack: Stack; database: Database } {
    const app = new App();
    const stack = new Stack(app, 'TestStack', {
        env: {
            account: '123456789012',
            region: 'us-east-1',
        },
    });
    const database = new Database(stack, 'TestDatabase', {
        databaseName: 'test_db',
        locationUri: 's3://test-bucket/test_db/',
    });
    return {
        stack,
        database,
    };
}

const MINIMAL_COLUMNS = [
    {
        name: 'id',
        type: IcebergType.LONG,
        required: true,
    },
];

describe('IcebergTable — happy path', () => {
    it('emits an AWS::Glue::Table with the openTableFormatInput shape (no tableInput)', () => {
        const {
            stack, database,
        } = makeStack();

        new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket/simple/',
        });

        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Glue::Table', {
            CatalogId: '123456789012',
            DatabaseName: Match.anyValue(),
            Name: 'simple',
            OpenTableFormatInput: {
                IcebergInput: {
                    MetadataOperation: 'CREATE',
                    Version: '2',
                    IcebergTableInput: Match.objectLike({
                        Location: 's3://my-bucket/simple/',
                        Schema: Match.objectLike({
                            Type: 'struct',
                            SchemaId: 0,
                            Fields: [
                                {
                                    Id: 1,
                                    Name: 'id',
                                    Type: 'long',
                                    Required: true,
                                },
                            ],
                        }),
                        Properties: {
                            'format-version': '2',
                            'write.format.default': 'parquet',
                        },
                    }),
                },
            },
        });
    });

    it('defaults dataFormat to parquet and formatVersion to v2', () => {
        const {
            stack, database,
        } = makeStack();
        const table = new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket/simple/',
        });
        expect(table.dataFormat).toBe(IcebergDataFormat.PARQUET);
        expect(table.formatVersion).toBe(IcebergFormatVersion.V2);
    });

    it('renders a partition spec with auto-generated names', () => {
        const {
            stack, database,
        } = makeStack();
        new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'events',
            columns: [
                {
                    name: 'id',
                    type: IcebergType.LONG,
                    required: true,
                },
                {
                    name: 'occurred_at',
                    type: IcebergType.TIMESTAMPTZ,
                    required: true,
                },
                {
                    name: 'customer_id',
                    type: IcebergType.LONG,
                    required: true,
                },
            ],
            location: 's3://my-bucket/events/',
            partitionSpec: [
                {
                    sourceColumn: 'occurred_at',
                    transform: IcebergPartitionTransform.DAY,
                },
                {
                    sourceColumn: 'customer_id',
                    transform: IcebergPartitionTransform.bucket(16),
                },
            ],
        });
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Glue::Table', {
            OpenTableFormatInput: {
                IcebergInput: {
                    IcebergTableInput: Match.objectLike({
                        PartitionSpec: {
                            SpecId: 0,
                            Fields: [
                                {
                                    Name: 'occurred_at_day',
                                    SourceId: 2,
                                    Transform: 'day',
                                    FieldId: 1000,
                                },
                                {
                                    Name: 'customer_id_bucket',
                                    SourceId: 3,
                                    Transform: 'bucket[16]',
                                    FieldId: 1001,
                                },
                            ],
                        },
                    }),
                },
            },
        });
    });

    it('defaults required to false on columns that omit it', () => {
        const {
            stack, database,
        } = makeStack();
        new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            columns: [
                {
                    name: 'always_optional',
                    type: IcebergType.STRING,
                },
            ],
            location: 's3://my-bucket/simple/',
        });
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Glue::Table', {
            OpenTableFormatInput: {
                IcebergInput: {
                    IcebergTableInput: Match.objectLike({
                        Schema: Match.objectLike({
                            Fields: [
                                Match.objectLike({
                                    Name: 'always_optional',
                                    Required: false,
                                }),
                            ],
                        }),
                    }),
                },
            },
        });
    });

    it('keeps the source column name when the partition transform is identity', () => {
        const {
            stack, database,
        } = makeStack();
        new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            columns: [
                {
                    name: 'region',
                    type: IcebergType.STRING,
                    required: true,
                },
            ],
            location: 's3://my-bucket/simple/',
            partitionSpec: [
                {
                    sourceColumn: 'region',
                    transform: IcebergPartitionTransform.IDENTITY,
                },
            ],
        });
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Glue::Table', {
            OpenTableFormatInput: {
                IcebergInput: {
                    IcebergTableInput: Match.objectLike({
                        PartitionSpec: Match.objectLike({
                            Fields: [
                                Match.objectLike({
                                    Name: 'region',
                                    Transform: 'identity',
                                }),
                            ],
                        }),
                    }),
                },
            },
        });
    });

    it('honors user-supplied partition field names', () => {
        const {
            stack, database,
        } = makeStack();
        new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'events',
            columns: [
                {
                    name: 'occurred_at',
                    type: IcebergType.TIMESTAMPTZ,
                    required: true,
                },
            ],
            location: 's3://my-bucket/events/',
            partitionSpec: [
                {
                    sourceColumn: 'occurred_at',
                    transform: IcebergPartitionTransform.HOUR,
                    name: 'hourly',
                },
            ],
        });
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Glue::Table', {
            OpenTableFormatInput: {
                IcebergInput: {
                    IcebergTableInput: Match.objectLike({
                        PartitionSpec: Match.objectLike({
                            Fields: [
                                Match.objectLike({
                                    Name: 'hourly',
                                    Transform: 'hour',
                                }),
                            ],
                        }),
                    }),
                },
            },
        });
    });

    it('renders a write order with defaults', () => {
        const {
            stack, database,
        } = makeStack();
        new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'orders',
            columns: [
                {
                    name: 'order_id',
                    type: IcebergType.LONG,
                    required: true,
                },
                {
                    name: 'placed_at',
                    type: IcebergType.TIMESTAMPTZ,
                    required: true,
                },
            ],
            location: 's3://my-bucket/orders/',
            sortOrder: [
                {
                    sourceColumn: 'placed_at',
                },
                {
                    sourceColumn: 'order_id',
                    direction: IcebergSortDirection.DESC,
                    nullOrder: IcebergNullOrder.NULLS_FIRST,
                },
            ],
        });
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Glue::Table', {
            OpenTableFormatInput: {
                IcebergInput: {
                    IcebergTableInput: Match.objectLike({
                        WriteOrder: {
                            OrderId: 1,
                            Fields: [
                                {
                                    SourceId: 2,
                                    Transform: 'identity',
                                    Direction: 'asc',
                                    NullOrder: 'nulls-last',
                                },
                                {
                                    SourceId: 1,
                                    Transform: 'identity',
                                    Direction: 'desc',
                                    NullOrder: 'nulls-first',
                                },
                            ],
                        },
                    }),
                },
            },
        });
    });

    it('resolves identifier field names to ids', () => {
        const {
            stack, database,
        } = makeStack();
        new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'orders',
            columns: [
                {
                    name: 'order_id',
                    type: IcebergType.LONG,
                    required: true,
                },
                {
                    name: 'customer_id',
                    type: IcebergType.LONG,
                    required: true,
                },
            ],
            location: 's3://my-bucket/orders/',
            identifierFieldNames: [
                'order_id',
            ],
        });
        const template = Template.fromStack(stack);
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

    it('honors a custom dataFormat + formatVersion', () => {
        const {
            stack, database,
        } = makeStack();
        new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'legacy',
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket/legacy/',
            dataFormat: IcebergDataFormat.AVRO,
            formatVersion: IcebergFormatVersion.V1,
            tableProperties: {
                'write.avro.compression-codec': 'snappy',
            },
        });
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Glue::Table', {
            OpenTableFormatInput: {
                IcebergInput: {
                    Version: '1',
                    IcebergTableInput: Match.objectLike({
                        Properties: {
                            'format-version': '1',
                            'write.format.default': 'avro',
                            'write.avro.compression-codec': 'snappy',
                        },
                    }),
                },
            },
        });
    });

    it('publishes the comment under properties.comment and never under TableInput', () => {
        const {
            stack, database,
        } = makeStack();
        new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            comment: 'demo comment',
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket/simple/',
        });
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Glue::Table', {
            OpenTableFormatInput: {
                IcebergInput: {
                    IcebergTableInput: Match.objectLike({
                        Properties: Match.objectLike({
                            comment: 'demo comment',
                        }),
                    }),
                },
            },
            TableInput: Match.absent(),
        });
    });

    it('never emits a TableInput sibling alongside openTableFormatInput', () => {
        const {
            stack, database,
        } = makeStack();
        new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket/simple/',
            partitionSpec: [
                {
                    sourceColumn: 'id',
                    transform: IcebergPartitionTransform.IDENTITY,
                },
            ],
            sortOrder: [
                {
                    sourceColumn: 'id',
                },
            ],
        });
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Glue::Table', {
            TableInput: Match.absent(),
        });
    });

    it('applies RETAIN by default', () => {
        const {
            stack, database,
        } = makeStack();
        new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket/simple/',
        });
        const template = Template.fromStack(stack);
        template.hasResource('AWS::Glue::Table', {
            DeletionPolicy: 'Retain',
            UpdateReplacePolicy: 'Retain',
        });
    });

    it('applies DESTROY when requested', () => {
        const {
            stack, database,
        } = makeStack();
        new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket/simple/',
            removalPolicy: RemovalPolicy.DESTROY,
        });
        const template = Template.fromStack(stack);
        template.hasResource('AWS::Glue::Table', {
            DeletionPolicy: 'Delete',
            UpdateReplacePolicy: 'Delete',
        });
    });

    it('appends a trailing slash to location if missing', () => {
        const {
            stack, database,
        } = makeStack();
        const table = new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket/simple',
        });
        expect(table.location).toBe('s3://my-bucket/simple/');
    });

    it('exposes a tableArn that matches the Glue ARN format', () => {
        const {
            stack, database,
        } = makeStack();
        const table = new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket/simple/',
        });
        expect(stack.resolve(table.tableArn)).toEqual({
            'Fn::Join': [
                '',
                [
                    'arn:',
                    {
                        Ref: 'AWS::Partition',
                    },
                    ':glue:us-east-1:123456789012:table/',
                    {
                        Ref: 'TestDatabase7A4A91C2',
                    },
                    '/simple',
                ],
            ],
        });
    });

    it('handles a bucket-root location', () => {
        const {
            stack, database,
        } = makeStack();
        const table = new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'root',
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket',
        });
        expect(table.location).toBe('s3://my-bucket/');
    });

    it('exposes the underlying CfnTable as .resource and .node.defaultChild', () => {
        const {
            stack, database,
        } = makeStack();
        const table = new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket/simple/',
        });
        expect(table.resource).toBeDefined();
        expect(table.node.defaultChild).toBe(table.resource);
    });

    it('skips writeOrder when sortOrder is omitted', () => {
        const {
            stack, database,
        } = makeStack();
        new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket/simple/',
        });
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Glue::Table', {
            OpenTableFormatInput: {
                IcebergInput: {
                    IcebergTableInput: Match.objectLike({
                        WriteOrder: Match.absent(),
                        PartitionSpec: Match.absent(),
                    }),
                },
            },
        });
    });
});

describe('IcebergTable — pinned field ids', () => {
    it('honors explicit column ids', () => {
        const {
            stack, database,
        } = makeStack();
        new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'evolving',
            columns: [
                {
                    name: 'a',
                    type: IcebergType.LONG,
                    id: 42,
                    required: true,
                },
                {
                    name: 'b',
                    type: IcebergType.STRING,
                    id: 99,
                },
            ],
            location: 's3://my-bucket/evolving/',
        });
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Glue::Table', {
            OpenTableFormatInput: {
                IcebergInput: {
                    IcebergTableInput: Match.objectLike({
                        Schema: Match.objectLike({
                            Fields: [
                                Match.objectLike({
                                    Id: 42,
                                    Name: 'a',
                                }),
                                Match.objectLike({
                                    Id: 99,
                                    Name: 'b',
                                }),
                            ],
                        }),
                    }),
                },
            },
        });
    });

    it('fills auto-assigned ids around pinned ones without collision', () => {
        const {
            stack, database,
        } = makeStack();
        new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'mixed',
            columns: [
                {
                    name: 'autoFirst',
                    type: IcebergType.LONG,
                },
                {
                    name: 'pinnedTwo',
                    type: IcebergType.STRING,
                    id: 2,
                },
                {
                    name: 'autoNext',
                    type: IcebergType.STRING,
                },
            ],
            location: 's3://my-bucket/mixed/',
        });
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Glue::Table', {
            OpenTableFormatInput: {
                IcebergInput: {
                    IcebergTableInput: Match.objectLike({
                        Schema: Match.objectLike({
                            Fields: [
                                Match.objectLike({
                                    Id: 1,
                                    Name: 'autoFirst',
                                }),
                                Match.objectLike({
                                    Id: 2,
                                    Name: 'pinnedTwo',
                                }),
                                Match.objectLike({
                                    Id: 3,
                                    Name: 'autoNext',
                                }),
                            ],
                        }),
                    }),
                },
            },
        });
    });

    it('rejects duplicate pinned ids', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'dup',
            columns: [
                {
                    name: 'a',
                    type: IcebergType.LONG,
                    id: 7,
                },
                {
                    name: 'b',
                    type: IcebergType.STRING,
                    id: 7,
                },
            ],
            location: 's3://my-bucket/dup/',
        })).toThrow(/duplicate column id 7/);
    });

    it('rejects non-positive pinned ids', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'bad',
            columns: [
                {
                    name: 'a',
                    type: IcebergType.LONG,
                    id: 0,
                },
            ],
            location: 's3://my-bucket/bad/',
        })).toThrow(/invalid id 0/);
    });

    it('rejects fractional pinned ids', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'bad',
            columns: [
                {
                    name: 'a',
                    type: IcebergType.LONG,
                    id: 1.5,
                },
            ],
            location: 's3://my-bucket/bad/',
        })).toThrow(/invalid id 1\.5/);
    });

    it('keeps nested-type ids above the highest pinned top-level id', () => {
        const {
            stack, database,
        } = makeStack();
        new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'nested',
            columns: [
                {
                    name: 'a',
                    type: IcebergType.LONG,
                    id: 100,
                },
                {
                    name: 'list_col',
                    type: IcebergType.list(IcebergType.STRING),
                },
            ],
            location: 's3://my-bucket/nested/',
        });
        const template = Template.fromStack(stack);
        template.hasResourceProperties('AWS::Glue::Table', {
            OpenTableFormatInput: {
                IcebergInput: {
                    IcebergTableInput: Match.objectLike({
                        Schema: Match.objectLike({
                            Fields: Match.arrayWith([
                                Match.objectLike({
                                    Id: 100,
                                    Name: 'a',
                                }),
                                Match.objectLike({
                                    Name: 'list_col',
                                    /// Type is the serialized JSON string of the
                                    /// list type with an element-id derived from
                                    /// the post-pinned counter (>= 101).
                                    Type: Match.stringLikeRegexp('"element-id":1\\d\\d'),
                                }),
                            ]),
                        }),
                    }),
                },
            },
        });
    });
});

describe('IcebergTable — validation', () => {
    it('rejects an invalid table name', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'Bad-Name',
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket/simple/',
        })).toThrow(/tableName.*lowercase/);
    });

    it('rejects an empty column list', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            columns: [

            ],
            location: 's3://my-bucket/simple/',
        })).toThrow(/at least one column/);
    });

    it('rejects duplicate top-level column names', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            columns: [
                {
                    name: 'a',
                    type: IcebergType.INT,
                },
                {
                    name: 'a',
                    type: IcebergType.STRING,
                },
            ],
            location: 's3://my-bucket/simple/',
        })).toThrow(/duplicate column name/);
    });

    it('rejects a non-s3 location', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            columns: MINIMAL_COLUMNS,
            location: '/some/local/path',
        })).toThrow(/s3:\/\//);
    });

    it('rejects a partition spec on an unknown column', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket/simple/',
            partitionSpec: [
                {
                    sourceColumn: 'who_dis',
                    transform: IcebergPartitionTransform.IDENTITY,
                },
            ],
        })).toThrow(/unknown column 'who_dis'/);
    });

    it('rejects an incompatible partition transform', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            columns: [
                {
                    name: 'name',
                    type: IcebergType.STRING,
                    required: true,
                },
            ],
            location: 's3://my-bucket/simple/',
            partitionSpec: [
                {
                    sourceColumn: 'name',
                    transform: IcebergPartitionTransform.DAY,
                },
            ],
        })).toThrow(/day.*date/);
    });

    it('rejects duplicate partition field names', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            columns: [
                {
                    name: 'col',
                    type: IcebergType.STRING,
                    required: true,
                },
            ],
            location: 's3://my-bucket/simple/',
            partitionSpec: [
                {
                    sourceColumn: 'col',
                    transform: IcebergPartitionTransform.IDENTITY,
                    name: 'p',
                },
                {
                    sourceColumn: 'col',
                    transform: IcebergPartitionTransform.IDENTITY,
                    name: 'p',
                },
            ],
        })).toThrow(/duplicate partition field name/);
    });

    it('rejects an empty sortOrder when provided', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket/simple/',
            sortOrder: [

            ],
        })).toThrow(/sortOrder must contain at least one field/);
    });

    it('rejects a sortOrder referencing unknown columns', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket/simple/',
            sortOrder: [
                {
                    sourceColumn: 'nope',
                },
            ],
        })).toThrow(/unknown column 'nope'/);
    });

    it('rejects an incompatible sortOrder transform', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            columns: [
                {
                    name: 'name',
                    type: IcebergType.STRING,
                    required: true,
                },
            ],
            location: 's3://my-bucket/simple/',
            sortOrder: [
                {
                    sourceColumn: 'name',
                    transform: IcebergPartitionTransform.HOUR,
                },
            ],
        })).toThrow(/hour/);
    });

    it('rejects identifierFieldNames with duplicates', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket/simple/',
            identifierFieldNames: [
                'id',
                'id',
            ],
        })).toThrow(/duplicate identifier field/);
    });

    it('rejects identifierFieldNames referencing unknown columns', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket/simple/',
            identifierFieldNames: [
                'who',
            ],
        })).toThrow(/identifierFieldNames.*who/);
    });

    it('propagates table-property validation errors', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket/simple/',
            tableProperties: {
                'write.format.default': 'orc',
            },
        })).toThrow(/write\.format\.default.*orc/);
    });
});

describe('IcebergTable — grants', () => {
    function resolvedStatements(template: Template): Array<Record<string, unknown>> {
        const policies = template.findResources('AWS::IAM::Policy');
        const policy = Object.values(policies)[0];
        return policy.Properties.PolicyDocument.Statement;
    }

    function actionListOf(statement: Record<string, unknown>): string[] {
        const actions = statement.Action as string | string[];
        return Array.isArray(actions) ? actions : [
            actions,
        ];
    }

    function statementsByAction(
        statements: Array<Record<string, unknown>>,
        action: string,
    ): Array<Record<string, unknown>> {
        return statements.filter((statement) => actionListOf(statement).includes(action));
    }

    function resolvedResourceString(stack: Stack, statement: Record<string, unknown>): string {
        return JSON.stringify(stack.resolve(statement.Resource));
    }

    it('grantRead emits four statements: Glue, list-with-s3:prefix, bucket-no-condition, and object', () => {
        const {
            stack, database,
        } = makeStack();
        const table = new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket/path/simple/',
        });
        const role = new Role(stack, 'Reader', {
            assumedBy: new ServicePrincipal('glue.amazonaws.com'),
        });
        table.grantRead(role);
        const statements = resolvedStatements(Template.fromStack(stack));

        /// Glue statement: scoped to the Glue table ARN (a CFN
        /// intrinsic). No S3 actions on it.
        const glueStatements = statementsByAction(statements, 'glue:GetTable');
        expect(glueStatements).toHaveLength(1);
        expect(actionListOf(glueStatements[0])).not.toContain('s3:ListBucket');
        expect(actionListOf(glueStatements[0])).not.toContain('s3:GetBucketLocation');
        expect(resolvedResourceString(stack, glueStatements[0])).toContain(':glue:');

        /// `s3:ListBucket` statement: scoped to bucket ARN with the
        /// `s3:prefix` condition limiting visibility to this table.
        const listStatements = statementsByAction(statements, 's3:ListBucket');
        expect(listStatements).toHaveLength(1);
        expect(actionListOf(listStatements[0])).toEqual([
            's3:ListBucket',
        ]);
        expect(resolvedResourceString(stack, listStatements[0])).toContain('my-bucket');
        expect(listStatements[0].Condition).toEqual({
            StringLike: {
                's3:prefix': [
                    'path/simple/*',
                    'path/simple/',
                ],
            },
        });

        /// Unconditional bucket statement for actions that DO NOT
        /// support `s3:prefix` — putting `GetBucketLocation` under
        /// the conditioned statement above would silently deny it.
        const getBucketLocationStatements = statementsByAction(statements, 's3:GetBucketLocation');
        expect(getBucketLocationStatements).toHaveLength(1);
        expect(getBucketLocationStatements[0].Condition).toBeUndefined();
        expect(resolvedResourceString(stack, getBucketLocationStatements[0])).toContain('my-bucket');
        expect(actionListOf(getBucketLocationStatements[0])).not.toContain('s3:ListBucket');

        /// Object statement: scoped to bucket/prefix*.
        const objectStatements = statementsByAction(statements, 's3:GetObject');
        expect(objectStatements).toHaveLength(1);
        expect(resolvedResourceString(stack, objectStatements[0])).toContain('my-bucket/path/simple/*');
        const objectActions = actionListOf(objectStatements[0]);
        expect(objectActions).not.toContain('s3:ListBucket');
        expect(objectActions).not.toContain('s3:GetBucketLocation');
    });

    it('grantWrite emits Glue, unconditional bucket (for ListBucketMultipartUploads), and object statements', () => {
        const {
            stack, database,
        } = makeStack();
        const table = new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket/simple/',
        });
        const role = new Role(stack, 'Writer', {
            assumedBy: new ServicePrincipal('glue.amazonaws.com'),
        });
        table.grantWrite(role);
        const statements = resolvedStatements(Template.fromStack(stack));

        const glueStatements = statementsByAction(statements, 'glue:UpdateTable');
        expect(glueStatements).toHaveLength(1);

        /// `s3:ListBucketMultipartUploads` must NOT carry an
        /// `s3:prefix` condition (the action does not support that
        /// condition key).
        const mpuStatements = statementsByAction(statements, 's3:ListBucketMultipartUploads');
        expect(mpuStatements).toHaveLength(1);
        expect(mpuStatements[0].Condition).toBeUndefined();
        expect(resolvedResourceString(stack, mpuStatements[0])).toContain('my-bucket');

        /// grantWrite alone never grants `s3:ListBucket` — that is
        /// a read-time action.
        expect(statementsByAction(statements, 's3:ListBucket')).toHaveLength(0);

        const objectStatements = statementsByAction(statements, 's3:PutObject');
        expect(objectStatements).toHaveLength(1);
        expect(resolvedResourceString(stack, objectStatements[0])).toContain('my-bucket/simple/*');
    });

    it('grantReadWrite combines all four statement shapes', () => {
        const {
            stack, database,
        } = makeStack();
        const table = new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket/simple/',
        });
        const role = new Role(stack, 'Both', {
            assumedBy: new ServicePrincipal('glue.amazonaws.com'),
        });
        table.grantReadWrite(role);
        const statements = resolvedStatements(Template.fromStack(stack));

        const glueStatements = statementsByAction(statements, 'glue:GetTable');
        expect(actionListOf(glueStatements[0])).toEqual(expect.arrayContaining([
            'glue:GetTable',
            'glue:UpdateTable',
        ]));

        const listStatements = statementsByAction(statements, 's3:ListBucket');
        expect(listStatements).toHaveLength(1);
        expect(actionListOf(listStatements[0])).toEqual([
            's3:ListBucket',
        ]);
        expect(listStatements[0].Condition).toBeDefined();

        const unconditionedBucketStatements = statementsByAction(statements, 's3:GetBucketLocation');
        expect(unconditionedBucketStatements).toHaveLength(1);
        expect(unconditionedBucketStatements[0].Condition).toBeUndefined();
        expect(actionListOf(unconditionedBucketStatements[0])).toEqual(expect.arrayContaining([
            's3:GetBucketLocation',
            's3:ListBucketMultipartUploads',
        ]));

        const objectStatements = statementsByAction(statements, 's3:GetObject');
        expect(actionListOf(objectStatements[0])).toEqual(expect.arrayContaining([
            's3:GetObject',
            's3:PutObject',
            's3:DeleteObject',
        ]));
    });

    it('handles a bucket-root location by setting prefix glob to "*"', () => {
        const {
            stack, database,
        } = makeStack();
        const table = new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'root',
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket',
        });
        const role = new Role(stack, 'Reader', {
            assumedBy: new ServicePrincipal('glue.amazonaws.com'),
        });
        table.grantRead(role);
        const statements = resolvedStatements(Template.fromStack(stack));
        const listStatements = statementsByAction(statements, 's3:ListBucket');
        expect(listStatements[0].Condition).toEqual({
            StringLike: {
                's3:prefix': [
                    '*',
                    '',
                ],
            },
        });
    });
});

describe('IcebergTable.fromIcebergTableAttributes', () => {
    it('reconstructs a table reference and supports the same split-statement grants', () => {
        const {
            stack, database,
        } = makeStack();
        const imported = IcebergTable.fromIcebergTableAttributes(stack, 'Imported', {
            database,
            tableName: 'pre_existing',
            location: 's3://other-bucket/pre_existing/',
        });
        expect(imported.tableName).toBe('pre_existing');
        expect(imported.location).toBe('s3://other-bucket/pre_existing/');
        expect(imported.database).toBe(database);
        const resolved = stack.resolve(imported.tableArn);
        expect(resolved['Fn::Join'][1]).toEqual(expect.arrayContaining([
            'arn:',
            ':glue:us-east-1:123456789012:table/',
            '/pre_existing',
        ]));

        const role = new Role(stack, 'ImportedReader', {
            assumedBy: new ServicePrincipal('glue.amazonaws.com'),
        });
        imported.grantRead(role);
        imported.grantWrite(role);
        imported.grantReadWrite(role);

        const template = Template.fromStack(stack);
        const policies = template.findResources('AWS::IAM::Policy');
        const policy = Object.values(policies)[0];
        const statements = policy.Properties.PolicyDocument.Statement as Array<Record<string, unknown>>;

        const listStatements = statements.filter((statement) => {
            const actions = statement.Action as string | string[];
            const list = Array.isArray(actions) ? actions : [
                actions,
            ];
            return list.includes('s3:ListBucket');
        });
        expect(listStatements.length).toBeGreaterThan(0);
        /// `fromIcebergTableAttributes` builds the bucket ARN with
        /// `stack.partition` which can resolve to either a literal
        /// (when the env's partition is known) or an `Fn::Join`
        /// (when it isn't). Resolve before comparing so the assertion
        /// survives both shapes.
        const resolvedBucketArn = stack.resolve(listStatements[0].Resource);
        expect(JSON.stringify(resolvedBucketArn)).toContain('other-bucket');
        expect(listStatements[0].Condition).toEqual({
            StringLike: {
                's3:prefix': [
                    'pre_existing/*',
                    'pre_existing/',
                ],
            },
        });

        const objectStatements = statements.filter((statement) => {
            const actions = statement.Action as string | string[];
            const list = Array.isArray(actions) ? actions : [
                actions,
            ];
            return list.includes('s3:GetObject');
        });
        const resolvedObjectArn = stack.resolve(objectStatements[0].Resource);
        expect(JSON.stringify(resolvedObjectArn)).toContain('other-bucket/pre_existing/*');
    });

    it('appends a trailing slash to an imported location if missing', () => {
        const {
            stack, database,
        } = makeStack();
        const imported = IcebergTable.fromIcebergTableAttributes(stack, 'Imported', {
            database,
            tableName: 'pre',
            location: 's3://other-bucket/pre',
        });
        expect(imported.location).toBe('s3://other-bucket/pre/');
    });
});
