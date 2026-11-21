/** Sort direction for an Iceberg sort field. */
export enum IcebergSortDirection {
    /** Ascending — smaller values first. */
    ASC = 'asc',

    /** Descending — larger values first. */
    DESC = 'desc',
}

/** Null ordering for an Iceberg sort field. */
export enum IcebergNullOrder {
    /** Nulls precede all non-null values. */
    NULLS_FIRST = 'nulls-first',

    /** Nulls follow all non-null values. */
    NULLS_LAST = 'nulls-last',
}
