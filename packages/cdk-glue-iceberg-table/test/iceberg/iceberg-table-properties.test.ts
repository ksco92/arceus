import {
    IcebergDataFormat,
    IcebergFormatVersion,
    validateIcebergProperties,
} from '../../lib/iceberg/iceberg-table-properties';

describe('validateIcebergProperties', () => {
    it('rejects format-version that disagrees with formatVersion', () => {
        expect(() => validateIcebergProperties(
            IcebergDataFormat.PARQUET,
            IcebergFormatVersion.V3,
            {
                'format-version': '2',
            },
        )).toThrow(/format-version.*'2'.*formatVersion is '3'/);
    });

    it('accepts supplied values that match dataFormat and formatVersion', () => {
        expect(() => validateIcebergProperties(
            IcebergDataFormat.ORC,
            IcebergFormatVersion.V2,
            {
                'write.format.default': 'orc',
                'format-version': '2',
            },
        )).not.toThrow();
    });

    it('accepts a key it does not check', () => {
        expect(() => validateIcebergProperties(
            IcebergDataFormat.PARQUET,
            IcebergFormatVersion.V2,
            {
                'write.parquet.compression-codec': 'lzo',
            },
        )).not.toThrow();
    });
});
