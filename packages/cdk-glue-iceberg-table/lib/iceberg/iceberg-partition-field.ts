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
     * Iceberg partition field id, 1000 or above (the construct's rule,
     * checked at synth; the
     * [Iceberg spec](https://iceberg.apache.org/spec/#partition-evolution)
     * says v1 ids "were assigned sequentially starting at 1000 in the
     * reference implementation"), unique across the table's whole
     * partition-spec history. A changed transform or source column makes a
     * new field that takes a never-used id; a changed or dropped field's id
     * stays retired. A Spark read of a table whose history holds two fields
     * under one id fails with `Conflicting partition fields`. Number a new
     * table's fields 1000, 1001 and up in spec order: Glue assigns those
     * ids at creation and ignores the declared ones.
     */
    readonly fieldId: number;
}
