/**
 * Schema history: a committed record of every field and partition field id a
 * table has used, and the checks that keep a new definition consistent with it.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
    CfnTable,
} from 'aws-cdk-lib/aws-glue';
import {
    CloudAssembly,
} from 'aws-cdk-lib/cx-api';
import {
    IConstruct,
} from 'constructs';
import {
    IcebergType,
    IcebergTypeKind,
    pathSegment,
} from './iceberg-type';
import {
    IcebergColumn,
    IcebergPartitionField,
} from './iceberg-table';
import {
    renderPartitionSpec,
    renderSchema,
    validatePartitionSpec,
} from './iceberg-table-render';

/** One field id a table has used: a top-level column or a nested field. */
export interface IcebergFieldHistory {
    /** Iceberg field id. */
    readonly id: number;

    /** Field path when last seen (`addr.city`, `tags.element`, `attrs.key`). */
    readonly path: string;

    /** Type when last seen: the primitive type string, or `list`, `map` or `struct`. */
    readonly type: string;

    /** Whether the field was required when last seen. */
    readonly required: boolean;

    /** Whether the field is absent from the latest recorded definition. Its id stays retired. */
    readonly dropped: boolean;
}

/** One partition field id a table has used in any partition spec. */
export interface IcebergPartitionFieldHistory {
    /** Partition field id. */
    readonly fieldId: number;

    /** Partition field name when last seen. */
    readonly name: string;

    /** Field id of the source column. */
    readonly sourceId: number;

    /** Transform string (`identity`, `bucket[16]`, `day`, ...). */
    readonly transform: string;
}

/** Every field and partition field id one table has used. */
export interface IcebergTableHistory {
    /** Glue table name. */
    readonly tableName: string;

    /** Fields, ordered by id. */
    readonly fields: IcebergFieldHistory[];

    /** Partition fields, ordered by field id. */
    readonly partitionFields: IcebergPartitionFieldHistory[];
}

/** Contents of a schema history file: one record per table. */
export interface IcebergSchemaHistoryFile {
    /** Table records, ordered by table name. */
    readonly tables: IcebergTableHistory[];
}

/** The part of a table definition the schema history records. */
export interface IcebergTableSchema {
    /** Top-level columns. */
    readonly columns: IcebergColumn[];

    /** Partition spec. */
    readonly partitionSpec?: IcebergPartitionField[];
}

/** Class of an unsafe schema change. */
export enum IcebergSchemaViolationKind {
    /** A field id from the history is used by a different field. */
    FIELD_ID_REUSED = 'field-id-reused',

    /** A field kept its path but changed its id. */
    FIELD_ID_CHANGED = 'field-id-changed',

    /** A field changed to a type Iceberg cannot promote it to. */
    TYPE_CHANGED = 'type-changed',

    /** An optional field became required. */
    OPTIONAL_TO_REQUIRED = 'optional-to-required',

    /** A column that a recorded partition spec is sourced from was dropped. */
    PARTITION_SOURCE_DROPPED = 'partition-source-dropped',

    /** A partition field id is used with a different source or transform. */
    PARTITION_FIELD_CHANGED = 'partition-field-changed',
}

/** One unsafe change between a table's history and a new definition. */
export interface IcebergSchemaViolation {
    /** Class of the change. */
    readonly kind: IcebergSchemaViolationKind;

    /** Description naming the field and the ids involved. */
    readonly message: string;
}

/** Cloud assembly metadata type carrying a table's current fields for `updateFromCloudAssembly`. */
const METADATA_TYPE = 'cdk-glue-iceberg-table:schema-history';

const NESTED_KINDS: ReadonlySet<IcebergTypeKind> = new Set([
    IcebergTypeKind.LIST,
    IcebergTypeKind.MAP,
    IcebergTypeKind.STRUCT,
]);

/**
 * Checks and maintains the committed schema history that `IcebergTable` compares
 * a definition against when `schemaHistoryFile` is set.
 */
export class IcebergSchemaHistory {
    /**
     * Unsafe changes from `previous` to `next`; empty when the change is safe. Fields
     * are identified by id, so a field whose path changed under the same id is a rename.
     * @param previous The table's history record.
     * @param next The new table definition.
     */
    public static validateSchemaEvolution(
        previous: IcebergTableHistory,
        next: IcebergTableSchema,
    ): IcebergSchemaViolation[] {
        return findViolations(previous, currentRecord(previous.tableName, next));
    }

    /**
     * `history` with `next` recorded as the current definition of `tableName`; ids
     * absent from `next` stay in the record as dropped. Throws if the change is unsafe.
     * @param history The schema history.
     * @param tableName Glue table name.
     * @param next The table definition to record.
     */
    public static append(
        history: IcebergSchemaHistoryFile,
        tableName: string,
        next: IcebergTableSchema,
    ): IcebergSchemaHistoryFile {
        return appendRecord(history, currentRecord(tableName, next));
    }

