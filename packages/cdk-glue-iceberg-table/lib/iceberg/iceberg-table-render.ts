import {
    Token,
} from 'aws-cdk-lib';
import {
    CfnTable,
} from 'aws-cdk-lib/aws-glue';
import {
    IcebergStructFieldDefinition,
    IcebergType,
    IcebergTypeKind,
} from './iceberg-type';
import {
    IcebergPartitionTransform,
    IcebergPartitionTransformKind,
} from './iceberg-partition-transform';
import {
    FORMAT_VERSION_KEY,
    IcebergDataFormat,
    IcebergFormatVersion,
    WRITE_FORMAT_DEFAULT_KEY,
} from './iceberg-table-properties';
import {
    IcebergNullOrder,
    IcebergSortDirection,
} from './iceberg-sort-order';
import {
    IcebergColumn,
} from './iceberg-column';
import {
    IcebergPartitionField,
} from './iceberg-partition-field';
import {
    IcebergSortField,
} from './iceberg-sort-field';
import {
    IcebergTableProps,
} from './iceberg-table';

/** Largest field id the Iceberg spec allows (`Integer.MAX_VALUE - 200`). */
const MAX_FIELD_ID = 2147483447;

/** Doc prefix that marks identifier columns, so an identifier change is a field change. */
const IDENTIFIER_DOC_PREFIX = '(PK) ';

/** @internal */
export function validateTableName(tableName: string): void {
    if (!Token.isUnresolved(tableName) && !/^[a-z0-9_]+$/.test(tableName)) {
        throw new Error(
            `tableName '${tableName}' must contain only lowercase letters, digits, and underscores`,
        );
    }
}

/** @internal */
export function validateCatalogId(catalogId: string | undefined): void {
    if (catalogId !== undefined && !Token.isUnresolved(catalogId) && !/^[0-9]{12}$/.test(catalogId)) {
        throw new Error(`catalogId '${catalogId}' must be a 12-digit AWS account id`);
    }
}

/** @internal */
export function validateLocation(location: string): void {
    if (!location.startsWith('s3://')) {
        throw new Error(`location must start with 's3://', got '${location}'`);
    }
}

