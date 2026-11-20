import {
    App,
    Lazy,
    RemovalPolicy,
    Stack,
} from 'aws-cdk-lib';
import {
    Match,
    Template,
} from 'aws-cdk-lib/assertions';
import {
    Database,
} from 'aws-cdk-lib/aws-glue';
import {
    Role,
    ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import {
    IcebergColumn,
    IcebergDataFormat,
    IcebergEdgeAlgorithm,
    IcebergFormatVersion,
    IcebergNullOrder,
    IcebergPartitionField,
    IcebergPartitionTransform,
    IcebergSortDirection,
    IcebergStructFieldDefinition,
    IcebergTable,
    IcebergType,
    IcebergTypeKind,
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
        id: 1,
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
            formatVersion: IcebergFormatVersion.V2,
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

    it('renders format version 3', () => {
        const {
            stack, database,
        } = makeStack();

        new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            formatVersion: IcebergFormatVersion.V3,
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket/simple/',
        });

        Template.fromStack(stack).hasResourceProperties('AWS::Glue::Table', {
            OpenTableFormatInput: {
                IcebergInput: Match.objectLike({
                    Version: '3',
                    IcebergTableInput: Match.objectLike({
                        Properties: Match.objectLike({
                            'format-version': '3',
                        }),
                    }),
                }),
            },
        });
    });

    it('defaults dataFormat to parquet and surfaces the supplied formatVersion', () => {
        const {
            stack, database,
        } = makeStack();
        const table = new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            formatVersion: IcebergFormatVersion.V2,
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
            formatVersion: IcebergFormatVersion.V2,
            columns: [
                {
                    name: 'id',
                    type: IcebergType.LONG,
                    required: true,
                    id: 1,
                },
                {
                    name: 'occurred_at',
                    type: IcebergType.TIMESTAMPTZ,
                    required: true,
                    id: 2,
                },
                {
                    name: 'customer_id',
                    type: IcebergType.LONG,
                    required: true,
                    id: 3,
                },
            ],
            location: 's3://my-bucket/events/',
            partitionSpec: [
                {
                    sourceColumn: 'occurred_at',
                    transform: IcebergPartitionTransform.DAY,
                    fieldId: 1000,
                },
                {
                    sourceColumn: 'customer_id',
                    transform: IcebergPartitionTransform.bucket(16),
                    fieldId: 1001,
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

    it('renders pinned partition field ids verbatim, not by position', () => {
        const {
            stack, database,
        } = makeStack();
        new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'events',
            formatVersion: IcebergFormatVersion.V2,
            columns: [
                {
                    name: 'occurred_at',
                    type: IcebergType.TIMESTAMPTZ,
                    required: true,
                    id: 1,
                },
                {
                    name: 'customer_id',
                    type: IcebergType.LONG,
                    required: true,
                    id: 2,
                },
            ],
            location: 's3://my-bucket/events/',
            /// Non-contiguous, non-sorted ids: the first declared field
            /// carries the higher id. A positional allocator would emit
            /// 1000/1001 here instead.
            partitionSpec: [
                {
                    sourceColumn: 'occurred_at',
                    transform: IcebergPartitionTransform.MONTH,
                    fieldId: 1007,
                },
                {
                    sourceColumn: 'customer_id',
                    transform: IcebergPartitionTransform.bucket(16),
                    fieldId: 1003,
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
                                Match.objectLike({
                                    Name: 'occurred_at_month',
                                    FieldId: 1007,
                                }),
                                Match.objectLike({
                                    Name: 'customer_id_bucket',
                                    FieldId: 1003,
                                }),
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
            formatVersion: IcebergFormatVersion.V2,
            columns: [
                {
                    name: 'always_optional',
                    type: IcebergType.STRING,
                    id: 1,
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
            formatVersion: IcebergFormatVersion.V2,
            columns: [
                {
                    name: 'region',
                    type: IcebergType.STRING,
                    required: true,
                    id: 1,
                },
            ],
            location: 's3://my-bucket/simple/',
            partitionSpec: [
                {
                    sourceColumn: 'region',
                    transform: IcebergPartitionTransform.IDENTITY,
                    fieldId: 1000,
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
            formatVersion: IcebergFormatVersion.V2,
            columns: [
                {
                    name: 'occurred_at',
                    type: IcebergType.TIMESTAMPTZ,
                    required: true,
                    id: 1,
                },
            ],
            location: 's3://my-bucket/events/',
            partitionSpec: [
                {
                    sourceColumn: 'occurred_at',
                    transform: IcebergPartitionTransform.HOUR,
                    name: 'hourly',
                    fieldId: 1000,
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
            formatVersion: IcebergFormatVersion.V2,
            columns: [
                {
                    name: 'order_id',
                    type: IcebergType.LONG,
                    required: true,
                    id: 1,
                },
                {
                    name: 'placed_at',
                    type: IcebergType.TIMESTAMPTZ,
                    required: true,
                    id: 2,
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
            formatVersion: IcebergFormatVersion.V2,
            columns: [
                {
                    name: 'order_id',
                    type: IcebergType.LONG,
                    required: true,
                    id: 1,
                },
                {
                    name: 'customer_id',
                    type: IcebergType.LONG,
                    required: true,
                    id: 2,
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
            formatVersion: IcebergFormatVersion.V2,
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

    it('rejects setting comment both at top level and inside tableProperties', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => {
            new IcebergTable(stack, 'Tbl', {
                database,
                tableName: 'conflict',
                formatVersion: IcebergFormatVersion.V2,
                columns: MINIMAL_COLUMNS,
                location: 's3://my-bucket/conflict/',
                comment: 'from prop',
                tableProperties: {
                    comment: 'from props map',
                },
            });
        }).toThrow(/comment is set both as the top-level `comment` prop and as `tableProperties.comment`/);
    });

    it('never emits a TableInput sibling alongside openTableFormatInput', () => {
        const {
            stack, database,
        } = makeStack();
        new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            formatVersion: IcebergFormatVersion.V2,
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket/simple/',
            partitionSpec: [
                {
                    sourceColumn: 'id',
                    transform: IcebergPartitionTransform.IDENTITY,
                    fieldId: 1000,
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
            formatVersion: IcebergFormatVersion.V2,
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
            formatVersion: IcebergFormatVersion.V2,
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
            formatVersion: IcebergFormatVersion.V2,
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
            formatVersion: IcebergFormatVersion.V2,
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
            formatVersion: IcebergFormatVersion.V2,
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
            formatVersion: IcebergFormatVersion.V2,
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
            formatVersion: IcebergFormatVersion.V2,
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
            formatVersion: IcebergFormatVersion.V2,
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

    it('honors arbitrary non-contiguous pinned ids', () => {
        const {
            stack, database,
        } = makeStack();
        new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'sparse',
            formatVersion: IcebergFormatVersion.V2,
            columns: [
                {
                    name: 'first',
                    type: IcebergType.LONG,
                    id: 1,
                },
                {
                    name: 'second',
                    type: IcebergType.STRING,
                    id: 5,
                },
                {
                    name: 'third',
                    type: IcebergType.STRING,
                    id: 100,
                },
            ],
            location: 's3://my-bucket/sparse/',
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
                                    Name: 'first',
                                }),
                                Match.objectLike({
                                    Id: 5,
                                    Name: 'second',
                                }),
                                Match.objectLike({
                                    Id: 100,
                                    Name: 'third',
                                }),
                            ],
                        }),
                    }),
                },
            },
        });
    });

    it('rejects a column that is missing its required id', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'missing',
            formatVersion: IcebergFormatVersion.V2,
            columns: [
                {
                    name: 'a',
                    type: IcebergType.LONG,
                    id: 1,
                },
                /// Cast through `unknown` to bypass the required-field
                /// type check and exercise the runtime guard a jsii
                /// Python/JS caller could still trip.
                {
                    name: 'b',
                    type: IcebergType.STRING,
                } as unknown as IcebergColumn,
            ],
            location: 's3://my-bucket/missing/',
        })).toThrow(/column 'b' is missing a required id/);
    });

    it('rejects a column whose id is explicitly undefined', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'undef',
            formatVersion: IcebergFormatVersion.V2,
            columns: [
                {
                    name: 'a',
                    type: IcebergType.LONG,
                    id: undefined,
                } as unknown as IcebergColumn,
            ],
            location: 's3://my-bucket/undef/',
        })).toThrow(/column 'a' is missing a required id/);
    });

    it('rejects a column whose id is null', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'nullid',
            formatVersion: IcebergFormatVersion.V2,
            columns: [
                {
                    name: 'a',
                    type: IcebergType.LONG,
                    id: null,
                } as unknown as IcebergColumn,
            ],
            location: 's3://my-bucket/nullid/',
        })).toThrow(/column 'a' is missing a required id/);
    });

    it('rejects duplicate pinned ids', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'dup',
            formatVersion: IcebergFormatVersion.V2,
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
        })).toThrow("duplicate field id 7 on column 'b', already used by 'a'");
    });

    it('rejects non-positive pinned ids', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'bad',
            formatVersion: IcebergFormatVersion.V2,
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
            formatVersion: IcebergFormatVersion.V2,
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
});

