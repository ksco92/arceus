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
        this.kind = options.kind;
        switch (options.kind) {
            case IcebergPartitionTransformKind.IDENTITY:
            case IcebergPartitionTransformKind.YEAR:
            case IcebergPartitionTransformKind.MONTH:
            case IcebergPartitionTransformKind.DAY:
            case IcebergPartitionTransformKind.HOUR:
            case IcebergPartitionTransformKind.VOID:
                /// These transforms carry no extra data.
                break;
            case IcebergPartitionTransformKind.BUCKET:
                if (options.bucketCount === undefined) {
                    throw new Error('bucket transform requires bucketCount');
                }
                if (!Number.isInteger(options.bucketCount) || options.bucketCount < 1) {
                    throw new Error(`bucket() numBuckets must be a positive integer, got ${options.bucketCount}`);
                }
                this.bucketCount = options.bucketCount;
                break;
            case IcebergPartitionTransformKind.TRUNCATE:
                if (options.truncateWidth === undefined) {
                    throw new Error('truncate transform requires truncateWidth');
                }
                if (!Number.isInteger(options.truncateWidth) || options.truncateWidth < 1) {
                    throw new Error(`truncate() width must be a positive integer, got ${options.truncateWidth}`);
                }
                this.truncateWidth = options.truncateWidth;
                break;
            /* istanbul ignore next: defensive — TS exhaustiveness covers this, only reachable from non-TS bindings */
            default: {
                const exhaustive: never = options.kind;
                throw new Error(`unknown IcebergPartitionTransformKind: ${exhaustive}`);
            }
        }
    }

    /** Iceberg/Glue transform string (e.g. `identity`, `bucket[16]`, `hour`). */
    public toTransformString(): string {
        switch (this.kind) {
            case IcebergPartitionTransformKind.BUCKET:
                return `bucket[${this.bucketCount}]`;
            case IcebergPartitionTransformKind.TRUNCATE:
                return `truncate[${this.truncateWidth}]`;
            case IcebergPartitionTransformKind.IDENTITY:
            case IcebergPartitionTransformKind.YEAR:
            case IcebergPartitionTransformKind.MONTH:
            case IcebergPartitionTransformKind.DAY:
            case IcebergPartitionTransformKind.HOUR:
            case IcebergPartitionTransformKind.VOID:
                return this.kind;
            /* istanbul ignore next: defensive — TS exhaustiveness covers this, only reachable from non-TS bindings */
            default: {
                const exhaustive: never = this.kind;
                throw new Error(`unknown IcebergPartitionTransformKind in toTransformString: ${exhaustive}`);
            }
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
                        `partition transform 'bucket[${this.bucketCount}]' on column '${sourceColumnName}' requires `
                        + 'an int/long/decimal/date/time/timestamp/timestamptz/string/uuid/fixed/binary column',
                    );
                }
                return;
            case IcebergPartitionTransformKind.TRUNCATE:
                if (!isTruncateLegal(sourceType)) {
                    throw new Error(
                        `partition transform 'truncate[${this.truncateWidth}]' on column '${sourceColumnName}' requires `
                        + 'an int/long/decimal/string/binary column',
                    );
                }
                return;
            /* istanbul ignore next: defensive — TS exhaustiveness covers this, only reachable from non-TS bindings */
            default: {
                const exhaustive: never = this.kind;
                throw new Error(`unknown IcebergPartitionTransformKind in validateSourceType: ${exhaustive}`);
            }
        }
    }
}

function isTemporal(type: IcebergType): boolean {
    return type.kind === IcebergTypeKind.DATE
        || type.kind === IcebergTypeKind.TIMESTAMP
        || type.kind === IcebergTypeKind.TIMESTAMPTZ;
}

function isTimestamp(type: IcebergType): boolean {
    return type.kind === IcebergTypeKind.TIMESTAMP
        || type.kind === IcebergTypeKind.TIMESTAMPTZ;
}

function isBucketLegal(type: IcebergType): boolean {
    switch (type.kind) {
        case IcebergTypeKind.INT:
        case IcebergTypeKind.LONG:
        case IcebergTypeKind.DATE:
        case IcebergTypeKind.TIME:
        case IcebergTypeKind.TIMESTAMP:
        case IcebergTypeKind.TIMESTAMPTZ:
        case IcebergTypeKind.STRING:
        case IcebergTypeKind.UUID:
        case IcebergTypeKind.BINARY:
        case IcebergTypeKind.DECIMAL:
        case IcebergTypeKind.FIXED:
            return true;
        default:
            return false;
    }
}

function isTruncateLegal(type: IcebergType): boolean {
    switch (type.kind) {
        case IcebergTypeKind.INT:
        case IcebergTypeKind.LONG:
        case IcebergTypeKind.STRING:
        case IcebergTypeKind.BINARY:
        case IcebergTypeKind.DECIMAL:
            return true;
        default:
            return false;
    }
}
