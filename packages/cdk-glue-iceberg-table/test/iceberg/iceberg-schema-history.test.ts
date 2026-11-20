import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    App,
    Stack,
} from 'aws-cdk-lib';
import {
    Database,
} from 'aws-cdk-lib/aws-glue';
import {
    IcebergColumn,
    IcebergFormatVersion,
    IcebergPartitionField,
    IcebergPartitionTransform,
    IcebergSchemaHistory,
    IcebergSchemaHistoryFile,
    IcebergSchemaViolationKind,
    IcebergTable,
    IcebergTableHistory,
    IcebergTableSchema,
    IcebergType,
} from '../../lib/iceberg';

function column(name: string, id: number, type: IcebergType = IcebergType.STRING, required = false): IcebergColumn {
    return {
        name,
        id,
        type,
        required: required || undefined,
    };
}

function partition(sourceColumn: string, transform: IcebergPartitionTransform, fieldId: number): IcebergPartitionField {
    return {
        sourceColumn,
        transform,
        fieldId,
    };
}

/** History of table `t` after recording each definition in turn. */
function recorded(...definitions: IcebergTableSchema[]): IcebergTableHistory {
    const history = definitions.reduce(
        (acc: IcebergSchemaHistoryFile, definition) => IcebergSchemaHistory.append(acc, 't', definition),
        {
            tables: [],
        },
    );
    return history.tables[0];
}

function kinds(previous: IcebergTableHistory, next: IcebergTableSchema): IcebergSchemaViolationKind[] {
    return IcebergSchemaHistory.validateSchemaEvolution(previous, next).map((violation) => violation.kind);
}

function reused(id: number, oldPath: string, detail: string, newPath: string): string {
    return `field id ${id} belonged to '${oldPath}', ${detail}, and is reused by '${newPath}'; `
        + `give '${newPath}' an id the table has never used`;
}

function changed(fieldPath: string, from: number, to: number): string {
    return `field '${fieldPath}' changed id from ${from} to ${to}; keep id ${from}, `
        + 'or record the field as dropped before adding it under a new id';
}

function messages(previous: IcebergTableHistory, next: IcebergTableSchema): string[] {
    return IcebergSchemaHistory.validateSchemaEvolution(previous, next).map((violation) => violation.message);
}

const NESTED: IcebergTableSchema = {
    columns: [
        column('id', 1, IcebergType.LONG, true),
        column('tags', 2, IcebergType.list({
            element: IcebergType.STRING,
            elementId: 5,
        })),
        column('attrs', 3, IcebergType.map({
            key: IcebergType.STRING,
            keyId: 6,
            value: IcebergType.STRING,
            valueId: 7,
        })),
        column('addr', 4, IcebergType.struct([
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
        ])),
        column('placed_at', 10, IcebergType.TIMESTAMPTZ, true),
    ],
    partitionSpec: [
        partition('placed_at', IcebergPartitionTransform.DAY, 1000),
    ],
};

