import {
    Token,
} from 'aws-cdk-lib';
import {
    CfnTable,
} from 'aws-cdk-lib/aws-glue';
import {
    IcebergType,
    IcebergTypeKind,
    oneOf,
    ownArray,
    pathSegment,
    primitive,
    snapshotField,
} from './iceberg-type';
import {
    IcebergPartitionTransform,
} from './iceberg-partition-transform';
import {
    IcebergPropertyKeys,
    IcebergDataFormat,
    IcebergFormatVersion,
} from './iceberg-table-properties';
import {
    IcebergColumn,
    IcebergNullOrder,
    IcebergPartitionField,
    IcebergSortDirection,
    IcebergSortField,
    IcebergTableProps,
} from './iceberg-table';

/// /////////////////////////////////////////////////
/// /////////////////////////////////////////////////
// Validation

/** Doc prefix that marks identifier columns, so an identifier change is a field change. */
const IDENTIFIER_DOC_PREFIX = '(PK) ';

function snapshotPartitionField(field: IcebergPartitionField): IcebergPartitionField {
    const {
        sourceColumn,
        transform,
        name,
        fieldId,
    } = field;
    return {
        sourceColumn: primitive('partition sourceColumn', sourceColumn, 'string'),
        transform: new IcebergPartitionTransform(transform),
        name: primitive('partition field name', name, 'string', {
            optional: true, 
        }),
        fieldId,
    };
}

function snapshotSortField(field: IcebergSortField): IcebergSortField {
    const {
        sourceColumn,
        transform,
        direction,
        nullOrder,
    } = field;
    return {
        sourceColumn: primitive('sort sourceColumn', sourceColumn, 'string'),
        transform: transform === undefined ? undefined : new IcebergPartitionTransform(transform),
        direction: oneOf('sort direction', direction, IcebergSortDirection, true),
        nullOrder: oneOf('sort nullOrder', nullOrder, IcebergNullOrder, true),
    };
}

/**
 * A copy of `props` built from one read of each prop: strings and enums checked, arrays and
 * objects rebuilt, so the construct validates and renders values the caller cannot change.
 * `database` and `removalPolicy` are passed to CDK as given.
 *
 * @internal
 */
export function snapshotProps(props: IcebergTableProps): IcebergTableProps {
    const {
        database,
        tableName,
        columns,
        location,
        partitionSpec,
        sortOrder,
        identifierFieldNames,
        dataFormat,
        formatVersion,
        tableProperties,
        comment,
        removalPolicy,
    } = props;
    return {
        database,
        removalPolicy,
        tableName: primitive('tableName', tableName, 'string'),
        location: primitive('location', location, 'string', {
            tokens: true, 
        }),
        dataFormat: oneOf('dataFormat', dataFormat, IcebergDataFormat, true),
        formatVersion: oneOf('formatVersion', formatVersion, IcebergFormatVersion),
        comment: primitive('comment', comment, 'string', {
            optional: true,
            tokens: true, 
        }),
        columns: ownArray('columns', columns).map(snapshotField),
        partitionSpec: partitionSpec === undefined
            ? undefined
            : ownArray('partitionSpec', partitionSpec).map(snapshotPartitionField),
        sortOrder: sortOrder === undefined ? undefined : ownArray('sortOrder', sortOrder).map(snapshotSortField),
        identifierFieldNames: identifierFieldNames === undefined
            ? undefined
            : ownArray('identifierFieldNames', identifierFieldNames).map(
                (name) => primitive('identifier field name', name, 'string'),
            ),
        tableProperties: tableProperties === undefined
            ? undefined
            : Object.fromEntries(Object.entries(tableProperties).map(([
                key,
                value,
            ]) => [
                primitive('tableProperties key', key, 'string'),
                primitive(`tableProperties['${key}']`, value, 'string', {
                    tokens: true, 
                }),
            ])),
    };
}

/** @internal */
export function validateProps(props: IcebergTableProps): void {
    if (!props.tableName.match(/^[a-z0-9_]+$/)) {
        throw new Error(
            `tableName '${props.tableName}' must contain only lowercase letters, digits, and underscores`,
        );
    }
    if (props.columns.length === 0) {
        throw new Error('IcebergTable requires at least one column');
    }
    const names = new Set<string>();
    for (const column of props.columns) {
        if (names.has(column.name)) {
            throw new Error(`duplicate column name: ${column.name}`);
        }
        names.add(column.name);
        if (column.doc?.startsWith(IDENTIFIER_DOC_PREFIX)) {
            throw new Error(
                `column '${column.name}' has a doc starting with '${IDENTIFIER_DOC_PREFIX}', a prefix the construct `
                + 'adds to identifier columns; remove it and list the column in identifierFieldNames instead',
            );
        }
    }
    if (!props.location.startsWith('s3://')) {
        throw new Error(`location must start with 's3://', got '${props.location}'`);
    }
    for (const column of props.columns) {
        validateFieldType(column.name, column.type, column.required ?? false, props.formatVersion);
    }
}

