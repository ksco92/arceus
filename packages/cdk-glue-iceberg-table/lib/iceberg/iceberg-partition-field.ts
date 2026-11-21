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
     * Iceberg partition field id. Required: every partition field must
     * be pinned to a stable integer >= 1000 (the Iceberg spec reserves
     * ids below 1000 for schema columns) that is unique across the
     * table's entire partition-spec history — not just the current
     * spec. Iceberg's strict engines (Spark, Trino) reject a table
     * whose spec history carries two different partition fields with
     * the same id.
     *
     * The rule is the inverse of the column-id rule: a column keeps
     * its id forever, but any change to a partition field — a
     * different transform, a different source column — makes it a NEW
     * field that needs a fresh, never-before-used id. Only an
     * untouched field keeps its id across deploys. Once a field is
     * changed or dropped, its id is retired for good; the construct
     * checks retirement only against a `schemaHistoryFile`.
     */
    readonly fieldId: number;
}