    /**
     * Serialize `history` as two-space indented JSON with a trailing newline, tables
     * sorted by name, fields by id and partition fields by field id.
     * @param history The schema history.
     */
    public static toJson(history: IcebergSchemaHistoryFile): string {
        const tables = [
            ...history.tables,
        ].sort((a, b) => compareStrings(a.tableName, b.tableName)).map((table) => ({
            tableName: table.tableName,
            fields: [
                ...table.fields,
            ].sort((a, b) => a.id - b.id).map((field) => ({
                id: field.id,
                path: field.path,
                type: field.type,
                required: field.required,
                dropped: field.dropped,
            })),
            partitionFields: [
                ...table.partitionFields,
            ].sort((a, b) => a.fieldId - b.fieldId).map((field) => ({
                fieldId: field.fieldId,
                name: field.name,
                sourceId: field.sourceId,
                transform: field.transform,
            })),
        }));
        return `${JSON.stringify({
            tables,
        }, undefined, 2)}\n`;
    }

    /**
     * Parse a schema history file's contents. Throws on JSON that is not a schema history.
     * @param json File contents.
     */
    public static fromJson(json: string): IcebergSchemaHistoryFile {
        return parseHistory(json, 'schema history');
    }

    /**
     * Record every table that set `schemaHistoryFile` in a synthesized cloud assembly
     * into its history file, and return the paths of the files written. Run it after
     * `cdk synth`; it writes nothing if any table's change is unsafe.
     * @param assemblyDirectory The cloud assembly directory, usually `cdk.out`.
     */
    public static updateFromCloudAssembly(assemblyDirectory: string): string[] {
        const recordsByFile = new Map<string, IcebergTableHistory[]>();
        for (const stack of new CloudAssembly(assemblyDirectory).stacksRecursively) {
            for (const entry of stack.findMetadataByType(METADATA_TYPE)) {
                const data = entry.data as unknown as { file: string; table: IcebergTableHistory };
                const records = recordsByFile.get(data.file) ?? [];
                if (records.some((record) => record.tableName === data.table.tableName)) {
                    throw new Error(
                        `two tables named '${data.table.tableName}' use the schema history file '${data.file}'; `
                        + 'give tables in different databases different history files',
                    );
                }
                recordsByFile.set(data.file, [
                    ...records,
                    data.table,
                ]);
            }
        }
        const updates = [
            ...recordsByFile,
        ].map(([
            file,
            records,
        ]) => ({
            file,
            json: IcebergSchemaHistory.toJson(records.reduce(appendRecord, readHistoryFile(file))),
        }));
        for (const update of updates) {
            fs.writeFileSync(update.file, update.json);
        }
        return updates.map((update) => update.file).sort(compareStrings);
    }
}

/**
 * Throw if `next` is unsafe against the record of `tableName` in the history file at
 * `file`, resolved against the working directory, and attach `next` to `scope` for
 * `updateFromCloudAssembly`.
 *
 * @internal
 */
export function checkSchemaHistory(scope: IConstruct, file: string, tableName: string, next: IcebergTableSchema): void {
    const resolved = path.resolve(file);
    const record = readHistoryFile(resolved).tables.find((table) => table.tableName === tableName);
    const current = currentRecord(tableName, next);
    if (record !== undefined) {
        const violations = findViolations(record, current);
        if (violations.length > 0) {
            throw new Error(
                `table '${tableName}' is not a safe change from its record in ${resolved}:\n${formatViolations(violations)}`,
            );
        }
    }
    scope.node.addMetadata(METADATA_TYPE, {
        file: resolved,
        table: current,
    });
}

function formatViolations(violations: IcebergSchemaViolation[]): string {
    return violations.map((violation) => `  - ${violation.message}`).join('\n');
}

function readHistoryFile(file: string): IcebergSchemaHistoryFile {
    let json: string;
    try {
        json = fs.readFileSync(file, 'utf-8');
    } catch (error) {
        throw new Error(
            `cannot read schema history file ${file}: ${(error as Error).message}. `
            + 'Create it with the content {"tables": []} for an app with no recorded tables, '
            + 'or point schemaHistoryFile at the committed file.',
        );
    }
    return parseHistory(json, file);
}

