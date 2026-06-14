/**
 * Iceberg table property keys and validation.
 *
 * `AWS::Glue::Table.OpenTableFormatInput.IcebergInput.IcebergTableInput.properties`
 * is a free-form string map. Glue does not validate the keys, but
 * Athena's writer will reject queries against tables whose properties
 * contradict each other (e.g. `write.format.default=parquet` with
 * `write.parquet.compression-codec=lzo`). The L2 enforces the same
 * matrix at synth time so that misconfigured tables never make it to
 * a deploy.
 */

/** Apache Iceberg format version. Required on every `IcebergTable`. */
export enum IcebergFormatVersion {
    /** v1 — read-only Hive-compatible analytic tables. */
    V1 = '1',

    /** v2 — adds row-level deletes. */
    V2 = '2',
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

/** Canonical Iceberg property keys the L2 understands. */
export const ICEBERG_PROPERTY_KEYS = {
    FORMAT_VERSION: 'format-version',
    WRITE_FORMAT_DEFAULT: 'write.format.default',
    WRITE_PARQUET_COMPRESSION_CODEC: 'write.parquet.compression-codec',
    WRITE_ORC_COMPRESSION_CODEC: 'write.orc.compression-codec',
    WRITE_AVRO_COMPRESSION_CODEC: 'write.avro.compression-codec',
    WRITE_TARGET_FILE_SIZE_BYTES: 'write.target-file-size-bytes',
    WRITE_DELETE_MODE: 'write.delete.mode',
    WRITE_UPDATE_MODE: 'write.update.mode',
    WRITE_MERGE_MODE: 'write.merge.mode',
    WRITE_DISTRIBUTION_MODE: 'write.distribution-mode',
    GC_ENABLED: 'gc.enabled',
    HISTORY_EXPIRE_MAX_SNAPSHOT_AGE_MS: 'history.expire.max-snapshot-age-ms',
    HISTORY_EXPIRE_MIN_SNAPSHOTS_TO_KEEP: 'history.expire.min-snapshots-to-keep',
    COMMIT_RETRY_NUM_RETRIES: 'commit.retry.num-retries',
} as const;

const PARQUET_CODECS = new Set([
    'zstd',
    'snappy',
    'gzip',
    'brotli',
    'lz4',
    'uncompressed',
]);

const ORC_CODECS = new Set([
    'zstd',
    'snappy',
    'zlib',
    'lz4',
    'lzo',
    'none',
]);

const AVRO_CODECS = new Set([
    'gzip',
    'snappy',
    'zstd',
    'uncompressed',
]);

const WRITE_MODES = new Set([
    'copy-on-write',
    'merge-on-read',
]);

const DISTRIBUTION_MODES = new Set([
    'none',
    'hash',
    'range',
]);

const BOOLEAN_VALUES = new Set([
    'true',
    'false',
]);

/**
 * Validates that the merged property map for a table is internally
 * consistent. Throws `Error` on the first conflict so the user sees
 * one clear message per deploy.
 *
 * @internal
 */
export function validateIcebergProperties(
    dataFormat: IcebergDataFormat,
    formatVersion: IcebergFormatVersion,
    properties: { [key: string]: string },
): void {
    /// 1. write.format.default must match the chosen data format.
    const declaredFormat = properties[ICEBERG_PROPERTY_KEYS.WRITE_FORMAT_DEFAULT];
    if (declaredFormat !== undefined && declaredFormat !== dataFormat) {
        throw new Error(
            `tableProperties['${ICEBERG_PROPERTY_KEYS.WRITE_FORMAT_DEFAULT}'] is '${declaredFormat}' `
            + `but dataFormat is '${dataFormat}'. Drop the property or change dataFormat to match.`,
        );
    }

    /// 2. format-version must match the chosen format version.
    const declaredVersion = properties[ICEBERG_PROPERTY_KEYS.FORMAT_VERSION];
    if (declaredVersion !== undefined && declaredVersion !== formatVersion) {
        throw new Error(
            `tableProperties['${ICEBERG_PROPERTY_KEYS.FORMAT_VERSION}'] is '${declaredVersion}' `
            + `but formatVersion is '${formatVersion}'. Drop the property or change formatVersion to match.`,
        );
    }

    /// 3. Compression codec must be valid for the chosen format and
    ///    must be set on the correct codec key for that format.
    validateCompressionForFormat(dataFormat, properties);

    /// 4. write modes must be valid Iceberg literals.
    validateEnumProperty(properties, ICEBERG_PROPERTY_KEYS.WRITE_DELETE_MODE, WRITE_MODES);
    validateEnumProperty(properties, ICEBERG_PROPERTY_KEYS.WRITE_UPDATE_MODE, WRITE_MODES);
    validateEnumProperty(properties, ICEBERG_PROPERTY_KEYS.WRITE_MERGE_MODE, WRITE_MODES);
    validateEnumProperty(properties, ICEBERG_PROPERTY_KEYS.WRITE_DISTRIBUTION_MODE, DISTRIBUTION_MODES);

    /// 5. merge-on-read requires format-version=2.
    if (formatVersion === IcebergFormatVersion.V1) {
        for (const key of [
            ICEBERG_PROPERTY_KEYS.WRITE_DELETE_MODE,
            ICEBERG_PROPERTY_KEYS.WRITE_UPDATE_MODE,
            ICEBERG_PROPERTY_KEYS.WRITE_MERGE_MODE,
        ]) {
            if (properties[key] === 'merge-on-read') {
                throw new Error(
                    `tableProperties['${key}'] = 'merge-on-read' requires formatVersion v2; got v1`,
                );
            }
        }
    }

    /// 6. gc.enabled is a boolean.
    validateEnumProperty(properties, ICEBERG_PROPERTY_KEYS.GC_ENABLED, BOOLEAN_VALUES);

    /// 7. Numeric properties must parse to positive integers.
    validatePositiveInt(properties, ICEBERG_PROPERTY_KEYS.WRITE_TARGET_FILE_SIZE_BYTES);
    validatePositiveInt(properties, ICEBERG_PROPERTY_KEYS.HISTORY_EXPIRE_MAX_SNAPSHOT_AGE_MS);
    validatePositiveInt(properties, ICEBERG_PROPERTY_KEYS.HISTORY_EXPIRE_MIN_SNAPSHOTS_TO_KEEP);
    validatePositiveInt(properties, ICEBERG_PROPERTY_KEYS.COMMIT_RETRY_NUM_RETRIES);
}

function validateCompressionForFormat(
    dataFormat: IcebergDataFormat,
    properties: { [key: string]: string },
): void {
    const candidates: Array<{ key: string; allowed: ReadonlySet<string>; ownerFormat: IcebergDataFormat }> = [
        {
            key: ICEBERG_PROPERTY_KEYS.WRITE_PARQUET_COMPRESSION_CODEC,
            allowed: PARQUET_CODECS,
            ownerFormat: IcebergDataFormat.PARQUET,
        },
        {
            key: ICEBERG_PROPERTY_KEYS.WRITE_ORC_COMPRESSION_CODEC,
            allowed: ORC_CODECS,
            ownerFormat: IcebergDataFormat.ORC,
        },
        {
            key: ICEBERG_PROPERTY_KEYS.WRITE_AVRO_COMPRESSION_CODEC,
            allowed: AVRO_CODECS,
            ownerFormat: IcebergDataFormat.AVRO,
        },
    ];
    for (const candidate of candidates) {
        const value = properties[candidate.key];
        if (value === undefined) {
            continue;
        }
        if (candidate.ownerFormat !== dataFormat) {
            throw new Error(
                `tableProperties['${candidate.key}'] is set but dataFormat is '${dataFormat}'. `
                + `That codec key only applies to '${candidate.ownerFormat}' tables.`,
            );
        }
        if (!candidate.allowed.has(value)) {
            throw new Error(
                `tableProperties['${candidate.key}'] = '${value}' is not a valid ${candidate.ownerFormat} `
                + `compression codec. Allowed: ${Array.from(candidate.allowed).sort().join(', ')}.`,
            );
        }
    }
}

function validateEnumProperty(
    properties: { [key: string]: string },
    key: string,
    allowed: ReadonlySet<string>,
): void {
    const value = properties[key];
    if (value !== undefined && !allowed.has(value)) {
        throw new Error(
            `tableProperties['${key}'] = '${value}' is not valid. `
            + `Allowed: ${Array.from(allowed).sort().join(', ')}.`,
        );
    }
}

function validatePositiveInt(
    properties: { [key: string]: string },
    key: string,
): void {
    const raw = properties[key];
    if (raw === undefined) {
        return;
    }
    if (!/^[0-9]+$/.test(raw) || Number(raw) < 1) {
        throw new Error(
            `tableProperties['${key}'] = '${raw}' must be a positive integer string.`,
        );
    }
}
