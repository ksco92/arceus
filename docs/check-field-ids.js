/**
 * Zero-dependency CI checker comparing a synthesized CloudFormation template's
 * `AWS::Glue::Table` Iceberg declaration against a live table's `metadata.json`
 * to guard against cross-deploy column, nested-field, and partition field-id reuse.
 */

const fs = require('fs');
const { parseArgs } = require('util');

const USAGE = 'usage: check-field-ids.js <template.json> <metadata.json> [--table <name>]';

function collectNestedType(rawType, path, parentId, out, problems) {
    let parsed = rawType;
    if (typeof rawType === 'string') {
        const trimmed = rawType.trim();
        if (!trimmed.startsWith('{')) {
            return 'primitive';
        }
        try {
            parsed = JSON.parse(trimmed);
        } catch (err) {
            problems.push(`Field '${path}' has invalid JSON type: ${err.message}.`);
            return null;
        }
    }
    if (!parsed || typeof parsed !== 'object') {
        return null;
    }
    const pushSlot = (slot, id, childType) => {
        const childPath = `${path}.${slot}`;
        const entry = {
            id,
            path: childPath,
            parentId,
            slot,
            kind: null,
        };
        out.push(entry);
        entry.kind = collectNestedType(childType, childPath, id, out, problems);
    };
    if (parsed.type === 'list') {
        pushSlot('element', parsed['element-id'], parsed.element);
        return 'list';
    }
    if (parsed.type === 'map') {
        pushSlot('key', parsed['key-id'], parsed.key);
        pushSlot('value', parsed['value-id'], parsed.value);
        return 'map';
    }
    if (parsed.type === 'struct') {
        collectBindings(parsed.fields, problems, `${path}.`, parentId, out);
        return 'struct';
    }
    problems.push(`Field '${path}' has unsupported object type ${JSON.stringify(parsed.type)}.`);
    return null;
}

function collectBindings(fields, problems = [], prefix = '', parentId = null, out = []) {
    if (!Array.isArray(fields)) {
        problems.push(`Schema field list${prefix ? ` under '${prefix}'` : ''} must be an array.`);
        return out;
    }
    for (const field of fields) {
        if (!field || typeof field !== 'object') {
            problems.push(`Schema field list${prefix ? ` under '${prefix}'` : ''} contains a non-object entry.`);
            continue;
        }
        const rawName = field.name ?? field.Name;
        const name = typeof rawName === 'string' ? rawName : '';
        const segment = /[.`]/.test(name) ? `\`${name.replace(/`/g, '``')}\`` : name;
        const path = `${prefix}${segment}`;
        const id = field.id ?? field.Id;
        const entry = {
            id,
            path,
            parentId,
            slot: 'field',
            kind: null,
        };
        out.push(entry);
        entry.kind = collectNestedType(field.type ?? field.Type, path, id, out, problems);
    }
    return out;
}

/**
 * Walk Iceberg schema fields recursively into `list`, `map`, and `struct` types.
 *
 * Accepts both CloudFormation `Schema.Fields` entries (PascalCase keys with
 * JSON-stringified `Type`) and Iceberg `metadata.json` `fields`.
 *
 * @param fields Array of field definitions.
 * @param prefix Dotted path prefix for nested fields.
 * @returns Flat list of `{ id, path }` entries.
 */
function collectFields(fields, prefix = '') {
    return collectBindings(fields, [], prefix).map(({ id, path }) => ({
        id,
        path,
    }));
}

/**
 * Locate the target `AWS::Glue::Table` Iceberg resource in a CloudFormation template.
 *
 * @param template Parsed CloudFormation template object.
 * @param tableName Optional Glue table name or logical resource id.
 * @returns `{ table, problem }` where `table` holds `{ logicalId, name, tableInput }`.
 */
