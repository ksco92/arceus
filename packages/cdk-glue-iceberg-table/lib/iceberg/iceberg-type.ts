/**
 * Iceberg primitive and nested type representation.
 *
 * Primitives render to their type string (`int`, `decimal(10, 2)`, ...);
 * `list`, `map`, and `struct` render to a JSON object embedded as a
 * string, carrying the element, key, value, and struct field ids the
 * caller pinned. `IcebergTable` checks those ids are unique across the
 * whole schema. One concrete class discriminated by `kind` keeps the
 * shape the same in every jsii binding.
 */

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
    UNKNOWN = 'unknown',
    TIMESTAMP_NS = 'timestamp_ns',
    TIMESTAMPTZ_NS = 'timestamptz_ns',
    VARIANT = 'variant',
    GEOMETRY = 'geometry',
    GEOGRAPHY = 'geography',
}

/** Edge-interpolation algorithm of a `geography` type. */
export enum IcebergEdgeAlgorithm {
    SPHERICAL = 'spherical',
    VINCENTY = 'vincenty',
    THOMAS = 'thomas',
    ANDOYER = 'andoyer',
    KARNEY = 'karney',
}

/** CRS that `geography(<crs>, <algorithm>)` spells out when only an algorithm is set. */
const DEFAULT_GEO_CRS = 'OGC:CRS84';

/** Definition of a single struct field. */
export interface IcebergStructFieldDefinition {
    /** Iceberg field id of the field. */
    readonly id: number;

    /** Field name (unique within the struct). */
    readonly name: string;

    /** Field type. */
    readonly type: IcebergType;

    /** Whether the field is non-nullable. Defaults to `false`. */
    readonly required?: boolean;

    /** Optional documentation string. */
    readonly doc?: string;
}

/** Definition of a list type. */
export interface IcebergListDefinition {
    /** Element type. */
    readonly element: IcebergType;

    /** Iceberg field id of the element. */
    readonly elementId: number;

    /** Whether elements are non-nullable. Defaults to `false`. */
    readonly elementRequired?: boolean;
}

/** Definition of a map type. Keys are always required per the Iceberg spec. */
export interface IcebergMapDefinition {
    /** Key type. */
    readonly key: IcebergType;

    /** Iceberg field id of the key. */
    readonly keyId: number;

    /** Value type. */
    readonly value: IcebergType;

    /** Iceberg field id of the value. */
    readonly valueId: number;

    /** Whether values are non-nullable. Defaults to `false`. */
    readonly valueRequired?: boolean;
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

    /** Element field id. Checked by `IcebergTable`. */
    readonly listElementId?: number;

    /** Whether list elements are non-nullable. Defaults to `false`. */
    readonly listElementRequired?: boolean;

    /** Map key type. Required when `kind === MAP`. */
    readonly mapKey?: IcebergType;

    /** Map key field id. Checked by `IcebergTable`. */
    readonly mapKeyId?: number;

    /** Map value type. Required when `kind === MAP`. */
    readonly mapValue?: IcebergType;

    /** Map value field id. Checked by `IcebergTable`. */
    readonly mapValueId?: number;

    /** Whether map values are non-nullable. Defaults to `false`. */
    readonly mapValueRequired?: boolean;

    /** Struct fields (non-empty, unique names). Required when `kind === STRUCT`. */
    readonly structFields?: IcebergStructFieldDefinition[];

    /** Coordinate reference system identifier. Optional when `kind` is `GEOMETRY` or `GEOGRAPHY`. */
    readonly geoCrs?: string;

    /** Edge-interpolation algorithm. Optional when `kind === GEOGRAPHY`. */
    readonly geographyAlgorithm?: IcebergEdgeAlgorithm;
}