/** Record of the fields and partition fields of `next`, none dropped. */
function currentRecord(tableName: string, next: IcebergTableSchema): IcebergTableHistory {
    const rendered = renderSchema(next.columns, undefined);
    validatePartitionSpec(next.partitionSpec, rendered.columnByName);
    const fields: IcebergFieldHistory[] = [];
    const visit = (fieldPath: string, id: number, type: IcebergType, required: boolean): void => {
        fields.push({
            id,
            path: fieldPath,
            type: NESTED_KINDS.has(type.kind) ? type.kind : type._render(fieldPath, () => 0),
            required,
            dropped: false,
        });
        if (type.listElement !== undefined) {
            visit(`${fieldPath}.element`, type.listElementId!, type.listElement, type.listElementRequired!);
        }
        if (type.mapKey !== undefined) {
            visit(`${fieldPath}.key`, type.mapKeyId!, type.mapKey, true);
            visit(`${fieldPath}.value`, type.mapValueId!, type.mapValue!, type.mapValueRequired!);
        }
        for (const field of type.structFields ?? []) {
            visit(`${fieldPath}.${pathSegment(field.name)}`, field.id, field.type, field.required ?? false);
        }
    };
    for (const column of next.columns) {
        visit(pathSegment(column.name), column.id, column.type, column.required ?? false);
    }
    const spec = renderPartitionSpec(next.partitionSpec, rendered.columnByName);
    const partitionFields = (spec?.fields ?? []) as CfnTable.IcebergPartitionFieldProperty[];
    return {
        tableName,
        fields: fields.sort((a, b) => a.id - b.id),
        partitionFields: partitionFields.map((field) => ({
            fieldId: field.fieldId!,
            name: field.name,
            sourceId: field.sourceId,
            transform: field.transform,
        })).sort((a, b) => a.fieldId - b.fieldId),
    };
}

function findViolations(previous: IcebergTableHistory, current: IcebergTableHistory): IcebergSchemaViolation[] {
    const violations: IcebergSchemaViolation[] = [];
    const report = (kind: IcebergSchemaViolationKind, message: string): void => {
        violations.push({
            kind,
            message,
        });
    };
    const previousById = new Map(previous.fields.map((field) => [
        field.id,
        field,
    ]));
    const previousIdByPath = new Map(previous.fields.filter((field) => !field.dropped).map((field) => [
        field.path,
        field.id,
    ]));
    const currentIdByPath = new Map(current.fields.map((field) => [
        field.path,
        field.id,
    ]));
    for (const field of current.fields) {
        const old = previousById.get(field.id);
        const pathOwner = old === undefined ? undefined : currentIdByPath.get(old.path);
        if (old?.dropped) {
            report(
                IcebergSchemaViolationKind.FIELD_ID_REUSED,
                `field id ${field.id} belonged to '${old.path}', which was dropped, and is reused by '${field.path}'`,
            );
        } else if (old !== undefined && pathOwner !== undefined && pathOwner !== field.id) {
            report(
                IcebergSchemaViolationKind.FIELD_ID_REUSED,
                `field id ${field.id} belonged to '${old.path}', which now has id ${pathOwner}, `
                + `and is reused by '${field.path}'`,
            );
        } else if (old !== undefined) {
            if (!isAllowedPromotion(old.type, field.type)) {
                report(
                    IcebergSchemaViolationKind.TYPE_CHANGED,
                    `field '${field.path}' (id ${field.id}) changed type from ${old.type} to ${field.type}; `
                    + 'Iceberg allows only int to long, float to double, and a wider decimal precision at the same scale',
                );
            }
            if (!old.required && field.required) {
                report(
                    IcebergSchemaViolationKind.OPTIONAL_TO_REQUIRED,
                    `field '${field.path}' (id ${field.id}) changed from optional to required`,
                );
            }
        }
        const previousId = previousIdByPath.get(field.path);
        if (previousId !== undefined && previousId !== field.id) {
            report(
                IcebergSchemaViolationKind.FIELD_ID_CHANGED,
                `field '${field.path}' changed id from ${previousId} to ${field.id}`,
            );
        }
    }
    const currentIds = new Set(current.fields.map((field) => field.id));
    const sourceIds = new Set(previous.partitionFields.map((field) => field.sourceId));
    for (const field of previous.fields) {
        if (!field.dropped && sourceIds.has(field.id) && !currentIds.has(field.id)) {
            report(
                IcebergSchemaViolationKind.PARTITION_SOURCE_DROPPED,
                `column '${field.path}' (id ${field.id}) is dropped, but a recorded partition spec is sourced from it`,
            );
        }
    }
    const previousPartitionById = new Map(previous.partitionFields.map((field) => [
        field.fieldId,
        field,
    ]));
    for (const field of current.partitionFields) {
        const old = previousPartitionById.get(field.fieldId);
        if (old !== undefined && (old.sourceId !== field.sourceId || old.transform !== field.transform)) {
            report(
                IcebergSchemaViolationKind.PARTITION_FIELD_CHANGED,
                `partition field id ${field.fieldId} was ${old.transform} of source id ${old.sourceId} `
                + `and is now ${field.transform} of source id ${field.sourceId}; `
                + 'a changed partition field takes a fieldId no partition field has used',
            );
        }
    }
    return violations;
}

