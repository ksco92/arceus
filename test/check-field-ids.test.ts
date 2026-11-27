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

interface SynthTableOptions {
    readonly tableName?: string;
    readonly columns: IcebergColumn[];
    readonly partitionSpec?: IcebergPartitionField[];
}

function synthTable(opts: SynthTableOptions): Record<string, unknown> {
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
        tableName: opts.tableName ?? 'orders',
        columns: opts.columns,
        partitionSpec: opts.partitionSpec,
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

describe('collectFields', () => {
    it('collects top-level and nested ids from synthesized CloudFormation Schema.Fields', () => {
        const template = synthTable({
            columns: [
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
            ],
        }) as {
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

    it('supports synthetic PascalCase nested type objects and skips non-object field entries', () => {
        const collected = checker.collectFields([
            null,
            {
                Id: 1,
                Name: 'items',
                Type: {
                    Type: 'list',
                    ElementId: 2,
                    Element: {
                        Type: 'map',
                        KeyId: 3,
                        Key: 'string',
                        ValueId: 4,
                        Value: {
                            Type: 'struct',
                            Fields: [
                                {
                                    Id: 5,
                                    Name: 'code',
                                    Type: 'int',
                                },
                            ],
                        },
                    },
                },
            },
            {
                Id: 6,
                Name: 123,
                Type: null,
            },
        ]);
        expect(collected).toEqual([
            {
                id: 1,
                path: 'items',
            },
            {
                id: 2,
                path: 'items.element',
            },
            {
                id: 3,
                path: 'items.element.key',
            },
            {
                id: 4,
                path: 'items.element.value',
            },
            {
                id: 5,
                path: 'items.element.value.code',
            },
            {
                id: 6,
                path: '',
            },
        ]);
    });
});

describe('checkFieldIds — safe updates on synthesized IcebergTable', () => {
    it('passes on an unchanged table with nested fields and partitions', () => {
        const template = synthTable({
            columns: baseColumns(),
            partitionSpec: [
                {
                    sourceColumn: 'placed_at',
                    transform: IcebergPartitionTransform.DAY,
                    fieldId: 1000,
                },
            ],
        });
        expect(checker.checkFieldIds(template, baseMetadata()).problems).toEqual([]);
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
        const template = synthTable({
            columns: cols,
            partitionSpec: [
                {
                    sourceColumn: 'placed_at',
                    transform: IcebergPartitionTransform.DAY,
                    fieldId: 1000,
                },
            ],
        });
        expect(checker.checkFieldIds(template, baseMetadata()).problems).toEqual([]);
    });

    it('passes when renaming an existing column or nested field while keeping its active id', () => {
        const cols = baseColumns();
        cols[1] = {
            ...cols[1],
            name: 'buyer_id',
        };
        cols[4] = {
            name: 'addr',
            type: IcebergType.struct([
                {
                    id: 8,
                    name: 'street',
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
        };
        const template = synthTable({
            columns: cols,
            partitionSpec: [
                {
                    sourceColumn: 'placed_at',
                    transform: IcebergPartitionTransform.DAY,
                    fieldId: 1000,
                },
            ],
        });
        expect(checker.checkFieldIds(template, baseMetadata()).problems).toEqual([]);
    });

    it('passes when dropping a column', () => {
        const cols = baseColumns().filter((c) => c.name !== 'tags');
        const template = synthTable({
            columns: cols,
            partitionSpec: [
                {
                    sourceColumn: 'placed_at',
                    transform: IcebergPartitionTransform.DAY,
                    fieldId: 1000,
                },
            ],
        });
        expect(checker.checkFieldIds(template, baseMetadata()).problems).toEqual([]);
    });

    it('passes when adding a partition field above last-partition-id', () => {
        const template = synthTable({
            columns: baseColumns(),
            partitionSpec: [
                {
                    sourceColumn: 'placed_at',
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
        expect(checker.checkFieldIds(template, baseMetadata()).problems).toEqual([]);
    });

    it('passes when reverting to an exact historical partition field and when table has no partition spec', () => {
        const template = synthTable({
            columns: baseColumns(),
            partitionSpec: [
                {
                    sourceColumn: 'placed_at',
                    transform: IcebergPartitionTransform.DAY,
                    fieldId: 1000,
                },
            ],
        });
        const evolvedMeta = baseMetadata({
            'last-partition-id': 1001,
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
                {
                    'spec-id': 1,
                    fields: [
                        {
                            name: 'placed_at_month',
                            'source-id': 3,
                            transform: 'month',
                            'field-id': 1001,
                        },
                    ],
                },
            ],
        });
        expect(checker.checkFieldIds(template, evolvedMeta).problems).toEqual([]);

        const unpartitionedTemplate = synthTable({
            columns: baseColumns(),
        });
        const unpartitionedMeta = baseMetadata({
            'partition-specs': undefined,
            'last-partition-id': undefined,
        });
        expect(checker.checkFieldIds(unpartitionedTemplate, unpartitionedMeta).problems).toEqual([]);
    });
});

describe('checkFieldIds — violations', () => {
    function metadataAfterDrop(): Record<string, unknown> {
        const schema0Fields = baseMetadataFields();
        const schema1Fields = schema0Fields.filter((f) => (f as { id: number }).id !== 2);
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
                    fields: schema1Fields,
                },
            ],
        });
    }

    it('rejects reusing a dropped top-level column id', () => {
        const cols = baseColumns().filter((c) => c.id !== 2);
        cols.push({
            name: 'currency',
            type: IcebergType.STRING,
            id: 2,
        });
        const template = synthTable({
            columns: cols,
        });
        const {
            problems,
        } = checker.checkFieldIds(template, metadataAfterDrop());
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("Field 'currency' reuses historical field id 2");
        expect(problems[0]).toContain("'customer_id'");
    });

    it('rejects reusing dropped nested struct, list, and map field ids', () => {
        const schema0Fields = baseMetadataFields();
        const schema1Fields = [
            {
                id: 1,
                name: 'order_id',
                required: true,
                type: 'long',
            },
        ];
        const meta = baseMetadata({
            'last-column-id': 11,
            'current-schema-id': 1,
            schemas: [
                {
                    'schema-id': 0,
                    fields: schema0Fields,
                },
                {
                    'schema-id': 1,
                    fields: schema1Fields,
                },
            ],
        });
        const template = synthTable({
            columns: [
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
            ],
        });
        const {
            problems,
        } = checker.checkFieldIds(template, meta);
        expect(problems).toHaveLength(4);
        expect(problems[0]).toContain('new_list.element');
        expect(problems[0]).toContain('tags.element');
        expect(problems[1]).toContain('new_struct.postal_code');
        expect(problems[1]).toContain('addr.city');
        expect(problems[2]).toContain('new_map.key');
        expect(problems[2]).toContain('attrs.key');
        expect(problems[3]).toContain('new_map.value');
        expect(problems[3]).toContain('attrs.value');
    });

    it('rejects a new field whose id is <= last-column-id when not in schemas (e.g. bumped counter)', () => {
        const cols = baseColumns();
        cols.push({
            name: 'currency',
            type: IcebergType.STRING,
            id: 12,
        });
        const template = synthTable({
            columns: cols,
        });
        const meta = baseMetadata({
            'last-column-id': 12,
        });
        const {
            problems,
        } = checker.checkFieldIds(template, meta);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("New field 'currency' uses id 12 <= last-column-id (12)");
    });

    it('rejects reusing a partition fieldId with a different transform or source column', () => {
        const diffTransform = synthTable({
            columns: baseColumns(),
            partitionSpec: [
                {
                    sourceColumn: 'placed_at',
                    transform: IcebergPartitionTransform.MONTH,
                    fieldId: 1000,
                },
            ],
        });
        const transformResult = checker.checkFieldIds(diffTransform, baseMetadata());
        expect(transformResult.problems).toHaveLength(1);
        expect(transformResult.problems[0]).toContain('reuses fieldId 1000');

        const diffSource = synthTable({
            columns: baseColumns(),
            partitionSpec: [
                {
                    sourceColumn: 'customer_id',
                    transform: IcebergPartitionTransform.IDENTITY,
                    fieldId: 1000,
                },
            ],
        });
        const sourceResult = checker.checkFieldIds(diffSource, baseMetadata());
        expect(sourceResult.problems).toHaveLength(1);
        expect(sourceResult.problems[0]).toContain('reuses fieldId 1000');
    });

    it('rejects a new partition fieldId <= last-partition-id and detects stale last-partition-id', () => {
        const rolledBackMeta = baseMetadata({
            'last-partition-id': 1002,
        });
        const newLowId = synthTable({
            columns: baseColumns(),
            partitionSpec: [
                {
                    sourceColumn: 'placed_at',
                    transform: IcebergPartitionTransform.DAY,
                    fieldId: 1000,
                },
                {
                    sourceColumn: 'customer_id',
                    transform: IcebergPartitionTransform.bucket(8),
                    fieldId: 1001,
                },
            ],
        });
        const lowResult = checker.checkFieldIds(newLowId, rolledBackMeta);
        expect(lowResult.problems).toHaveLength(1);
        expect(lowResult.problems[0]).toContain('fieldId 1001 <= last-partition-id (1002)');

        const staleMeta = baseMetadata({
            'last-partition-id': 999,
        });
        const cleanTemplate = synthTable({
            columns: baseColumns(),
            partitionSpec: [
                {
                    sourceColumn: 'placed_at',
                    transform: IcebergPartitionTransform.DAY,
                    fieldId: 1000,
                },
            ],
        });
        const staleResult = checker.checkFieldIds(cleanTemplate, staleMeta);
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

        const dupTpl = {
            Resources: {
                TableA: {
                    Type: 'AWS::Glue::Table',
                    Properties: {
                        Name: 'dup',
                        OpenTableFormatInput: {
                            IcebergInput: {
                                IcebergTableInput: {
                                    Schema: {
                                        Fields: [],
                                    },
                                },
                            },
                        },
                    },
                },
                TableB: {
                    Type: 'AWS::Glue::Table',
                    Properties: {
                        Name: 'dup',
                        OpenTableFormatInput: {
                            IcebergInput: {
                                IcebergTableInput: {
                                    Schema: {
                                        Fields: [],
                                    },
                                },
                            },
                        },
                    },
                },
            },
        };
        expect(checker.findIcebergTable(dupTpl, 'dup').problem).toContain("Multiple Iceberg tables match 'dup'");
        expect(checker.findIcebergTable(dupTpl, 'TableB').table.logicalId).toBe('TableB');
    });

    it('reports malformed template and metadata structures without throwing', () => {
        const singleTpl = synthTable({
            columns: [
                {
                    name: 'id',
                    type: IcebergType.LONG,
                    id: 1,
                },
            ],
        });
        expect(checker.checkFieldIds(null, baseMetadata()).problems[0]).toContain('Invalid CloudFormation template');
        expect(checker.checkFieldIds(singleTpl, null).problems[0]).toContain('Invalid Iceberg metadata');
        expect(checker.checkFieldIds(singleTpl, {}).problems[0]).toContain('last-column-id');
        expect(checker.checkFieldIds(singleTpl, {
            'last-column-id': 1,
        }).problems[0]).toContain('schemas');
        expect(checker.checkFieldIds(singleTpl, {
            'last-column-id': 1,
            'current-schema-id': 9,
            schemas: [
                {
                    'schema-id': 0,
                    fields: [],
                },
            ],
        }).problems[0]).toContain('current-schema-id 9');

        const badTemplate = {
            Resources: {
                Tbl: {
                    Type: 'AWS::Glue::Table',
                    Properties: {
                        Name: 't',
                        OpenTableFormatInput: {
                            IcebergInput: {
                                IcebergTableInput: {
                                    Schema: {
                                        Fields: [
                                            {
                                                Id: '1',
                                                Name: 'a',
                                                Type: 'long',
                                            },
                                            {
                                                Id: 1,
                                                Name: 'b',
                                                Type: 'long',
                                            },
                                            {
                                                Id: 1,
                                                Name: 'c',
                                                Type: 'long',
                                            },
                                        ],
                                    },
                                    PartitionSpec: {
                                        Fields: [
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
                                        ],
                                    },
                                },
                            },
                        },
                    },
                },
            },
        };
        const badMeta = baseMetadata({
            'last-column-id': 1,
            schemas: [
                {
                    'schema-id': 0,
                    fields: [
                        {
                            id: 1,
                            name: 'b',
                            type: 'long',
                        },
                    ],
                },
            ],
            'partition-specs': [
                {
                    'spec-id': 0,
                    fields: [],
                },
            ],
            'last-partition-id': 999,
        });
        const badResult = checker.checkFieldIds(badTemplate, badMeta);
        expect(badResult.problems).toHaveLength(4);

        expect(checker.checkFieldIds({
            Resources: {
                Tbl: {
                    Type: 'AWS::Glue::Table',
                    Properties: {
                        Name: 't',
                        OpenTableFormatInput: {
                            IcebergInput: {
                                IcebergTableInput: {
                                    Schema: {},
                                },
                            },
                        },
                    },
                },
            },
        }, {
            'last-column-id': 1,
            'current-schema-id': 0,
            schemas: [
                {
                    'schema-id': 0,
                    fields: [],
                },
            ],
            'partition-specs': 'bad',
        }).problems).toHaveLength(2);

        expect(checker.checkFieldIds({
            Resources: {
                Tbl: {
                    Type: 'AWS::Glue::Table',
                    Properties: {
                        Name: 't',
                        OpenTableFormatInput: {
                            IcebergInput: {
                                IcebergTableInput: {
                                    Schema: {
                                        Fields: [],
                                    },
                                    PartitionSpec: {
                                        Fields: 'bad',
                                    },
                                },
                            },
                        },
                    },
                },
            },
        }, {
            'last-column-id': 1,
            'current-schema-id': 0,
            schemas: [
                {
                    'schema-id': 0,
                    fields: [],
                },
            ],
            'partition-specs': [],
        }).problems).toHaveLength(1);

        expect(checker.checkFieldIds(singleTpl, {
            'last-column-id': 1,
            'current-schema-id': 0,
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
            'last-partition-id': 'bad',
        }).problems[0]).toContain("non-integer 'last-partition-id'");
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

        fs.writeFileSync(templateFile, JSON.stringify(synthTable({
            columns: baseColumns(),
            partitionSpec: [
                {
                    sourceColumn: 'placed_at',
                    transform: IcebergPartitionTransform.DAY,
                    fieldId: 1000,
                },
            ],
        })));
        fs.writeFileSync(metadataFile, JSON.stringify(baseMetadata()));
        fs.writeFileSync(badTemplateFile, JSON.stringify(synthTable({
            columns: [
                ...baseColumns().filter((c) => c.id !== 2),
                {
                    name: 'reused',
                    type: IcebergType.LONG,
                    id: 2,
                },
            ],
        })));
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
        fs.writeFileSync(droppedMeta, JSON.stringify(baseMetadata({
            'current-schema-id': 1,
            schemas: [
                {
                    'schema-id': 0,
                    fields: baseMetadataFields(),
                },
                {
                    'schema-id': 1,
                    fields: baseMetadataFields().filter((f) => (f as { id: number }).id !== 2),
                },
            ],
        })));
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