const V3_TYPE_KINDS: ReadonlySet<IcebergTypeKind> = new Set([
    IcebergTypeKind.UNKNOWN,
    IcebergTypeKind.TIMESTAMP_NS,
    IcebergTypeKind.TIMESTAMPTZ_NS,
    IcebergTypeKind.VARIANT,
    IcebergTypeKind.GEOMETRY,
    IcebergTypeKind.GEOGRAPHY,
]);

const NON_IDENTIFIER_TYPE_KINDS: ReadonlySet<IcebergTypeKind> = new Set([
    ...[
        ...V3_TYPE_KINDS,
    ].filter(
        (kind) => kind !== IcebergTypeKind.TIMESTAMP_NS && kind !== IcebergTypeKind.TIMESTAMPTZ_NS,
    ),
    IcebergTypeKind.FLOAT,
    IcebergTypeKind.DOUBLE,
    IcebergTypeKind.LIST,
    IcebergTypeKind.MAP,
    IcebergTypeKind.STRUCT,
]);

/**
 * Throws if the field at `path`, or any field nested in it, uses a v3
 * type below format v3 or is a required `unknown`. List elements, map
 * keys, and map values count as fields.
 */
function validateFieldType(
    path: string,
    type: IcebergType,
    required: boolean,
    formatVersion: IcebergFormatVersion,
): void {
    if (V3_TYPE_KINDS.has(type.kind)
        && (formatVersion === IcebergFormatVersion.V1 || formatVersion === IcebergFormatVersion.V2)) {
        throw new Error(
            `column '${path}' has type '${type.kind}', which requires formatVersion v3; got v${formatVersion}. `
            + 'Set formatVersion to IcebergFormatVersion.V3 or change the column type.',
        );
    }
    if (type.kind === IcebergTypeKind.UNKNOWN && required) {
        throw new Error(
            `column '${path}' has type 'unknown', which must be optional; `
            + 'drop required (or set elementRequired / valueRequired to false), or change the type.',
        );
    }
    if (type.listElement !== undefined) {
        validateFieldType(`${path}.element`, type.listElement, type.listElementRequired!, formatVersion);
    }
    if (type.mapKey !== undefined) {
        if (type.mapKey.kind === IcebergTypeKind.UNKNOWN) {
            throw new Error(
                `column '${path}.key' has type 'unknown' as a map key; `
                + 'map keys are always required, so use a different key type',
            );
        }
        validateFieldType(`${path}.key`, type.mapKey, true, formatVersion);
        validateFieldType(`${path}.value`, type.mapValue!, type.mapValueRequired!, formatVersion);
    }
    for (const field of type.structFields ?? []) {
        validateFieldType(`${path}.${field.name}`, field.type, field.required ?? false, formatVersion);
    }
}

/** @internal */
export function normalizeLocation(location: string): string {
    return location.endsWith('/') ? location : `${location}/`;
}

/** @internal */
export function parseS3Uri(uri: string): { bucket: string; key: string } {
    /// `normalizeLocation` is always called first, so `uri` ends with `/`
    /// and therefore contains at least one `/` after the scheme.
    const rest = uri.substring('s3://'.length);
    const slash = rest.indexOf('/');
    return {
        bucket: rest.substring(0, slash),
        key: rest.substring(slash + 1),
    };
}

/// /////////////////////////////////////////////////
/// /////////////////////////////////////////////////
// Schema / partition / sort rendering

interface RenderedColumn {
    readonly id: number;
    readonly type: IcebergType;
    readonly required: boolean;
}

/** @internal */
export interface RenderedSchema {
    readonly fields: CfnTable.IcebergStructFieldProperty[];
    readonly columnByName: Map<string, RenderedColumn>;
}

/**
 * Render the top-level fields, prefixing the doc of every column named
 * in `identifierFieldNames` with the identifier marker.
 *
 * @internal
 */
