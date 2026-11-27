import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    spawnSync,
} from 'child_process';
import {
    App,
    CfnParameter,
    Stack,
} from 'aws-cdk-lib';
import {
    Template,
} from 'aws-cdk-lib/assertions';
import {
    CfnTable,
    Database,
} from 'aws-cdk-lib/aws-glue';
import {
    IcebergColumn,
    IcebergFormatVersion,
    IcebergPartitionField,
    IcebergPartitionTransform,
    IcebergTable,
    IcebergType,
} from '../packages/cdk-glue-iceberg-table/lib/iceberg';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const checker = require('../docs/check-field-ids.js');

const SCRIPT = path.join(__dirname, '..', 'docs', 'check-field-ids.js');

const DAY_PARTITION: IcebergPartitionField[] = [
    {
        sourceColumn: 'placed_at',
        transform: IcebergPartitionTransform.DAY,
        fieldId: 1000,
    },
];

function rawTable(
    tableInput: Record<string, unknown>,
    logicalId = 'Tbl',
    name = 't',
): Record<string, unknown> {
    return {
        [logicalId]: {
            Type: 'AWS::Glue::Table',
            Properties: {
                Name: name,
                OpenTableFormatInput: {
                    IcebergInput: {
                        IcebergTableInput: tableInput,
                    },
                },
            },
        },
    };
}

function rawTemplate(
    tableInput: Record<string, unknown>,
    logicalId = 'Tbl',
    name = 't',
): Record<string, unknown> {
    return {
        Resources: rawTable(tableInput, logicalId, name),
    };
}

function synthTable(
    columns: IcebergColumn[],
    partitionSpec?: IcebergPartitionField[],
): Record<string, unknown> {
    const app = new App();
    const stack = new Stack(app, 'TestStack', {
        env: {
            account: '123456789012',
            region: 'us-east-1',
        },
    });
    const database = new Database(stack, 'Db', {
        databaseName: 'analytics',
    });
    new IcebergTable(stack, 'OrdersTable', {
        database,
        tableName: 'orders',
        columns,
        partitionSpec,
        location: 's3://test-bucket/analytics/orders/',
        formatVersion: IcebergFormatVersion.V2,
    });
    return Template.fromStack(stack).toJSON();
}

function baseColumns(): IcebergColumn[] {
    return [
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
        {
            name: 'placed_at',
            type: IcebergType.TIMESTAMPTZ,
            required: true,
            id: 3,
        },
        {
            name: 'tags',
            type: IcebergType.list({
                element: IcebergType.STRING,
                elementId: 7,
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
                    required: true,
                },
                {
                    id: 9,
                    name: 'city',
                    type: IcebergType.STRING,
                    required: true,
                },
            ]),
            id: 5,
        },
        {
            name: 'attrs',
            type: IcebergType.map({
                key: IcebergType.STRING,
                keyId: 10,
                value: IcebergType.STRING,
                valueId: 11,
            }),
            id: 6,
        },
    ];
}

function baseMetadataFields(): unknown[] {
    return [
        {
            id: 1,
            name: 'order_id',
            required: true,
            type: 'long',
        },
        {
            id: 2,
            name: 'customer_id',
            required: true,
            type: 'long',
        },
        {
            id: 3,
            name: 'placed_at',
            required: true,
            type: 'timestamptz',
        },
        {
            id: 4,
            name: 'tags',
            required: false,
            type: {
                type: 'list',
                'element-id': 7,
                element: 'string',
            },
        },
        {
            id: 5,
            name: 'addr',
            required: false,
            type: {
                type: 'struct',
                fields: [
                    {
                        id: 8,
                        name: 'line1',
                        required: true,
                        type: 'string',
                    },
                    {
                        id: 9,
                        name: 'city',
                        required: true,
                        type: 'string',
                    },
                ],
            },
        },
        {
            id: 6,
            name: 'attrs',
            required: false,
            type: {
                type: 'map',
                'key-id': 10,
                key: 'string',
                'value-id': 11,
                value: 'string',
            },
        },
    ];
}

function baseMetadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        'format-version': 2,
        'last-column-id': 11,
        'current-schema-id': 0,
        schemas: [
            {
                'schema-id': 0,
                fields: baseMetadataFields(),
            },
        ],
        'last-partition-id': 1000,
        'partition-specs': [
            {
                'spec-id': 0,
                fields: [
                    {
                        name: 'placed_at_day',
                        'source-id': 3,
                        transform: 'day',
                        'field-id': 1000,
                    },
                ],
            },
        ],
        ...overrides,
    };
}

function metadataAfterDrop(): Record<string, unknown> {
    const schema0Fields = baseMetadataFields();
    return baseMetadata({
        'last-column-id': 11,
        'current-schema-id': 1,
        schemas: [
            {
                'schema-id': 0,
                fields: schema0Fields,
            },
            {
                'schema-id': 1,
                fields: schema0Fields.filter((f) => (f as { id: number }).id !== 2),
            },
        ],
    });
}

const BASE_TEMPLATE = synthTable(baseColumns(), DAY_PARTITION);

describe('collectFields', () => {
    it('collects top-level and nested ids from synthesized CloudFormation Schema.Fields', () => {
        const template = synthTable([
            ...baseColumns(),
            {
                name: 'a.b`c',
                type: IcebergType.list({
                    element: IcebergType.struct([
                        {
                            id: 14,
                            name: 'item',
                            type: IcebergType.STRING,
                        },
                    ]),
                    elementId: 13,
                }),
                id: 12,
            },
        ]) as {
            Resources: Record<string, {
                Type: string;
                Properties: {
                    OpenTableFormatInput: {
                        IcebergInput: {
                            IcebergTableInput: {
                                Schema: {
                                    Fields: unknown[];
                                };
                            };
                        };
                    };
                };
            }>;
        };
        const glueTable = Object.values(template.Resources).find((r) => r.Type === 'AWS::Glue::Table')!;
        const fields = glueTable.Properties.OpenTableFormatInput.IcebergInput.IcebergTableInput.Schema.Fields;
        expect(checker.collectFields(fields)).toEqual([
            {
                id: 1,
                path: 'order_id',
            },
            {
                id: 2,
                path: 'customer_id',
            },
            {
                id: 3,
                path: 'placed_at',
            },
            {
                id: 4,
                path: 'tags',
            },
            {
                id: 7,
                path: 'tags.element',
            },
            {
                id: 5,
                path: 'addr',
            },
            {
                id: 8,
                path: 'addr.line1',
            },
            {
                id: 9,
                path: 'addr.city',
            },
            {
                id: 6,
                path: 'attrs',
            },
            {
                id: 10,
                path: 'attrs.key',
            },
            {
                id: 11,
                path: 'attrs.value',
            },
            {
                id: 12,
                path: '`a.b``c`',
            },
            {
                id: 13,
                path: '`a.b``c`.element',
            },
            {
                id: 14,
                path: '`a.b``c`.element.item',
            },
        ]);
    });

    it('handles non-object entries, optional prefix, and non-string field names safely', () => {
        expect(checker.collectFields([
            null,
            {
                Id: 6,
                Name: 123,
                Type: null,
            },
        ], 'p.')).toEqual([
            {
                id: 6,
                path: 'p.',
            },
        ]);
    });
});

