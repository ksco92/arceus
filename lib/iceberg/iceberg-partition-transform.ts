import {
    IcebergType,
} from './iceberg-type';

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
    public static readonly IDENTITY: IcebergPartitionTransform = new IcebergPartitionTransform(
        'identity',
        () => undefined,
    );

    /** `year` — extracts the year of a date/timestamp. */
    public static readonly YEAR: IcebergPartitionTransform = IcebergPartitionTransform.temporal(
        'year',
        false,
    );

    /** `month` — extracts the month of a date/timestamp. */
    public static readonly MONTH: IcebergPartitionTransform = IcebergPartitionTransform.temporal(
        'month',
        false,
    );

    /** `day` — extracts the day of a date/timestamp. */
    public static readonly DAY: IcebergPartitionTransform = IcebergPartitionTransform.temporal(
        'day',
        false,
    );

    /** `hour` — extracts the hour of a timestamp (not a date). */
    public static readonly HOUR: IcebergPartitionTransform = IcebergPartitionTransform.temporal(
        'hour',
        true,
    );

    /** `void` — always-null partition. Useful for partition-spec evolution. */
    public static readonly VOID: IcebergPartitionTransform = new IcebergPartitionTransform(
        'void',
        () => undefined,
    );

    /**
     * `bucket[N]` — Murmur3 hash of the source mod N.
     * @param numBuckets Number of buckets (positive integer).
     */
    public static bucket(numBuckets: number): IcebergPartitionTransform {
        if (!Number.isInteger(numBuckets) || numBuckets < 1) {
            throw new Error(`bucket() numBuckets must be a positive integer, got ${numBuckets}`);
        }
        return new IcebergPartitionTransform(
            `bucket[${numBuckets}]`,
            (columnName: string, type: IcebergType) => {
                if (!isBucketLegal(type)) {
                    throw new Error(
                        `partition transform 'bucket[${numBuckets}]' on column '${columnName}' requires `
                        + 'an int/long/decimal/date/time/timestamp/timestamptz/string/uuid/binary column',
                    );
                }
                return undefined;
            },
        );
    }

    /**
     * `truncate[W]` — truncate the source to width W.
     * @param width Width (positive integer).
     */
    public static truncate(width: number): IcebergPartitionTransform {
        if (!Number.isInteger(width) || width < 1) {
            throw new Error(`truncate() width must be a positive integer, got ${width}`);
        }
        return new IcebergPartitionTransform(
            `truncate[${width}]`,
            (columnName: string, type: IcebergType) => {
                if (!isTruncateLegal(type)) {
                    throw new Error(
                        `partition transform 'truncate[${width}]' on column '${columnName}' requires `
                        + 'an int/long/decimal/string/binary column',
                    );
                }
                return undefined;
            },
        );
    }

    private static temporal(name: string, timestampOnly: boolean): IcebergPartitionTransform {
        return new IcebergPartitionTransform(name, (columnName: string, type: IcebergType) => {
            const legal = timestampOnly ? isTimestampType(type) : isTemporalType(type);
            if (!legal) {
                const accepts = timestampOnly ? 'timestamp/timestamptz' : 'date/timestamp/timestamptz';
                throw new Error(
                    `partition transform '${name}' on column '${columnName}' requires a ${accepts} column`,
                );
            }
            return undefined;
        });
    }

    private readonly transformString: string;
    private readonly validator: (columnName: string, type: IcebergType) => void;

    private constructor(
        transformString: string,
        validator: (columnName: string, type: IcebergType) => void,
    ) {
        this.transformString = transformString;
        this.validator = validator;
    }

    /** Iceberg/Glue transform string (e.g. `identity`, `bucket[16]`, `hour`). */
    public toTransformString(): string {
        return this.transformString;
    }

    /**
     * Throws if this transform is not legal on the given source type.
     *
     * @internal
     */
    public validateSourceType(sourceColumnName: string, sourceType: IcebergType): void {
        this.validator(sourceColumnName, sourceType);
    }
}

function isTemporalType(type: IcebergType): boolean {
    return type === IcebergType.DATE
        || type === IcebergType.TIMESTAMP
        || type === IcebergType.TIMESTAMPTZ;
}

function isTimestampType(type: IcebergType): boolean {
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
