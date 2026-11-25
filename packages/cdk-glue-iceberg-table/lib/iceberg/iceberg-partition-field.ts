import {
    IcebergPartitionTransform,
} from './iceberg-partition-transform';

/** One partition spec field. */
export interface IcebergPartitionField {
    /** Name of the top-level table column this partition derives from. */
    readonly sourceColumn: string;

    /** Transform to apply to the source column. */
    readonly transform: IcebergPartitionTransform;

    /**
     * Display name for the partition field. Defaults to
     * `<sourceColumn>` for identity transforms and
     * `<sourceColumn>_<transform>` otherwise.
     */
    readonly name?: string;

    /**
     * Iceberg partition field id: 1000 or above (the construct's rule,
     * checked at synth) and unique across the table's whole partition-spec
     * history. A changed transform or source column makes a new field that
     * takes a never-used id; a changed or dropped field's id stays retired.
     * A Spark `SELECT *` from a table where `bucket(8)` of a column took
     * the id that `bucket(4)` of that column held fails with `Conflicting
     * partition fields`. Number a new table's fields 1000, 1001 and up in
     * `partitionSpec` order: Glue assigns those ids at creation and ignores
     * the declared ones.
     */
    readonly fieldId: number;
}