describe('checkFieldIds — safe updates on synthesized IcebergTable', () => {
    it('passes on an unchanged table with nested fields and partitions', () => {
        expect(checker.checkFieldIds(BASE_TEMPLATE, baseMetadata()).problems).toEqual([]);
    });

    it('passes when adding top-level and nested struct/list/map fields above last-column-id', () => {
        const cols = baseColumns();
        cols[4] = {
            name: 'addr',
            type: IcebergType.struct([
                {
                    id: 8,
                    name: 'line1',
                    type: IcebergType.STRING,
                    required: true,
                },
                {
                    id: 9,
                    name: 'city',
                    type: IcebergType.STRING,
                    required: true,
                },
                {
                    id: 12,
                    name: 'zip',
                    type: IcebergType.STRING,
                },
            ]),
            id: 5,
        };
        cols.push(
            {
                name: 'notes',
                type: IcebergType.list({
                    element: IcebergType.STRING,
                    elementId: 14,
                }),
                id: 13,
            },
            {
                name: 'labels',
                type: IcebergType.map({
                    key: IcebergType.STRING,
                    keyId: 16,
                    value: IcebergType.STRING,
                    valueId: 17,
                }),
                id: 15,
            },
        );
        expect(checker.checkFieldIds(synthTable(cols, DAY_PARTITION), baseMetadata()).problems).toEqual([]);
    });

    it('passes on column/ancestor/nested renames, sibling reordering, and primitive widening', () => {
        const cols = baseColumns();
        const reordered = [
            cols[2],
            {
                id: 2,
                name: 'buyer_id',
                type: IcebergType.STRING,
                required: false,
            },
            {
                id: 1,
                name: 'order_id',
                type: IcebergType.DOUBLE,
                required: true,
            },
            cols[3],
            {
                id: 5,
                name: 'shipping_address',
                type: IcebergType.struct([
                    {
                        id: 9,
                        name: 'city',
                        type: IcebergType.STRING,
                        required: true,
                    },
                    {
                        id: 8,
                        name: 'street',
                        type: IcebergType.STRING,
                        required: true,
                    },
                ]),
            },
            cols[5],
        ];
        const meta = baseMetadata();
        const fields = (meta.schemas as Array<{ fields: Array<Record<string, unknown>> }>)[0].fields;
        fields[0].type = 'float';
        fields[1].type = 'unknown';
        fields[1].required = false;
        expect(checker.checkFieldIds(synthTable(reordered, DAY_PARTITION), meta).problems).toEqual([]);
    });

    it('passes when dropping a column', () => {
        const cols = baseColumns().filter((c) => c.name !== 'tags');
        expect(checker.checkFieldIds(synthTable(cols, DAY_PARTITION), baseMetadata()).problems).toEqual([]);
    });

    it('passes when adding a partition field above last-partition-id', () => {
        const spec = [
            ...DAY_PARTITION,
            {
                sourceColumn: 'customer_id',
                transform: IcebergPartitionTransform.bucket(16),
                fieldId: 1001,
            },
        ];
        expect(checker.checkFieldIds(synthTable(baseColumns(), spec), baseMetadata()).problems).toEqual([]);
    });

    it('passes when reverting to an exact historical partition field and when table has no partition spec', () => {
        const evolvedMeta = baseMetadata({
            'last-partition-id': 1005,
            'partition-specs': [
                {
                    'spec-id': 0,
                },
                {
                    'spec-id': 1,
                    fields: [
                        {
                            name: 'placed_at_month',
                            'source-id': 3,
                            transform: 'month',
                            'field-id': 1005,
                        },
                        {
                            name: 'placed_at_day',
                            'source-id': 3,
                            transform: 'day',
                            'field-id': 1000,
                        },
                    ],
                },
            ],
        });
        expect(checker.checkFieldIds(BASE_TEMPLATE, evolvedMeta).problems).toEqual([]);

        const unpartitionedMeta = baseMetadata({
            'partition-specs': undefined,
            'last-partition-id': undefined,
        });
        expect(checker.checkFieldIds(synthTable(baseColumns()), unpartitionedMeta).problems).toEqual([]);
    });
});

