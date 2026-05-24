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
 *
 * The type model is intentionally jsii-compatible — no private
 * constructors, no function types stored as fields. `IcebergType` is
 * a single concrete class discriminated by `kind` plus optional data
 * fields for the nested-type variants. Users construct instances via
 * the static factories on the class (or the `IcebergType.BOOLEAN` etc.
 * primitive instances); the public constructor exists so that
 * non-TypeScript bindings can reach the same surface.
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

/**
 * Construction options for an `IcebergType`.
 *
 * Most callers should use the static factories (`IcebergType.BOOLEAN`,
 * `IcebergType.list(...)`, etc.) rather than instantiate directly.
 * The constructor is public only because jsii reflection requires it.
 */
export interface IcebergTypeOptions {
    /**
     * Canonical Iceberg-spec name for the type (e.g. `boolean`, `int`,
     * `decimal(10,2)`, `list`, `map`, `struct`).
     */
    readonly kind: string;

    /** Element type. Set when `kind === 'list'`. */
    readonly listElement?: IcebergType;

    /** Whether list elements are non-nullable. Set when `kind === 'list'`. */
    readonly listElementRequired?: boolean;

    /** Map key type. Set when `kind === 'map'`. */
    readonly mapKey?: IcebergType;

    /** Map value type. Set when `kind === 'map'`. */
    readonly mapValue?: IcebergType;

    /** Whether map values are non-nullable. Set when `kind === 'map'`. */
    readonly mapValueRequired?: boolean;

    /** Struct fields. Set when `kind === 'struct'`. */
    readonly structFields?: IcebergStructFieldDefinition[];
}

/**
 * Iceberg type. Use the static factories on this class to construct
 * primitives, decimals, fixed, lists, maps, and structs.
 */
export class IcebergType {
    /// Primitives — values from https://iceberg.apache.org/spec/#schemas-and-data-types

    /** Boolean. */
    public static readonly BOOLEAN: IcebergType = new IcebergType({
        kind: 'boolean',
    });

    /** 32-bit signed integer. */
    public static readonly INT: IcebergType = new IcebergType({
        kind: 'int',
    });

    /** 64-bit signed integer. */
    public static readonly LONG: IcebergType = new IcebergType({
        kind: 'long',
    });

    /** 32-bit IEEE 754 floating point. */
    public static readonly FLOAT: IcebergType = new IcebergType({
        kind: 'float',
    });

    /** 64-bit IEEE 754 floating point. */
    public static readonly DOUBLE: IcebergType = new IcebergType({
        kind: 'double',
    });

    /** Calendar date with no time of day. */
    public static readonly DATE: IcebergType = new IcebergType({
        kind: 'date',
    });

    /** Microsecond-precision time of day, no date, no zone. */
    public static readonly TIME: IcebergType = new IcebergType({
        kind: 'time',
    });

    /** Microsecond-precision timestamp without zone. */
    public static readonly TIMESTAMP: IcebergType = new IcebergType({
        kind: 'timestamp',
    });

    /** Microsecond-precision timestamp stored as UTC. */
    public static readonly TIMESTAMPTZ: IcebergType = new IcebergType({
        kind: 'timestamptz',
    });

    /** UTF-8 string of arbitrary length. */
    public static readonly STRING: IcebergType = new IcebergType({
        kind: 'string',
    });

    /** RFC-4122 UUID. */
    public static readonly UUID: IcebergType = new IcebergType({
        kind: 'uuid',
    });

    /** Variable-length byte sequence. */
    public static readonly BINARY: IcebergType = new IcebergType({
        kind: 'binary',
    });

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
        return new IcebergType({
            kind: `decimal(${precision},${scale})`,
        });
    }

    /**
     * Fixed-length byte array.
     * @param length Byte length (must be positive).
     */
    public static fixed(length: number): IcebergType {
        if (!Number.isInteger(length) || length < 1) {
            throw new Error(`fixed length must be a positive integer, got ${length}`);
        }
        return new IcebergType({
            kind: `fixed[${length}]`,
        });
    }

    /**
     * Ordered list of values.
     * @param element Element type.
     * @param elementRequired Whether elements are non-nullable. Defaults to `true` (non-null).
     */
    public static list(element: IcebergType, elementRequired = true): IcebergType {
        return new IcebergType({
            kind: 'list',
            listElement: element,
            listElementRequired: elementRequired,
        });
    }

    /**
     * Key/value map. Keys are always required per the Iceberg spec.
     * @param key Key type.
     * @param value Value type.
     * @param valueRequired Whether values are non-nullable. Defaults to `true` (non-null).
     */
    public static map(key: IcebergType, value: IcebergType, valueRequired = true): IcebergType {
        return new IcebergType({
            kind: 'map',
            mapKey: key,
            mapValue: value,
            mapValueRequired: valueRequired,
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
        return new IcebergType({
            kind: 'struct',
            structFields: fields,
        });
    }

    /** Canonical Iceberg-spec name of the type. */
    public readonly kind: string;

    /** @internal */
    public readonly _listElement?: IcebergType;

    /** @internal */
    public readonly _listElementRequired?: boolean;

    /** @internal */
    public readonly _mapKey?: IcebergType;

    /** @internal */
    public readonly _mapValue?: IcebergType;

    /** @internal */
    public readonly _mapValueRequired?: boolean;

    /** @internal */
    public readonly _structFields?: IcebergStructFieldDefinition[];

    public constructor(options: IcebergTypeOptions) {
        this.kind = options.kind;
        this._listElement = options.listElement;
        this._listElementRequired = options.listElementRequired;
        this._mapKey = options.mapKey;
        this._mapValue = options.mapValue;
        this._mapValueRequired = options.mapValueRequired;
        this._structFields = options.structFields;
    }

    /**
     * Render the type as the string Glue's `IcebergStructField.type`
     * expects. Primitives return their canonical name; nested types
     * return a JSON-encoded object.
     *
     * @internal
     */
    public _render(ctx: IcebergRenderContext): string {
        if (this._listElement !== undefined) {
            const elementId = ctx.nextId();
            const elementRepr = this._listElement._render(ctx);
            return JSON.stringify({
                type: 'list',
                'element-id': elementId,
                'element-required': this._listElementRequired,
                element: tryParseObject(elementRepr),
            });
        }
        if (this._mapKey !== undefined && this._mapValue !== undefined) {
            const keyId = ctx.nextId();
            const valueId = ctx.nextId();
            const keyRepr = this._mapKey._render(ctx);
            const valueRepr = this._mapValue._render(ctx);
            return JSON.stringify({
                type: 'map',
                'key-id': keyId,
                key: tryParseObject(keyRepr),
                'value-id': valueId,
                'value-required': this._mapValueRequired,
                value: tryParseObject(valueRepr),
            });
        }
        if (this._structFields !== undefined) {
            const rendered = this._structFields.map((field) => {
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
        }
        return this.kind;
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