function isAllowedPromotion(from: string, to: string): boolean {
    if (from === to || (from === 'int' && to === 'long') || (from === 'float' && to === 'double')) {
        return true;
    }
    const decimal = /^decimal\((\d+), (\d+)\)$/;
    const fromDecimal = decimal.exec(from);
    const toDecimal = decimal.exec(to);
    return fromDecimal !== null && toDecimal !== null
        && fromDecimal[2] === toDecimal[2] && Number(toDecimal[1]) > Number(fromDecimal[1]);
}

/** `history` with `current` merged into its table's record; throws if the change is unsafe. */
function appendRecord(history: IcebergSchemaHistoryFile, current: IcebergTableHistory): IcebergSchemaHistoryFile {
    const previous = history.tables.find((table) => table.tableName === current.tableName);
    if (previous === undefined) {
        return {
            tables: [
                ...history.tables,
                current,
            ],
        };
    }
    const violations = findViolations(previous, current);
    if (violations.length > 0) {
        throw new Error(`cannot record table '${current.tableName}':\n${formatViolations(violations)}`);
    }
    const currentIds = new Set(current.fields.map((field) => field.id));
    const currentFieldIds = new Set(current.partitionFields.map((field) => field.fieldId));
    return {
        tables: history.tables.map((table) => (table !== previous ? table : {
            tableName: table.tableName,
            fields: [
                ...current.fields,
                ...previous.fields.filter((field) => !currentIds.has(field.id)).map((field) => ({
                    ...field,
                    dropped: true,
                })),
            ].sort((a, b) => a.id - b.id),
            partitionFields: [
                ...current.partitionFields,
                ...previous.partitionFields.filter((field) => !currentFieldIds.has(field.fieldId)),
            ].sort((a, b) => a.fieldId - b.fieldId),
        })),
    };
}

function compareStrings(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

type FieldKind = 'string' | 'integer' | 'boolean' | 'array';

const FIELD_KIND_DESCRIPTIONS: Record<FieldKind, string> = {
    string: 'a string',
    integer: 'an integer',
    boolean: 'a boolean',
    array: 'an array',
};

function parseHistory(json: string, source: string): IcebergSchemaHistoryFile {
    const fail = (problem: string): never => {
        throw new Error(`${source} is not a schema history file: ${problem}`);
    };
    let data: unknown;
    try {
        data = JSON.parse(json);
    } catch (error) {
        return fail((error as Error).message);
    }
    const checkObject = (value: unknown, where: string, shape: Record<string, FieldKind>): void => {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            fail(`${where || 'the top level'} must be an object`);
        }
        const record = value as Record<string, unknown>;
        const expected = Object.keys(shape);
        for (const key of Object.keys(record)) {
            if (!expected.includes(key)) {
                fail(`${where || 'the top level'} has unknown key '${key}'`);
            }
        }
        for (const key of expected) {
            const field = record[key];
            const ok = {
                string: typeof field === 'string',
                integer: Number.isInteger(field),
                boolean: typeof field === 'boolean',
                array: Array.isArray(field),
            }[shape[key]];
            if (!ok) {
                fail(`${where}${where ? '.' : ''}${key} must be ${FIELD_KIND_DESCRIPTIONS[shape[key]]}`);
            }
        }
    };
    const checkUnique = (values: Array<string | number>, label: string): void => {
        const duplicate = values.find((value, index) => values.indexOf(value) !== index);
        if (duplicate !== undefined) {
            fail(`${label} ${duplicate} appears twice`);
        }
    };
    checkObject(data, '', {
        tables: 'array',
    });
    const history = data as IcebergSchemaHistoryFile;
    history.tables.forEach((table, t) => {
        checkObject(table, `tables[${t}]`, {
            tableName: 'string',
            fields: 'array',
            partitionFields: 'array',
        });
        table.fields.forEach((field, f) => checkObject(field, `tables[${t}].fields[${f}]`, {
            id: 'integer',
            path: 'string',
            type: 'string',
            required: 'boolean',
            dropped: 'boolean',
        }));
        table.partitionFields.forEach((field, f) => checkObject(field, `tables[${t}].partitionFields[${f}]`, {
            fieldId: 'integer',
            name: 'string',
            sourceId: 'integer',
            transform: 'string',
        }));
        checkUnique(table.fields.map((field) => field.id), `table '${table.tableName}' field id`);
        checkUnique(
            table.partitionFields.map((field) => field.fieldId),
            `table '${table.tableName}' partition field id`,
        );
    });
    checkUnique(history.tables.map((table) => table.tableName), 'table name');
    return history;
}