describe('checkFieldIds — violations', () => {
    it('rejects reusing a dropped top-level column id', () => {
        const cols = baseColumns().filter((c) => c.id !== 2);
        cols.push({
            name: 'currency',
            type: IcebergType.STRING,
            id: 2,
        });
        const {
            problems,
        } = checker.checkFieldIds(synthTable(cols), metadataAfterDrop());
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("Field 'currency' reuses historical field id 2");
        expect(problems[0]).toContain("'customer_id'");
    });

    it('rejects reusing dropped nested struct, list, and map field ids', () => {
        const meta = baseMetadata({
            'last-column-id': 11,
            'current-schema-id': 1,
            schemas: [
                {
                    'schema-id': 0,
                    fields: baseMetadataFields(),
                },
                {
                    'schema-id': 1,
                    fields: [
                        {
                            id: 1,
                            name: 'order_id',
                            required: true,
                            type: 'long',
                        },
                    ],
                },
            ],
        });
        const template = synthTable([
            {
                name: 'order_id',
                type: IcebergType.LONG,
                required: true,
                id: 1,
            },
            {
                name: 'new_list',
                type: IcebergType.list({
                    element: IcebergType.STRING,
                    elementId: 7,
                }),
                id: 12,
            },
            {
                name: 'new_struct',
                type: IcebergType.struct([
                    {
                        id: 9,
                        name: 'postal_code',
                        type: IcebergType.STRING,
                    },
                ]),
                id: 13,
            },
            {
                name: 'new_map',
                type: IcebergType.map({
                    key: IcebergType.STRING,
                    keyId: 10,
                    value: IcebergType.STRING,
                    valueId: 11,
                }),
                id: 14,
            },
        ]);
        const {
            problems,
        } = checker.checkFieldIds(template, meta);
        expect(problems).toHaveLength(4);
        expect(problems[0]).toContain('new_list.element');
        expect(problems[1]).toContain('new_struct.postal_code');
        expect(problems[2]).toContain('new_map.key');
        expect(problems[3]).toContain('new_map.value');
    });

    it('rejects new top-level or nested field ids <= last-column-id', () => {
        const cols = baseColumns();
        cols[4] = {
            name: 'addr',
            type: IcebergType.struct([
                {
                    id: 8,
                    name: 'line1',
                    type: IcebergType.STRING,
                    required: true,
                },
                {
                    id: 9,
                    name: 'city',
                    type: IcebergType.STRING,
                    required: true,
                },
                {
                    id: 12,
                    name: 'zip',
                    type: IcebergType.STRING,
                },
            ]),
            id: 5,
        };
        cols.push({
            name: 'currency',
            type: IcebergType.STRING,
            id: 13,
        });
        const {
            problems,
        } = checker.checkFieldIds(synthTable(cols), baseMetadata({
            'last-column-id': 13,
        }));
        expect(problems).toHaveLength(2);
        expect(problems[0]).toContain("New field 'addr.zip' uses id 12 <= last-column-id (13)");
        expect(problems[1]).toContain("New field 'currency' uses id 13 <= last-column-id (13)");
    });

    it('rejects out-of-creation-order active id swaps (docs/field-ids.md example)', () => {
        const template = synthTable([
            {
                name: 'order_id',
                type: IcebergType.LONG,
                required: true,
                id: 1,
            },
            {
                name: 'tags',
                type: IcebergType.list({
                    element: IcebergType.STRING,
                    elementId: 2,
                }),
                id: 3,
            },
            {
                name: 'placed_at',
                type: IcebergType.TIMESTAMPTZ,
                id: 4,
            },
        ]);
        const glueOrderMeta = baseMetadata({
            'last-column-id': 4,
            schemas: [
                {
                    'schema-id': 0,
                    fields: [
                        {
                            id: 1,
                            name: 'order_id',
                            type: 'long',
                        },
                        {
                            id: 2,
                            name: 'tags',
                            type: {
                                type: 'list',
                                'element-id': 4,
                                element: 'string',
                            },
                        },
                        {
                            id: 3,
                            name: 'placed_at',
                            type: 'timestamptz',
                        },
                    ],
                },
            ],
            'partition-specs': [],
            'last-partition-id': 999,
        });
        const {
            problems,
        } = checker.checkFieldIds(template, glueOrderMeta);
        expect(problems).toHaveLength(3);
        expect(problems[0]).toContain('tags');
        expect(problems[1]).toContain('tags.element');
        expect(problems[2]).toContain('placed_at');
    });

    it('rejects moving an active nested id to top-level, swapping map key/value ids, or changing container kind', () => {
        const dropListReuseElement = baseColumns().filter((c) => c.id !== 4);
        dropListReuseElement.push({
            name: 'currency',
            type: IcebergType.STRING,
            id: 7,
        });
        expect(checker.checkFieldIds(synthTable(dropListReuseElement, DAY_PARTITION), baseMetadata()).problems[0])
            .toContain("Field 'currency' uses active field id 7");

        const swapMapAndMoveStructField = baseColumns();
        swapMapAndMoveStructField[4] = {
            name: 'addr',
            type: IcebergType.struct([
                {
                    id: 8,
                    name: 'line1',
                    type: IcebergType.STRING,
                    required: true,
                },
            ]),
            id: 5,
        };
        swapMapAndMoveStructField[5] = {
            name: 'attrs',
            type: IcebergType.map({
                key: IcebergType.STRING,
                keyId: 11,
                value: IcebergType.STRING,
                valueId: 10,
            }),
            id: 6,
        };
        swapMapAndMoveStructField.push({
            name: 'city',
            type: IcebergType.STRING,
            id: 9,
        });
        expect(checker.checkFieldIds(
            synthTable(swapMapAndMoveStructField, DAY_PARTITION),
            baseMetadata(),
        ).problems).toHaveLength(3);

        const kindMismatch = baseColumns();
        kindMismatch[3] = {
            name: 'tags',
            type: IcebergType.STRING,
            id: 4,
        };
        kindMismatch[1] = {
            name: 'customer_id',
            type: IcebergType.list({
                element: IcebergType.STRING,
                elementId: 12,
            }),
            id: 2,
        };
        const kindProblems = checker.checkFieldIds(synthTable(kindMismatch, DAY_PARTITION), baseMetadata()).problems;
        expect(kindProblems).toHaveLength(2);
        expect(kindProblems[0]).toContain("kind from 'primitive' to 'list'");
        expect(kindProblems[1]).toContain("kind from 'list' to 'primitive'");
    });

    it('rejects reusing a partition fieldId with a different transform or source column', () => {
        const diffTransform = synthTable(baseColumns(), [
            {
                sourceColumn: 'placed_at',
                transform: IcebergPartitionTransform.MONTH,
                fieldId: 1000,
            },
        ]);
        expect(checker.checkFieldIds(diffTransform, baseMetadata()).problems[0]).toContain('reuses fieldId 1000');

        const diffSource = synthTable(baseColumns(), [
            {
                sourceColumn: 'customer_id',
                transform: IcebergPartitionTransform.IDENTITY,
                fieldId: 1000,
            },
        ]);
        expect(checker.checkFieldIds(diffSource, baseMetadata()).problems[0]).toContain('reuses fieldId 1000');
    });

    it('rejects a new partition fieldId <= last-partition-id and detects stale last-partition-id', () => {
        const newLowId = synthTable(baseColumns(), [
            ...DAY_PARTITION,
            {
                sourceColumn: 'customer_id',
                transform: IcebergPartitionTransform.bucket(8),
                fieldId: 1001,
            },
        ]);
        expect(checker.checkFieldIds(newLowId, baseMetadata({
            'last-partition-id': 1002,
        })).problems[0]).toContain('fieldId 1001 <= last-partition-id (1002)');

        const staleResult = checker.checkFieldIds(BASE_TEMPLATE, baseMetadata({
            'last-partition-id': 999,
        }));
        expect(staleResult.problems).toHaveLength(1);
        expect(staleResult.problems[0]).toContain('Stale last-partition-id (999 < max historical field-id 1000)');
    });
});

