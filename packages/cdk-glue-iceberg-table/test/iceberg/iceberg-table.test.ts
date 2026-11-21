import {
    App,
    CfnParameter,
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
    IcebergColumn,
    IcebergDataFormat,
    IcebergEdgeAlgorithm,
    IcebergFormatVersion,
    IcebergNullOrder,
    IcebergPartitionTransform,
    IcebergSortDirection,
    IcebergStructFieldDefinition,
    IcebergTable,
    IcebergTableProps,
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
        id: 1,
    },
];

const props = (database: Database, overrides: Partial<IcebergTableProps> = {}): IcebergTableProps => ({
    database,
    tableName: 'simple',
    formatVersion: IcebergFormatVersion.V2,
    columns: MINIMAL_COLUMNS,
    location: 's3://my-bucket/simple/',
    ...overrides,
});

describe('IcebergTable — happy path', () => {
    it('emits an AWS::Glue::Table with the openTableFormatInput shape (no tableInput)', () => {
        const {
            stack, database,
        } = makeStack();

        new IcebergTable(stack, 'Tbl', props(database));

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

    it('defaults dataFormat to parquet and surfaces the supplied formatVersion', () => {
        const {
            stack, database,
        } = makeStack();
        const table = new IcebergTable(stack, 'Tbl', props(database));
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
        new IcebergTable(stack, 'Tbl', props(database, {
            comment: 'demo comment',
        }));
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

    it('applies RETAIN by default', () => {
        const {
            stack, database,
        } = makeStack();
        new IcebergTable(stack, 'Tbl', props(database));
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
        new IcebergTable(stack, 'Tbl', props(database, {
            removalPolicy: RemovalPolicy.DESTROY,
        }));
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
        const table = new IcebergTable(stack, 'Tbl', props(database));
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
        const table = new IcebergTable(stack, 'Tbl', props(database));
        expect(table.resource).toBeDefined();
        expect(table.node.defaultChild).toBe(table.resource);
    });

    it('skips writeOrder when sortOrder is omitted', () => {
        const {
            stack, database,
        } = makeStack();
        new IcebergTable(stack, 'Tbl', props(database));
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

    it('renders no PartitionSpec for an empty partitionSpec', () => {
        const {
            stack, database,
        } = makeStack();
        new IcebergTable(stack, 'Tbl', props(database, {
            partitionSpec: [],
        }));
        Template.fromStack(stack).hasResourceProperties('AWS::Glue::Table', {
            OpenTableFormatInput: {
                IcebergInput: {
                    IcebergTableInput: Match.objectLike({
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

    it('accepts id 2147483447 and rejects 2147483448', () => {
        const column = (id: number): IcebergColumn => ({
            name: 'c',
            type: IcebergType.STRING,
            id,
        });
        expect(() => synthFields([
            MINIMAL_COLUMNS[0],
            column(2147483447),
        ])).not.toThrow();
        expect(() => synthFields([
            MINIMAL_COLUMNS[0],
            column(2147483448),
        ])).toThrow("column 'c' has invalid id 2147483448; ids must be integers from 1 to 2147483447");
    });

    it('keeps id message paths distinct when names contain backquotes and a dot', () => {
        expect(() => synthFields([
            {
                name: 'a.`b',
                type: IcebergType.STRING,
                id: 1,
            },
            {
                name: '`a',
                type: IcebergType.struct([
                    {
                        id: 1,
                        name: '`b`',
                        type: IcebergType.STRING,
                    },
                ]),
                id: 2,
            },
        ])).toThrow("duplicate field id 1 on column '```a`.```b```', already used by '`a.``b`'");
    });

    it('rejects an invalid nested id, naming its path', () => {
        expect(() => synthFields([
            MINIMAL_COLUMNS[0],
            {
                name: 'c',
                type: IcebergType.list({
                    element: IcebergType.struct([
                        {
                            id: 0,
                            name: 'f',
                            type: IcebergType.STRING,
                        },
                    ]),
                    elementId: 3,
                }),
                id: 2,
            },
        ])).toThrow("column 'c.element.f' has invalid id 0; ids must be integers from 1 to 2147483447");
    });

    it('rejects a nested id equal to the id of a column declared after its parent', () => {
        expect(() => synthFields([
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
        ])).toThrow("duplicate field id 3 on column 'tags.element', already used by 'later'");
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
    it('rejects a formatVersion that is not an IcebergFormatVersion', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', {
            database,
            tableName: 'simple',
            formatVersion: '9' as IcebergFormatVersion,
            columns: MINIMAL_COLUMNS,
            location: 's3://my-bucket/simple/',
        })).toThrow("formatVersion must be one of 1, 2, 3, got '9'");
    });

    it('rejects a dataFormat that is not an IcebergDataFormat', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', props(database, {
            dataFormat: 'csv' as IcebergDataFormat,
        }))).toThrow("dataFormat must be one of parquet, orc, avro, got 'csv'");
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
        expect(() => new IcebergTable(stack, 'Tbl', props(database, {
            partitionSpec: [
                {
                    sourceColumn: 'who_dis',
                    transform: IcebergPartitionTransform.IDENTITY,
                    fieldId: 1000,
                },
            ],
        }))).toThrow(/unknown column 'who_dis'/);
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

    it('rejects a partition fieldId below 1000', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', props(database, {
            partitionSpec: [
                {
                    sourceColumn: 'id',
                    transform: IcebergPartitionTransform.IDENTITY,
                    fieldId: 999,
                },
            ],
        }))).toThrow(/partition field 'id' has invalid fieldId 999/);
    });

    it('rejects a fractional partition fieldId', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', props(database, {
            partitionSpec: [
                {
                    sourceColumn: 'id',
                    transform: IcebergPartitionTransform.IDENTITY,
                    fieldId: 1000.5,
                },
            ],
        }))).toThrow(/partition field 'id' has invalid fieldId 1000.5/);
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
        expect(() => new IcebergTable(stack, 'Tbl', props(database, {
            sortOrder: [],
        }))).toThrow(/sortOrder must contain at least one field/);
    });

    it('rejects a sortOrder referencing unknown columns', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', props(database, {
            sortOrder: [
                {
                    sourceColumn: 'nope',
                },
            ],
        }))).toThrow(/unknown column 'nope'/);
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

    it('rejects identifierFieldNames with duplicates', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', props(database, {
            identifierFieldNames: [
                'id',
                'id',
            ],
        }))).toThrow(/duplicate identifier field/);
    });

    it('rejects identifierFieldNames referencing unknown columns', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', props(database, {
            identifierFieldNames: [
                'who',
            ],
        }))).toThrow(/identifierFieldNames.*who/);
    });

    it('propagates table-property validation errors', () => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', props(database, {
            tableProperties: {
                'write.format.default': 'orc',
            },
        }))).toThrow(/write\.format\.default.*orc/);
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
        [
            'float',
            IcebergType.FLOAT,
        ],
        [
            'double',
            IcebergType.DOUBLE,
        ],
        [
            'list',
            IcebergType.list({
                element: IcebergType.STRING,
                elementId: 3,
            }),
        ],
        [
            'map',
            IcebergType.map({
                key: IcebergType.STRING,
                keyId: 3,
                value: IcebergType.STRING,
                valueId: 4,
            }),
        ],
        [
            'struct',
            IcebergType.struct([
                {
                    id: 3,
                    name: 'f',
                    type: IcebergType.STRING,
                },
            ]),
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

describe('IcebergTable.fromIcebergTableAttributes', () => {
    it('reconstructs a table reference', () => {
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

    it('accepts a token location', () => {
        const {
            stack, database,
        } = makeStack();
        const table = IcebergTable.fromIcebergTableAttributes(stack, 'Imported', {
            database,
            tableName: 'pre',
            location: `s3://${Lazy.string({
                produce: () => 'resolved-bucket',
            })}/p/`,
        });
        expect(stack.resolve(table.tableArn)).toBeDefined();
    });
});

describe('IcebergTable.creationOrderFieldIds', () => {
    it('numbers flat columns in declaration order', () => {
        expect(IcebergTable.creationOrderFieldIds([
            {
                name: 'customer_id',
                type: IcebergType.LONG,
                required: true,
                id: 1,
            },
            {
                name: 'email',
                type: IcebergType.STRING,
                required: true,
                id: 2,
            },
            {
                name: 'signed_up_at',
                type: IcebergType.TIMESTAMPTZ,
                required: true,
                id: 3,
            },
        ])).toEqual({
            customer_id: 1,
            email: 2,
            signed_up_at: 3,
        });
    });

    it('numbers each top-level column before any list element, map key and value, or struct field', () => {
        expect(IcebergTable.creationOrderFieldIds([
            {
                name: 'id',
                type: IcebergType.LONG,
                required: true,
                id: 1,
            },
            {
                name: 'tags',
                type: IcebergType.list({
                    element: IcebergType.STRING,
                    elementId: 3,
                }),
                id: 2,
            },
            {
                name: 'attrs',
                type: IcebergType.map({
                    key: IcebergType.STRING,
                    keyId: 5,
                    value: IcebergType.STRING,
                    valueId: 6,
                }),
                id: 4,
            },
            {
                name: 'addr',
                type: IcebergType.struct([
                    {
                        id: 8,
                        name: 'line1',
                        type: IcebergType.STRING,
                    },
                    {
                        id: 9,
                        name: 'city',
                        type: IcebergType.STRING,
                    },
                ]),
                id: 7,
            },
        ])).toEqual({
            'id': 1,
            'tags': 2,
            'attrs': 3,
            'addr': 4,
            'tags.element': 5,
            'attrs.key': 6,
            'attrs.value': 7,
            'addr.line1': 8,
            'addr.city': 9,
        });
    });

    it('ignores gapped, out-of-order declared ids and numbers each struct level before each field subtree in turn', () => {
        expect(IcebergTable.creationOrderFieldIds([
            {
                name: 'c',
                type: IcebergType.LONG,
                required: true,
                id: 10,
            },
            {
                name: 'a',
                type: IcebergType.STRING,
                required: true,
                id: 3,
            },
            {
                name: 's',
                type: IcebergType.struct([
                    {
                        id: 21,
                        name: 'x',
                        type: IcebergType.INT,
                    },
                    {
                        id: 22,
                        name: 'lst',
                        type: IcebergType.list({
                            elementId: 23,
                            element: IcebergType.struct([
                                {
                                    id: 24,
                                    name: 'p',
                                    type: IcebergType.INT,
                                },
                                {
                                    id: 25,
                                    name: 'q',
                                    type: IcebergType.STRING,
                                },
                            ]),
                        }),
                    },
                    {
                        id: 26,
                        name: 'y',
                        type: IcebergType.STRING,
                    },
                ]),
                id: 20,
            },
            {
                name: 'm',
                type: IcebergType.map({
                    keyId: 31,
                    key: IcebergType.STRING,
                    valueId: 32,
                    value: IcebergType.struct([
                        {
                            id: 33,
                            name: 'v1',
                            type: IcebergType.INT,
                        },
                        {
                            id: 34,
                            name: 'v2',
                            type: IcebergType.list({
                                elementId: 35,
                                element: IcebergType.LONG,
                            }),
                        },
                    ]),
                }),
                id: 30,
            },
            {
                name: 't',
                type: IcebergType.list({
                    elementId: 8,
                    element: IcebergType.map({
                        keyId: 9,
                        key: IcebergType.STRING,
                        valueId: 11,
                        value: IcebergType.INT,
                    }),
                }),
                id: 7,
            },
        ])).toEqual({
            'c': 1,
            'a': 2,
            's': 3,
            'm': 4,
            't': 5,
            's.x': 6,
            's.lst': 7,
            's.y': 8,
            's.lst.element': 9,
            's.lst.element.p': 10,
            's.lst.element.q': 11,
            'm.key': 12,
            'm.value': 13,
            'm.value.v1': 14,
            'm.value.v2': 15,
            'm.value.v2.element': 16,
            't.element': 17,
            't.element.key': 18,
            't.element.value': 19,
        });
    });

    it('numbers a map key and value, then the key subtree, then the value subtree', () => {
        expect(IcebergTable.creationOrderFieldIds([
            {
                name: 'm',
                type: IcebergType.map({
                    keyId: 9,
                    key: IcebergType.struct([
                        {
                            id: 7,
                            name: 'k1',
                            type: IcebergType.STRING,
                        },
                        {
                            id: 8,
                            name: 'k2',
                            type: IcebergType.INT,
                        },
                    ]),
                    valueId: 5,
                    value: IcebergType.struct([
                        {
                            id: 4,
                            name: 'v1',
                            type: IcebergType.STRING,
                        },
                    ]),
                }),
                id: 6,
            },
        ])).toEqual({
            'm': 1,
            'm.key': 2,
            'm.value': 3,
            'm.key.k1': 4,
            'm.key.k2': 5,
            'm.value.v1': 6,
        });
    });

    it('keeps every field as an own key, including __proto__ and constructor', () => {
        const ids = IcebergTable.creationOrderFieldIds([
            {
                name: '__proto__',
                type: IcebergType.LONG,
                id: 1,
            },
            {
                name: 'constructor',
                type: IcebergType.LONG,
                id: 2,
            },
        ]);
        expect(Object.entries(ids)).toEqual([
            [
                '__proto__',
                1,
            ],
            [
                'constructor',
                2,
            ],
        ]);
    });

    it('keys a field whose name contains a dot by its backquoted path', () => {
        expect(IcebergTable.creationOrderFieldIds([
            {
                name: 'a.b',
                type: IcebergType.struct([
                    {
                        id: 2,
                        name: 'c',
                        type: IcebergType.STRING,
                    },
                ]),
                id: 1,
            },
        ])).toEqual({
            '`a.b`': 1,
            '`a.b`.c': 2,
        });
    });
});

describe('IcebergTable — catalogId and tokenized tableName', () => {
    it('renders a literal catalogId in the template', () => {
        const {
            stack, database,
        } = makeStack();
        new IcebergTable(stack, 'Tbl', props(database, {
            catalogId: '999999999999',
        }));
        Template.fromStack(stack).hasResourceProperties('AWS::Glue::Table', {
            CatalogId: '999999999999',
        });
    });

    it('renders a CfnParameter catalogId as a Ref in the template', () => {
        const {
            stack, database,
        } = makeStack();
        new IcebergTable(stack, 'Tbl', props(database, {
            catalogId: new CfnParameter(stack, 'Catalog').valueAsString,
        }));
        Template.fromStack(stack).hasResourceProperties('AWS::Glue::Table', {
            CatalogId: {
                Ref: 'Catalog',
            },
        });
    });

    it('renders a CfnParameter table property value as a Ref on a key the construct does not check', () => {
        const {
            stack, database,
        } = makeStack();
        new IcebergTable(stack, 'Tbl', props(database, {
            tableProperties: {
                'gc.enabled': new CfnParameter(stack, 'P').valueAsString,
            },
        }));
        Template.fromStack(stack).hasResourceProperties('AWS::Glue::Table', {
            OpenTableFormatInput: {
                IcebergInput: {
                    IcebergTableInput: {
                        Properties: {
                            'gc.enabled': {
                                Ref: 'P',
                            },
                        },
                    },
                },
            },
        });
    });

    it('renders a CfnParameter tableName as a Ref in the template Name', () => {
        const {
            stack, database,
        } = makeStack();
        new IcebergTable(stack, 'Tbl', props(database, {
            tableName: new CfnParameter(stack, 'TableNameParam', {
                default: 'from_parameter',
            }).valueAsString,
        }));
        Template.fromStack(stack).hasResourceProperties('AWS::Glue::Table', {
            Name: {
                Ref: 'TableNameParam',
            },
        });
    });

    it.each([
        'Bad-Name',
        '',
    ])('rejects the literal table name %j', (tableName) => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', props(database, {
            tableName,
        }))).toThrow("must contain only lowercase letters, digits, and underscores");
    });

    it.each([
        '12345678901',
        'abcdefghijkl',
        '123456789012\n',
    ])('rejects the literal catalogId %j', (catalogId) => {
        const {
            stack, database,
        } = makeStack();
        expect(() => new IcebergTable(stack, 'Tbl', props(database, {
            catalogId,
        }))).toThrow('must be a 12-digit AWS account id');
    });

    it.each([
        [
            'tableName',
            'Bad-Name',
            'must contain only lowercase letters, digits, and underscores',
        ],
        [
            'catalogId',
            '12345678901',
            'must be a 12-digit AWS account id',
        ],
    ])('rejects an invalid %s on an imported table', (key, value, message) => {
        const {
            stack, database,
        } = makeStack();
        expect(() => IcebergTable.fromIcebergTableAttributes(stack, 'Imported', {
            database,
            tableName: 'simple',
            location: 's3://my-bucket/simple/',
            [key]: value,
        })).toThrow(message);
    });
});