function findIcebergTable(template, tableName) {
    const resources = template?.Resources;
    const tables = [];
    if (resources && typeof resources === 'object') {
        for (const [logicalId, resource] of Object.entries(resources)) {
            const tableInput = resource?.Properties?.OpenTableFormatInput?.IcebergInput?.IcebergTableInput;
            if (resource?.Type === 'AWS::Glue::Table' && tableInput && typeof tableInput === 'object') {
                tables.push({
                    logicalId,
                    name: resource.Properties.Name,
                    tableInput,
                });
            }
        }
    }
    const label = (t) => (typeof t.name === 'string' && t.name !== '' ? `${t.name} (${t.logicalId})` : t.logicalId);
    if (tables.length === 0) {
        return {
            table: null,
            problem: 'No AWS::Glue::Table Iceberg resources found in template.',
        };
    }
    if (tableName === undefined) {
        if (tables.length === 1) {
            return {
                table: tables[0],
                problem: null,
            };
        }
        return {
            table: null,
            problem: `Multiple Iceberg tables found (${tables.map(label).join(', ')}); pass --table <name>.`,
        };
    }
    const matches = tables.filter((t) => t.name === tableName || t.logicalId === tableName);
    if (matches.length === 0) {
        return {
            table: null,
            problem: `Iceberg table '${tableName}' not found in template. Available tables: ${tables.map(label).join(', ')}.`,
        };
    }
    if (matches.length > 1) {
        return {
            table: null,
            problem: `Multiple Iceberg tables match '${tableName}' (${matches.map(label).join(', ')}); pass the logical resource id.`,
        };
    }
    return {
        table: matches[0],
        problem: null,
    };
}

function indexSchemaHistory(metadata, problems) {
    const lastColumnId = metadata['last-column-id'];
    if (typeof lastColumnId !== 'number' || !Number.isInteger(lastColumnId)) {
        problems.push("Iceberg metadata is missing integer 'last-column-id'.");
        return null;
    }
    if (!Array.isArray(metadata.schemas)) {
        problems.push("Iceberg metadata is missing 'schemas' array.");
        return null;
    }
    const currentSchemaId = metadata['current-schema-id'];
    const currentSchema = metadata.schemas.find((s) => s && s['schema-id'] === currentSchemaId);
    if (!currentSchema) {
        problems.push(`Iceberg metadata is missing schema for current-schema-id ${currentSchemaId}.`);
        return null;
    }
    if (!Array.isArray(currentSchema.fields)) {
        problems.push(`Iceberg metadata schema ${currentSchemaId} is missing 'fields' array.`);
        return null;
    }
    const activeById = new Map();
    const historicalById = new Map();
    for (const schema of metadata.schemas) {
        if (!schema || typeof schema !== 'object' || !Array.isArray(schema.fields)) {
            problems.push("Iceberg metadata 'schemas' contains an entry missing 'fields' array.");
            continue;
        }
        for (const entry of collectBindings(schema.fields, problems)) {
            if (schema === currentSchema) {
                activeById.set(entry.id, entry);
            }
            if (!historicalById.has(entry.id)) {
                historicalById.set(entry.id, new Set());
            }
            historicalById.get(entry.id).add(entry.path);
        }
    }
    return {
        lastColumnId,
        activeById,
        historicalById,
    };
}