describe('table selection and malformed inputs', () => {
    function multiTableTemplate(): Record<string, unknown> {
        const app = new App();
        const stack = new Stack(app, 'MultiStack', {
            env: {
                account: '123456789012',
                region: 'us-east-1',
            },
        });
        const database = new Database(stack, 'Db', {
            databaseName: 'analytics',
        });
        const param = new CfnParameter(stack, 'EventsTableParam', {
            default: 'events',
        });
        new IcebergTable(stack, 'OrdersTable', {
            database,
            tableName: 'orders',
            columns: [
                {
                    name: 'order_id',
                    type: IcebergType.LONG,
                    required: true,
                    id: 1,
                },
            ],
            location: 's3://test-bucket/analytics/orders/',
            formatVersion: IcebergFormatVersion.V2,
        });
        new IcebergTable(stack, 'EventsTable', {
            database,
            tableName: param.valueAsString,
            columns: [
                {
                    name: 'event_id',
                    type: IcebergType.STRING,
                    required: true,
                    id: 1,
                },
            ],
            location: 's3://test-bucket/analytics/events/',
            formatVersion: IcebergFormatVersion.V2,
        });
        new CfnTable(stack, 'LegacyHiveTable', {
            catalogId: '123456789012',
            databaseName: 'analytics',
            tableInput: {
                name: 'legacy',
            },
        });
        return Template.fromStack(stack).toJSON();
    }

    it('handles multi-table selection by Name, logical resource id, omitted --table, and unknown --table', () => {
        const tpl = multiTableTemplate();
        const resources = (tpl as { Resources: Record<string, { Type: string }> }).Resources;
        const eventsLogicalId = Object.keys(resources).find((k) => k.startsWith('EventsTable'))!;
        const simpleMeta = baseMetadata({
            'last-column-id': 1,
            schemas: [
                {
                    'schema-id': 0,
                    fields: [
                        {
                            id: 1,
                            name: 'order_id',
                            type: 'long',
                        },
                    ],
                },
            ],
            'partition-specs': [],
            'last-partition-id': 999,
        });

        expect(checker.checkFieldIds(tpl, simpleMeta).problems[0]).toContain('--table');
        expect(checker.checkFieldIds(tpl, simpleMeta, {
            tableName: 'orders',
        }).problems).toEqual([]);
        expect(checker.checkFieldIds(tpl, simpleMeta, {
            tableName: eventsLogicalId,
        }).problems).toEqual([]);

        const missing = checker.checkFieldIds(tpl, simpleMeta, {
            tableName: 'unknown_tbl',
        });
        expect(missing.problems[0]).toContain("Iceberg table 'unknown_tbl' not found");
        expect(missing.problems[0]).toContain('orders');
        expect(missing.problems[0]).toContain(eventsLogicalId);
    });

    it('reports zero tables and ambiguous table matches cleanly', () => {
        const emptyTpl = {
            Resources: {
                HiveOnly: {
                    Type: 'AWS::Glue::Table',
                    Properties: {
                        TableInput: {
                            Name: 'hive',
                        },
                    },
                },
            },
        };
        expect(checker.findIcebergTable(emptyTpl).problem).toContain('No AWS::Glue::Table Iceberg resources');

        const emptySchema = {
            Schema: {
                Fields: [],
            },
        };
        const dupTpl = {
            Resources: {
                ...rawTable(emptySchema, 'TableA', 'dup'),
                ...rawTable(emptySchema, 'TableB', ''),
            },
        };
        expect(checker.findIcebergTable(dupTpl).problem).toContain('TableB');
        expect(checker.findIcebergTable({
            Resources: {
                ...dupTpl.Resources,
                ...rawTable(emptySchema, 'TableC', 'dup'),
            },
        }, 'dup').problem).toContain("Multiple Iceberg tables match 'dup'");
        expect(checker.findIcebergTable(dupTpl, 'TableB').table.logicalId).toBe('TableB');
    });

    const singleCol = {
        Id: 1,
        Name: 'id',
        Type: 'long',
    };
    const tplCol = (Id: unknown, Name: unknown, Type: unknown) => ({
        Id,
        Name,
        Type,
    });
    const tplWith = (Fields: unknown, PartitionFields?: unknown) => rawTemplate(
        PartitionFields !== undefined
            ? {
                Schema: {
                    Fields,
                },
                PartitionSpec: {
                    Fields: PartitionFields,
                },
            }
            : {
                Schema: {
                    Fields,
                },
            },
    );
    const badType = (typeVal: unknown) => tplWith([
        tplCol(1, 'id', typeVal),
    ]);
    const badPart = (fields: unknown) => tplWith([
        singleCol,
    ], fields);
    const singleTpl = tplWith([
        singleCol,
    ]);
    const metaWith = (overrides: Record<string, unknown> = {}) => baseMetadata({
        'last-column-id': 1,
        schemas: [
            {
                'schema-id': 0,
                fields: [
                    {
                        id: 1,
                        name: 'id',
                        type: 'long',
                    },
                ],
            },
        ],
        'partition-specs': [],
        'last-partition-id': 999,
        ...overrides,
    });
    const metaNoFields = metaWith({
        schemas: [
            {
                'schema-id': 0,
            },
        ],
    });
    const metaHistMissingFields = metaWith({
        schemas: [
            {
                'schema-id': 0,
                fields: [
                    {
                        id: 1,
                        name: 'id',
                        type: 'long',
                    },
                ],
            },
            {
                'schema-id': 1,
            },
        ],
    });
    const metaNullSpecField = metaWith({
        'partition-specs': [
            {
                'spec-id': 0,
                fields: [
                    null,
                ],
            },
        ],
    });
    const dupPartitionFields = [
        {
            FieldId: 'x',
            SourceId: 1,
            Transform: 'day',
        },
        {
            FieldId: 1000,
            SourceId: 1,
            Transform: 'day',
            Name: 'p1',
        },
        {
            FieldId: 1000,
            SourceId: 1,
            Transform: 'month',
            Name: 'p2',
        },
    ];
    const onlyLastColMeta = {
        'last-column-id': 1,
    };
    const badCurrentSchemaId = metaWith({
        'current-schema-id': 9,
    });
    const missingSchemaFieldsTpl = rawTemplate({
        Schema: {},
    });
    const nonObjFieldTpl = tplWith([
        null,
    ]);
    const nonIntIdTpl = tplWith([
        tplCol('1', 'id', 'long'),
    ]);
    const dupIdTpl = tplWith([
        singleCol,
        tplCol(1, 'b', 'long'),
    ]);
    const badSpecsMeta = metaWith({
        'partition-specs': 'bad',
    });
    const nullSpecsMeta = metaWith({
        'partition-specs': [
            null,
        ],
    });
    const badLastPartMeta = metaWith({
        'last-partition-id': 'bad',
    });
    const nullPartTpl = badPart([
        null,
    ]);

    test.each`
        name                                           | tpl                       | meta                     | expected
        ${'non-object template'}                       | ${null}                   | ${metaWith()}            | ${'Invalid CloudFormation template'}
        ${'non-object metadata'}                       | ${singleTpl}              | ${null}                  | ${'Invalid Iceberg metadata'}
        ${'missing last-column-id'}                    | ${singleTpl}              | ${{}}                    | ${'last-column-id'}
        ${'missing schemas'}                           | ${singleTpl}              | ${onlyLastColMeta}       | ${'schemas'}
        ${'missing current-schema-id entry'}           | ${singleTpl}              | ${badCurrentSchemaId}    | ${'current-schema-id 9'}
        ${'current schema missing fields array'}       | ${singleTpl}              | ${metaNoFields}          | ${"missing 'fields' array"}
        ${'historical schema missing fields array'}    | ${singleTpl}              | ${metaHistMissingFields} | ${"entry missing 'fields' array"}
        ${'template missing Schema.Fields'}            | ${missingSchemaFieldsTpl} | ${metaWith()}            | ${"missing 'Schema.Fields'"}
        ${'malformed JSON type string'}                | ${badType('{bad')}        | ${metaWith()}            | ${'invalid JSON type'}
        ${'non-array nested struct fields'}            | ${badType('{"type":"struct","fields":"bad"}')} | ${metaWith()} | ${'must be an array'}
        ${'non-object nested struct field entry'}      | ${badType('{"type":"struct","fields":[null]}')} | ${metaWith()} | ${"under 'id.'"}
        ${'unsupported object type'}                   | ${badType('{"type":"unknown_container"}')} | ${metaWith()} | ${'unsupported object type'}
        ${'non-object entry in Schema.Fields'}         | ${nonObjFieldTpl}         | ${metaWith()}            | ${'non-object entry'}
        ${'non-integer field Id'}                      | ${nonIntIdTpl}            | ${metaWith()}            | ${'non-integer id'}
        ${'duplicate field Id'}                        | ${dupIdTpl}               | ${metaWith()}            | ${'duplicates field id 1'}
        ${'non-array partition-specs'}                 | ${singleTpl}              | ${badSpecsMeta}          | ${"'partition-specs' must be an array"}
        ${'malformed partition-specs entry'}           | ${singleTpl}              | ${nullSpecsMeta}         | ${'malformed spec entry'}
        ${'non-object partition-specs[].fields entry'} | ${singleTpl}              | ${metaNullSpecField}     | ${"partition spec 'fields' contains a non-object entry"}
        ${'non-integer last-partition-id'}             | ${singleTpl}              | ${badLastPartMeta}       | ${"non-integer 'last-partition-id'"}
        ${'non-array PartitionSpec.Fields'}            | ${badPart('bad')}         | ${metaWith()}            | ${"'PartitionSpec.Fields' must be an array"}
        ${'non-object PartitionSpec.Fields entry'}     | ${nullPartTpl}            | ${metaWith()}            | ${"'PartitionSpec.Fields' contains a non-object entry"}
        ${'non-integer and duplicate FieldId'}         | ${badPart(dupPartitionFields)} | ${metaWith()}       | ${'duplicates FieldId 1000'}
    `('reports $name cleanly without throwing', ({
        tpl, meta, expected,
    }) => {
        const {
            problems,
        } = checker.checkFieldIds(tpl, meta);
        expect(problems.some((p: string) => p.includes(expected))).toBe(true);
    });
});

