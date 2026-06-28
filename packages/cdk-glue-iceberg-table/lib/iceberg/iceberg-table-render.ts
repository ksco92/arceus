import {
    CfnTable,
} from 'aws-cdk-lib/aws-glue';
import {
    IcebergRenderContext,
    IcebergType,
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
    const fields: CfnTable.IcebergPartitionFieldProperty[] = partitionSpec.map((field, index) => ({
        name: field.name ?? defaultPartitionName(field),
        sourceId: columnByName.get(field.sourceColumn)!.id,
        transform: field.transform.toTransformString(),
        /// Per the Iceberg spec, partition field ids must be in the
        /// range [1000, 9999]; the construct allocates them densely
        /// from 1000 in declaration order. Reordering partitions
        /// across deploys reassigns ids — see the "partition field id
        /// reuse" entry in the README's Known limitations.
        fieldId: 1000 + index,
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