describe('IcebergSchemaHistory.validateSchemaEvolution', () => {
    it('reports nothing for an unchanged definition', () => {
        expect(kinds(recorded(NESTED), NESTED)).toEqual([]);
    });

    it.each([
        [
            IcebergType.INT,
            IcebergType.LONG,
        ],
        [
            IcebergType.FLOAT,
            IcebergType.DOUBLE,
        ],
        [
            IcebergType.decimal(10, 2),
            IcebergType.decimal(12, 2),
        ],
    ])('allows the promotion %p to %p', (from, to) => {
        expect(kinds(recorded({
            columns: [
                column('c', 1, from),
            ],
        }), {
            columns: [
                column('c', 1, to),
            ],
        })).toEqual([]);
    });

    it.each([
        [
            IcebergType.LONG,
            IcebergType.INT,
        ],
        [
            IcebergType.FLOAT,
            IcebergType.LONG,
        ],
        [
            IcebergType.INT,
            IcebergType.DOUBLE,
        ],
        [
            IcebergType.decimal(10, 2),
            IcebergType.decimal(12, 3),
        ],
        [
            IcebergType.decimal(12, 2),
            IcebergType.decimal(10, 2),
        ],
        [
            IcebergType.STRING,
            IcebergType.decimal(10, 2),
        ],
        [
            IcebergType.decimal(10, 2),
            IcebergType.STRING,
        ],
        [
            IcebergType.STRING,
            IcebergType.struct([
                {
                    id: 2,
                    name: 'x',
                    type: IcebergType.STRING,
                },
            ]),
        ],
    ])('reports the type change %p to %p', (from, to) => {
        expect(kinds(recorded({
            columns: [
                column('c', 1, from),
            ],
        }), {
            columns: [
                column('c', 1, to),
            ],
        })).toEqual([
            IcebergSchemaViolationKind.TYPE_CHANGED,
        ]);
    });

    it('reports a nested field type change with its path and both types', () => {
        expect(messages(recorded(NESTED), {
            columns: NESTED.columns.map((c) => (c.id !== 2 ? c : column('tags', 2, IcebergType.list({
                element: IcebergType.LONG,
                elementId: 5,
            })))),
            partitionSpec: NESTED.partitionSpec,
        })).toEqual([
            "field 'tags.element' (id 5) changed type from string to long; "
            + 'this check allows only int to long, float to double, and a wider decimal precision at the same scale',
        ]);
    });

    it('reports an optional field that became required', () => {
        expect(messages(recorded({
            columns: [
                column('c', 1),
            ],
        }), {
            columns: [
                column('c', 1, IcebergType.STRING, true),
            ],
        })).toEqual([
            "field 'c' (id 1) changed from optional to required; keep it optional",
        ]);
    });

    it('allows a required field to become optional', () => {
        expect(kinds(recorded({
            columns: [
                column('c', 1, IcebergType.STRING, true),
            ],
        }), {
            columns: [
                column('c', 1),
            ],
        })).toEqual([]);
    });

    it('allows a rename that keeps the id', () => {
        expect(kinds(recorded(NESTED), {
            columns: NESTED.columns.map((c) => (c.id !== 4 ? c : {
                ...c,
                name: 'address',
            })),
            partitionSpec: NESTED.partitionSpec,
        })).toEqual([]);
    });

    it('reports a dropped field id given to a new field', () => {
        const history = recorded({
            columns: [
                column('a', 1),
                column('b', 2),
            ],
        }, {
            columns: [
                column('a', 1),
            ],
        });
        expect(messages(history, {
            columns: [
                column('a', 1),
                column('c', 2),
            ],
        })).toEqual([
            "field id 2 belonged to 'b', which was dropped, and is reused by 'c'; give 'c' an id the table has never used",
        ]);
    });

    it('reports only the reuse when the reusing field has another type and is required', () => {
        const history = recorded({
            columns: [
                column('a', 1),
                column('b', 2),
            ],
        }, {
            columns: [
                column('a', 1),
            ],
        });
        expect(kinds(history, {
            columns: [
                column('a', 1),
                column('c', 2, IcebergType.LONG, true),
            ],
        })).toEqual([
            IcebergSchemaViolationKind.FIELD_ID_REUSED,
        ]);
    });

    it('reports a dropped field id brought back under its old path', () => {
        const history = recorded({
            columns: [
                column('a', 1),
                column('b', 2),
            ],
        }, {
            columns: [
                column('a', 1),
            ],
        });
        expect(kinds(history, {
            columns: [
                column('a', 1),
                column('b', 2),
            ],
        })).toEqual([
            IcebergSchemaViolationKind.FIELD_ID_REUSED,
        ]);
    });

    it('reports an id moved to another field while its old path stays under a new id', () => {
        expect(messages(recorded({
            columns: [
                column('a', 1),
                column('b', 2),
            ],
        }), {
            columns: [
                column('a', 3),
                column('b', 2),
                column('c', 1),
            ],
        })).toEqual([
            reused(1, 'a', 'which now has id 3', 'c'),
            changed('a', 1, 3),
        ]);
    });

    it('reports a field whose path stayed but whose id changed', () => {
        expect(messages(recorded(NESTED), {
            columns: NESTED.columns.map((c) => (c.id !== 4 ? c : column('addr', 4, IcebergType.struct([
                {
                    id: 8,
                    name: 'line1',
                    type: IcebergType.STRING,
                },
                {
                    id: 11,
                    name: 'city',
                    type: IcebergType.STRING,
                },
            ])))),
            partitionSpec: NESTED.partitionSpec,
        })).toEqual([
            changed('addr.city', 9, 11),
        ]);
    });

    it('allows a column dropped in an earlier record to return under its name with a new id', () => {
        const history = recorded({
            columns: [
                column('a', 1),
                column('b', 2),
            ],
        }, {
            columns: [
                column('a', 1),
            ],
        });
        expect(kinds(history, {
            columns: [
                column('a', 1),
                column('b', 3),
            ],
        })).toEqual([]);
    });

    it('reports nested ids 4, 5, 6 renumbered to 5, 6, 7 after an added column', () => {
        const nested = (first: number): IcebergColumn => column('addr', 3, IcebergType.struct([
            {
                id: first,
                name: 'line1',
                type: IcebergType.STRING,
            },
            {
                id: first + 1,
                name: 'city',
                type: IcebergType.STRING,
            },
            {
                id: first + 2,
                name: 'zip',
                type: IcebergType.STRING,
            },
        ]));
        const history = recorded({
            columns: [
                column('id', 1, IcebergType.LONG, true),
                column('name', 2),
                nested(4),
            ],
        });
        const found = IcebergSchemaHistory.validateSchemaEvolution(history, {
            columns: [
                column('id', 1, IcebergType.LONG, true),
                column('name', 2),
                nested(5),
                column('note', 4),
            ],
        });
        expect(found.map((violation) => violation.message)).toEqual([
            reused(4, 'addr.line1', 'which now has id 5', 'note'),
            reused(5, 'addr.city', 'which now has id 6', 'addr.line1'),
            reused(6, 'addr.zip', 'which now has id 7', 'addr.city'),
            changed('addr.line1', 4, 5),
            changed('addr.city', 5, 6),
            changed('addr.zip', 6, 7),
        ]);
    });

    it('reports a dropped column that a partition field no longer in the spec was sourced from', () => {
        const history = recorded({
            columns: [
                column('a', 1),
                column('region', 2),
            ],
            partitionSpec: [
                partition('region', IcebergPartitionTransform.IDENTITY, 1000),
            ],
        }, {
            columns: [
                column('a', 1),
                column('region', 2),
            ],
        });
        expect(messages(history, {
            columns: [
                column('a', 1),
            ],
        })).toEqual([
            "column 'region' (id 2) is dropped, but a recorded partition spec is sourced from it; keep the column in the schema",
        ]);
    });

    it('allows dropping a column no partition field was sourced from', () => {
        expect(kinds(recorded({
            columns: [
                column('a', 1),
                column('b', 2),
            ],
            partitionSpec: [
                partition('a', IcebergPartitionTransform.IDENTITY, 1000),
            ],
        }), {
            columns: [
                column('a', 1),
            ],
            partitionSpec: [
                partition('a', IcebergPartitionTransform.IDENTITY, 1000),
            ],
        })).toEqual([]);
    });

    it('does not report a partition source column the history already records as dropped', () => {
        const history: IcebergTableHistory = {
            tableName: 't',
            fields: [
                {
                    id: 1,
                    path: 'a',
                    type: 'string',
                    required: false,
                    dropped: false,
                },
                {
                    id: 2,
                    path: 'region',
                    type: 'string',
                    required: false,
                    dropped: true,
                },
            ],
            partitionFields: [
                {
                    fieldId: 1000,
                    name: 'region',
                    sourceId: 2,
                    transform: 'identity',
                },
            ],
        };
        expect(kinds(history, {
            columns: [
                column('a', 1),
            ],
        })).toEqual([]);
    });

    it('reports a partition field that changed transform while keeping its id', () => {
        expect(messages(recorded(NESTED), {
            columns: NESTED.columns,
            partitionSpec: [
                partition('placed_at', IcebergPartitionTransform.MONTH, 1000),
            ],
        })).toEqual([
            'partition field id 1000 was day of source id 10 and is now month of source id 10; '
            + 'a changed partition field takes a fieldId no partition field has used',
        ]);
    });

    it('reports a partition field that changed source while keeping its id', () => {
        const columns = [
            column('a', 1),
            column('b', 2),
        ];
        expect(kinds(recorded({
            columns,
            partitionSpec: [
                partition('a', IcebergPartitionTransform.IDENTITY, 1000),
            ],
        }), {
            columns,
            partitionSpec: [
                partition('b', IcebergPartitionTransform.IDENTITY, 1000),
            ],
        })).toEqual([
            IcebergSchemaViolationKind.PARTITION_FIELD_CHANGED,
        ]);
    });

    it('reports a retired partition field id given to a different partition field', () => {
        const history = recorded(NESTED, {
            columns: NESTED.columns,
        });
        expect(kinds(history, {
            columns: NESTED.columns,
            partitionSpec: [
                partition('id', IcebergPartitionTransform.bucket(8), 1000),
            ],
        })).toEqual([
            IcebergSchemaViolationKind.PARTITION_FIELD_CHANGED,
        ]);
    });

    it('allows a renamed partition field and a retired identical partition field returning under its id', () => {
        const history = recorded(NESTED, {
            columns: NESTED.columns,
        });
        expect(kinds(history, {
            columns: NESTED.columns,
            partitionSpec: [
                {
                    ...partition('placed_at', IcebergPartitionTransform.DAY, 1000),
                    name: 'day',
                },
            ],
        })).toEqual([]);
    });

    it('tracks a field named __proto__ like any other field', () => {
        const history = recorded({
            columns: [
                column('__proto__', 1),
            ],
        });
        expect(history.fields.map((field) => field.path)).toEqual([
            '__proto__',
        ]);
        expect(messages(history, {
            columns: [
                column('__proto__', 2),
            ],
        })).toEqual([
            changed('__proto__', 1, 2),
        ]);
    });

    it('rejects an invalid definition before comparing', () => {
        expect(() => IcebergSchemaHistory.validateSchemaEvolution(recorded(NESTED), {
            columns: [
                column('a', 1),
                column('b', 1),
            ],
        })).toThrow(/duplicate field id 1/);
    });

    it.each([
        [
            'a partition source column missing from the columns',
            partition('missing', IcebergPartitionTransform.IDENTITY, 1000),
            "partitionSpec references unknown column 'missing'",
        ],
        [
            'a duplicate partition fieldId',
            partition('id', IcebergPartitionTransform.bucket(8), 1000),
            "duplicate partition fieldId 1000 on partition field 'id_bucket'",
        ],
    ])('rejects %s with the partition validator message', (_, invalid, message) => {
        expect(() => IcebergSchemaHistory.validateSchemaEvolution(recorded(NESTED), {
            columns: NESTED.columns,
            partitionSpec: [
                ...NESTED.partitionSpec!,
                invalid,
            ],
        })).toThrow(message);
    });

    it.each([
        [
            'tags.element',
            5,
            (required: boolean) => column('tags', 2, IcebergType.list({
                element: IcebergType.STRING,
                elementId: 5,
                elementRequired: required,
            })),
        ],
        [
            'attrs.value',
            7,
            (required: boolean) => column('attrs', 3, IcebergType.map({
                key: IcebergType.STRING,
                keyId: 6,
                value: IcebergType.STRING,
                valueId: 7,
                valueRequired: required,
            })),
        ],
        [
            'addr.city',
            9,
            (required: boolean) => column('addr', 4, IcebergType.struct([
                {
                    id: 9,
                    name: 'city',
                    type: IcebergType.STRING,
                    required,
                },
            ])),
        ],
    ])('reports the nested field %s becoming required', (fieldPath, id, build) => {
        expect(messages(recorded({
            columns: [
                build(false),
            ],
        }), {
            columns: [
                build(true),
            ],
        })).toEqual([
            `field '${fieldPath}' (id ${id}) changed from optional to required; keep it optional`,
        ]);
    });

    it('records a map key as required', () => {
        expect(recorded(NESTED).fields.find((field) => field.path === 'attrs.key')?.required).toBe(true);
    });
});

