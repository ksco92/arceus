import {
    CfnTable,
} from 'aws-cdk-lib/aws-glue';
import {
    IcebergRenderContext,
    IcebergType,
    IcebergTypeKind,
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
    IcebergTypeKind.UNKNOWN,
    IcebergTypeKind.VARIANT,
    IcebergTypeKind.GEOMETRY,
    IcebergTypeKind.GEOGRAPHY,
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
}

/** @internal */
export interface RenderedSchema {
    readonly fields: CfnTable.IcebergStructFieldProperty[];
    readonly columnByName: Map<string, RenderedColumn>;
}

/** @internal */
export function renderSchema(columns: IcebergColumn[]): RenderedSchema {
    /// First pass: collect and validate the caller-provided top-level
    /// ids (every column pins its own; the construct never fills them).
    /// Nested-type ids continue above the highest top-level id so they
    /// never collide with column ids.
    const topLevelIds = collectTopLevelIds(columns);
    let nextId = Math.max(...topLevelIds, columns.length) + 1;
    const ctx: IcebergRenderContext = {
        nextId: () => {
            const id = nextId;
            nextId += 1;
            return id;
        },
    };
    const columnByName = new Map<string, RenderedColumn>();
    const fields: CfnTable.IcebergStructFieldProperty[] = columns.map((column, index) => {
        const id = topLevelIds[index];
        const typeString = column.type._render(ctx);
        columnByName.set(column.name, {
            id,
            type: column.type,
        });
        return {
            id,
            name: column.name,
            type: typeString,
            required: column.required ?? false,
            doc: column.doc,
        };
    });
    return {
        fields,
        columnByName,
    };
}

/**
 * Validate the caller-provided top-level field ids and return them in
 * column order. Every column must pin an id (the construct no longer
 * auto-assigns); each id must be a positive integer and unique across
 * the column set. Throws on a missing, non-positive, or duplicate id.
 */
function collectTopLevelIds(columns: IcebergColumn[]): number[] {
    const taken = new Set<number>();
    return columns.map((column) => {
        /// Defensive: a jsii Python/JS caller can still pass nothing
        /// despite the required TypeScript type, so guard at runtime.
        if (column.id === undefined || column.id === null) {
            throw new Error(`column '${column.name}' is missing a required id`);
        }
        if (!Number.isInteger(column.id) || column.id < 1) {
            throw new Error(
                `column '${column.name}' has invalid id ${column.id}; ids must be positive integers`,
            );
        }
        if (taken.has(column.id)) {
            throw new Error(`duplicate column id ${column.id} on column '${column.name}'`);
        }
        taken.add(column.id);
        return column.id;
    });
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