describe('IcebergTable — nested field ids', () => {
    interface ParsedField {
        id: number;
        name: string;
        type: unknown;
    }

    function synthFields(columns: IcebergColumn[]): Array<{ Id: number; Name: string; Type: string }> {
        const {
            stack, database,
        } = makeStack();
        new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'nested',
            formatVersion: IcebergFormatVersion.V2,
            columns,
            location: 's3://my-bucket/nested/',
        });
        const tables = Template.fromStack(stack).findResources('AWS::Glue::Table');
        return Object.values(tables)[0].Properties.OpenTableFormatInput.IcebergInput.IcebergTableInput.Schema.Fields;
    }

    function parsedFields(columns: IcebergColumn[]): ParsedField[] {
        return synthFields(columns).map((field) => ({
            id: field.Id,
            name: field.Name,
            type: field.Type.startsWith('{') ? JSON.parse(field.Type) : field.Type,
        }));
    }

    function addressFields(withMiddleField: boolean): IcebergStructFieldDefinition[] {
        return [
            {
                id: 20,
                name: 'line1',
                type: IcebergType.STRING,
            },
            ...(withMiddleField ? [
                {
                    id: 40,
                    name: 'line2',
                    type: IcebergType.STRING,
                },
            ] : []),
            {
                id: 21,
                name: 'city',
                type: IcebergType.STRING,
            },
        ];
    }

    function evolvingColumns(evolved: boolean): IcebergColumn[] {
        return [
            {
                name: 'id',
                type: IcebergType.LONG,
                required: true,
                id: 1,
            },
            ...(evolved ? [
                {
                    name: 'note',
                    type: IcebergType.STRING,
                    id: 4,
                },
            ] : []),
            {
                name: 'tags',
                type: IcebergType.list({
                    element: IcebergType.STRING,
                    elementId: 10,
                }),
                id: 2,
            },
            {
                name: 'addr',
                type: IcebergType.struct(addressFields(evolved)),
                id: 3,
            },
            {
                name: 'attrs',
                type: IcebergType.map({
                    key: IcebergType.struct([
                        {
                            id: 33,
                            name: 'k',
                            type: IcebergType.STRING,
                        },
                    ]),
                    keyId: 30,
                    value: IcebergType.list({
                        element: IcebergType.INT,
                        elementId: 32,
                    }),
                    valueId: 31,
                }),
                id: 5,
            },
        ];
    }

    const EXPECTED_FIELDS: ParsedField[] = [
        {
            id: 1,
            name: 'id',
            type: 'long',
        },
        {
            id: 2,
            name: 'tags',
            type: {
                type: 'list',
                'element-id': 10,
                'element-required': false,
                element: 'string',
            },
        },
        {
            id: 3,
            name: 'addr',
            type: {
                type: 'struct',
                fields: [
                    {
                        id: 20,
                        name: 'line1',
                        required: false,
                        type: 'string',
                    },
                    {
                        id: 21,
                        name: 'city',
                        required: false,
                        type: 'string',
                    },
                ],
            },
        },
        {
            id: 5,
            name: 'attrs',
            type: {
                type: 'map',
                'key-id': 30,
                key: {
                    type: 'struct',
                    fields: [
                        {
                            id: 33,
                            name: 'k',
                            required: false,
                            type: 'string',
                        },
                    ],
                },
                'value-id': 31,
                'value-required': false,
                value: {
                    type: 'list',
                    'element-id': 32,
                    'element-required': false,
                    element: 'int',
                },
            },
        },
    ];

    it('renders the pinned ids at every depth, with element-required and value-required false when unset', () => {
        expect(parsedFields(evolvingColumns(false))).toEqual(EXPECTED_FIELDS);
    });

    it('keeps every existing id when a top-level column and a mid-struct field are added', () => {
        const [
            idField,
            tags,
            addr,
            attrs,
        ] = EXPECTED_FIELDS;
        const [
            line1,
            city,
        ] = (addr.type as { fields: unknown[] }).fields;
        expect(parsedFields(evolvingColumns(true))).toEqual([
            idField,
            {
                id: 4,
                name: 'note',
                type: 'string',
            },
            tags,
            {
                ...addr,
                type: {
                    type: 'struct',
                    fields: [
                        line1,
                        {
                            id: 40,
                            name: 'line2',
                            required: false,
                            type: 'string',
                        },
                        city,
                    ],
                },
            },
            attrs,
        ]);
    });

    it.each([
        [
            'column',
            (id: number): IcebergColumn => ({
                name: 'c',
                type: IcebergType.STRING,
                id,
            }),
            'c',
        ],
        [
            'list element',
            (id: number): IcebergColumn => ({
                name: 'c',
                type: IcebergType.list({
                    element: IcebergType.STRING,
                    elementId: id,
                }),
                id: 2,
            }),
            'c.element',
        ],
    ])('accepts id 2147483447 and rejects 2147483448 as a %s id', (_label, column, path) => {
        expect(() => synthFields([
            MINIMAL_COLUMNS[0],
            column(2147483447),
        ])).not.toThrow();
        expect(() => synthFields([
            MINIMAL_COLUMNS[0],
            column(2147483448),
        ])).toThrow(`column '${path}' has invalid id 2147483448; ids must be integers from 1 to 2147483447`);
    });

    function firstReadThenOne(first: number): () => number {
        let reads = 0;
        return () => {
            reads += 1;
            return reads === 1 ? first : 1;
        };
    }

    it.each([
        [
            'column',
            (): IcebergColumn => {
                const read = firstReadThenOne(2);
                return {
                    name: 'c',
                    type: IcebergType.STRING,
                    get id() {
                        return read();
                    },
                };
            },
            {
                id: 2,
                name: 'c',
                type: 'string',
            },
        ],
        [
            'struct field',
            (): IcebergColumn => {
                const read = firstReadThenOne(3);
                return {
                    name: 'c',
                    type: IcebergType.struct([
                        {
                            name: 'f',
                            type: IcebergType.STRING,
                            get id() {
                                return read();
                            },
                        },
                    ]),
                    id: 2,
                };
            },
            {
                id: 2,
                name: 'c',
                type: {
                    type: 'struct',
                    fields: [
                        {
                            id: 3,
                            name: 'f',
                            required: false,
                            type: 'string',
                        },
                    ],
                },
            },
        ],
    ])('renders the checked %s id when later reads return another id', (_label, column, expected) => {
        expect(parsedFields([
            MINIMAL_COLUMNS[0],
            column(),
        ])[1]).toEqual(expected);
    });

    it('carries the first-read column id into identifier, partition, and sort source ids', () => {
        const read = firstReadThenOne(2);
        const {
            stack, database,
        } = makeStack();
        new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'nested',
            formatVersion: IcebergFormatVersion.V2,
            columns: [
                MINIMAL_COLUMNS[0],
                {
                    name: 'c',
                    type: IcebergType.LONG,
                    required: true,
                    get id() {
                        return read();
                    },
                },
            ],
            location: 's3://my-bucket/nested/',
            identifierFieldNames: [
                'c',
            ],
            partitionSpec: [
                {
                    sourceColumn: 'c',
                    transform: IcebergPartitionTransform.IDENTITY,
                    fieldId: 1000,
                },
            ],
            sortOrder: [
                {
                    sourceColumn: 'c',
                },
            ],
        });
        const tables = Template.fromStack(stack).findResources('AWS::Glue::Table');
        const input = Object.values(tables)[0].Properties.OpenTableFormatInput.IcebergInput.IcebergTableInput;
        expect([
            input.Schema.IdentifierFieldIds,
            input.PartitionSpec.Fields[0].SourceId,
            input.WriteOrder.Fields[0].SourceId,
        ]).toEqual([
            [
                2,
            ],
            2,
            2,
        ]);
    });

    it('rejects an unresolved token as an id', () => {
        expect(() => synthFields([
            MINIMAL_COLUMNS[0],
            {
                name: 'c',
                type: IcebergType.STRING,
                id: Lazy.number({
                    produce: () => 2,
                }),
            },
        ])).toThrow("column 'c' has an unresolved token as its id; ids must be concrete numbers, not tokens");
    });

    it.each([
        [
            '5',
            'string',
        ],
        [
            BigInt(5),
            'bigint',
        ],
    ])('rejects a non-number id %s', (badId, typeName) => {
        expect(() => synthFields([
            MINIMAL_COLUMNS[0],
            {
                name: 'c',
                type: IcebergType.STRING,
                id: badId as unknown as number,
            },
        ])).toThrow(`column 'c' has invalid id 5 of type ${typeName}; ids must be numbers`);
    });

    it.each([
        [
            'a dot',
            'a.b',
            'a',
            'b',
            "duplicate field id 1 on column 'a.b', already used by '`a.b`'",
        ],
        [
            'backquotes and a dot',
            'a.`b',
            '`a',
            '`b`',
            "duplicate field id 1 on column '```a`.```b```', already used by '`a.``b`'",
        ],
    ])('keeps id message paths distinct when names contain %s', (_label, columnName, structName, fieldName, message) => {
        expect(() => synthFields([
            {
                name: columnName,
                type: IcebergType.STRING,
                id: 1,
            },
            {
                name: structName,
                type: IcebergType.struct([
                    {
                        id: 1,
                        name: fieldName,
                        type: IcebergType.STRING,
                    },
                ]),
                id: 2,
            },
        ])).toThrow(message);
    });

    it.each([
        [
            'struct field',
            IcebergType.struct([
                {
                    name: 'f',
                    type: IcebergType.STRING,
                } as unknown as IcebergStructFieldDefinition,
            ]),
            'c.f',
        ],
        [
            'list element',
            new IcebergType({
                kind: IcebergTypeKind.LIST,
                listElement: IcebergType.STRING,
            }),
            'c.element',
        ],
        [
            'map key',
            new IcebergType({
                kind: IcebergTypeKind.MAP,
                mapKey: IcebergType.STRING,
                mapValue: IcebergType.STRING,
                mapValueId: 4,
            }),
            'c.key',
        ],
        [
            'map value',
            new IcebergType({
                kind: IcebergTypeKind.MAP,
                mapKey: IcebergType.STRING,
                mapKeyId: 3,
                mapValue: IcebergType.STRING,
                mapValueId: null as unknown as number,
            }),
            'c.value',
        ],
        [
            'struct field under a map value',
            IcebergType.map({
                key: IcebergType.STRING,
                keyId: 3,
                value: IcebergType.struct([
                    {
                        name: 'f',
                        type: IcebergType.STRING,
                    } as unknown as IcebergStructFieldDefinition,
                ]),
                valueId: 4,
            }),
            'c.value.f',
        ],
    ])('rejects a missing %s id, naming its path', (_label, type, path) => {
        expect(() => synthFields([
            MINIMAL_COLUMNS[0],
            {
                name: 'c',
                type,
                id: 2,
            },
        ])).toThrow(`column '${path}' is missing a required id`);
    });

    it.each([
        0,
        -3,
        2.5,
    ])('rejects nested id %s', (badId) => {
        expect(() => synthFields([
            MINIMAL_COLUMNS[0],
            {
                name: 'c',
                type: IcebergType.list({
                    element: IcebergType.struct([
                        {
                            id: badId,
                            name: 'f',
                            type: IcebergType.STRING,
                        },
                    ]),
                    elementId: 3,
                }),
                id: 2,
            },
        ])).toThrow(`column 'c.element.f' has invalid id ${badId}; ids must be integers from 1 to 2147483447`);
    });

    it.each([
        [
            'after',
            [
                MINIMAL_COLUMNS[0],
                {
                    name: 'tags',
                    type: IcebergType.list({
                        element: IcebergType.STRING,
                        elementId: 1,
                    }),
                    id: 2,
                },
            ],
            "duplicate field id 1 on column 'tags.element', already used by 'id'",
        ],
        [
            'before',
            [
                {
                    name: 'tags',
                    type: IcebergType.list({
                        element: IcebergType.STRING,
                        elementId: 3,
                    }),
                    id: 2,
                },
                {
                    name: 'later',
                    type: IcebergType.STRING,
                    id: 3,
                },
            ],
            "duplicate field id 3 on column 'later', already used by 'tags.element'",
        ],
    ])('rejects a nested id equal to a top-level column id declared %s it', (_label, columns, error) => {
        expect(() => synthFields(columns)).toThrow(error);
    });

    it.each([
        [
            'two nested fields at different depths',
            [
                {
                    name: 'attrs',
                    type: IcebergType.map({
                        key: IcebergType.STRING,
                        keyId: 10,
                        value: IcebergType.STRING,
                        valueId: 11,
                    }),
                    id: 2,
                },
                {
                    name: 'deep',
                    type: IcebergType.struct([
                        {
                            id: 20,
                            name: 'inner',
                            type: IcebergType.struct([
                                {
                                    id: 11,
                                    name: 'leaf',
                                    type: IcebergType.STRING,
                                },
                            ]),
                        },
                    ]),
                    id: 3,
                },
            ],
            "duplicate field id 11 on column 'deep.inner.leaf', already used by 'attrs.value'",
        ],
        [
            'a struct field under a map value',
            [
                {
                    name: 'c',
                    type: IcebergType.map({
                        key: IcebergType.STRING,
                        keyId: 3,
                        value: IcebergType.struct([
                            {
                                id: 3,
                                name: 'f',
                                type: IcebergType.STRING,
                            },
                        ]),
                        valueId: 4,
                    }),
                    id: 2,
                },
            ],
            "duplicate field id 3 on column 'c.value.f', already used by 'c.key'",
        ],
        [
            'a struct field under a map key',
            [
                {
                    name: 'c',
                    type: IcebergType.map({
                        key: IcebergType.struct([
                            {
                                id: 2,
                                name: 'f',
                                type: IcebergType.STRING,
                            },
                        ]),
                        keyId: 3,
                        value: IcebergType.STRING,
                        valueId: 4,
                    }),
                    id: 2,
                },
            ],
            "duplicate field id 2 on column 'c.key.f', already used by 'c'",
        ],
    ])('rejects a repeated id on %s', (_label, columns, error) => {
        expect(() => synthFields([
            MINIMAL_COLUMNS[0],
            ...columns,
        ])).toThrow(error);
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
            formatVersion: IcebergFormatVersion.V2,
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
            formatVersion: IcebergFormatVersion.V2,
            columns: [],
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
            formatVersion: IcebergFormatVersion.V2,
            columns: [
                {
                    name: 'a',
                    type: IcebergType.INT,
                    id: 1,
                },
                {
                    name: 'a',
                    type: IcebergType.STRING,
                    id: 2,
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
            formatVersion: IcebergFormatVersion.V2,
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
            formatVersion: IcebergFormatVersion.V2,
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket/simple/',
            partitionSpec: [
                {
                    sourceColumn: 'who_dis',
                    transform: IcebergPartitionTransform.IDENTITY,
                    fieldId: 1000,
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
            formatVersion: IcebergFormatVersion.V2,
            columns: [
                {
                    name: 'name',
                    type: IcebergType.STRING,
                    required: true,
                    id: 1,
                },
            ],
            location: 's3://my-bucket/simple/',
            partitionSpec: [
                {
                    sourceColumn: 'name',
                    transform: IcebergPartitionTransform.DAY,
                    fieldId: 1000,
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
            formatVersion: IcebergFormatVersion.V2,
            columns: [
                {
                    name: 'col',
                    type: IcebergType.STRING,
                    required: true,
                    id: 1,
                },
            ],
            location: 's3://my-bucket/simple/',
            partitionSpec: [
                {
                    sourceColumn: 'col',
                    transform: IcebergPartitionTransform.IDENTITY,
                    name: 'p',
                    fieldId: 1000,
                },
                {
                    sourceColumn: 'col',
                    transform: IcebergPartitionTransform.IDENTITY,
                    name: 'p',
                    fieldId: 1001,
                },
            ],
        })).toThrow(/duplicate partition field name/);
    });

    it('rejects a partition field that is missing its required fieldId', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            formatVersion: IcebergFormatVersion.V2,
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket/simple/',
            /// Cast through `unknown` to bypass the required-field
            /// type check and exercise the runtime guard a jsii
            /// Python/JS caller could still trip.
            partitionSpec: [
                {
                    sourceColumn: 'id',
                    transform: IcebergPartitionTransform.IDENTITY,
                } as unknown as IcebergPartitionField,
            ],
        })).toThrow(/partition field 'id' is missing a required fieldId/);
    });

    it('rejects a partition field whose fieldId is explicitly undefined', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            formatVersion: IcebergFormatVersion.V2,
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket/simple/',
            partitionSpec: [
                {
                    sourceColumn: 'id',
                    transform: IcebergPartitionTransform.IDENTITY,
                    fieldId: undefined,
                } as unknown as IcebergPartitionField,
            ],
        })).toThrow(/partition field 'id' is missing a required fieldId/);
    });

    it('rejects a partition field whose fieldId is null', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            formatVersion: IcebergFormatVersion.V2,
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket/simple/',
            partitionSpec: [
                {
                    sourceColumn: 'id',
                    transform: IcebergPartitionTransform.IDENTITY,
                    fieldId: null,
                } as unknown as IcebergPartitionField,
            ],
        })).toThrow(/partition field 'id' is missing a required fieldId/);
    });

    it('rejects a partition fieldId below 1000', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            formatVersion: IcebergFormatVersion.V2,
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket/simple/',
            partitionSpec: [
                {
                    sourceColumn: 'id',
                    transform: IcebergPartitionTransform.IDENTITY,
                    fieldId: 999,
                },
            ],
        })).toThrow(/partition field 'id' has invalid fieldId 999/);
    });

    it('rejects a fractional partition fieldId', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            formatVersion: IcebergFormatVersion.V2,
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket/simple/',
            partitionSpec: [
                {
                    sourceColumn: 'id',
                    transform: IcebergPartitionTransform.IDENTITY,
                    fieldId: 1000.5,
                },
            ],
        })).toThrow(/partition field 'id' has invalid fieldId 1000.5/);
    });

    it('rejects duplicate partition fieldIds', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            formatVersion: IcebergFormatVersion.V2,
            columns: [
                {
                    name: 'occurred_at',
                    type: IcebergType.TIMESTAMPTZ,
                    required: true,
                    id: 1,
                },
            ],
            location: 's3://my-bucket/simple/',
            partitionSpec: [
                {
                    sourceColumn: 'occurred_at',
                    transform: IcebergPartitionTransform.MONTH,
                    fieldId: 1000,
                },
                {
                    sourceColumn: 'occurred_at',
                    transform: IcebergPartitionTransform.DAY,
                    fieldId: 1000,
                },
            ],
        })).toThrow(/duplicate partition fieldId 1000 on partition field 'occurred_at_day'/);
    });

    it('rejects an empty sortOrder when provided', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            formatVersion: IcebergFormatVersion.V2,
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket/simple/',
            sortOrder: [],
        })).toThrow(/sortOrder must contain at least one field/);
    });

    it('rejects a sortOrder referencing unknown columns', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            formatVersion: IcebergFormatVersion.V2,
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
            formatVersion: IcebergFormatVersion.V2,
            columns: [
                {
                    name: 'name',
                    type: IcebergType.STRING,
                    required: true,
                    id: 1,
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

    it('rejects a variant column in sortOrder', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            formatVersion: IcebergFormatVersion.V3,
            columns: [
                {
                    name: 'payload',
                    type: IcebergType.VARIANT,
                    id: 1,
                },
            ],
            location: 's3://my-bucket/simple/',
            sortOrder: [
                {
                    sourceColumn: 'payload',
                    transform: IcebergPartitionTransform.IDENTITY,
                },
            ],
        })).toThrow(/column 'payload' has type variant, which cannot be a partition or sort source/);
    });

    it('rejects identifierFieldNames with duplicates', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            formatVersion: IcebergFormatVersion.V2,
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
            formatVersion: IcebergFormatVersion.V2,
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
            formatVersion: IcebergFormatVersion.V2,
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket/simple/',
            tableProperties: {
                'write.format.default': 'orc',
            },
        })).toThrow(/write\.format\.default.*orc/);
    });
});

