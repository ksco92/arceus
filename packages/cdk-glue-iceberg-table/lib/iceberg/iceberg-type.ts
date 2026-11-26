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
    /** Iceberg field id of the field: unique across the table schema, from 1 to 2147483447. */
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

    /** Iceberg field id of the element: unique across the table schema, from 1 to 2147483447. */
    readonly elementId: number;

    /** Whether elements are non-nullable. Defaults to `false`. */
    readonly elementRequired?: boolean;
}

/** Definition of a map type. Keys are always required per the Iceberg spec. */
export interface IcebergMapDefinition {
    /** Key type. */
    readonly key: IcebergType;

    /** Iceberg field id of the key: unique across the table schema, from 1 to 2147483447. */
    readonly keyId: number;

    /** Value type. */
    readonly value: IcebergType;

    /** Iceberg field id of the value: unique across the table schema, from 1 to 2147483447. */
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
    public static readonly BOOLEAN: IcebergType = IcebergType.primitive(IcebergTypeKind.BOOLEAN);

    /** 32-bit signed integer. */
    public static readonly INT: IcebergType = IcebergType.primitive(IcebergTypeKind.INT);

    /** 64-bit signed integer. */
    public static readonly LONG: IcebergType = IcebergType.primitive(IcebergTypeKind.LONG);

    /** 32-bit IEEE 754 floating point. */
    public static readonly FLOAT: IcebergType = IcebergType.primitive(IcebergTypeKind.FLOAT);

    /** 64-bit IEEE 754 floating point. */
    public static readonly DOUBLE: IcebergType = IcebergType.primitive(IcebergTypeKind.DOUBLE);

    /** Calendar date with no time of day. */
    public static readonly DATE: IcebergType = IcebergType.primitive(IcebergTypeKind.DATE);

    /** Microsecond-precision time of day, no date, no zone. */
    public static readonly TIME: IcebergType = IcebergType.primitive(IcebergTypeKind.TIME);

    /** Microsecond-precision timestamp without zone. */
    public static readonly TIMESTAMP: IcebergType = IcebergType.primitive(IcebergTypeKind.TIMESTAMP);

    /** Microsecond-precision timestamp stored as UTC. */
    public static readonly TIMESTAMPTZ: IcebergType = IcebergType.primitive(IcebergTypeKind.TIMESTAMPTZ);

    /** UTF-8 string of arbitrary length. */
    public static readonly STRING: IcebergType = IcebergType.primitive(IcebergTypeKind.STRING);

    /** RFC-4122 UUID. */
    public static readonly UUID: IcebergType = IcebergType.primitive(IcebergTypeKind.UUID);

    /** Variable-length byte sequence. */
    public static readonly BINARY: IcebergType = IcebergType.primitive(IcebergTypeKind.BINARY);

    /** Type of a column whose values are always null. Format v3; never required. */
    public static readonly UNKNOWN: IcebergType = IcebergType.primitive(IcebergTypeKind.UNKNOWN);

    /** Nanosecond-precision timestamp without zone. Format v3. */
    public static readonly TIMESTAMP_NS: IcebergType = IcebergType.primitive(IcebergTypeKind.TIMESTAMP_NS);

    /** Nanosecond-precision timestamp stored as UTC. Format v3. */
    public static readonly TIMESTAMPTZ_NS: IcebergType = IcebergType.primitive(IcebergTypeKind.TIMESTAMPTZ_NS);

    /** Semi-structured value: an object, an array, or a primitive. Format v3. */
    public static readonly VARIANT: IcebergType = IcebergType.primitive(IcebergTypeKind.VARIANT);

    private static primitive(kind: IcebergTypeKind): IcebergType {
        return new IcebergType({
            kind,
        });
    }

    /**
     * Fixed-precision decimal.
     * @param precision Total number of digits (1..38).
     * @param scale Digits after the decimal point (0..precision).
     * @returns Decimal Iceberg type.
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
     * @returns Fixed-length Iceberg type.
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
     * @returns List Iceberg type.
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
     * @returns Map Iceberg type.
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
     * @returns Struct Iceberg type.
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
     * @returns Geometry Iceberg type.
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
     * @returns Geography Iceberg type.
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
        }
    }

    /**
     * Render the type as the string Glue's `IcebergStructField.type` expects.
     *
     * @internal
     */
    public _render(): string {
        const json = this.toJson();
        return typeof json === 'string' ? json : JSON.stringify(json);
    }

    private toJson(): unknown {
        switch (this.kind) {
            case IcebergTypeKind.LIST:
                return {
                    type: 'list',
                    'element-id': this.listElementId,
                    'element-required': this.listElementRequired,
                    element: this.listElement!.toJson(),
                };
            case IcebergTypeKind.MAP:
                return {
                    type: 'map',
                    'key-id': this.mapKeyId,
                    key: this.mapKey!.toJson(),
                    'value-id': this.mapValueId,
                    'value-required': this.mapValueRequired,
                    value: this.mapValue!.toJson(),
                };
            case IcebergTypeKind.STRUCT:
                return {
                    type: 'struct',
                    fields: this.structFields!.map((field) => ({
                        id: field.id,
                        name: field.name,
                        required: field.required ?? false,
                        type: field.type.toJson(),
                        doc: field.doc,
                    })),
                };
            default:
                return this.typeString();
        }
    }

    /** The type string of a type that is not a list, map or struct. */
    private typeString(): string {
        switch (this.kind) {
            case IcebergTypeKind.DECIMAL:
                /// The space after the comma matches the decimal form Glue stores. See issue #40.
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
            default:
                return this.kind;
        }
    }
}
