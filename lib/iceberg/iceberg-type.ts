/**
 * Iceberg primitive and nested type representation.
 *
 * Iceberg field types are serialized to a string when a primitive
 * (`int`, `long`, `decimal(10,2)`, ...) and to a JSON object embedded
 * as a string when nested (`list`, `map`, `struct`). The Glue CFN
 * surface accepts either form in `IcebergStructField.type`, so the L2
 * always renders to `string`.
 *
 * Nested types carry their own field IDs (`element-id`, `key-id`,
 * `value-id`, and per-field `id` inside structs). Those IDs must be
 * globally unique inside one Iceberg table — so when `IcebergTable`
 * walks its columns it threads a single monotonically-increasing
 * counter through every type to assign them.
 */

/** @internal Render-time state — currently just a monotonic id generator. */
export interface IcebergRenderContext {
    /** Returns the next unused field/element/key/value id. */
    nextId(): number;
}

/** Definition of a single struct field. */
export interface IcebergStructFieldDefinition {
    /** Field name (unique within the struct). */
    readonly name: string;

    /** Field type. */
    readonly type: IcebergType;

    /** Whether the field is non-nullable. Defaults to `false`. */
    readonly required?: boolean;

    /** Optional documentation string. */
    readonly doc?: string;
}

type RenderFn = (ctx: IcebergRenderContext) => string;

/**
 * Iceberg type. Use the static factories on this class — the
 * constructor is `private` so users can't introduce arbitrary types
 * that bypass validation.
 */
export class IcebergType {
    /// Primitives — values from https://iceberg.apache.org/spec/#schemas-and-data-types

    /** Boolean. */
    public static readonly BOOLEAN: IcebergType = IcebergType.primitive('boolean');

    /** 32-bit signed integer. */
    public static readonly INT: IcebergType = IcebergType.primitive('int');

    /** 64-bit signed integer. */
    public static readonly LONG: IcebergType = IcebergType.primitive('long');

    /** 32-bit IEEE 754 floating point. */
    public static readonly FLOAT: IcebergType = IcebergType.primitive('float');

    /** 64-bit IEEE 754 floating point. */
    public static readonly DOUBLE: IcebergType = IcebergType.primitive('double');

    /** Calendar date with no time of day. */
    public static readonly DATE: IcebergType = IcebergType.primitive('date');

    /** Microsecond-precision time of day, no date, no zone. */
    public static readonly TIME: IcebergType = IcebergType.primitive('time');

    /** Microsecond-precision timestamp without zone. */
    public static readonly TIMESTAMP: IcebergType = IcebergType.primitive('timestamp');

    /** Microsecond-precision timestamp stored as UTC. */
    public static readonly TIMESTAMPTZ: IcebergType = IcebergType.primitive('timestamptz');

    /** UTF-8 string of arbitrary length. */
    public static readonly STRING: IcebergType = IcebergType.primitive('string');

    /** RFC-4122 UUID. */
    public static readonly UUID: IcebergType = IcebergType.primitive('uuid');

    /** Variable-length byte sequence. */
    public static readonly BINARY: IcebergType = IcebergType.primitive('binary');

    /**
     * Fixed-precision decimal.
     * @param precision Total number of digits (1..38).
     * @param scale Digits after the decimal point (0..precision).
     */
    public static decimal(precision: number, scale: number): IcebergType {
        if (!Number.isInteger(precision) || precision < 1 || precision > 38) {
            throw new Error(`decimal precision must be an integer in [1, 38], got ${precision}`);
        }
        if (!Number.isInteger(scale) || scale < 0 || scale > precision) {
            throw new Error(`decimal scale must be an integer in [0, ${precision}], got ${scale}`);
        }
        return IcebergType.primitive(`decimal(${precision},${scale})`);
    }

    /**
     * Fixed-length byte array.
     * @param length Byte length (must be positive).
     */
    public static fixed(length: number): IcebergType {
        if (!Number.isInteger(length) || length < 1) {
            throw new Error(`fixed length must be a positive integer, got ${length}`);
        }
        return IcebergType.primitive(`fixed[${length}]`);
    }