/**
 * Iceberg type. Use the static factories on this class to construct
 * primitives, decimals, fixed, geospatial types, lists, maps, and structs.
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

    /** Type of a column whose values are always null. Format v3; never required. */
    public static readonly UNKNOWN: IcebergType = new IcebergType({
        kind: IcebergTypeKind.UNKNOWN,
    });

    /** Nanosecond-precision timestamp without zone. Format v3. */
    public static readonly TIMESTAMP_NS: IcebergType = new IcebergType({
        kind: IcebergTypeKind.TIMESTAMP_NS,
    });

    /** Nanosecond-precision timestamp stored as UTC. Format v3. */
    public static readonly TIMESTAMPTZ_NS: IcebergType = new IcebergType({
        kind: IcebergTypeKind.TIMESTAMPTZ_NS,
    });

    /** Semi-structured value: an object, an array, or a primitive. Format v3. */
    public static readonly VARIANT: IcebergType = new IcebergType({
        kind: IcebergTypeKind.VARIANT,
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
     * @param definition Element type, element id, and element nullability.
     */
    public static list(definition: IcebergListDefinition): IcebergType {
        return new IcebergType({
            kind: IcebergTypeKind.LIST,
            listElement: definition.element,
            listElementId: definition.elementId,
            listElementRequired: definition.elementRequired,
        });
    }

    /**
     * Key/value map.
     * @param definition Key and value types, their ids, and value nullability.
     */
    public static map(definition: IcebergMapDefinition): IcebergType {
        return new IcebergType({
            kind: IcebergTypeKind.MAP,
            mapKey: definition.key,
            mapKeyId: definition.keyId,
            mapValue: definition.value,
            mapValueId: definition.valueId,
            mapValueRequired: definition.valueRequired,
        });
    }

    /**
     * Nested struct.
     * @param fields Struct fields (each carries an id, name, type, required flag, optional doc).
     */
    public static struct(fields: IcebergStructFieldDefinition[]): IcebergType {
        return new IcebergType({
            kind: IcebergTypeKind.STRUCT,
            structFields: fields,
        });
    }

    /**
     * Geospatial features with linear edges. Format v3.
     * @param crs Coordinate reference system identifier, such as `EPSG:3857`. Defaults to `OGC:CRS84`.
     */
    public static geometry(crs?: string): IcebergType {
        return new IcebergType({
            kind: IcebergTypeKind.GEOMETRY,
            geoCrs: crs,
        });
    }

    /**
     * Geospatial features with edges interpolated by an algorithm. Format v3.
     * @param crs Coordinate reference system identifier. Defaults to `OGC:CRS84`.
     * @param algorithm Edge-interpolation algorithm. Defaults to `SPHERICAL`.
     */
    public static geography(crs?: string, algorithm?: IcebergEdgeAlgorithm): IcebergType {
        return new IcebergType({
            kind: IcebergTypeKind.GEOGRAPHY,
            geoCrs: crs,
            geographyAlgorithm: algorithm,
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

    /** List element field id (set when `kind === LIST`). */
    public readonly listElementId?: number;

    /** Whether list elements are non-nullable (set when `kind === LIST`). */
    public readonly listElementRequired?: boolean;

    /** Map key type (set when `kind === MAP`). */
    public readonly mapKey?: IcebergType;

    /** Map key field id (set when `kind === MAP`). */
    public readonly mapKeyId?: number;

    /** Map value type (set when `kind === MAP`). */
    public readonly mapValue?: IcebergType;

    /** Map value field id (set when `kind === MAP`). */
    public readonly mapValueId?: number;

    /** Whether map values are non-nullable (set when `kind === MAP`). */
    public readonly mapValueRequired?: boolean;

    /** Struct fields (set when `kind === STRUCT`). */
    public readonly structFields?: IcebergStructFieldDefinition[];

    /** Coordinate reference system (set when `kind` is `GEOMETRY` or `GEOGRAPHY` and one was given). */
    public readonly geoCrs?: string;

    /** Edge-interpolation algorithm (set when one was given). */
    public readonly geographyAlgorithm?: IcebergEdgeAlgorithm;

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
                this.listElementId = options.listElementId;
                this.listElementRequired = options.listElementRequired ?? false;
                break;
            case IcebergTypeKind.MAP:
                if (options.mapKey === undefined || options.mapValue === undefined) {
                    throw new Error('map requires both mapKey and mapValue');
                }
                this.mapKey = options.mapKey;
                this.mapKeyId = options.mapKeyId;
                this.mapValue = options.mapValue;
                this.mapValueId = options.mapValueId;
                this.mapValueRequired = options.mapValueRequired ?? false;
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
            case IcebergTypeKind.GEOMETRY:
            case IcebergTypeKind.GEOGRAPHY:
                if (options.geoCrs !== undefined && !/^[^\s(){},]+$/.test(options.geoCrs)) {
                    throw new Error(
                        `${options.kind} CRS must be a non-empty identifier such as 'EPSG:4326' with no whitespace, `
                        + `parentheses, braces, or commas (inline PROJJSON is not allowed), got '${options.geoCrs}'`,
                    );
                }
                this.geoCrs = options.geoCrs;
                this.geographyAlgorithm = options.geographyAlgorithm;
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
            case IcebergTypeKind.UNKNOWN:
            case IcebergTypeKind.TIMESTAMP_NS:
            case IcebergTypeKind.TIMESTAMPTZ_NS:
            case IcebergTypeKind.VARIANT:
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
     * Render the type at `path` as the string Glue's `IcebergStructField.type`
     * expects. Nested ids are passed through `claimId` once each, and its result is rendered.
     *
     * @internal
     */
    public _render(path: string, claimId: (path: string, id: unknown) => number): string {
        switch (this.kind) {
            case IcebergTypeKind.DECIMAL:
                /// The space after the comma is load-bearing: Iceberg's
                /// canonical decimal form is `decimal(P, S)`, and that is
                /// exactly what Glue writes into the stored table metadata.
                /// Emitting `decimal(P,S)` (no space) makes every later
                /// schema-identical UpdateTable submit a type string that
                /// differs textually from the stored one; Glue reads that as
                /// a phantom column change that adds no schema, then its
                /// set-current-schema step dereferences a "last added schema"
                /// that never got added and fails the deploy with
                /// `Cannot set last added schema: no schema has been added`.
                /// Matching the canonical spacing keeps the submitted schema
                /// byte-identical to the live one. See issue #40.
                return `decimal(${this.decimalPrecision}, ${this.decimalScale})`;
            case IcebergTypeKind.FIXED:
                return `fixed[${this.fixedLength}]`;
            case IcebergTypeKind.GEOMETRY:
                return this.geoCrs === undefined ? 'geometry' : `geometry(${this.geoCrs})`;
            case IcebergTypeKind.GEOGRAPHY:
                if (this.geographyAlgorithm !== undefined) {
                    return `geography(${this.geoCrs ?? DEFAULT_GEO_CRS}, ${this.geographyAlgorithm})`;
                }
                return this.geoCrs === undefined ? 'geography' : `geography(${this.geoCrs})`;
            case IcebergTypeKind.LIST:
                return JSON.stringify({
                    type: 'list',
                    'element-id': claimId(`${path}.element`, this.listElementId),
                    'element-required': this.listElementRequired,
                    element: tryParseObject(this.listElement!._render(`${path}.element`, claimId)),
                });
            case IcebergTypeKind.MAP:
                return JSON.stringify({
                    type: 'map',
                    'key-id': claimId(`${path}.key`, this.mapKeyId),
                    key: tryParseObject(this.mapKey!._render(`${path}.key`, claimId)),
                    'value-id': claimId(`${path}.value`, this.mapValueId),
                    'value-required': this.mapValueRequired,
                    value: tryParseObject(this.mapValue!._render(`${path}.value`, claimId)),
                });
            case IcebergTypeKind.STRUCT: {
                const rendered = this.structFields!.map((field) => {
                    const name = field.name;
                    const fieldPath = `${path}.${pathSegment(name)}`;
                    const id = claimId(fieldPath, field.id);
                    const required = field.required ?? false;
                    const typeRepr = field.type._render(fieldPath, claimId);
                    const out: Record<string, unknown> = {
                        id,
                        name,
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
            case IcebergTypeKind.UNKNOWN:
            case IcebergTypeKind.TIMESTAMP_NS:
            case IcebergTypeKind.TIMESTAMPTZ_NS:
            case IcebergTypeKind.VARIANT:
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
 * Field name as a path segment, in backquotes when it contains a dot.
 *
 * @internal
 */
export function pathSegment(name: string): string {
    return name.includes('.') ? `\`${name}\`` : name;
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