describe('CLI execution', () => {
    let tmpDir: string;
    let templateFile: string;
    let metadataFile: string;
    let badTemplateFile: string;

    const run = (...args: string[]) => spawnSync('node', [
        SCRIPT,
        ...args,
    ], {
        encoding: 'utf8',
    });

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-field-ids-'));
        templateFile = path.join(tmpDir, 'template.json');
        metadataFile = path.join(tmpDir, 'metadata.json');
        badTemplateFile = path.join(tmpDir, 'bad-template.json');

        fs.writeFileSync(templateFile, JSON.stringify(BASE_TEMPLATE));
        fs.writeFileSync(metadataFile, JSON.stringify(baseMetadata()));
        fs.writeFileSync(badTemplateFile, JSON.stringify(synthTable([
            ...baseColumns().filter((c) => c.id !== 2),
            {
                name: 'reused',
                type: IcebergType.LONG,
                id: 2,
            },
        ])));
    });

    afterAll(() => {
        fs.rmSync(tmpDir, {
            recursive: true,
            force: true,
        });
    });

    it('exits 0 with empty stderr on a clean check', () => {
        expect(run(templateFile, metadataFile)).toMatchObject({
            status: 0,
            stderr: '',
        });
        expect(run('--table=orders', templateFile, metadataFile)).toMatchObject({
            status: 0,
            stderr: '',
        });
        expect(run(templateFile, metadataFile, '--table', 'orders')).toMatchObject({
            status: 0,
            stderr: '',
        });
    });

    it('exits 1 with violations on stderr when field-id reuse is detected', () => {
        const droppedMeta = path.join(tmpDir, 'dropped-metadata.json');
        fs.writeFileSync(droppedMeta, JSON.stringify(metadataAfterDrop()));
        const result = run(badTemplateFile, droppedMeta);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("Field 'reused' reuses historical field id 2");
    });

    it('exits 1 on missing files or invalid JSON', () => {
        const missing = run(path.join(tmpDir, 'missing.json'), metadataFile);
        expect(missing.status).toBe(1);
        expect(missing.stderr).toContain('Cannot read template');

        const badJson = path.join(tmpDir, 'bad.json');
        fs.writeFileSync(badJson, '{not-json');
        const invalid = run(badJson, metadataFile);
        expect(invalid.status).toBe(1);
        expect(invalid.stderr).toContain('Invalid JSON in template');
    });

    it('exits 2 with usage message on bad CLI arguments', () => {
        for (const badArgs of [
            [],
            [
                templateFile,
            ],
            [
                templateFile,
                metadataFile,
                'extra',
            ],
            [
                templateFile,
                metadataFile,
                '--table',
            ],
            [
                templateFile,
                metadataFile,
                '--table=',
            ],
            [
                templateFile,
                metadataFile,
                '--unknown',
            ],
        ]) {
            expect(run(...badArgs)).toMatchObject({
                status: 2,
                stderr: expect.stringContaining('usage: check-field-ids.js'),
            });
        }
    });
});
