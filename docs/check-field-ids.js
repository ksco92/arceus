/**
 * Zero-dependency CI checker comparing a synthesized CloudFormation template's
 * `AWS::Glue::Table` Iceberg declaration against a live table's `metadata.json`
 * to guard against cross-deploy column, nested-field, and partition field-id reuse.
 */

const fs = require('fs');

const USAGE = 'usage: check-field-ids.js <template.json> <metadata.json> [--table <name>]';

function collectNestedType(rawType, path, out) {
    let parsed = rawType;
    if (typeof rawType === 'string') {
        const trimmed = rawType.trim();
        if (!trimmed.startsWith('{')) {
            return;
        }
        parsed = JSON.parse(trimmed);
    }
    if (!parsed || typeof parsed !== 'object') {
        return;
    }
    const kind = parsed.type ?? parsed.Type;
    if (kind === 'list') {
        const elementPath = `${path}.element`;
        out.push({
            id: parsed['element-id'] ?? parsed.ElementId,
            path: elementPath,
        });
        collectNestedType(parsed.element ?? parsed.Element, elementPath, out);
    } else if (kind === 'map') {
        const keyPath = `${path}.key`;
        const valuePath = `${path}.value`;
        out.push({
            id: parsed['key-id'] ?? parsed.KeyId,
            path: keyPath,
        });
        out.push({
            id: parsed['value-id'] ?? parsed.ValueId,
            path: valuePath,
        });
        collectNestedType(parsed.key ?? parsed.Key, keyPath, out);
        collectNestedType(parsed.value ?? parsed.Value, valuePath, out);
    } else if (kind === 'struct') {
        collectFields(parsed.fields ?? parsed.Fields, `${path}.`, out);
    }
}

/**
 * Walk Iceberg schema fields recursively into `list`, `map`, and `struct` types.
 *
 * Accepts both CloudFormation `Schema.Fields` entries (PascalCase keys with
 * JSON-stringified or object `Type`) and Iceberg `metadata.json` `fields`.
 *
 * @param fields Array of field definitions.
 * @param prefix Dotted path prefix for nested fields.
 * @param out Accumulator array (created when omitted).
 * @returns Flat list of `{ id, path }` entries.
 */
function collectFields(fields, prefix = '', out = []) {
    for (const field of fields ?? []) {
        if (!field || typeof field !== 'object') {
            continue;
        }
        const rawName = field.name ?? field.Name;
        const name = typeof rawName === 'string' ? rawName : '';
        const segment = /[.`]/.test(name) ? `\`${name.replace(/`/g, '``')}\`` : name;
        const path = `${prefix}${segment}`;
        out.push({
            id: field.id ?? field.Id,
            path,
        });
        collectNestedType(field.type ?? field.Type, path, out);
    }
    return out;
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

function checkColumnIds(tableInput, metadata, problems) {
    const lastColumnId = metadata['last-column-id'];
    if (typeof lastColumnId !== 'number' || !Number.isInteger(lastColumnId)) {
        problems.push("Iceberg metadata is missing integer 'last-column-id'.");
        return;
    }
    if (!Array.isArray(metadata.schemas)) {
        problems.push("Iceberg metadata is missing 'schemas' array.");
        return;
    }
    const currentSchemaId = metadata['current-schema-id'];
    const currentSchema = metadata.schemas.find((s) => s && s['schema-id'] === currentSchemaId);
    if (!currentSchema) {
        problems.push(`Iceberg metadata is missing schema for current-schema-id ${currentSchemaId}.`);
        return;
    }
    if (!Array.isArray(tableInput.Schema?.Fields)) {
        problems.push("Template IcebergTableInput is missing 'Schema.Fields' array.");
        return;
    }
    const activeIds = new Set(collectFields(currentSchema.fields).map((f) => f.id));
    const historicalById = new Map();
    for (const schema of metadata.schemas) {
        for (const { id, path } of collectFields(schema?.fields)) {
            if (!historicalById.has(id)) {
                historicalById.set(id, new Set());
            }
            historicalById.get(id).add(path);
        }
    }
    const seenIds = new Map();
    for (const { id, path } of collectFields(tableInput.Schema.Fields)) {
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
        if (activeIds.has(id)) {
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

function checkPartitionIds(tableInput, metadata, problems) {
    const specs = metadata['partition-specs'];
    if (specs !== undefined && !Array.isArray(specs)) {
        problems.push("Iceberg metadata 'partition-specs' must be an array.");
        return;
    }
    const historicalPartitions = new Map();
    let maxHistoricalPartitionId = 0;
    for (const spec of specs ?? []) {
        for (const field of spec?.fields ?? []) {
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
    const lastPartitionId = metadata['last-partition-id'];
    if (lastPartitionId !== undefined && (typeof lastPartitionId !== 'number' || !Number.isInteger(lastPartitionId))) {
        problems.push("Iceberg metadata has non-integer 'last-partition-id'.");
        return;
    }
    if (lastPartitionId !== undefined && maxHistoricalPartitionId > lastPartitionId) {
        problems.push(
            `Stale last-partition-id (${lastPartitionId} < max historical field-id ${maxHistoricalPartitionId}).`,
        );
    }
    const effectiveLastPartitionId = Math.max(lastPartitionId ?? 0, maxHistoricalPartitionId);
    const partitionFields = tableInput.PartitionSpec?.Fields;
    if (partitionFields !== undefined && !Array.isArray(partitionFields)) {
        problems.push("Template IcebergTableInput 'PartitionSpec.Fields' must be an array.");
        return;
    }
    const seenPartitionIds = new Set();
    for (const field of partitionFields ?? []) {
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

function parseArgs(argv) {
    const positional = [];
    let tableName;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--table') {
            if (i + 1 >= argv.length || !argv[i + 1]) {
                return null;
            }
            tableName = argv[++i];
        } else if (arg.startsWith('--table=')) {
            const value = arg.slice('--table='.length);
            if (!value) {
                return null;
            }
            tableName = value;
        } else if (arg.startsWith('-')) {
            return null;
        } else {
            positional.push(arg);
        }
    }
    if (positional.length !== 2 || !positional[0] || !positional[1]) {
        return null;
    }
    return {
        templatePath: positional[0],
        metadataPath: positional[1],
        tableName,
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
    const args = parseArgs(process.argv.slice(2));
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
