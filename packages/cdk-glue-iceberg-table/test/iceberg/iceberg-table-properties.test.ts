import {
    IcebergDataFormat,
    IcebergFormatVersion,
    IcebergPropertyKeys,
    validateIcebergProperties,
} from '../../lib/iceberg/iceberg-table-properties';

describe('validateIcebergProperties', () => {
    it('accepts an empty property map', () => {
        expect(() => validateIcebergProperties(
            IcebergDataFormat.PARQUET,
            IcebergFormatVersion.V2,
            {},
        )).not.toThrow();
    });

    it('accepts a fully-specified parquet table', () => {
        expect(() => validateIcebergProperties(
            IcebergDataFormat.PARQUET,
            IcebergFormatVersion.V2,
            {
                [IcebergPropertyKeys.WRITE_FORMAT_DEFAULT]: 'parquet',
                [IcebergPropertyKeys.FORMAT_VERSION]: '2',
                [IcebergPropertyKeys.WRITE_PARQUET_COMPRESSION_CODEC]: 'zstd',
                [IcebergPropertyKeys.WRITE_DELETE_MODE]: 'merge-on-read',
                [IcebergPropertyKeys.WRITE_DISTRIBUTION_MODE]: 'hash',
                [IcebergPropertyKeys.GC_ENABLED]: 'true',
                [IcebergPropertyKeys.WRITE_TARGET_FILE_SIZE_BYTES]: '134217728',
            },
        )).not.toThrow();
    });

    it('rejects write.format.default that disagrees with dataFormat', () => {
        expect(() => validateIcebergProperties(
            IcebergDataFormat.PARQUET,
            IcebergFormatVersion.V2,
            {
                [IcebergPropertyKeys.WRITE_FORMAT_DEFAULT]: 'orc',
            },
        )).toThrow(/write\.format\.default.*orc.*parquet/);
    });

    it('rejects format-version that disagrees with formatVersion', () => {
        expect(() => validateIcebergProperties(
            IcebergDataFormat.PARQUET,
            IcebergFormatVersion.V2,
            {
                [IcebergPropertyKeys.FORMAT_VERSION]: '1',
            },
        )).toThrow(/format-version.*1.*2/);
    });

    it('rejects compression codec set on wrong format', () => {
        expect(() => validateIcebergProperties(
            IcebergDataFormat.PARQUET,
            IcebergFormatVersion.V2,
            {
                [IcebergPropertyKeys.WRITE_ORC_COMPRESSION_CODEC]: 'zstd',
            },
        )).toThrow(/write\.orc\.compression-codec.*parquet/);
    });

    it('rejects unsupported parquet codec', () => {
        expect(() => validateIcebergProperties(
            IcebergDataFormat.PARQUET,
            IcebergFormatVersion.V2,
            {
                [IcebergPropertyKeys.WRITE_PARQUET_COMPRESSION_CODEC]: 'bzip2',
            },
        )).toThrow(/bzip2/);
    });

    it('accepts valid orc table', () => {
        expect(() => validateIcebergProperties(
            IcebergDataFormat.ORC,
            IcebergFormatVersion.V2,
            {
                [IcebergPropertyKeys.WRITE_ORC_COMPRESSION_CODEC]: 'zlib',
            },
        )).not.toThrow();
    });

    it('accepts valid avro table', () => {
        expect(() => validateIcebergProperties(
            IcebergDataFormat.AVRO,
            IcebergFormatVersion.V2,
            {
                [IcebergPropertyKeys.WRITE_AVRO_COMPRESSION_CODEC]: 'snappy',
            },
        )).not.toThrow();
    });

    it('rejects merge-on-read on a v1 table', () => {
        expect(() => validateIcebergProperties(
            IcebergDataFormat.PARQUET,
            IcebergFormatVersion.V1,
            {
                [IcebergPropertyKeys.WRITE_DELETE_MODE]: 'merge-on-read',
            },
        )).toThrow(/merge-on-read.*v2/);
    });

    it.each([
        IcebergPropertyKeys.WRITE_DELETE_MODE,
        IcebergPropertyKeys.WRITE_UPDATE_MODE,
        IcebergPropertyKeys.WRITE_MERGE_MODE,
    ])('rejects merge-on-read on %s when v1', (key) => {
        expect(() => validateIcebergProperties(
            IcebergDataFormat.PARQUET,
            IcebergFormatVersion.V1,
            {
                [key]: 'merge-on-read',
            },
        )).toThrow(/merge-on-read.*v2/);
    });

    it('rejects invalid write mode', () => {
        expect(() => validateIcebergProperties(
            IcebergDataFormat.PARQUET,
            IcebergFormatVersion.V2,
            {
                [IcebergPropertyKeys.WRITE_MERGE_MODE]: 'weird-mode',
            },
        )).toThrow(/write\.merge\.mode.*weird-mode/);
    });

    it('rejects invalid distribution mode', () => {
        expect(() => validateIcebergProperties(
            IcebergDataFormat.PARQUET,
            IcebergFormatVersion.V2,
            {
                [IcebergPropertyKeys.WRITE_DISTRIBUTION_MODE]: 'sideways',
            },
        )).toThrow(/distribution-mode/);
    });

    it('rejects non-boolean gc.enabled', () => {
        expect(() => validateIcebergProperties(
            IcebergDataFormat.PARQUET,
            IcebergFormatVersion.V2,
            {
                [IcebergPropertyKeys.GC_ENABLED]: 'yes',
            },
        )).toThrow(/gc\.enabled.*yes/);
    });

    it.each([
        IcebergPropertyKeys.WRITE_TARGET_FILE_SIZE_BYTES,
        IcebergPropertyKeys.HISTORY_EXPIRE_MAX_SNAPSHOT_AGE_MS,
        IcebergPropertyKeys.HISTORY_EXPIRE_MIN_SNAPSHOTS_TO_KEEP,
        IcebergPropertyKeys.COMMIT_RETRY_NUM_RETRIES,
    ])('rejects non-positive-int %s', (key) => {
        expect(() => validateIcebergProperties(
            IcebergDataFormat.PARQUET,
            IcebergFormatVersion.V2,
            {
                [key]: 'twelve',
            },
        )).toThrow(new RegExp(`${key.replace(/\./g, '\\.')}`));
    });

    it.each([
        '0',
        '-5',
        '1.5',
    ])('rejects %s as a numeric property value', (value) => {
        expect(() => validateIcebergProperties(
            IcebergDataFormat.PARQUET,
            IcebergFormatVersion.V2,
            {
                [IcebergPropertyKeys.COMMIT_RETRY_NUM_RETRIES]: value,
            },
        )).toThrow(/positive integer/);
    });
});