function checkColumnIds(tableInput, metadata, problems) {
    const history = indexSchemaHistory(metadata, problems);
    if (!history) {
        return;
    }
    if (!Array.isArray(tableInput.Schema?.Fields)) {
        problems.push("Template IcebergTableInput is missing 'Schema.Fields' array.");
        return;
    }
    const {
        lastColumnId, activeById, historicalById,
    } = history;
    const seenIds = new Map();
    for (const entry of collectBindings(tableInput.Schema.Fields, problems)) {
        const {
            id, path, parentId, slot, kind,
        } = entry;
        if (typeof id !== 'number' || !Number.isInteger(id)) {
            problems.push(`Template field '${path}' has non-integer id ${JSON.stringify(id)}.`);
            continue;
        }
        const duplicateOwner = seenIds.get(id);
        if (duplicateOwner !== undefined) {
            problems.push(`Template field '${path}' duplicates field id ${id} already used by '${duplicateOwner}'.`);
            continue;
        }
        seenIds.set(id, path);
        const cur = activeById.get(id);
        if (cur !== undefined) {
            if (parentId !== cur.parentId || slot !== cur.slot) {
                problems.push(
                    `Field '${path}' uses active field id ${id} in ${slot} under parent ${parentId ?? 'root'}, `
                    + `but current schema binds id ${id} to '${cur.path}' (${cur.slot} under parent ${cur.parentId ?? 'root'}).`,
                );
            } else if (kind !== null && cur.kind !== null && kind !== cur.kind) {
                problems.push(`Field '${path}' changes active field id ${id} kind from '${cur.kind}' to '${kind}'.`);
            }
            continue;
        }
        const priorPaths = historicalById.get(id);
        if (priorPaths !== undefined) {
            const names = [...priorPaths].map((p) => `'${p}'`).join(', ');
            problems.push(
                `Field '${path}' reuses historical field id ${id} (previously used by ${names}); `
                + `pick an id above last-column-id (${lastColumnId}).`,
            );
        } else if (id <= lastColumnId) {
            problems.push(
                `New field '${path}' uses id ${id} <= last-column-id (${lastColumnId}); `
                + `pick an id above ${lastColumnId}.`,
            );
        }
    }
}

function indexPartitionHistory(metadata, problems) {
    const specs = metadata['partition-specs'];
    if (specs !== undefined && !Array.isArray(specs)) {
        problems.push("Iceberg metadata 'partition-specs' must be an array.");
        return null;
    }
    const lastPartitionId = metadata['last-partition-id'];
    if (lastPartitionId !== undefined && (typeof lastPartitionId !== 'number' || !Number.isInteger(lastPartitionId))) {
        problems.push("Iceberg metadata has non-integer 'last-partition-id'.");
        return null;
    }
    const historicalPartitions = new Map();
    let maxHistoricalPartitionId = 0;
    for (const spec of specs ?? []) {
        if (!spec || typeof spec !== 'object' || (spec.fields !== undefined && !Array.isArray(spec.fields))) {
            problems.push("Iceberg metadata 'partition-specs' contains a malformed spec entry.");
            continue;
        }
        for (const field of spec.fields ?? []) {
            if (!field || typeof field !== 'object') {
                problems.push("Iceberg metadata partition spec 'fields' contains a non-object entry.");
                continue;
            }
            const fieldId = field['field-id'];
            const binding = `${field['source-id']}:${field.transform}`;
            if (fieldId > maxHistoricalPartitionId) {
                maxHistoricalPartitionId = fieldId;
            }
            if (!historicalPartitions.has(fieldId)) {
                historicalPartitions.set(fieldId, new Set());
            }
            historicalPartitions.get(fieldId).add(binding);
        }
    }
    if (lastPartitionId !== undefined && maxHistoricalPartitionId > lastPartitionId) {
        problems.push(
            `Stale last-partition-id (${lastPartitionId} < max historical field-id ${maxHistoricalPartitionId}).`,
        );
    }
    return {
        historicalPartitions,
        effectiveLastPartitionId: Math.max(lastPartitionId ?? 0, maxHistoricalPartitionId),
    };
}