    /**
     * Ordered list of values.
     * @param element Element type.
     * @param elementRequired Whether elements are non-nullable. Defaults to `true` (non-null).
     */
    public static list(element: IcebergType, elementRequired = true): IcebergType {
        return new IcebergType('list', (ctx) => {
            const elementId = ctx.nextId();
            const elementRepr = element._render(ctx);
            return JSON.stringify({
                type: 'list',
                'element-id': elementId,
                'element-required': elementRequired,
                element: tryParseObject(elementRepr),
            });
        });
    }

    /**
     * Key/value map. Keys are always required per the Iceberg spec.
     * @param key Key type.
     * @param value Value type.
     * @param valueRequired Whether values are non-nullable. Defaults to `true` (non-null).
     */
    public static map(key: IcebergType, value: IcebergType, valueRequired = true): IcebergType {
        return new IcebergType('map', (ctx) => {
            const keyId = ctx.nextId();
            const valueId = ctx.nextId();
            const keyRepr = key._render(ctx);
            const valueRepr = value._render(ctx);
            return JSON.stringify({
                type: 'map',
                'key-id': keyId,
                key: tryParseObject(keyRepr),
                'value-id': valueId,
                'value-required': valueRequired,
                value: tryParseObject(valueRepr),
            });
        });
    }

    /**
     * Nested struct.
     * @param fields Struct fields (each carries a name, type, required flag, optional doc).
     */
    public static struct(fields: IcebergStructFieldDefinition[]): IcebergType {
        if (fields.length === 0) {
            throw new Error('struct() requires at least one field');
        }
        const seen = new Set<string>();
        for (const field of fields) {
            if (seen.has(field.name)) {
                throw new Error(`duplicate field name in struct: ${field.name}`);
            }
            seen.add(field.name);
        }
        return new IcebergType('struct', (ctx) => {
            const rendered = fields.map((field) => {
                const id = ctx.nextId();
                const required = field.required ?? false;
                const typeRepr = field.type._render(ctx);
                const out: Record<string, unknown> = {
                    id,
                    name: field.name,
                    required,
                    type: tryParseObject(typeRepr),
                };
                if (field.doc !== undefined) {
                    out.doc = field.doc;
                }
                return out;
            });
            return JSON.stringify({
                type: 'struct',
                fields: rendered,
            });
        });
    }

    private static primitive(canonical: string): IcebergType {
        return new IcebergType(canonical, () => canonical);
    }

    /** Stable identifier used by partition / sort transform validators. */
    public readonly kind: string;

    private readonly renderFn: RenderFn;

    private constructor(kind: string, renderFn: RenderFn) {
        this.kind = kind;
        this.renderFn = renderFn;
    }

    /**
     * Render the type as the string Glue's `IcebergStructField.type`
     * expects. Primitives return their canonical name; nested types
     * return a JSON-encoded object.
     *
     * @internal
     */
    public _render(ctx: IcebergRenderContext): string {
        return this.renderFn(ctx);
    }

    /** Whether this type is the Iceberg primitive of the given canonical name. */
    public isPrimitive(canonical: string): boolean {
        return this.kind === canonical;
    }

    /** Whether this type is `decimal(P, S)` for any `P, S`. */
    public isDecimal(): boolean {
        return this.kind.startsWith('decimal(');
    }

    /** Whether this type is `fixed[L]` for any `L`. */
    public isFixed(): boolean {
        return this.kind.startsWith('fixed[');
    }
}

/**
 * Parse a string as JSON if it looks like an object, otherwise return
 * the string unchanged. Used so that when we embed a nested type
 * representation back inside a parent JSON object the result is
 * structured JSON, not a doubly-encoded string.
 *
 * @internal
 */
function tryParseObject(repr: string): unknown {
    const first = repr.charAt(0);
    if (first === '{' || first === '[') {
        return JSON.parse(repr);
    }
    return repr;
}
