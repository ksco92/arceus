import {
    IcebergType,
} from './iceberg-type';

/**
 * Discriminator for the kind of transform. Used by the source-type
 * validator (in this file) and by the renderer (which just calls
 * `toTransformString()`).
 *
 * @internal
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
 * Most callers should use the static factories (`IcebergPartitionTransform.IDENTITY`,
 * `IcebergPartitionTransform.bucket(...)`, etc.) rather than instantiate
 * directly. The constructor is public only because jsii reflection
 * requires it.
 */
export interface IcebergPartitionTransformOptions {
    /** Discriminator for source-type validation. */
    readonly kind: IcebergPartitionTransformKind;

    /** Number of buckets — required when `kind === BUCKET`. */
    readonly bucketCount?: number;

    /** Truncate width — required when `kind === TRUNCATE`. */
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

    /** `year` — extracts the year of a date/timestamp. */
    public static readonly YEAR: IcebergPartitionTransform = new IcebergPartitionTransform({
        kind: IcebergPartitionTransformKind.YEAR,
    });

    /** `month` — extracts the month of a date/timestamp. */
    public static readonly MONTH: IcebergPartitionTransform = new IcebergPartitionTransform({
        kind: IcebergPartitionTransformKind.MONTH,
    });

    /** `day` — extracts the day of a date/timestamp. */
    public static readonly DAY: IcebergPartitionTransform = new IcebergPartitionTransform({
        kind: IcebergPartitionTransformKind.DAY,
    });

    /** `hour` — extracts the hour of a timestamp (not a date). */
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
        if (!Number.isInteger(numBuckets) || numBuckets < 1) {
            throw new Error(`bucket() numBuckets must be a positive integer, got ${numBuckets}`);
        }
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
        if (!Number.isInteger(width) || width < 1) {
            throw new Error(`truncate() width must be a positive integer, got ${width}`);
        }
        return new IcebergPartitionTransform({
            kind: IcebergPartitionTransformKind.TRUNCATE,
            truncateWidth: width,
        });
    }

    /** Discriminator. */
    public readonly kind: IcebergPartitionTransformKind;

    /** @internal */
    public readonly _bucketCount?: number;

    /** @internal */
    public readonly _truncateWidth?: number;

    public constructor(options: IcebergPartitionTransformOptions) {
        if (options.kind === IcebergPartitionTransformKind.BUCKET && options.bucketCount === undefined) {
            throw new Error('bucket transform requires bucketCount');
        }
        if (options.kind === IcebergPartitionTransformKind.TRUNCATE && options.truncateWidth === undefined) {
            throw new Error('truncate transform requires truncateWidth');
        }
        this.kind = options.kind;
        this._bucketCount = options.bucketCount;
        this._truncateWidth = options.truncateWidth;
    }

    /** Iceberg/Glue transform string (e.g. `identity`, `bucket[16]`, `hour`). */
    public toTransformString(): string {
        switch (this.kind) {
            case IcebergPartitionTransformKind.BUCKET:
                return `bucket[${this._bucketCount}]`;
            case IcebergPartitionTransformKind.TRUNCATE:
                return `truncate[${this._truncateWidth}]`;
            default:
                return this.kind;
        }
    }

    /**
     * Throws if this transform is not legal on the given source type.
     *
     * @internal
     */
    public validateSourceType(sourceColumnName: string, sourceType: IcebergType): void {
        switch (this.kind) {
            case IcebergPartitionTransformKind.IDENTITY:
            case IcebergPartitionTransformKind.VOID:
                return;
            case IcebergPartitionTransformKind.YEAR:
            case IcebergPartitionTransformKind.MONTH:
            case IcebergPartitionTransformKind.DAY:
                if (!isTemporal(sourceType)) {
                    throw new Error(
                        `partition transform '${this.kind}' on column '${sourceColumnName}' `
                        + 'requires a date/timestamp/timestamptz column',
                    );
                }
                return;
            case IcebergPartitionTransformKind.HOUR:
                if (!isTimestamp(sourceType)) {
                    throw new Error(
                        `partition transform 'hour' on column '${sourceColumnName}' `
                        + 'requires a timestamp/timestamptz column',
                    );
                }
                return;
            case IcebergPartitionTransformKind.BUCKET:
                if (!isBucketLegal(sourceType)) {
                    throw new Error(
                        `partition transform 'bucket[${this._bucketCount}]' on column '${sourceColumnName}' requires `
                        + 'an int/long/decimal/date/time/timestamp/timestamptz/string/uuid/fixed/binary column',
                    );
                }
                return;
            case IcebergPartitionTransformKind.TRUNCATE:
                if (!isTruncateLegal(sourceType)) {
                    throw new Error(
                        `partition transform 'truncate[${this._truncateWidth}]' on column '${sourceColumnName}' requires `
                        + 'an int/long/decimal/string/binary column',
                    );
                }
                return;
        }
    }
}

function isTemporal(type: IcebergType): boolean {
    return type === IcebergType.DATE
        || type === IcebergType.TIMESTAMP
        || type === IcebergType.TIMESTAMPTZ;
}

function isTimestamp(type: IcebergType): boolean {
    return type === IcebergType.TIMESTAMP
        || type === IcebergType.TIMESTAMPTZ;
}

function isBucketLegal(type: IcebergType): boolean {
    return type === IcebergType.INT
        || type === IcebergType.LONG
        || type === IcebergType.DATE
        || type === IcebergType.TIME
        || type === IcebergType.TIMESTAMP
        || type === IcebergType.TIMESTAMPTZ
        || type === IcebergType.STRING
        || type === IcebergType.UUID
        || type === IcebergType.BINARY
        || type.isDecimal()
        || type.isFixed();
}

function isTruncateLegal(type: IcebergType): boolean {
    return type === IcebergType.INT
        || type === IcebergType.LONG
        || type === IcebergType.STRING
        || type === IcebergType.BINARY
        || type.isDecimal();
}
