import {
    IcebergType,
    IcebergTypeKind,
} from './iceberg-type';

/**
 * Discriminator for `IcebergPartitionTransform`.
 */
export enum IcebergPartitionTransformKind {
    IDENTITY = 'identity',
    YEAR = 'year',
    MONTH = 'month',
    DAY = 'day',
    HOUR = 'hour',
    VOID = 'void',
    BUCKET = 'bucket',
    TRUNCATE = 'truncate',
}

/**
 * Construction options for an `IcebergPartitionTransform`.
 *
 * Most callers should use the static factories
 * (`IcebergPartitionTransform.IDENTITY`,
 * `IcebergPartitionTransform.bucket(...)`, etc.) rather than
 * instantiate directly. The constructor exists for jsii reflection
 * and runs the same validation as the factories.
 */
export interface IcebergPartitionTransformOptions {
    /** Discriminator. */
    readonly kind: IcebergPartitionTransformKind;

    /** Number of buckets (positive integer). Required when `kind === BUCKET`. */
    readonly bucketCount?: number;

    /** Truncate width (positive integer). Required when `kind === TRUNCATE`. */
    readonly truncateWidth?: number;
}

/**
 * One of the partition / sort transforms defined in the Iceberg spec.
 *
 * Use the static factories on this class to construct one. The
 * resulting object knows (a) the literal string Glue expects for
 * `IcebergPartitionField.transform` and (b) which source column types
 * it is legal to apply against.
 */
export class IcebergPartitionTransform {
    /** `identity` — source value unmodified. Legal on any column type. */
    public static readonly IDENTITY: IcebergPartitionTransform = new IcebergPartitionTransform({
        kind: IcebergPartitionTransformKind.IDENTITY,
    });

    /** `year` — extracts the year of a date or timestamp (nanosecond timestamps included). */
    public static readonly YEAR: IcebergPartitionTransform = new IcebergPartitionTransform({
        kind: IcebergPartitionTransformKind.YEAR,
    });

    /** `month` — extracts the month of a date or timestamp (nanosecond timestamps included). */
    public static readonly MONTH: IcebergPartitionTransform = new IcebergPartitionTransform({
        kind: IcebergPartitionTransformKind.MONTH,
    });

    /** `day` — extracts the day of a date or timestamp (nanosecond timestamps included). */
    public static readonly DAY: IcebergPartitionTransform = new IcebergPartitionTransform({
        kind: IcebergPartitionTransformKind.DAY,
    });

    /** `hour` — extracts the hour of a timestamp (nanosecond timestamps included, not a date). */
    public static readonly HOUR: IcebergPartitionTransform = new IcebergPartitionTransform({
        kind: IcebergPartitionTransformKind.HOUR,
    });

    /** `void` — always-null partition. Useful for partition-spec evolution. */
    public static readonly VOID: IcebergPartitionTransform = new IcebergPartitionTransform({
        kind: IcebergPartitionTransformKind.VOID,
    });

    /**
     * `bucket[N]` — Murmur3 hash of the source mod N.
     * @param numBuckets Number of buckets (positive integer).
     */
    public static bucket(numBuckets: number): IcebergPartitionTransform {
        return new IcebergPartitionTransform({
            kind: IcebergPartitionTransformKind.BUCKET,
            bucketCount: numBuckets,
        });
    }

    /**
     * `truncate[W]` — truncate the source to width W.
     * @param width Width (positive integer).
     */
    public static truncate(width: number): IcebergPartitionTransform {
        return new IcebergPartitionTransform({
            kind: IcebergPartitionTransformKind.TRUNCATE,
            truncateWidth: width,
        });
    }

    /** Discriminator. */
    public readonly kind: IcebergPartitionTransformKind;

    /** Number of buckets (set when `kind === BUCKET`). */
    public readonly bucketCount?: number;

    /** Truncate width (set when `kind === TRUNCATE`). */
    public readonly truncateWidth?: number;