describe('IcebergTable — identifier doc marker', () => {
    function docsOf(identifierFieldNames?: string[]): Array<string | undefined> {
        const {
            stack, database,
        } = makeStack();
        new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'orders',
            formatVersion: IcebergFormatVersion.V2,
            columns: [
                {
                    name: 'order_id',
                    type: IcebergType.LONG,
                    required: true,
                    id: 1,
                    doc: 'Order key.',
                },
                {
                    name: 'line_no',
                    type: IcebergType.INT,
                    required: true,
                    id: 2,
                },
                {
                    name: 'note',
                    type: IcebergType.STRING,
                    id: 3,
                    doc: 'Free text.',
                },
            ],
            location: 's3://my-bucket/orders/',
            identifierFieldNames,
        });
        const tables = Template.fromStack(stack).findResources('AWS::Glue::Table');
        const fields = Object.values(tables)[0].Properties.OpenTableFormatInput.IcebergInput.IcebergTableInput.Schema.Fields;
        return fields.map((field: { Doc?: string }) => field.Doc);
    }

    it('prefixes identifier docs with (PK) and leaves other columns unchanged', () => {
        expect(docsOf([
            'order_id',
            'line_no',
        ])).toEqual([
            '(PK) Order key.',
            '(PK) ',
            'Free text.',
        ]);
    });

    it.each([
        undefined,
        [],
    ])('leaves every doc unchanged when identifierFieldNames is %p', (identifierFieldNames) => {
        expect(docsOf(identifierFieldNames)).toEqual([
            'Order key.',
            undefined,
            'Free text.',
        ]);
    });

    function synthTable(columns: IcebergColumn[], identifierFieldNames?: string[]): Template {
        const {
            stack, database,
        } = makeStack();
        new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            formatVersion: IcebergFormatVersion.V2,
            columns,
            location: 's3://my-bucket/simple/',
            identifierFieldNames,
        });
        return Template.fromStack(stack);
    }

    it.each([
        {
            label: 'rejects an optional identifier column',
            column: {
                ...MINIMAL_COLUMNS[0],
                required: false,
            },
            identifierFieldNames: [
                'id',
            ],
            error: "identifierFieldNames references optional column 'id'; "
                + 'set required: true on the column or remove it from identifierFieldNames',
        },
        {
            label: 'rejects a bare (PK) doc',
            column: {
                ...MINIMAL_COLUMNS[0],
                doc: '(PK) ',
            },
            identifierFieldNames: undefined,
            error: "column 'id' has a doc starting with '(PK) ', a prefix the construct adds to identifier columns; "
                + 'remove it and list the column in identifierFieldNames instead',
        },
        {
            label: 'rejects a (PK) doc on an identifier column',
            column: {
                ...MINIMAL_COLUMNS[0],
                doc: '(PK) key',
            },
            identifierFieldNames: [
                'id',
            ],
            error: "column 'id' has a doc starting with '(PK) ', a prefix the construct adds to identifier columns; "
                + 'remove it and list the column in identifierFieldNames instead',
        },
        {
            label: 'accepts a doc that only resembles the marker',
            column: {
                ...MINIMAL_COLUMNS[0],
                doc: '(PK)key',
            },
            identifierFieldNames: undefined,
            error: undefined,
        },
    ])('$label', ({
        column, identifierFieldNames, error,
    }) => {
        let thrown: string | undefined;
        try {
            synthTable([
                column,
            ], identifierFieldNames);
        } catch (e) {
            thrown = (e as Error).message;
        }
        expect(thrown).toBe(error);
    });

    it('leaves nested struct field docs and names unmarked', () => {
        const template = synthTable([
            MINIMAL_COLUMNS[0],
            {
                name: 'detail',
                type: IcebergType.struct([
                    {
                        id: 3,
                        name: 'note',
                        type: IcebergType.STRING,
                        doc: '(PK) x',
                    },
                    {
                        id: 4,
                        name: 'id',
                        type: IcebergType.LONG,
                        doc: 'Nested id.',
                    },
                ]),
                id: 2,
            },
        ], [
            'id',
        ]);
        const tables = template.findResources('AWS::Glue::Table');
        const fields = Object.values(tables)[0].Properties.OpenTableFormatInput.IcebergInput.IcebergTableInput.Schema.Fields;
        const nested = JSON.parse(fields[1].Type).fields.map((field: { doc: string }) => field.doc);
        expect(nested).toEqual([
            '(PK) x',
            'Nested id.',
        ]);
    });
});