export function renderSchema(
    columns: IcebergColumn[],
    identifierFieldNames: string[] | undefined,
): RenderedSchema {
    const pathById = new Map<number, string>();
    const claimId = (path: string, id: unknown): number => claimFieldId(path, id, pathById);
    const identifierNames = new Set(identifierFieldNames);
    const columnByName = new Map<string, RenderedColumn>();
    const fields: CfnTable.IcebergStructFieldProperty[] = columns.map((column) => {
        const path = pathSegment(column.name);
        const id = claimId(path, column.id);
        const required = column.required ?? false;
        columnByName.set(column.name, {
            id,
            type: column.type,
            required,
        });
        return {
            id,
            name: column.name,
            type: column.type._render(path, claimId),
            required,
            doc: identifierNames.has(column.name) ? `${IDENTIFIER_DOC_PREFIX}${column.doc ?? ''}` : column.doc,
        };
    });
    return {
        fields,
        columnByName,
    };
}

/** @internal */
export function creationOrderFieldIds(columns: IcebergColumn[]): { [path: string]: number } {
    const ids: { [path: string]: number } = {};
    let lastId = 0;
    /// `defineProperty` keeps a field named `__proto__` as an own key.
    const assign = (path: string): void => {
        Object.defineProperty(ids, path, {
            value: ++lastId,
            enumerable: true,
            writable: true,
            configurable: true,
        });
    };
    const assignStruct = (prefix: string, fields: Array<{ name: string; type: IcebergType }>): void => {
        for (const field of fields) {
            assign(`${prefix}${pathSegment(field.name)}`);
        }
        for (const field of fields) {
            assignNested(`${prefix}${pathSegment(field.name)}`, field.type);
        }
    };
    const assignNested = (path: string, type: IcebergType): void => {
        if (type.listElement !== undefined) {
            assign(`${path}.element`);
            assignNested(`${path}.element`, type.listElement);
        } else if (type.mapKey !== undefined) {
            assign(`${path}.key`);
            assign(`${path}.value`);
            assignNested(`${path}.key`, type.mapKey);
            assignNested(`${path}.value`, type.mapValue!);
        } else if (type.structFields !== undefined) {
            assignStruct(`${path}.`, type.structFields);
        }
    };
    assignStruct('', columns);
    return ids;
}

/** Largest field id the Iceberg spec allows (`Integer.MAX_VALUE - 200`). */
const MAX_FIELD_ID = 2147483447;

/** Check the id of the field at `path`, record it in `pathById`, and return it. */
function claimFieldId(path: string, id: unknown, pathById: Map<number, string>): number {
    if (id === undefined || id === null) {
        throw new Error(`column '${path}' is missing a required id`);
    }
    if (typeof id !== 'number') {
        throw new Error(`column '${path}' has invalid id ${String(id)} of type ${typeof id}; ids must be numbers`);
    }
    if (Token.isUnresolved(id)) {
        throw new Error(`column '${path}' has an unresolved token as its id; ids must be concrete numbers, not tokens`);
    }
    if (!Number.isInteger(id) || id < 1 || id > MAX_FIELD_ID) {
        throw new Error(`column '${path}' has invalid id ${id}; ids must be integers from 1 to ${MAX_FIELD_ID}`);
    }
    const owner = pathById.get(id);
    if (owner !== undefined) {
        throw new Error(`duplicate field id ${id} on column '${path}', already used by '${owner}'`);
    }
    pathById.set(id, path);
    return id;
}

/** @internal */
export function validatePartitionSpec(
    partitionSpec: IcebergPartitionField[] | undefined,
    columnByName: Map<string, RenderedColumn>,
): void {
    if (partitionSpec === undefined) {
        return;
    }
    const partitionNames = new Set<string>();
    const partitionFieldIds = new Set<number>();
    for (const field of partitionSpec) {
        const source = columnByName.get(field.sourceColumn);
        if (source === undefined) {
            throw new Error(
                `partitionSpec references unknown column '${field.sourceColumn}'`,
            );
        }
        field.transform._validateSourceType(field.sourceColumn, source.type);
        const partitionName = field.name ?? defaultPartitionName(field);
        if (partitionNames.has(partitionName)) {
            throw new Error(`duplicate partition field name: ${partitionName}`);
        }
        partitionNames.add(partitionName);
        /// Defensive: a jsii Python/JS caller can still pass nothing
        /// despite the required TypeScript type, so guard at runtime.
        if (field.fieldId === undefined || field.fieldId === null) {
            throw new Error(
                `partition field '${partitionName}' is missing a required fieldId`,
            );
        }
        if (!Number.isInteger(field.fieldId) || field.fieldId < 1000) {
            throw new Error(
                `partition field '${partitionName}' has invalid fieldId ${field.fieldId}; `
                + 'partition field ids must be integers >= 1000',
            );
        }
        if (partitionFieldIds.has(field.fieldId)) {
            throw new Error(
                `duplicate partition fieldId ${field.fieldId} on partition field '${partitionName}'`,
            );
        }
        partitionFieldIds.add(field.fieldId);
    }
}