    public constructor(options: IcebergPartitionTransformOptions) {
        const {
            kind,
            bucketCount,
            truncateWidth,
        } = options;
        this.kind = kind;
        switch (kind) {
            case IcebergPartitionTransformKind.BUCKET:
                if (bucketCount === undefined) {
                    throw new Error('bucket transform requires bucketCount');
                }
                if (!Number.isInteger(bucketCount) || bucketCount < 1) {
                    throw new Error(`bucket() numBuckets must be a positive integer, got ${bucketCount}`);
                }
                this.bucketCount = bucketCount;
                break;
            case IcebergPartitionTransformKind.TRUNCATE:
                if (truncateWidth === undefined) {
                    throw new Error('truncate transform requires truncateWidth');
                }
                if (!Number.isInteger(truncateWidth) || truncateWidth < 1) {
                    throw new Error(`truncate() width must be a positive integer, got ${truncateWidth}`);
                }
                this.truncateWidth = truncateWidth;
                break;
        }
    }

    /** Iceberg/Glue transform string (e.g. `identity`, `bucket[16]`, `hour`). */
    public toTransformString(): string {
        switch (this.kind) {
            case IcebergPartitionTransformKind.BUCKET:
                return `bucket[${this.bucketCount}]`;
            case IcebergPartitionTransformKind.TRUNCATE:
                return `truncate[${this.truncateWidth}]`;
            default:
                return this.kind;
        }
    }

    /**
     * Throws if this transform is not legal on the given source type.
     *
     * @internal
     */
    public _validateSourceType(sourceColumnName: string, sourceType: IcebergType): void {
        if (sourceType.kind === IcebergTypeKind.VARIANT) {
            throw new Error(
                `column '${sourceColumnName}' has type variant, which cannot be a partition or sort source`,
            );
        }
        if (
            (
                sourceType.kind === IcebergTypeKind.GEOMETRY
                || sourceType.kind === IcebergTypeKind.GEOGRAPHY
                || sourceType.kind === IcebergTypeKind.UNKNOWN
            )
            && this.kind !== IcebergPartitionTransformKind.VOID
        ) {
            throw new Error(
                `partition transform '${this.toTransformString()}' on column '${sourceColumnName}' `
                + `is not allowed on ${sourceType.kind}; only 'void' is`,
            );
        }
        const legal = LEGAL_SOURCE_KINDS[this.kind];
        if (legal !== undefined && !legal.includes(sourceType.kind)) {
            throw new Error(
                `partition transform '${this.toTransformString()}' on column '${sourceColumnName}' requires `
                + `${/^[aeiou]/.test(legal[0]) ? 'an' : 'a'} ${legal.join('/')} column`,
            );
        }
    }
}

const TIMESTAMP_KINDS = [
    IcebergTypeKind.TIMESTAMP,
    IcebergTypeKind.TIMESTAMPTZ,
    IcebergTypeKind.TIMESTAMP_NS,
    IcebergTypeKind.TIMESTAMPTZ_NS,
];

const TEMPORAL_KINDS = [
    IcebergTypeKind.DATE,
    ...TIMESTAMP_KINDS,
];

/** Source column types a transform is limited to; one not listed is limited only by the checks in _validateSourceType. */
const LEGAL_SOURCE_KINDS: { [kind in IcebergPartitionTransformKind]?: IcebergTypeKind[] } = {
    [IcebergPartitionTransformKind.YEAR]: TEMPORAL_KINDS,
    [IcebergPartitionTransformKind.MONTH]: TEMPORAL_KINDS,
    [IcebergPartitionTransformKind.DAY]: TEMPORAL_KINDS,
    [IcebergPartitionTransformKind.HOUR]: TIMESTAMP_KINDS,
    [IcebergPartitionTransformKind.BUCKET]: [
        IcebergTypeKind.INT,
        IcebergTypeKind.LONG,
        IcebergTypeKind.DECIMAL,
        IcebergTypeKind.DATE,
        IcebergTypeKind.TIME,
        ...TIMESTAMP_KINDS,
        IcebergTypeKind.STRING,
        IcebergTypeKind.UUID,
        IcebergTypeKind.FIXED,
        IcebergTypeKind.BINARY,
    ],
    [IcebergPartitionTransformKind.TRUNCATE]: [
        IcebergTypeKind.INT,
        IcebergTypeKind.LONG,
        IcebergTypeKind.DECIMAL,
        IcebergTypeKind.STRING,
        IcebergTypeKind.BINARY,
    ],
};
