import {
    IcebergType,
} from './iceberg-type';

/** One top-level column in an Iceberg table. */
export interface IcebergColumn {
    /** Column name (unique within the table). */
    readonly name: string;

    /** Column type. */
    readonly type: IcebergType;

    /**
     * Whether the column is non-nullable. Defaults to `false` to
     * match the Iceberg spec default of optional fields.
     */
    readonly required?: boolean;

    /** Optional documentation string; must not start with `(PK) `. */
    readonly doc?: string;

    /**
     * Iceberg field id for this column: unique across the table schema,
     * from 1 to 2147483447. Keep it for the life of the column and never
     * give a dropped column's id to another field.
     */
    readonly id: number;
}
