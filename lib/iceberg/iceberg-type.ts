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
 * `IcebergType` is intentionally jsii-friendly: one concrete class,
 * discriminated by a public `kind` enum, all fields are public
 * readonly so non-TypeScript bindings see the same shape, and the
 * public constructor runs the same validation as the static factories
 * (callers cannot reach the constructor without going through a kind
 * + matching data combination).
 */

/** @internal Render-time state — currently just a monotonic id generator. */
export interface IcebergRenderContext {
    /** Returns the next unused field/element/key/value id. */
    nextId(): number;
}

/** Discriminator for `IcebergType`. */
export enum IcebergTypeKind {
    BOOLEAN = 'boolean',
    INT = 'int',
    LONG = 'long',
    FLOAT = 'float',
    DOUBLE = 'double',
    DATE = 'date',
    TIME = 'time',
    TIMESTAMP = 'timestamp',
    TIMESTAMPTZ = 'timestamptz',
    STRING = 'string',
    UUID = 'uuid',
    BINARY = 'binary',
    DECIMAL = 'decimal',
    FIXED = 'fixed',
    LIST = 'list',
    MAP = 'map',
    STRUCT = 'struct',
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
 * The constructor exists for jsii reflection; it runs the same
 * validation as the factories.
 */
export interface IcebergTypeOptions {
    /** Discriminator. */
    readonly kind: IcebergTypeKind;

    /** Decimal precision (1..38). Required when `kind === DECIMAL`. */
    readonly decimalPrecision?: number;

    /** Decimal scale (0..precision). Required when `kind === DECIMAL`. */
    readonly decimalScale?: number;

    /** Fixed-byte length (positive). Required when `kind === FIXED`. */
    readonly fixedLength?: number;

    /** Element type. Required when `kind === LIST`. */
    readonly listElement?: IcebergType;

    /** Whether list elements are non-nullable. Defaults to `true`. */
    readonly listElementRequired?: boolean;

    /** Map key type. Required when `kind === MAP`. */
    readonly mapKey?: IcebergType;

    /** Map value type. Required when `kind === MAP`. */
    readonly mapValue?: IcebergType;

    /** Whether map values are non-nullable. Defaults to `true`. */
    readonly mapValueRequired?: boolean;

