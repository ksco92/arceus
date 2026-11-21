/** Table property keys the construct sets, and the enums that choose their values. */

/** Apache Iceberg format version. Required on every `IcebergTable`. */
export enum IcebergFormatVersion {
    /** v1 — read-only Hive-compatible analytic tables. */
    V1 = '1',

    /** v2 — adds row-level deletes. */
    V2 = '2',

    /** v3 — adds deletion vectors and row lineage. */
    V3 = '3',
}

/** Data-file storage format for an Iceberg table. */
export enum IcebergDataFormat {
    /** Apache Parquet (default). */
    PARQUET = 'parquet',

    /** Apache ORC. */
    ORC = 'orc',

    /** Apache Avro. */
    AVRO = 'avro',
}

/** @internal */
export const FORMAT_VERSION_KEY = 'format-version';

/** @internal */
export const WRITE_FORMAT_DEFAULT_KEY = 'write.format.default';

/**
 * Throws when a supplied `write.format.default` or `format-version` disagrees with
 * `dataFormat` or `formatVersion`.
 *
 * @internal
 */
export function validateIcebergProperties(
    dataFormat: IcebergDataFormat,
    formatVersion: IcebergFormatVersion,
    properties: { [key: string]: string },
): void {
    const declaredFormat = properties[WRITE_FORMAT_DEFAULT_KEY];
    if (declaredFormat !== undefined && declaredFormat !== dataFormat) {
        throw new Error(
            `tableProperties['${WRITE_FORMAT_DEFAULT_KEY}'] is '${declaredFormat}' `
            + `but dataFormat is '${dataFormat}'. Drop the property or change dataFormat to match.`,
        );
    }

    const declaredVersion = properties[FORMAT_VERSION_KEY];
    if (declaredVersion !== undefined && declaredVersion !== formatVersion) {
        throw new Error(
            `tableProperties['${FORMAT_VERSION_KEY}'] is '${declaredVersion}' `
            + `but formatVersion is '${formatVersion}'. Drop the property or change formatVersion to match.`,
        );
    }
}