/** @internal */
export function validateSortOrder(
    sortOrder: IcebergSortField[] | undefined,
    columnByName: Map<string, RenderedColumn>,
): void {
    if (sortOrder === undefined) {
        return;
    }
    if (sortOrder.length === 0) {
        throw new Error('sortOrder must contain at least one field when provided');
    }
    for (const field of sortOrder) {
        const source = columnByName.get(field.sourceColumn);
        if (source === undefined) {
            throw new Error(`sortOrder references unknown column '${field.sourceColumn}'`);
        }
        const transform = field.transform ?? IcebergPartitionTransform.IDENTITY;
        transform._validateSourceType(field.sourceColumn, source.type);
    }
}

/** @internal */
export function renderPartitionSpec(
    partitionSpec: IcebergPartitionField[] | undefined,
    columnByName: Map<string, RenderedColumn>,
): CfnTable.IcebergPartitionSpecProperty | undefined {
    if (partitionSpec === undefined || partitionSpec.length === 0) {
        return undefined;
    }
    const fields: CfnTable.IcebergPartitionFieldProperty[] = partitionSpec.map((field) => ({
        name: field.name ?? defaultPartitionName(field),
        sourceId: columnByName.get(field.sourceColumn)!.id,
        transform: field.transform.toTransformString(),
        fieldId: field.fieldId,
    }));
    return {
        specId: 0,
        fields,
    };
}

/** @internal */
export function renderSortOrder(
    sortOrder: IcebergSortField[] | undefined,
    columnByName: Map<string, RenderedColumn>,
): CfnTable.IcebergSortOrderProperty | undefined {
    if (sortOrder === undefined || sortOrder.length === 0) {
        return undefined;
    }
    const fields: CfnTable.IcebergSortFieldProperty[] = sortOrder.map((field) => {
        const transform = field.transform ?? IcebergPartitionTransform.IDENTITY;
        return {
            sourceId: columnByName.get(field.sourceColumn)!.id,
            transform: transform.toTransformString(),
            direction: field.direction ?? IcebergSortDirection.ASC,
            nullOrder: field.nullOrder ?? IcebergNullOrder.NULLS_LAST,
        };
    });
    return {
        orderId: 1,
        fields,
    };
}

function defaultPartitionName(field: IcebergPartitionField): string {
    const transformString = field.transform.toTransformString();
    if (transformString === 'identity') {
        return field.sourceColumn;
    }
    /// `bucket[16]` -> `sourceColumn_bucket`
    const baseTransform = transformString.replace(/\[.*\]$/, '');
    return `${field.sourceColumn}_${baseTransform}`;
}

/** @internal */
export function resolveIdentifierFieldIds(
    identifierFieldNames: string[] | undefined,
    columnByName: Map<string, RenderedColumn>,
): number[] | undefined {
    if (identifierFieldNames === undefined || identifierFieldNames.length === 0) {
        return undefined;
    }
    const seen = new Set<string>();
    return identifierFieldNames.map((name) => {
        if (seen.has(name)) {
            throw new Error(`duplicate identifier field: ${name}`);
        }
        seen.add(name);
        const column = columnByName.get(name);
        if (column === undefined) {
            throw new Error(`identifierFieldNames references unknown column '${name}'`);
        }
        if (NON_IDENTIFIER_TYPE_KINDS.has(column.type.kind)) {
            throw new Error(
                `identifierFieldNames references column '${name}' of type '${column.type.kind}', `
                + 'which cannot identify a row; remove it from identifierFieldNames',
            );
        }
        if (!column.required) {
            throw new Error(
                `identifierFieldNames references optional column '${name}'; `
                + 'set required: true on the column or remove it from identifierFieldNames',
            );
        }
        return column.id;
    });
}

/** @internal */
export function mergeProperties(
    dataFormat: IcebergDataFormat,
    formatVersion: IcebergFormatVersion,
    user: { [key: string]: string } | undefined,
    comment: string | undefined,
): { [key: string]: string } {
    if (comment !== undefined && user !== undefined && user.comment !== undefined) {
        throw new Error(
            'comment is set both as the top-level `comment` prop and as `tableProperties.comment`; '
            + 'set it in exactly one place',
        );
    }
    const merged: { [key: string]: string } = {
        [IcebergPropertyKeys.FORMAT_VERSION]: formatVersion,
        [IcebergPropertyKeys.WRITE_FORMAT_DEFAULT]: dataFormat,
        ...(user ?? {}),
    };
    if (comment !== undefined) {
        merged.comment = comment;
    }
    return merged;
}