describe('IcebergSchemaHistory.append and toJson', () => {
    const DEFINITION: IcebergTableSchema = {
        columns: [
            column('id', 1, IcebergType.LONG, true),
            column('tags', 2, IcebergType.list({
                element: IcebergType.decimal(10, 2),
                elementId: 3,
            })),
        ],
        partitionSpec: [
            partition('id', IcebergPartitionTransform.bucket(16), 1000),
        ],
    };

    it('serializes with fixed key order, two-space indent and a trailing newline', () => {
        expect(IcebergSchemaHistory.toJson(IcebergSchemaHistory.append({
            tables: [],
        }, 'orders', DEFINITION))).toBe(`{
  "tables": [
    {
      "tableName": "orders",
      "fields": [
        {
          "id": 1,
          "path": "id",
          "type": "long",
          "required": true,
          "dropped": false
        },
        {
          "id": 2,
          "path": "tags",
          "type": "list",
          "required": false,
          "dropped": false
        },
        {
          "id": 3,
          "path": "tags.element",
          "type": "decimal(10, 2)",
          "required": false,
          "dropped": false
        }
      ],
      "partitionFields": [
        {
          "fieldId": 1000,
          "name": "id_bucket",
          "sourceId": 1,
          "transform": "bucket[16]"
        }
      ]
    }
  ]
}
`);
    });

    it('sorts fields and partition fields given in reverse order', () => {
        const sorted = IcebergSchemaHistory.append({
            tables: [],
        }, 'orders', DEFINITION);
        const table = sorted.tables[0];
        const reversed: IcebergSchemaHistoryFile = {
            tables: [
                {
                    tableName: table.tableName,
                    fields: [
                        ...table.fields,
                    ].reverse(),
                    partitionFields: [
                        ...table.partitionFields,
                        {
                            fieldId: 1001,
                            name: 'id',
                            sourceId: 1,
                            transform: 'identity',
                        },
                    ].reverse(),
                },
            ],
        };
        expect(IcebergSchemaHistory.toJson(reversed)).toBe(IcebergSchemaHistory.toJson({
            tables: [
                {
                    ...table,
                    partitionFields: [
                        ...table.partitionFields,
                        reversed.tables[0].partitionFields[0],
                    ],
                },
            ],
        }));
    });

    it('produces byte-identical JSON when the same definition is appended twice', () => {
        const once = IcebergSchemaHistory.append({
            tables: [],
        }, 'orders', DEFINITION);
        const twice = IcebergSchemaHistory.append(once, 'orders', DEFINITION);
        expect(IcebergSchemaHistory.toJson(twice)).toBe(IcebergSchemaHistory.toJson(once));
    });

    it('keeps dropped fields and retired partition fields, sorted by id', () => {
        const history = recorded(DEFINITION, {
            columns: [
                column('id', 1, IcebergType.LONG, true),
                column('a', 7),
            ],
            partitionSpec: [
                partition('a', IcebergPartitionTransform.IDENTITY, 1002),
                partition('id', IcebergPartitionTransform.bucket(8), 1001),
            ],
        });
        expect(history.fields.map((field) => [
            field.id,
            field.dropped,
        ])).toEqual([
            [
                1,
                false,
            ],
            [
                2,
                true,
            ],
            [
                3,
                true,
            ],
            [
                7,
                false,
            ],
        ]);
        expect(history.partitionFields.map((field) => field.fieldId)).toEqual([
            1000,
            1001,
            1002,
        ]);
    });

    it('orders tables by name and leaves other tables untouched', () => {
        const history = [
            'b',
            'a',
            'b',
        ].reduce(
            (acc: IcebergSchemaHistoryFile, name) => IcebergSchemaHistory.append(acc, name, DEFINITION),
            {
                tables: [],
            },
        );
        const parsed = IcebergSchemaHistory.fromJson(IcebergSchemaHistory.toJson(history));
        expect(parsed.tables.map((table) => table.tableName)).toEqual([
            'a',
            'b',
        ]);
    });

    it('refuses to record an unsafe change', () => {
        const history = IcebergSchemaHistory.append({
            tables: [],
        }, 'orders', DEFINITION);
        expect(() => IcebergSchemaHistory.append(history, 'orders', {
            columns: [
                column('id', 1, IcebergType.INT, true),
            ],
        })).toThrow("cannot record table 'orders':\n  - field 'id' (id 1) changed type from long to int");
    });
});