describe('IcebergTable — v3 types', () => {
    function build(
        formatVersion: IcebergFormatVersion,
        column: Omit<IcebergColumn, 'id' | 'name'>,
        identifierFieldNames?: string[],
    ): IcebergTable {
        const {
            stack, database,
        } = makeStack();
        return new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'v3',
            formatVersion,
            columns: [
                ...MINIMAL_COLUMNS,
                {
                    ...column,
                    name: 'c',
                    id: 2,
                },
            ],
            location: 's3://my-bucket/v3/',
            identifierFieldNames,
        });
    }

    it('renders v3 type strings into the schema', () => {
        const table = build(IcebergFormatVersion.V3, {
            type: IcebergType.geography('EPSG:4326', IcebergEdgeAlgorithm.KARNEY),
        });
        Template.fromStack(Stack.of(table)).hasResourceProperties('AWS::Glue::Table', {
            OpenTableFormatInput: {
                IcebergInput: Match.objectLike({
                    IcebergTableInput: Match.objectLike({
                        Schema: Match.objectLike({
                            Fields: Match.arrayWith([
                                Match.objectLike({
                                    Name: 'c',
                                    Type: 'geography(EPSG:4326, karney)',
                                }),
                            ]),
                        }),
                    }),
                }),
            },
        });
    });

    it.each([
        [
            'unknown',
            IcebergType.UNKNOWN,
            'c',
        ],
        [
            'timestamp_ns',
            IcebergType.TIMESTAMP_NS,
            'c',
        ],
        [
            'timestamptz_ns',
            IcebergType.TIMESTAMPTZ_NS,
            'c',
        ],
        [
            'variant',
            IcebergType.VARIANT,
            'c',
        ],
        [
            'geometry',
            IcebergType.geometry('EPSG:3857'),
            'c',
        ],
        [
            'geography',
            IcebergType.geography(),
            'c',
        ],
        [
            'variant',
            IcebergType.list({
                element: IcebergType.VARIANT,
                elementId: 3,
            }),
            'c.element',
        ],
        [
            'timestamp_ns',
            IcebergType.map({
                key: IcebergType.TIMESTAMP_NS,
                keyId: 3,
                value: IcebergType.STRING,
                valueId: 4,
            }),
            'c.key',
        ],
        [
            'timestamptz_ns',
            IcebergType.map({
                key: IcebergType.STRING,
                keyId: 3,
                value: IcebergType.TIMESTAMPTZ_NS,
                valueId: 4,
            }),
            'c.value',
        ],
        [
            'geography',
            IcebergType.struct([
                {
                    id: 3,
                    name: 'inner',
                    type: IcebergType.struct([
                        {
                            id: 4,
                            name: 'shape',
                            type: IcebergType.geography(),
                        },
                    ]),
                },
            ]),
            'c.inner.shape',
        ],
    ])('rejects %s at %s below v3 and accepts it at v3', (kind, type, path) => {
        for (const formatVersion of [
            IcebergFormatVersion.V1,
            IcebergFormatVersion.V2,
        ]) {
            expect(() => build(formatVersion, {
                type,
            })).toThrow(`column '${path}' has type '${kind}', which requires formatVersion v3; got v${formatVersion}`);
        }
        expect(() => build(IcebergFormatVersion.V3, {
            type,
        })).not.toThrow();
    });

    it.each([
        [
            'a required column',
            {
                type: IcebergType.UNKNOWN,
                required: true,
            },
            {
                type: IcebergType.UNKNOWN,
                required: false,
            },
            'c',
        ],
        [
            'a required struct field',
            {
                type: IcebergType.struct([
                    {
                        id: 3,
                        name: 'f',
                        type: IcebergType.UNKNOWN,
                        required: true,
                    },
                ]),
            },
            {
                type: IcebergType.struct([
                    {
                        id: 3,
                        name: 'f',
                        type: IcebergType.UNKNOWN,
                    },
                ]),
            },
            'c.f',
        ],
        [
            'a required list element',
            {
                type: IcebergType.list({
                    element: IcebergType.UNKNOWN,
                    elementId: 3,
                    elementRequired: true,
                }),
            },
            {
                type: IcebergType.list({
                    element: IcebergType.UNKNOWN,
                    elementId: 3,
                }),
            },
            'c.element',
        ],
        [
            'a required map value',
            {
                type: IcebergType.map({
                    key: IcebergType.STRING,
                    keyId: 3,
                    value: IcebergType.UNKNOWN,
                    valueId: 4,
                    valueRequired: true,
                }),
            },
            {
                type: IcebergType.map({
                    key: IcebergType.STRING,
                    keyId: 3,
                    value: IcebergType.UNKNOWN,
                    valueId: 4,
                }),
            },
            'c.value',
        ],
    ])('rejects unknown as %s and accepts it optional', (_label, rejected, accepted, path) => {
        expect(() => build(IcebergFormatVersion.V3, rejected))
            .toThrow(`column '${path}' has type 'unknown', which must be optional`);
        expect(() => build(IcebergFormatVersion.V3, accepted)).not.toThrow();
    });

    it('rejects unknown as a map key, which is always required', () => {
        expect(() => build(IcebergFormatVersion.V3, {
            type: IcebergType.map({
                key: IcebergType.UNKNOWN,
                keyId: 3,
                value: IcebergType.STRING,
                valueId: 4,
            }),
        })).toThrow("column 'c.key' has type 'unknown' as a map key; map keys are always required, so use a different key type");
    });

    it.each([
        [
            'variant',
            IcebergType.VARIANT,
        ],
        [
            'unknown',
            IcebergType.UNKNOWN,
        ],
        [
            'geometry',
            IcebergType.geometry(),
        ],
        [
            'geography',
            IcebergType.geography(),
        ],
    ])('rejects a %s column in identifierFieldNames and accepts it outside them', (kind, type) => {
        expect(() => build(IcebergFormatVersion.V3, {
            type,
        }, [
            'id',
            'c',
        ])).toThrow(`identifierFieldNames references column 'c' of type '${kind}', which cannot identify a row`);
        expect(() => build(IcebergFormatVersion.V3, {
            type,
        }, [
            'id',
        ])).not.toThrow();
    });

    it.each([
        IcebergType.TIMESTAMP_NS,
        IcebergType.TIMESTAMPTZ_NS,
    ])('accepts nanosecond timestamp %s in identifierFieldNames', (type) => {
        expect(() => build(IcebergFormatVersion.V3, {
            type,
            required: true,
        }, [
            'c',
        ])).not.toThrow();
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
            formatVersion: IcebergFormatVersion.V2,
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
            formatVersion: IcebergFormatVersion.V2,
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
            formatVersion: IcebergFormatVersion.V2,
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
            formatVersion: IcebergFormatVersion.V2,
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

    it('rejects an imported location that does not start with s3://', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => {
            IcebergTable.fromIcebergTableAttributes(stack, 'Imported', {
                database,
                tableName: 'pre',
                location: 'gs://other-bucket/pre/',
            });
        }).toThrow("location must start with 's3://', got 'gs://other-bucket/pre/'");
    });
});