    /** Struct fields (non-empty, unique names). Required when `kind === STRUCT`. */
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
        kind: IcebergTypeKind.BOOLEAN,
    });

    /** 32-bit signed integer. */
    public static readonly INT: IcebergType = new IcebergType({
        kind: IcebergTypeKind.INT,
    });

    /** 64-bit signed integer. */
    public static readonly LONG: IcebergType = new IcebergType({
        kind: IcebergTypeKind.LONG,
    });

    /** 32-bit IEEE 754 floating point. */
    public static readonly FLOAT: IcebergType = new IcebergType({
        kind: IcebergTypeKind.FLOAT,
    });

    /** 64-bit IEEE 754 floating point. */
    public static readonly DOUBLE: IcebergType = new IcebergType({
        kind: IcebergTypeKind.DOUBLE,
    });

    /** Calendar date with no time of day. */
    public static readonly DATE: IcebergType = new IcebergType({
        kind: IcebergTypeKind.DATE,
    });

    /** Microsecond-precision time of day, no date, no zone. */
    public static readonly TIME: IcebergType = new IcebergType({
        kind: IcebergTypeKind.TIME,
    });

    /** Microsecond-precision timestamp without zone. */
    public static readonly TIMESTAMP: IcebergType = new IcebergType({
        kind: IcebergTypeKind.TIMESTAMP,
    });

    /** Microsecond-precision timestamp stored as UTC. */
    public static readonly TIMESTAMPTZ: IcebergType = new IcebergType({
        kind: IcebergTypeKind.TIMESTAMPTZ,
    });

    /** UTF-8 string of arbitrary length. */
    public static readonly STRING: IcebergType = new IcebergType({
        kind: IcebergTypeKind.STRING,
    });

    /** RFC-4122 UUID. */
    public static readonly UUID: IcebergType = new IcebergType({
        kind: IcebergTypeKind.UUID,
    });

    /** Variable-length byte sequence. */
    public static readonly BINARY: IcebergType = new IcebergType({
        kind: IcebergTypeKind.BINARY,
    });

    /**
     * Fixed-precision decimal.
     * @param precision Total number of digits (1..38).
     * @param scale Digits after the decimal point (0..precision).
     */
    public static decimal(precision: number, scale: number): IcebergType {
        return new IcebergType({
            kind: IcebergTypeKind.DECIMAL,
            decimalPrecision: precision,
            decimalScale: scale,
        });
    }

    /**
     * Fixed-length byte array.
     * @param length Byte length (must be positive).
     */
    public static fixed(length: number): IcebergType {
        return new IcebergType({
            kind: IcebergTypeKind.FIXED,
            fixedLength: length,
        });
    }

    /**
     * Ordered list of values.
     * @param element Element type.
     * @param elementRequired Whether elements are non-nullable. Defaults to `true` (non-null).
     */
    public static list(element: IcebergType, elementRequired = true): IcebergType {
        return new IcebergType({
            kind: IcebergTypeKind.LIST,
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
            kind: IcebergTypeKind.MAP,
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
        return new IcebergType({
            kind: IcebergTypeKind.STRUCT,
            structFields: fields,
        });
    }

    /** Discriminator. */
    public readonly kind: IcebergTypeKind;

    /** Decimal precision (set when `kind === DECIMAL`). */
    public readonly decimalPrecision?: number;

    /** Decimal scale (set when `kind === DECIMAL`). */
    public readonly decimalScale?: number;

    /** Fixed-byte length (set when `kind === FIXED`). */
    public readonly fixedLength?: number;

    /** List element type (set when `kind === LIST`). */
    public readonly listElement?: IcebergType;

    /** Whether list elements are non-nullable (set when `kind === LIST`). */
    public readonly listElementRequired?: boolean;

    /** Map key type (set when `kind === MAP`). */
    public readonly mapKey?: IcebergType;

    /** Map value type (set when `kind === MAP`). */
    public readonly mapValue?: IcebergType;

    /** Whether map values are non-nullable (set when `kind === MAP`). */
    public readonly mapValueRequired?: boolean;

    /** Struct fields (set when `kind === STRUCT`). */
    public readonly structFields?: IcebergStructFieldDefinition[];

    public constructor(options: IcebergTypeOptions) {
        this.kind = options.kind;
        switch (options.kind) {
            case IcebergTypeKind.DECIMAL:
                if (options.decimalPrecision === undefined || options.decimalScale === undefined) {
                    throw new Error('decimal requires both decimalPrecision and decimalScale');
                }
                if (!Number.isInteger(options.decimalPrecision)
                    || options.decimalPrecision < 1
                    || options.decimalPrecision > 38) {
                    throw new Error(
                        `decimal precision must be an integer in [1, 38], got ${options.decimalPrecision}`,
                    );
                }
                if (!Number.isInteger(options.decimalScale)
                    || options.decimalScale < 0
                    || options.decimalScale > options.decimalPrecision) {
                    throw new Error(
                        `decimal scale must be an integer in [0, ${options.decimalPrecision}], got ${options.decimalScale}`,
                    );
                }
                this.decimalPrecision = options.decimalPrecision;
                this.decimalScale = options.decimalScale;
                break;
            case IcebergTypeKind.FIXED:
                if (options.fixedLength === undefined) {
                    throw new Error('fixed requires fixedLength');
                }
                if (!Number.isInteger(options.fixedLength) || options.fixedLength < 1) {
                    throw new Error(`fixed length must be a positive integer, got ${options.fixedLength}`);
                }
                this.fixedLength = options.fixedLength;
                break;
            case IcebergTypeKind.LIST:
                if (options.listElement === undefined) {
                    throw new Error('list requires listElement');
                }
                this.listElement = options.listElement;
                this.listElementRequired = options.listElementRequired ?? true;
                break;
            case IcebergTypeKind.MAP:
                if (options.mapKey === undefined || options.mapValue === undefined) {
                    throw new Error('map requires both mapKey and mapValue');
                }
                this.mapKey = options.mapKey;
                this.mapValue = options.mapValue;
                this.mapValueRequired = options.mapValueRequired ?? true;
                break;
            case IcebergTypeKind.STRUCT:
                if (options.structFields === undefined || options.structFields.length === 0) {
                    throw new Error('struct requires at least one structField');
                }
                /// Field names must be unique.
                const seenNames = new Set<string>();
                for (const field of options.structFields) {
                    if (seenNames.has(field.name)) {
                        throw new Error(`duplicate field name in struct: ${field.name}`);
                    }
                    seenNames.add(field.name);
                }
                this.structFields = options.structFields;
                break;
            case IcebergTypeKind.BOOLEAN:
            case IcebergTypeKind.INT:
            case IcebergTypeKind.LONG:
            case IcebergTypeKind.FLOAT:
            case IcebergTypeKind.DOUBLE:
            case IcebergTypeKind.DATE:
            case IcebergTypeKind.TIME:
            case IcebergTypeKind.TIMESTAMP:
            case IcebergTypeKind.TIMESTAMPTZ:
            case IcebergTypeKind.STRING:
            case IcebergTypeKind.UUID:
            case IcebergTypeKind.BINARY:
                /// Primitives carry no extra data.
                break;
            /* istanbul ignore next: defensive — TS exhaustiveness covers this, only reachable from non-TS bindings */
            default: {
                const exhaustive: never = options.kind;
                throw new Error(`unknown IcebergTypeKind: ${exhaustive}`);
            }
        }
    }

    /**
     * Render the type as the string Glue's `IcebergStructField.type`
     * expects. Primitives return their canonical name; nested types
     * return a JSON-encoded object.
     *
     * @internal
     */
    public _render(ctx: IcebergRenderContext): string {
        switch (this.kind) {
            case IcebergTypeKind.DECIMAL:
                return `decimal(${this.decimalPrecision},${this.decimalScale})`;
            case IcebergTypeKind.FIXED:
                return `fixed[${this.fixedLength}]`;
            case IcebergTypeKind.LIST: {
                const elementId = ctx.nextId();
                const elementRepr = this.listElement!._render(ctx);
                return JSON.stringify({
                    type: 'list',
                    'element-id': elementId,
                    'element-required': this.listElementRequired,
                    element: tryParseObject(elementRepr),
                });
            }
            case IcebergTypeKind.MAP: {
                const keyId = ctx.nextId();
                const valueId = ctx.nextId();
                const keyRepr = this.mapKey!._render(ctx);
                const valueRepr = this.mapValue!._render(ctx);
                return JSON.stringify({
                    type: 'map',
                    'key-id': keyId,
                    key: tryParseObject(keyRepr),
                    'value-id': valueId,
                    'value-required': this.mapValueRequired,
                    value: tryParseObject(valueRepr),
                });
            }
            case IcebergTypeKind.STRUCT: {
                const rendered = this.structFields!.map((field) => {
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
            case IcebergTypeKind.BOOLEAN:
            case IcebergTypeKind.INT:
            case IcebergTypeKind.LONG:
            case IcebergTypeKind.FLOAT:
            case IcebergTypeKind.DOUBLE:
            case IcebergTypeKind.DATE:
            case IcebergTypeKind.TIME:
            case IcebergTypeKind.TIMESTAMP:
            case IcebergTypeKind.TIMESTAMPTZ:
            case IcebergTypeKind.STRING:
            case IcebergTypeKind.UUID:
            case IcebergTypeKind.BINARY:
                return this.kind;
            /* istanbul ignore next: defensive — TS exhaustiveness covers this, only reachable from non-TS bindings */
            default: {
                const exhaustive: never = this.kind;
                throw new Error(`unknown IcebergTypeKind in _render: ${exhaustive}`);
            }
        }
    }

    /** Whether this type is the Iceberg primitive of the given canonical name. */
    public isPrimitive(canonical: string): boolean {
        return this.kind === canonical;
    }

    /** Whether this type is `decimal(P, S)` for any `P, S`. */
    public isDecimal(): boolean {
        return this.kind === IcebergTypeKind.DECIMAL;
    }

    /** Whether this type is `fixed[L]` for any `L`. */
    public isFixed(): boolean {
        return this.kind === IcebergTypeKind.FIXED;
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