describe('IcebergSchemaHistory.fromJson', () => {
    const FIELD = {
        id: 1,
        path: 'a',
        type: 'string',
        required: false,
        dropped: false,
    };
    const PARTITION_FIELD = {
        fieldId: 1000,
        name: 'a',
        sourceId: 1,
        transform: 'identity',
    };
    const historyJson = (...tables: unknown[]): string => JSON.stringify({
        tables,
    });
    const table = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
        tableName: 't',
        fields: [
            FIELD,
        ],
        partitionFields: [
            PARTITION_FIELD,
        ],
        ...overrides,
    });

    it('reads what toJson writes', () => {
        const json = historyJson(table());
        expect(IcebergSchemaHistory.fromJson(json)).toEqual({
            tables: [
                table(),
            ],
        });
    });

    it.each([
        [
            '{',
            /^schema history is not a schema history file: .*JSON/,
        ],
        [
            '[]',
            'the top level must be an object',
        ],
        [
            'null',
            'the top level must be an object',
        ],
        [
            '{"tables": [], "extra": 1}',
            "the top level has unknown key 'extra'",
        ],
        [
            '{}',
            'tables must be an array',
        ],
        [
            historyJson(
                table({
                    tableName: 1,
                }),
            ),
            'tables[0].tableName must be a string',
        ],
        [
            historyJson(
                table({
                    fields: [
                        {
                            ...FIELD,
                            id: 1.5,
                        },
                    ],
                }),
            ),
            'tables[0].fields[0].id must be an integer',
        ],
        [
            historyJson(
                table({
                    fields: [
                        {
                            ...FIELD,
                            dropped: 'no',
                        },
                    ],
                }),
            ),
            'tables[0].fields[0].dropped must be a boolean',
        ],
        [
            historyJson(
                table({
                    partitionFields: [
                        {
                            ...PARTITION_FIELD,
                            transform: null,
                        },
                    ],
                }),
            ),
            'tables[0].partitionFields[0].transform must be a string',
        ],
        [
            historyJson(
                table(),
                table(),
            ),
            'table name t appears twice',
        ],
        [
            historyJson(
                table({
                    fields: [
                        FIELD,
                        FIELD,
                    ],
                }),
            ),
            "table 't' field id 1 appears twice",
        ],
        [
            historyJson(
                table({
                    partitionFields: [
                        PARTITION_FIELD,
                        PARTITION_FIELD,
                    ],
                }),
            ),
            "table 't' partition field id 1000 appears twice",
        ],
    ])('rejects %s', (json, problem) => {
        expect(() => IcebergSchemaHistory.fromJson(json)).toThrow(
            typeof problem === 'string' ? `schema history is not a schema history file: ${problem}` : problem,
        );
    });
});

