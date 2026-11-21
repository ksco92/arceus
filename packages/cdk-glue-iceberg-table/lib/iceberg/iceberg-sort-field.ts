import {
    IcebergPartitionTransform,
} from './iceberg-partition-transform';
import {
    IcebergNullOrder,
    IcebergSortDirection,
} from './iceberg-sort-order';

/** One write-order (sort) field. */
export interface IcebergSortField {
    /** Name of the top-level table column to sort on. */
    readonly sourceColumn: string;

    /** Transform to apply to the source column. Defaults to `identity`. */
    readonly transform?: IcebergPartitionTransform;

    /** Sort direction. Defaults to `ASC`. */
    readonly direction?: IcebergSortDirection;

    /** Null ordering. Defaults to `NULLS_LAST`. */
    readonly nullOrder?: IcebergNullOrder;
}