function checkPartitionIds(tableInput, metadata, problems) {
    const history = indexPartitionHistory(metadata, problems);
    if (!history) {
        return;
    }
    const partitionFields = tableInput.PartitionSpec?.Fields;
    if (partitionFields !== undefined && !Array.isArray(partitionFields)) {
        problems.push("Template IcebergTableInput 'PartitionSpec.Fields' must be an array.");
        return;
    }
    const {
        historicalPartitions, effectiveLastPartitionId,
    } = history;
    const seenPartitionIds = new Set();
    for (const field of partitionFields ?? []) {
        if (!field || typeof field !== 'object') {
            problems.push("Template IcebergTableInput 'PartitionSpec.Fields' contains a non-object entry.");
            continue;
        }
        const fieldId = field.FieldId;
        const sourceId = field.SourceId;
        const transform = field.Transform;
        const name = field.Name ?? `${sourceId}:${transform}`;
        if (typeof fieldId !== 'number' || !Number.isInteger(fieldId)) {
            problems.push(`Template partition field '${name}' has non-integer FieldId ${JSON.stringify(fieldId)}.`);
            continue;
        }
        if (seenPartitionIds.has(fieldId)) {
            problems.push(`Template partition field '${name}' duplicates FieldId ${fieldId}.`);
            continue;
        }
        seenPartitionIds.add(fieldId);
        const binding = `${sourceId}:${transform}`;
        const prior = historicalPartitions.get(fieldId);
        if (prior !== undefined) {
            if (!prior.has(binding)) {
                problems.push(
                    `Partition field '${name}' (${binding}) reuses fieldId ${fieldId}, `
                    + `which conflicts with historical partition field (${[...prior].join(', ')}).`,
                );
            }
        } else if (fieldId <= effectiveLastPartitionId) {
            problems.push(
                `New partition field '${name}' (${binding}) uses fieldId ${fieldId} `
                + `<= last-partition-id (${effectiveLastPartitionId}); pick an id above ${effectiveLastPartitionId}.`,
            );
        }
    }
}

/**
 * Check a synthesized CloudFormation template against an Iceberg table's `metadata.json`
 * for column, nested-field, and partition field-id reuse or stale partition metadata.
 *
 * @param template Parsed CloudFormation template JSON.
 * @param metadata Parsed Iceberg `metadata.json`.
 * @param options Optional settings (`{ tableName }`).
 * @returns `{ problems }` array of human-readable violation strings.
 */
function checkFieldIds(template, metadata, options = {}) {
    if (!template || typeof template !== 'object') {
        return {
            problems: ['Invalid CloudFormation template: expected a JSON object.'],
        };
    }
    if (!metadata || typeof metadata !== 'object') {
        return {
            problems: ['Invalid Iceberg metadata: expected a JSON object.'],
        };
    }
    const found = findIcebergTable(template, options.tableName);
    if (found.problem) {
        return {
            problems: [found.problem],
        };
    }
    const problems = [];
    checkColumnIds(found.table.tableInput, metadata, problems);
    checkPartitionIds(found.table.tableInput, metadata, problems);
    return {
        problems,
    };
}

function parseCliArgs(argv) {
    let parsed;
    try {
        parsed = parseArgs({
            args: argv,
            options: {
                table: {
                    type: 'string',
                },
            },
            allowPositionals: true,
        });
    } catch {
        return null;
    }
    const {
        values, positionals,
    } = parsed;
    if (positionals.length !== 2 || !positionals[0] || !positionals[1] || values.table === '') {
        return null;
    }
    return {
        templatePath: positionals[0],
        metadataPath: positionals[1],
        tableName: values.table,
    };
}

function readJson(filePath, label) {
    let text;
    try {
        text = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
        throw new Error(`Cannot read ${label} '${filePath}': ${err.message}`);
    }
    try {
        return JSON.parse(text);
    } catch (err) {
        throw new Error(`Invalid JSON in ${label} '${filePath}': ${err.message}`);
    }
}

if (require.main === module) {
    const args = parseCliArgs(process.argv.slice(2));
    if (!args) {
        console.error(USAGE);
        process.exitCode = 2;
    } else {
        try {
            const template = readJson(args.templatePath, 'template');
            const metadata = readJson(args.metadataPath, 'metadata');
            const { problems } = checkFieldIds(template, metadata, {
                tableName: args.tableName,
            });
            problems.forEach((problem) => console.error(problem));
            process.exitCode = problems.length > 0 ? 1 : 0;
        } catch (err) {
            console.error(err.message);
            process.exitCode = 1;
        }
    }
}

module.exports = {
    checkFieldIds,
    collectFields,
    findIcebergTable,
};