describe('IcebergTable schemaHistoryFile', () => {
    let directory: string;

    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-history-'));
    });

    afterEach(() => {
        fs.rmSync(directory, {
            recursive: true,
            force: true,
        });
    });

    function writeHistory(name: string, history: IcebergSchemaHistoryFile): string {
        const file = path.join(directory, name);
        fs.writeFileSync(file, IcebergSchemaHistory.toJson(history));
        return file;
    }

    function app(tables: Array<{ tableName: string; file: string; schema: IcebergTableSchema }>): App {
        const result = new App({
            outdir: path.join(directory, 'cdk.out'),
        });
        const stack = new Stack(result, 'TestStack', {
            env: {
                account: '123456789012',
                region: 'us-east-1',
            },
        });
        const database = new Database(stack, 'TestDatabase', {
            databaseName: 'test_db',
        });
        for (const table of tables) {
            new IcebergTable(stack, table.tableName, {
                database,
                tableName: table.tableName,
                formatVersion: IcebergFormatVersion.V2,
                location: `s3://bucket/${table.tableName}/`,
                schemaHistoryFile: table.file,
                ...table.schema,
            });
        }
        return result;
    }

    const V1: IcebergTableSchema = {
        columns: [
            column('id', 1, IcebergType.INT, true),
        ],
    };
    const V2: IcebergTableSchema = {
        columns: [
            column('id', 1, IcebergType.LONG, true),
            column('note', 2),
        ],
    };

    it('passes a table with no record in the file', () => {
        const file = writeHistory('h.json', {
            tables: [],
        });
        expect(() => app([
            {
                tableName: 'orders',
                file,
                schema: V1,
            },
        ]).synth()).not.toThrow();
    });

    it('fails synth on an unsafe change from the record, naming the resolved file', () => {
        const file = writeHistory('h.json', IcebergSchemaHistory.append({
            tables: [],
        }, 'orders', V2));
        expect(() => app([
            {
                tableName: 'orders',
                file: path.relative(process.cwd(), file),
                schema: V1,
            },
        ])).toThrow(
            `table 'orders' is not a safe change from its record in ${file}:\n`
            + "  - field 'id' (id 1) changed type from long to int",
        );
    });

    it('fails synth on a missing file with the path and the remedy', () => {
        const file = path.join(directory, 'missing.json');
        expect(() => app([
            {
                tableName: 'orders',
                file,
                schema: V1,
            },
        ])).toThrow(new RegExp(`cannot read schema history file ${file}: .*Create it with the content \\{"tables": \\[\\]\\}`));
    });

    it('fails synth on a malformed file, naming it', () => {
        const file = path.join(directory, 'bad.json');
        fs.writeFileSync(file, '{"tables": {}}');
        expect(() => app([
            {
                tableName: 'orders',
                file,
                schema: V1,
            },
        ])).toThrow(`${file} is not a schema history file: tables must be an array`);
    });

    it('does not write the file at synth', () => {
        const file = writeHistory('h.json', {
            tables: [],
        });
        app([
            {
                tableName: 'orders',
                file,
                schema: V1,
            },
        ]).synth();
        expect(fs.readFileSync(file, 'utf-8')).toBe('{\n  "tables": []\n}\n');
    });

    it('records every table of a synthesized assembly in its own file', () => {
        const first = writeHistory('first.json', IcebergSchemaHistory.append({
            tables: [],
        }, 'orders', V1));
        const second = writeHistory('second.json', {
            tables: [],
        });
        const assembly = app([
            {
                tableName: 'orders',
                file: first,
                schema: V2,
            },
            {
                tableName: 'customers',
                file: first,
                schema: V1,
            },
            {
                tableName: 'events',
                file: second,
                schema: V1,
            },
        ]).synth();

        expect(IcebergSchemaHistory.updateFromCloudAssembly(assembly.directory)).toEqual([
            first,
            second,
        ].sort());
        expect(fs.readFileSync(first, 'utf-8')).toBe(IcebergSchemaHistory.toJson([
            [
                'orders',
                V1,
            ],
            [
                'orders',
                V2,
            ],
            [
                'customers',
                V1,
            ],
        ].reduce(
            (acc: IcebergSchemaHistoryFile, [
                name,
                schema,
            ]) => IcebergSchemaHistory.append(acc, name as string, schema as IcebergTableSchema),
            {
                tables: [],
            },
        )));
        expect(IcebergSchemaHistory.fromJson(fs.readFileSync(second, 'utf-8')).tables.map((t) => t.tableName)).toEqual([
            'events',
        ]);
    });

    it('writes no file when one table cannot be recorded', () => {
        const first = writeHistory('first.json', {
            tables: [],
        });
        const second = writeHistory('second.json', {
            tables: [],
        });
        const assembly = app([
            {
                tableName: 'orders',
                file: first,
                schema: V1,
            },
            {
                tableName: 'events',
                file: second,
                schema: V2,
            },
        ]).synth();
        fs.writeFileSync(second, IcebergSchemaHistory.toJson(IcebergSchemaHistory.append({
            tables: [],
        }, 'events', {
            columns: [
                column('id', 1, IcebergType.STRING, true),
            ],
        })));
        const before = fs.readFileSync(second, 'utf-8');

        expect(() => IcebergSchemaHistory.updateFromCloudAssembly(assembly.directory)).toThrow(
            `cannot record table 'events' in ${second}:`,
        );
        expect(fs.readFileSync(first, 'utf-8')).toBe('{\n  "tables": []\n}\n');
        expect(fs.readFileSync(second, 'utf-8')).toBe(before);
    });

    it('keeps the updates of tables that name one file through a symlink', () => {
        const file = writeHistory('h.json', {
            tables: [],
        });
        const alias = path.join(directory, 'alias.json');
        fs.symlinkSync(file, alias);
        expect(updateThroughTwoPaths(file, alias)).toEqual(RECORDED_THROUGH_TWO_PATHS);
    });

    const caseInsensitive = ((): boolean => {
        const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'case-'));
        fs.writeFileSync(path.join(probe, 'a'), '');
        const result = fs.existsSync(path.join(probe, 'A'));
        fs.rmSync(probe, {
            recursive: true,
        });
        return result;
    })();

    (caseInsensitive ? describe : describe.skip)('on a case-insensitive disk', () => {
        it('keeps the updates of tables that name one file in two letter cases', () => {
            const file = writeHistory('db.json', {
                tables: [],
            });
            expect(updateThroughTwoPaths(file, path.join(directory, 'DB.json'))).toEqual(RECORDED_THROUGH_TWO_PATHS);
        });
    });

    const RECORDED_THROUGH_TWO_PATHS = {
        written: 1,
        tables: [
            'customers',
            'orders',
        ],
    };

    /** Files written and tables recorded when `orders` names the history by `file` and `customers` by `alias`. */
    function updateThroughTwoPaths(file: string, alias: string): { written: number; tables: string[] } {
        const assembly = app([
            {
                tableName: 'orders',
                file,
                schema: V1,
            },
            {
                tableName: 'customers',
                file: alias,
                schema: V2,
            },
        ]).synth();
        return {
            written: IcebergSchemaHistory.updateFromCloudAssembly(assembly.directory).length,
            tables: IcebergSchemaHistory.fromJson(fs.readFileSync(file, 'utf-8')).tables.map((t) => t.tableName),
        };
    }

    it('fails the update when a history file is gone after synth', () => {
        const file = writeHistory('h.json', {
            tables: [],
        });
        const assembly = app([
            {
                tableName: 'orders',
                file,
                schema: V1,
            },
        ]).synth();
        fs.rmSync(file);

        expect(() => IcebergSchemaHistory.updateFromCloudAssembly(assembly.directory)).toThrow(
            `cannot read schema history file ${file}:`,
        );
    });

    it('refuses two tables of the same name in one file, whatever path names it', () => {
        const file = writeHistory('h.json', {
            tables: [],
        });
        const alias = path.join(directory, 'alias.json');
        fs.symlinkSync(file, alias);
        const result = app([]);
        for (const [
            id,
            historyFile,
        ] of [
                [
                    'One',
                    file,
                ],
                [
                    'Two',
                    alias,
                ],
            ]) {
            const stack = new Stack(result, id);
            new IcebergTable(stack, 'Table', {
                database: new Database(stack, 'Db', {
                    databaseName: `db_${id.toLowerCase()}`,
                }),
                tableName: 'orders',
                formatVersion: IcebergFormatVersion.V2,
                location: 's3://bucket/orders/',
                schemaHistoryFile: historyFile,
                ...V1,
            });
        }
        const assembly = result.synth();

        expect(() => IcebergSchemaHistory.updateFromCloudAssembly(assembly.directory)).toThrow(
            `two tables named 'orders' use the schema history file '${file}'; `
            + 'give tables in different databases different history files',
        );
    });
});