/** @internal */
export function validateProps(props: IcebergTableProps): void {
    validateTableName(props.tableName);
    validateCatalogId(props.catalogId);
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
    validateLocation(props.location);
    const pathById = new Map<number, string>();
    walkFields(props.columns, (path, id, type, required) => {
        validateFieldType(path, type, required, props.formatVersion);
        if (!Number.isInteger(id) || id < 1 || id > MAX_FIELD_ID) {
            throw new Error(
                `column '${path}' has invalid id ${id}; ids must be integers from 1 to ${MAX_FIELD_ID}`,
            );
        }
        const owner = pathById.get(id);
        if (owner !== undefined) {
            throw new Error(`duplicate field id ${id} on column '${path}', already used by '${owner}'`);
        }
        pathById.set(id, path);
    });
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

/** Throws if the field at `path` uses a v3 type below format v3, is a map keyed by `unknown`, or is a required `unknown`. */
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
    if (type.mapKey?.kind === IcebergTypeKind.UNKNOWN) {
        throw new Error(
            `column '${path}.key' has type 'unknown' as a map key; `
            + 'map keys are always required, so use a different key type',
        );
    }
    if (type.kind === IcebergTypeKind.UNKNOWN && required) {
        throw new Error(
            `column '${path}' has type 'unknown', which must be optional; `
            + 'drop required (or set elementRequired / valueRequired to false), or change the type.',
        );
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

/** @internal */
export interface RenderedSchema {
    readonly fields: CfnTable.IcebergStructFieldProperty[];
    readonly columnByName: Map<string, IcebergColumn>;
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
    const identifierNames = new Set(identifierFieldNames);
    const columnByName = new Map<string, IcebergColumn>();
    const fields: CfnTable.IcebergStructFieldProperty[] = columns.map((column) => {
        columnByName.set(column.name, column);
        return {
            id: column.id,
            name: column.name,
            type: column.type._render(),
            required: column.required ?? false,
            doc: identifierNames.has(column.name) ? `${IDENTIFIER_DOC_PREFIX}${column.doc ?? ''}` : column.doc,
        };
    });
    return {
        fields,
        columnByName,
    };
}

/** Field name as a path segment, backquoted with inner backquotes doubled when it contains a dot or backquote. */
function pathSegment(name: string): string {
    return /[.`]/.test(name) ? `\`${name.replace(/`/g, '``')}\`` : name;
}

function walkFields(
    columns: IcebergStructFieldDefinition[],
    visit: (path: string, id: number, type: IcebergType, required: boolean) => void,
): void {
    const walkStruct = (prefix: string, fields: IcebergStructFieldDefinition[]): void => {
        for (const field of fields) {
            visit(`${prefix}${pathSegment(field.name)}`, field.id, field.type, field.required ?? false);
        }
        for (const field of fields) {
            walkNested(`${prefix}${pathSegment(field.name)}`, field.type);
        }
    };
    const walkNested = (path: string, type: IcebergType): void => {
        if (type.listElement !== undefined) {
            visit(`${path}.element`, type.listElementId!, type.listElement, type.listElementRequired!);
            walkNested(`${path}.element`, type.listElement);
        } else if (type.mapKey !== undefined) {
            visit(`${path}.key`, type.mapKeyId!, type.mapKey, true);
            visit(`${path}.value`, type.mapValueId!, type.mapValue!, type.mapValueRequired!);
            walkNested(`${path}.key`, type.mapKey);
            walkNested(`${path}.value`, type.mapValue!);
        } else if (type.structFields !== undefined) {
            walkStruct(`${path}.`, type.structFields);
        }
    };
    walkStruct('', columns);
}

/** @internal */
export function creationOrderFieldIds(columns: IcebergColumn[]): { [path: string]: number } {
    const ids: { [path: string]: number } = {};
    let lastId = 0;
    /// `defineProperty` keeps a field named `__proto__` as an own key.
    walkFields(columns, (path) => {
        Object.defineProperty(ids, path, {
            value: ++lastId,
            enumerable: true,
            writable: true,
            configurable: true,
        });
    });
    return ids;
}

/** @internal */
export function renderPartitionSpec(
    partitionSpec: IcebergPartitionField[] | undefined,
    columnByName: Map<string, IcebergColumn>,
): CfnTable.IcebergPartitionSpecProperty | undefined {
    if (partitionSpec === undefined || partitionSpec.length === 0) {
        return undefined;
    }
    const names = new Set<string>();
    const fieldIds = new Set<number>();
    const fields = partitionSpec.map((field) => {
        const source = columnByName.get(field.sourceColumn);
        if (source === undefined) {
            throw new Error(`partitionSpec references unknown column '${field.sourceColumn}'`);
        }
        field.transform._validateSourceType(field.sourceColumn, source.type);
        const name = field.name
            ?? (field.transform.kind === IcebergPartitionTransformKind.IDENTITY
                ? field.sourceColumn
                : `${field.sourceColumn}_${field.transform.kind}`);
        if (names.has(name)) {
            throw new Error(`duplicate partition field name: ${name}`);
        }
        names.add(name);
        if (!Number.isInteger(field.fieldId) || field.fieldId < 1000) {
            throw new Error(
                `partition field '${name}' has invalid fieldId ${field.fieldId}; `
                + 'partition field ids must be integers >= 1000',
            );
        }
        if (fieldIds.has(field.fieldId)) {
            throw new Error(`duplicate partition fieldId ${field.fieldId} on partition field '${name}'`);
        }
        fieldIds.add(field.fieldId);
        return {
            name,
            sourceId: source.id,
            transform: field.transform.toTransformString(),
            fieldId: field.fieldId,
        };
    });
    return {
        specId: 0,
        fields,
    };
}

/** @internal */
export function renderSortOrder(
    sortOrder: IcebergSortField[] | undefined,
    columnByName: Map<string, IcebergColumn>,
): CfnTable.IcebergSortOrderProperty | undefined {
    if (sortOrder === undefined) {
        return undefined;
    }
    if (sortOrder.length === 0) {
        throw new Error('sortOrder must contain at least one field when provided');
    }
    const fields = sortOrder.map((field) => {
        const source = columnByName.get(field.sourceColumn);
        if (source === undefined) {
            throw new Error(`sortOrder references unknown column '${field.sourceColumn}'`);
        }
        const transform = field.transform ?? IcebergPartitionTransform.IDENTITY;
        transform._validateSourceType(field.sourceColumn, source.type);
        return {
            sourceId: source.id,
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

/** @internal */
export function resolveIdentifierFieldIds(
    identifierFieldNames: string[] | undefined,
    columnByName: Map<string, IcebergColumn>,
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
        [FORMAT_VERSION_KEY]: formatVersion,
        [WRITE_FORMAT_DEFAULT_KEY]: dataFormat,
        ...(user ?? {}),
    };
    if (comment !== undefined) {
        merged.comment = comment;
    }
    return merged;
}
